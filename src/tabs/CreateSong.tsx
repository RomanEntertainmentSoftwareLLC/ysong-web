import { useEffect, useMemo, useState } from "react";
import type { TabRendererProps } from "./core";
import { useTabManager } from "./core";
import { localAiChat } from "../lib/localAiApi";
import { YSONG_SYSTEM_PROMPT } from "../lib/ysongPersona";
import { bridgeApi, type BridgePlugin } from "../lib/bridgeApi";
import { getActiveBandId, listBandProfiles, setActiveBandId, type BandProfile } from "../lib/bandLibrary";
import { SCALE_DEFINITIONS, NOTE_NAMES, nearestAllowedPitch, type MidiScaleId, type MidiScaleRule } from "../lib/midi";
import { decodeAudioDuration, generateMiniMaxTrack, getMusicEngineStatus, uploadGeneratedAudio, type MusicEngineStatus } from "../lib/musicGeneration";
import { stageGeneratedSession, type GeneratedMidiRegion, type GeneratedSessionManifest, type GeneratedSessionTrack } from "../lib/generatedSession";

const STORAGE_KEY = "ysong:create-song:draft:v3";
type Draft = { title: string; lyrics: string; style: string; instrumental: boolean; bpm: string; key: string; duration: string; bandId: string };
const emptyDraft: Draft = { title: "", lyrics: "", style: "", instrumental: false, bpm: "", key: "", duration: "", bandId: "" };

type PlanDraft = Omit<GeneratedSessionManifest, "createdAt" | "v">;

function safeId(raw: unknown, fallback: string) {
  const clean = String(raw ?? "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return clean || fallback;
}

function numberIn(raw: unknown, fallback: number, min: number, max: number) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function parseJsonReply(raw: string) {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("YSong AI did not return a usable session manifest.");
  return JSON.parse(text.slice(start, end + 1));
}

function scaleFromText(raw: string): MidiScaleId | null {
  const s = raw.toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ").trim();
  const aliases: Array<[RegExp, MidiScaleId]> = [
    [/phrygian\s+dominant/, "phrygian-dominant"],
    [/harmonic\s+minor/, "harmonic-minor"],
    [/melodic\s+minor/, "melodic-minor"],
    [/major\s+pentatonic/, "major-pentatonic"],
    [/minor\s+pentatonic/, "minor-pentatonic"],
    [/natural\s+minor|aeolian|\bminor\b/, "natural-minor"],
    [/ionian|\bmajor\b/, "major"],
    [/mixolydian/, "mixolydian"],
    [/phrygian/, "phrygian"],
    [/locrian/, "locrian"],
    [/lydian/, "lydian"],
    [/dorian/, "dorian"],
    [/blues/, "blues"],
    [/chromatic/, "chromatic"],
  ];
  return aliases.find(([re]) => re.test(s))?.[1] ?? null;
}

function rootFromText(raw: string): number | null {
  const m = raw.trim().match(/^([A-Ga-g])([#b]?)/);
  if (!m) return null;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = base[m[1].toUpperCase()];
  if (m[2] === "#") pc += 1;
  if (m[2] === "b") pc -= 1;
  return (pc + 12) % 12;
}

function normalizeMidiRegions(raw: unknown, scaleRule: MidiScaleRule, totalBars: number): GeneratedMidiRegion[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 64).map((region: any, regionIndex) => {
    const startBar = numberIn(region?.startBar, 1, 1, totalBars);
    const lengthBars = numberIn(region?.lengthBars, 4, 0.125, Math.max(0.125, totalBars - startBar + 1));
    const repeatCount = Math.round(numberIn(region?.repeatCount, 1, 1, 64));
    const notes = Array.isArray(region?.notes) ? region.notes.slice(0, 512).map((note: any) => ({
      pitch: nearestAllowedPitch(Math.round(numberIn(note?.pitch, 60, 0, 127)), [scaleRule]),
      startBars: numberIn(note?.startBars, 0, 0, lengthBars),
      lengthBars: numberIn(note?.lengthBars, 0.25, 1 / 128, lengthBars),
      velocity: Math.round(numberIn(note?.velocity, 96, 1, 127)),
    })) : [];
    return { startBar, lengthBars, repeatCount, notes, _regionIndex: regionIndex } as GeneratedMidiRegion & { _regionIndex: number };
  }).filter((region) => region.notes.length > 0).map(({ _regionIndex: _ignored, ...region }) => region);
}

function normalizePlan(raw: any, draft: Draft, plugins: BridgePlugin[]): PlanDraft {
  const explicitBpm = Number(draft.bpm);
  const bpm = Number.isFinite(explicitBpm) && explicitBpm >= 20 ? Math.round(explicitBpm) : Math.round(numberIn(raw?.bpm, 120, 20, 400));
  const explicitRoot = rootFromText(draft.key);
  const explicitScale = scaleFromText(draft.key);
  const root = explicitRoot ?? Math.round(numberIn(raw?.keyRoot, rootFromText(String(raw?.keyLabel || "C")) ?? 0, 0, 11));
  const scaleId = explicitScale ?? scaleFromText(String(raw?.scaleId || raw?.keyLabel || "")) ?? "natural-minor";
  const scaleRule: MidiScaleRule = { id: "generated-session-scale", root, scaleId };
  const totalBars = Math.round(numberIn(raw?.totalBars, 64, 4, 512));
  const pluginByPath = new Map(plugins.filter((p) => p.kind === "instrument" && p.loadable !== false).map((p) => [p.path, p] as const));
  const rawTracks = Array.isArray(raw?.tracks) ? raw.tracks : [];
  const tracks: GeneratedSessionTrack[] = rawTracks.slice(0, 24).map((track: any, index: number) => {
    const requestedMode = track?.mode === "midi" ? "midi" : "audio";
    const requestedPath = String(track?.vst?.path || "");
    const catalog = requestedPath ? pluginByPath.get(requestedPath) : undefined;
    // For generated sessions, missing/imaginary VSTs never fall back to GM. The
    // quality-preserving fallback is a separately generated audio track.
    const mode: "audio" | "midi" = requestedMode === "midi" && catalog ? "midi" : "audio";
    const instructions = String(track?.instructions || `${track?.role || track?.name || "Music part"} isolated stem`).trim();
    const result: GeneratedSessionTrack = {
      id: safeId(track?.id, `track-${index + 1}`),
      name: String(track?.name || `Track ${index + 1}`).trim().slice(0, 90),
      role: String(track?.role || "arrangement part").trim().slice(0, 120),
      mode,
      instructions,
      useLyrics: !draft.instrumental && Boolean(track?.useLyrics),
    };
    if (mode === "midi" && catalog) {
      result.vst = {
        name: catalog.name,
        path: catalog.path,
        vendor: catalog.vendor ?? undefined,
        presetHint: String(track?.vst?.presetHint || "").trim().slice(0, 140) || undefined,
      };
      result.midiRegions = normalizeMidiRegions(track?.midiRegions, scaleRule, totalBars);
      if (!result.midiRegions.length) {
        // No symbolic performance means there is nothing editable to play. Preserve
        // musical quality by turning this one part back into an audio generation.
        result.mode = "audio";
        delete result.vst;
        delete result.midiRegions;
      }
    }
    return result;
  });
  if (!tracks.length) throw new Error("YSong AI returned a session with no tracks.");

  const explicitKeyLabel = draft.key.trim();
  const scaleLabel = SCALE_DEFINITIONS.find((s) => s.id === scaleId)?.label ?? scaleId;
  const keyLabel = explicitKeyLabel || `${NOTE_NAMES[root]} ${scaleLabel}`;
  const hardConstraints: string[] = Array.isArray(raw?.hardConstraints) ? raw.hardConstraints.map(String).filter(Boolean).slice(0, 40) : [];
  if (Number.isFinite(explicitBpm) && explicitBpm >= 20 && !hardConstraints.some((x) => /bpm/i.test(x))) hardConstraints.unshift(`Tempo must remain exactly ${bpm} BPM.`);
  if (explicitKeyLabel && !hardConstraints.some((x) => /key|scale|mode|phrygian|dorian|lydian|locrian|minor|major/i.test(x))) hardConstraints.unshift(`Tonal center / mode must remain exactly ${explicitKeyLabel}.`);

  return {
    projectName: String(raw?.projectName || draft.title || "Generated Song").trim().slice(0, 120) || "Generated Song",
    bpm,
    keyRoot: root,
    keyLabel,
    scaleId,
    sigNum: Math.round(numberIn(raw?.sigNum, 4, 1, 32)),
    sigDen: [1, 2, 4, 8, 16].includes(Number(raw?.sigDen)) ? Number(raw.sigDen) : 4,
    totalBars,
    instrumental: draft.instrumental,
    hardConstraints,
    forbidden: Array.isArray(raw?.forbidden) ? raw.forbidden.map(String).filter(Boolean).slice(0, 40) : [],
    structuredCaption: String(raw?.structuredCaption || "").trim(),
    sections: Array.isArray(raw?.sections) ? raw.sections.slice(0, 32).map((section: any, index: number) => ({
      name: String(section?.name || `Section ${index + 1}`).slice(0, 80),
      startBar: numberIn(section?.startBar, 1, 1, totalBars),
      endBar: numberIn(section?.endBar, totalBars, 1, totalBars),
    })) : [],
    tracks,
  };
}

function plannerPrompt(draft: Draft, band: BandProfile | null, plugins: BridgePlugin[]) {
  const instrumentPlugins = plugins.filter((p) => p.kind === "instrument" && p.loadable !== false);
  const pluginLines = instrumentPlugins.length ? instrumentPlugins.map((p) => `- name=${JSON.stringify(p.name)} vendor=${JSON.stringify(p.vendor || "")} category=${JSON.stringify(p.category || p.subCategories || "")} path=${JSON.stringify(p.path)}`).join("\n") : "(No usable desktop VST3 instruments are currently available.)";
  const bandContext = band ? `\nBAND / ARTIST\nName: ${band.name}\nSound: ${band.genre || "unspecified"}\nIdentity: ${band.bio || band.symbol || "unspecified"}` : "";
  return `${YSONG_SYSTEM_PROMPT}\n\nYSong CREATE SONG PRODUCER MODE\nYou are the producer/orchestrator between the user's musical request, MiniMax Music 3, the YSong DAW, and the installed VST3 instruments. Build an EDITABLE MULTITRACK SESSION, not a flattened song.\n\nHARD RULES\n1. Explicit user BPM, key, scale/mode, meter, lyrics, required instruments, exclusions, and section instructions are HARD CONSTRAINTS. Never reinterpret them. E Phrygian means pitch classes E F G A B C D for MIDI tracks.\n2. Never invent lyric lines, titles, style-token words, or prompt phrases for the singer. Only tracks with useLyrics=true may receive the supplied lyrics.\n3. Split the production into separate logical tracks: lead vocal, backing vocals/choir, guitars, bass, drums, synths, pads, arps, strings, effects, etc. Do not collapse unrelated parts together.\n4. Prefer mode=midi ONLY when one of the INSTALLED VST3 instruments below is genuinely appropriate. The vst.path must be copied EXACTLY from the list. Never invent a VST path or plugin.\n5. For MIDI tracks, create compact repeating midiRegions. Every note must obey the requested key/mode. Use startBars and lengthBars relative to the region. Keep patterns musically useful and editable.\n6. If no suitable installed VST exists, mode MUST be audio. Audio is the quality-preserving fallback; never substitute General MIDI for a generated song part.\n7. For audio tracks, instructions must request ONE ISOLATED STEM ONLY, while repeating the exact global BPM/key/mode, section map, role, and explicit exclusions.\n8. MiniMax itself may disobey prompts. Make hardConstraints and forbidden explicit so YSong can validate/enforce what it can before accepting a session.\n9. The structuredCaption must follow MiniMax Music 3's three-heading shape exactly: ### Global Metadata, ### Vocal Details, ### Arrangement.\n10. Return JSON ONLY. No markdown fences, explanations, or comments.\n\nINSTALLED VST3 INSTRUMENTS\n${pluginLines}${bandContext}\n\nUSER SONG BRIEF\nTitle: ${draft.title || "Untitled"}\nInstrumental: ${draft.instrumental}\nStyle: ${draft.style || "unspecified"}\nLyrics:\n${draft.instrumental ? "[Instrumental]" : (draft.lyrics || "(none supplied)")}\nExplicit BPM: ${draft.bpm || "unspecified"}\nExplicit key / mode: ${draft.key || "unspecified"}\nTarget duration: ${draft.duration || "unspecified"}\n\nRETURN THIS JSON SHAPE\n{\n  "projectName":"...",\n  "bpm":128,\n  "keyRoot":0,\n  "keyLabel":"C minor",\n  "scaleId":"natural-minor",\n  "sigNum":4,\n  "sigDen":4,\n  "totalBars":96,\n  "hardConstraints":["..."],\n  "forbidden":["..."],\n  "structuredCaption":"### Global Metadata\\n...\\n\\n### Vocal Details\\n...\\n\\n### Arrangement\\n...",\n  "sections":[{"name":"Intro","startBar":1,"endBar":8}],\n  "tracks":[\n    {\n      "id":"lead-vocal",\n      "name":"Lead Vocal",\n      "role":"lead vocal",\n      "mode":"audio",\n      "useLyrics":true,\n      "instructions":"Lead vocal isolated stem only..."\n    },\n    {\n      "id":"synth-pad",\n      "name":"Synth Pad",\n      "role":"warm analog pad",\n      "mode":"midi",\n      "useLyrics":false,\n      "instructions":"Warm analog pad...",\n      "vst":{"name":"EXACT INSTALLED NAME","path":"EXACT INSTALLED PATH","vendor":"...","presetHint":"warm slow-attack pad"},\n      "midiRegions":[{"startBar":1,"lengthBars":4,"repeatCount":4,"notes":[{"pitch":60,"startBars":0,"lengthBars":4,"velocity":82}]}]\n    }\n  ]\n}`;
}

function buildMiniMaxTrackInstructions(plan: PlanDraft, track: GeneratedSessionTrack) {
  const sections = plan.sections.map((s) => `${s.name}: bars ${s.startBar}-${s.endBar}`).join("; ");
  const constraints = plan.hardConstraints.length ? plan.hardConstraints.map((x) => `- ${x}`).join("\n") : "- Preserve the supplied musical specification exactly.";
  const forbidden = plan.forbidden.length ? plan.forbidden.map((x) => `- ${x}`).join("\n") : "- Do not add unrequested lyrics, spoken words, or unrelated instruments.";
  return `YSong isolated multitrack generation.\n\nHARD CONSTRAINTS\n${constraints}\n- Tempo: exactly ${plan.bpm} BPM.\n- Key / mode: exactly ${plan.keyLabel}.\n- Meter: ${plan.sigNum}/${plan.sigDen}.\n- This output must contain ONLY the ${track.name} / ${track.role} part. No full mix. No other instrument families.\n- Preserve full-song timeline and silence when this part is not active so it aligns at bar 1 in YSong.\n\nFORBIDDEN\n${forbidden}\n\nSECTION MAP\n${sections || `Full arrangement: bars 1-${plan.totalBars}`}\n\nTRACK DIRECTION\n${track.instructions}\n\nGLOBAL MINI MAX STRUCTURED CAPTION\n${plan.structuredCaption}`;
}

export default function CreateSongPane(_props: TabRendererProps) {
  const { tabs, openTab, activateTab } = useTabManager();
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const old = JSON.parse(localStorage.getItem("ysong:create-song:draft:v2") || localStorage.getItem("ysong:create-song:draft:v1") || "{}");
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { ...emptyDraft, ...old, ...current, bandId: current.bandId || getActiveBandId() || "" };
    } catch { return { ...emptyDraft, bandId: getActiveBandId() || "" }; }
  });
  const [bands, setBands] = useState<BandProfile[]>([]);
  const [plugins, setPlugins] = useState<BridgePlugin[]>([]);
  const [engine, setEngine] = useState<MusicEngineStatus | null>(null);
  const [plan, setPlan] = useState<PlanDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(draft)); } catch {} }, [draft]);
  useEffect(() => {
    const load = () => void listBandProfiles().then(setBands).catch(() => {});
    load();
    window.addEventListener("ysong:bands-changed", load);
    return () => window.removeEventListener("ysong:bands-changed", load);
  }, []);
  useEffect(() => {
    bridgeApi.getPlugins().then((r) => setPlugins(r.plugins ?? [])).catch(() => setPlugins([]));
    void refreshEngine();
  }, []);

  const patch = (next: Partial<Draft>) => { setDraft((d) => ({ ...d, ...next })); setPlan(null); };
  const selectedBand = useMemo(() => bands.find((b) => b.id === draft.bandId) ?? null, [bands, draft.bandId]);
  const usableVsts = useMemo(() => plugins.filter((p) => p.kind === "instrument" && p.loadable !== false), [plugins]);

  async function refreshEngine() {
    try { setEngine(await getMusicEngineStatus()); }
    catch (e) { setEngine({ configured: true, reachable: false, baseUrl: "", model: "minimax_ttm", message: e instanceof Error ? e.message : "MiniMax status failed." }); }
  }

  async function planSession(): Promise<PlanDraft | null> {
    setBusy(true); setError(""); setProgress("YSong AI is turning the brief into a strict multitrack session…");
    try {
      const reply = await localAiChat([
        { role: "system", content: plannerPrompt(draft, selectedBand, plugins) },
        { role: "user", content: "Build the session manifest now. Return JSON only." },
      ]);
      const normalized = normalizePlan(parseJsonReply(reply), draft, plugins);
      setPlan(normalized);
      setProgress(`Planned ${normalized.tracks.length} tracks: ${normalized.tracks.filter((t) => t.mode === "midi").length} editable MIDI/VST, ${normalized.tracks.filter((t) => t.mode === "audio").length} generated audio.`);
      return normalized;
    } catch (e) {
      setError(e instanceof Error ? e.message : "YSong AI could not build the session plan.");
      setProgress("");
      return null;
    } finally { setBusy(false); }
  }

  async function generateSession() {
    if (generating) return;
    setGenerating(true); setError("");
    try {
      const activePlan = plan ?? await planSession();
      if (!activePlan) return;
      const audioTracks = activePlan.tracks.filter((t) => t.mode === "audio");
      if (audioTracks.length) {
        const status = await getMusicEngineStatus();
        setEngine(status);
        if (!status.reachable) throw new Error(status.message || `MiniMax Music 3 is not reachable through ${status.provider === "audio_cpp" ? "the local audio.cpp runtime" : (status.baseUrl || "the configured endpoint")}.`);
      }

      const completed: GeneratedSessionTrack[] = [];
      const sharedSeed = Math.floor(Math.random() * 2_000_000_000);
      for (let i = 0; i < activePlan.tracks.length; i++) {
        const track = activePlan.tracks[i];
        if (track.mode === "midi") {
          setProgress(`Building editable MIDI/VST track ${i + 1}/${activePlan.tracks.length}: ${track.name}`);
          completed.push(track);
          continue;
        }
        setProgress(`Generating isolated audio track ${i + 1}/${activePlan.tracks.length}: ${track.name}`);
        const durationSeconds = Math.max(2, Math.min(600, activePlan.totalBars * activePlan.sigNum * (4 / activePlan.sigDen) * (60 / activePlan.bpm)));
        const blob = await generateMiniMaxTrack({
          lyrics: track.useLyrics && !draft.instrumental ? (draft.lyrics || "[Instrumental]") : "[Instrumental]",
          instructions: buildMiniMaxTrackInstructions(activePlan, track),
          seed: sharedSeed,
          maxNewTokens: 9000,
          durationSeconds,
          quality: "standard",
        });
        const durationSec = await decodeAudioDuration(blob).catch(() => undefined);
        setProgress(`Saving ${track.name} into YSong…`);
        const safeName = `${activePlan.projectName}-${track.name}`.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 150) || `Generated-${i + 1}`;
        const uploaded = await uploadGeneratedAudio(blob, `${safeName}.wav`);
        completed.push({ ...track, objectKey: uploaded.objectKey, durationSec });
      }

      const manifest: GeneratedSessionManifest = { v: 1, createdAt: Date.now(), ...activePlan, tracks: completed };
      stageGeneratedSession(manifest);
      setProgress("Session generated. Opening the editable YSong project…");
      const existingDaw = tabs.find((t) => t.type === "daw");
      const dawId = existingDaw?.id ?? openTab({ type: "daw", title: "DAW", pinned: true });
      activateTab(dawId);
      window.setTimeout(() => window.dispatchEvent(new Event("ysong:generated-session-staged")), 120);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally { setGenerating(false); }
  }

  function sendToAgent() {
    const bandContext = selectedBand ? `\nArtist / band: ${selectedBand.name}\nIdentity / sound: ${selectedBand.genre || selectedBand.bio || selectedBand.symbol || "unspecified"}` : "";
    const brief = `Help me build this song in the DAW.\nTitle: ${draft.title || "Untitled"}\nStyle: ${draft.style || "unspecified"}${bandContext}\n${draft.instrumental ? "Instrumental." : `Lyrics:\n${draft.lyrics || "(not written yet)"}`}\n${plan ? `\nStrict plan: ${plan.bpm} BPM, ${plan.keyLabel}, ${plan.tracks.length} tracks.\n${plan.structuredCaption}` : ""}`;
    try { localStorage.setItem("ysong:daw-agent:brief", brief); } catch {}
    const existingDaw = tabs.find((t) => t.type === "daw");
    const dawId = existingDaw?.id ?? openTab({ type: "daw", title: "DAW", pinned: true });
    activateTab(dawId);
    window.setTimeout(() => window.dispatchEvent(new Event("ysong:daw-agent-open")), 80);
  }

  return <div className="h-full overflow-y-auto bg-neutral-950 text-neutral-100">
    <div className="max-w-7xl mx-auto p-5 lg:p-8 grid xl:grid-cols-[430px_1fr] gap-5">
      <section className="space-y-4">
        <div><div className="text-xs uppercase tracking-[0.22em] text-indigo-300">YSong Studio</div><h1 className="text-3xl font-semibold mt-1">Create Song</h1><p className="text-sm text-neutral-400 mt-2">YSong AI produces the strict session plan; MiniMax Music 3 performs the audio-only parts. Synth parts become MIDI + your installed VSTs whenever YSong can do that cleanly.</p></div>
        <div className={`rounded-xl border px-3 py-2 text-xs ${engine?.reachable ? "border-emerald-400/20 bg-emerald-400/[.06] text-emerald-200" : "border-amber-400/20 bg-amber-400/[.06] text-amber-100"}`}>
          <div className="flex items-center justify-between gap-3"><span><b>MiniMax Music 3:</b> {engine?.reachable ? `ready · ${engine.provider === "audio_cpp" ? `audio.cpp ${engine.backend || "local"}` : engine.model}${engine.busy ? " · busy" : ""}` : "local engine offline"}</span><button type="button" onClick={() => void refreshEngine()} className="rounded-lg border border-white/10 px-2 py-1">Check</button></div>
          {!engine?.reachable && <div className="mt-1 opacity-70">YSong can still plan the editable session. Audio generation starts once the local/open-weights engine is ready.</div>}
        </div>
        <Field label="Song title"><input value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Untitled song" className="input" /></Field>
        <Field label="Band / artist"><select className="input" value={draft.bandId} onChange={(e) => { patch({ bandId: e.target.value }); if (e.target.value) setActiveBandId(e.target.value); }}><option value="">No saved band selected</option>{bands.map((b) => <option key={b.id} value={b.id}>{b.name || "Untitled Band"}</option>)}</select></Field>
        {selectedBand && <div className="rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-xs text-neutral-400"><b className="text-neutral-200">{selectedBand.name}</b>{selectedBand.genre ? ` · ${selectedBand.genre}` : ""}<div className="mt-1">Band identity is included in the producer brief.</div></div>}
        <label className="flex items-center gap-3 rounded-xl border border-white/10 p-3"><input type="checkbox" checked={draft.instrumental} onChange={(e) => patch({ instrumental: e.target.checked })} /><span className="text-sm">Instrumental</span></label>
        {!draft.instrumental && <Field label="Lyrics"><textarea value={draft.lyrics} onChange={(e) => patch({ lyrics: e.target.value })} placeholder="Write or paste lyrics…" className="input min-h-[230px] resize-y" /></Field>}
        <Field label="Style"><textarea value={draft.style} onChange={(e) => patch({ style: e.target.value })} placeholder="Genre, instruments, mood, vocal style, production direction…" className="input min-h-[120px] resize-y" /></Field>
        <div className="grid grid-cols-3 gap-2"><Field label="BPM"><input value={draft.bpm} onChange={(e) => patch({ bpm: e.target.value })} placeholder="Auto" className="input" /></Field><Field label="Key / mode"><input value={draft.key} onChange={(e) => patch({ key: e.target.value })} placeholder="E Phrygian" className="input" /></Field><Field label="Length"><input value={draft.duration} onChange={(e) => patch({ duration: e.target.value })} placeholder="Auto" className="input" /></Field></div>
        <div className="text-[11px] text-neutral-500">Installed VST3 instruments visible to the producer: {usableVsts.length}. If none fits a part, YSong asks MiniMax for a separate audio track instead of silently substituting General MIDI.</div>
        <div className="flex flex-wrap gap-2"><button onClick={() => void planSession()} disabled={busy || generating || (!draft.style.trim() && !draft.lyrics.trim())} className="rounded-xl px-4 py-2 bg-indigo-500/25 border border-indigo-400/30 disabled:opacity-35">{busy ? "Planning…" : "Plan editable session"}</button><button onClick={() => void generateSession()} disabled={busy || generating || (!draft.style.trim() && !draft.lyrics.trim())} className="rounded-xl px-4 py-2 bg-fuchsia-500/20 border border-fuchsia-400/30 disabled:opacity-35">{generating ? "Generating…" : "Generate Session"}</button></div>
        {(progress || error) && <div className={`rounded-xl border px-3 py-2 text-xs ${error ? "border-red-400/25 bg-red-400/[.06] text-red-200" : "border-white/10 bg-white/[.03] text-neutral-300"}`}>{error || progress}</div>}
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.035] min-h-[560px] p-5">
        <div className="flex items-center justify-between gap-3"><div><div className="text-xs uppercase tracking-widest text-neutral-500">Session blueprint</div><h2 className="text-xl font-semibold mt-1">What YSong will build</h2></div><button onClick={sendToAgent} className="rounded-xl px-3 py-2 text-sm border border-white/10 hover:bg-white/5">Open in DAW AI</button></div>
        {!plan ? <div className="mt-5 text-sm leading-6 text-neutral-400">Plan the song first. The surfer dude will turn your brief into hard musical constraints, a MiniMax structured caption, separate audio parts, and editable MIDI/VST parts chosen from the instruments Bridge can actually see.</div> : <div className="mt-5 space-y-5">
          <div className="grid sm:grid-cols-4 gap-2"><Stat label="Tempo" value={`${plan.bpm} BPM`} /><Stat label="Key / mode" value={plan.keyLabel} /><Stat label="Meter" value={`${plan.sigNum}/${plan.sigDen}`} /><Stat label="Tracks" value={String(plan.tracks.length)} /></div>
          <div><SectionTitle>Hard constraints</SectionTitle><div className="mt-2 flex flex-wrap gap-2">{plan.hardConstraints.length ? plan.hardConstraints.map((x, i) => <span key={i} className="rounded-full border border-amber-300/20 bg-amber-300/[.06] px-2.5 py-1 text-xs text-amber-100">{x}</span>) : <span className="text-xs text-neutral-500">No explicit hard constraints beyond the session specification.</span>}</div></div>
          <div><SectionTitle>Tracks</SectionTitle><div className="mt-2 grid lg:grid-cols-2 gap-2">{plan.tracks.map((track) => <div key={track.id} className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="flex items-center gap-2"><b className="text-sm">{track.name}</b><span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] ${track.mode === "midi" ? "bg-cyan-400/10 text-cyan-200" : "bg-fuchsia-400/10 text-fuchsia-200"}`}>{track.mode === "midi" ? "MIDI + VST" : "AUDIO"}</span></div><div className="text-xs text-neutral-500 mt-1">{track.role}</div>{track.vst && <div className="text-xs text-cyan-200/75 mt-2">{track.vst.name}{track.vst.presetHint ? ` · ${track.vst.presetHint}` : ""}</div>}</div>)}</div></div>
          <details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-sm">MiniMax structured caption</summary><pre className="mt-3 whitespace-pre-wrap text-xs leading-5 text-neutral-400 font-sans">{plan.structuredCaption}</pre></details>
        </div>}
      </section>
    </div>
    <style>{`.input{width:100%;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.28);border-radius:.75rem;padding:.65rem .75rem;outline:none}.input:focus{border-color:rgba(129,140,248,.55)}`}</style>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="block text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5">{label}</span>{children}</label>; }
function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div><div className="text-sm mt-1">{value}</div></div>; }
function SectionTitle({ children }: { children: React.ReactNode }) { return <div className="text-xs uppercase tracking-widest text-neutral-500">{children}</div>; }
