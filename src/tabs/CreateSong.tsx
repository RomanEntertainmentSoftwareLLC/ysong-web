import { useEffect, useMemo, useState } from "react";
import type { TabRendererProps } from "./core";
import { useTabManager } from "./core";
import { localAiChat } from "../lib/localAiApi";
import { bridgeApi, type BridgePlugin, type InstrumentRoleIntent } from "../lib/bridgeApi";
import { getActiveBandId, listBandProfiles, setActiveBandId, type BandProfile } from "../lib/bandLibrary";
import { SCALE_DEFINITIONS, NOTE_NAMES, nearestAllowedPitch, type MidiScaleId, type MidiScaleRule } from "../lib/midi";
import { decodeAudioDuration, generateMiniMaxTrack, getMusicEngineStatus, uploadGeneratedAudio, type MusicEngineStatus } from "../lib/musicGeneration";
import { classifyVocalRole, stageGeneratedSession, type GeneratedMidiRegion, type GeneratedSessionManifest, type GeneratedSessionTrack } from "../lib/generatedSession";
import { resultFromGeneratedSession } from "../lib/songGenerationContract";
import { upsertGeneration } from "../lib/generationLibrary";
import { listSingerCharacters, saveSingerCharacter, singerIdentity, type SingerCharacter } from "../lib/singerLibrary";
import AccountPlan from "../components/AccountPlan";
import GenerationJobs from "../components/GenerationJobs";
import { apiGet, apiPost } from "../lib/authApi";
import LyricsWorkspace from "../components/LyricsWorkspace";
import { importPlainLyrics, lyricsToPlainText, type LyricsDocument } from "../lib/lyricsDocument";

const STORAGE_KEY = "ysong:create-song:draft:v3";
const RECOVERY_KEY = "ysong:create-song:recovery:v1";
const BLUEPRINT_KEY = "ysong:create-song:blueprint:v1";
const LYRICS_KEY = "ysong:create-song:lyrics:v1";
type Draft = { title: string; lyrics: string; style: string; instrumental: boolean; bpm: string; key: string; duration: string; bandId: string; singerIds: string[] };
const emptyDraft: Draft = { title: "", lyrics: "", style: "", instrumental: false, bpm: "", key: "", duration: "", bandId: "", singerIds: [] };

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

function normalizedText(raw: unknown, limit = 120): string | undefined {
  return typeof raw === "string" ? raw.trim().replace(/\s+/g, " ").slice(0, limit) || undefined : undefined;
}

function normalizeInstrumentIntent(raw: unknown): InstrumentRoleIntent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const concept = (input: unknown) => {
    const first = normalizedText(input)?.toLowerCase().split(/[\s,;/|]+/).find((part) => part.length > 1);
    return first === "ambience" ? "ambient" : first;
  };
  const intent = {
    family: concept(value.family),
    role: concept(value.role),
    timbre: concept(value.timbre),
  };
  return Object.values(intent).some(Boolean) ? intent : undefined;
}

function isVocalPart(track: Pick<GeneratedSessionTrack, "role" | "name" | "vocalRole">) {
  return Boolean(track.vocalRole) || /\b(vocal|voice|sing|singer|choir|growl|scream|rap|spoken|chant)\b/i.test(`${track.role} ${track.name}`);
}

function normalizePlan(raw: any, draft: Draft, plugins: BridgePlugin[], singers: SingerCharacter[]): PlanDraft {
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
  const usedTrackIds = new Set<string>();
  const selectedSingers = singers.filter((singer) => draft.singerIds.includes(singer.id));
  const singerById = new Map(selectedSingers.map((singer) => [singer.id, singer]));
  const tracks: GeneratedSessionTrack[] = rawTracks.slice(0, 24).map((track: any, index: number) => {
    const sourceRole = normalizedText(track?.role, 120) ?? normalizedText(track?.name, 120) ?? "arrangement part";
    const vocalRole = classifyVocalRole(sourceRole);
    const plannedName = normalizedText(track?.name, 90) ?? (vocalRole ? vocalRole.replace(/\b\w/g, (letter) => letter.toUpperCase()) : `Track ${index + 1}`);
    const baseId = safeId(track?.id, `track-${index + 1}`);
    let id = baseId;
    for (let suffix = 2; usedTrackIds.has(id); suffix++) id = `${baseId}-${suffix}`;
    usedTrackIds.add(id);
    const requestedMode = track?.mode === "midi" ? "midi" : "audio";
    const requestedPath = String(track?.vst?.path || "");
    const catalog = requestedPath ? pluginByPath.get(requestedPath) : undefined;
    // Keep MIDI candidates until Bridge has had a chance to resolve their intent.
    // The later resolution step retains the existing audio fallback when needed.
    const mode: "audio" | "midi" = requestedMode;
    const instructions = String(track?.instructions || `${sourceRole} isolated stem`).trim();
    const result: GeneratedSessionTrack = {
      id,
      name: plannedName,
      role: sourceRole,
      ...(vocalRole ? { vocalRole } : {}),
      mode,
      instructions,
      useLyrics: !draft.instrumental && Boolean(track?.useLyrics),
    };
    const plannedSinger = singerById.get(String(track?.singerId || "")) ?? (vocalRole && selectedSingers.length === 1 ? selectedSingers[0] : undefined);
    if (plannedSinger && isVocalPart(result)) result.singer = singerIdentity(plannedSinger);
    if (mode === "midi") {
      result.instrumentIntent = normalizeInstrumentIntent(track?.instrumentIntent);
      result.desiredInstrument = normalizedText(track?.desiredInstrument) ?? normalizedText(track?.role);
      result.presetHint = normalizedText(track?.vst?.presetHint, 140);
      if (catalog) result.vst = {
        name: catalog.name,
        path: catalog.path,
        vendor: catalog.vendor ?? undefined,
        presetHint: result.presetHint,
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
    singerRoster: selectedSingers.map(singerIdentity),
    tracks,
  };
}

async function resolveInstruments(plan: PlanDraft): Promise<PlanDraft> {
  const tracks = await Promise.all(plan.tracks.map(async (track): Promise<GeneratedSessionTrack> => {
    if (track.mode !== "midi") return track;
    const desired = track.desiredInstrument ? [track.desiredInstrument] : [];
    const fallback = track.vst;
    let status: NonNullable<GeneratedSessionTrack["instrumentResolution"]>["status"] = "unavailable";
    let message = "Bridge instrument matching is unavailable.";
    let match: Awaited<ReturnType<typeof bridgeApi.matchInstruments>>["matches"][number] | undefined;
    let instrumentIntent = track.instrumentIntent;
    try {
      const response = await bridgeApi.matchInstruments(desired, 12, track.instrumentIntent);
      if (response.intent) instrumentIntent = { family: response.intent.family ?? undefined, role: response.intent.role ?? undefined, timbre: response.intent.timbre ?? undefined };
      const candidates = response.matches.filter((item) => item.instrument?.loadable === true && !!item.instrument.path);
      match = candidates[0];
      if (!match) { status = "no-match"; message = "No loadable instrument matched this intent."; }
      else if (match.weakEvidence !== false || !Array.isArray(match.evidence)) { status = "weak"; message = "Bridge found only weak instrument evidence."; }
      else if (candidates[1] && candidates[1].score === match.score) { status = "ambiguous"; message = "Bridge found equally ranked instruments."; }
      else if (!(match.score > 0)) { status = "weak"; message = "Bridge found no positive match evidence."; }
      else status = "resolved";
    } catch { /* Preserve the validated legacy path or audio fallback below. */ }
    if (status === "resolved" && match) return {
      ...track,
      instrumentIntent,
      vst: { name: match.instrument.name, path: match.instrument.path, vendor: match.instrument.vendor ?? undefined, presetHint: track.presetHint },
      instrumentResolution: { status, source: "bridge-match", instrumentId: match.instrument.id, score: match.score, evidence: match.evidence, reasons: match.reasons, weakEvidence: false },
    };
    const instrumentResolution: NonNullable<GeneratedSessionTrack["instrumentResolution"]> = {
      status, source: fallback ? "legacy-path" : "none", message,
      ...(match ? { score: match.score, evidence: match.evidence, reasons: match.reasons, weakEvidence: match.weakEvidence } : {}),
    };
    return fallback ? { ...track, instrumentIntent, instrumentResolution } : {
      ...track, instrumentIntent, mode: "audio", vst: undefined, midiRegions: undefined, instrumentResolution,
    };
  }));
  return { ...plan, tracks };
}

function plannerPrompt(draft: Draft, band: BandProfile | null, plugins: BridgePlugin[], singers: SingerCharacter[]) {
  const instrumentPlugins = plugins.filter((p) => p.kind === "instrument" && p.loadable !== false);
  const pluginLines = instrumentPlugins.length ? instrumentPlugins.map((p) => `- name=${JSON.stringify(p.name)} vendor=${JSON.stringify(p.vendor || "")} category=${JSON.stringify(p.category || p.subCategories || "")} path=${JSON.stringify(p.path)}`).join("\n") : "(No usable desktop VST3 instruments are currently available.)";
  const bandContext = band ? `\nBAND / ARTIST\nName: ${band.name}\nSound: ${band.genre || "unspecified"}\nIdentity: ${band.bio || band.symbol || "unspecified"}` : "";
  const singerContext = singers.length ? `\nSINGER CHARACTERS\n${singers.map((singer) => `- singerId=${JSON.stringify(singer.id)} name=${JSON.stringify(singer.displayName)} voice=${JSON.stringify(singer.voiceDescription)} range=${JSON.stringify(singer.vocalRange)} style=${JSON.stringify(singer.vocalStyle)}`).join("\n")}\nAssign an exact singerId from this roster to each vocal track. Different vocal roles may use different singers.` : "";
  return `YSong CREATE SONG PRODUCER MODE\nYou are the producer/orchestrator between the user's musical request, MiniMax Music 3, the YSong DAW, and the installed VST3 instruments. Build an EDITABLE MULTITRACK SESSION, not a flattened song.\n\nHARD RULES\n1. Explicit user BPM, key, scale/mode, meter, lyrics, required instruments, exclusions, and section instructions are HARD CONSTRAINTS. Never reinterpret them. E Phrygian means pitch classes E F G A B C D for MIDI tracks.\n2. Never invent lyric lines, titles, style-token words, or prompt phrases for the singer. Only tracks with useLyrics=true may receive the supplied lyrics.\n3. Split the production into separate logical tracks: lead vocal, harmony vocal, backing vocal, vocal doubles, ad-libs, ensemble/group vocals, guitars, bass, drums, synths, pads, arps, strings, effects, etc. Keep every explicitly requested vocal role on its own named audio track, with a unique id and a specific role. Do not combine separate vocal roles or unrelated parts. Request one isolated performance per audio track; do not claim the provider can separate a mixed result. Use neutral role labels unless the user's source explicitly supplies singer identity; do not invent a singer.\n4. Prefer mode=midi when an installed VST3 instrument is genuinely appropriate. For each MIDI part provide instrumentIntent with concise family, role, and timbre labels plus desiredInstrument text. Bridge resolves the final instrument. If supplying a vst.path as a fallback, copy it EXACTLY from the list; never invent a path or plugin.\n5. For MIDI tracks, create compact repeating midiRegions. Every note must obey the requested key/mode. Use startBars and lengthBars relative to the region. Keep patterns musically useful and editable.\n6. If no suitable installed VST exists, mode MUST be audio. Audio is the quality-preserving fallback; never substitute General MIDI for a generated song part.\n7. For audio tracks, instructions must request ONE ISOLATED STEM ONLY, while repeating the exact global BPM/key/mode, section map, role, and explicit exclusions.\n8. MiniMax itself may disobey prompts. Make hardConstraints and forbidden explicit so YSong can validate/enforce what it can before accepting a session.\n9. The structuredCaption must follow MiniMax Music 3's three-heading shape exactly: ### Global Metadata, ### Vocal Details, ### Arrangement.\n10. Return JSON ONLY. No markdown fences, explanations, or comments.\n\nINSTALLED VST3 INSTRUMENTS\n${pluginLines}${bandContext}${singerContext}\n\nUSER SONG BRIEF\nTitle: ${draft.title || "Untitled"}\nInstrumental: ${draft.instrumental}\nStyle: ${draft.style || "unspecified"}\nLyrics:\n${draft.instrumental ? "[Instrumental]" : (draft.lyrics || "(none supplied)")}\nExplicit BPM: ${draft.bpm || "unspecified"}\nExplicit key / mode: ${draft.key || "unspecified"}\nTarget duration: ${draft.duration || "unspecified"}\n\nRETURN THIS JSON SHAPE\n{\n  "projectName":"...",\n  "bpm":128,\n  "keyRoot":0,\n  "keyLabel":"C minor",\n  "scaleId":"natural-minor",\n  "sigNum":4,\n  "sigDen":4,\n  "totalBars":96,\n  "hardConstraints":["..."],\n  "forbidden":["..."],\n  "structuredCaption":"### Global Metadata\\n...\\n\\n### Vocal Details\\n...\\n\\n### Arrangement\\n...",\n  "sections":[{"name":"Intro","startBar":1,"endBar":8}],\n  "tracks":[\n    {\n      "id":"lead-vocal",\n      "name":"Lead Vocal",\n      "role":"lead vocal",\n      "singerId":"exact-stable-singer-id",\n      "mode":"audio",\n      "useLyrics":true,\n      "instructions":"Lead vocal isolated stem only..."\n    },\n    {\n      "id":"synth-pad",\n      "name":"Synth Pad",\n      "role":"warm analog pad",\n      "mode":"midi",\n      "useLyrics":false,\n      "instructions":"Warm analog pad...",\n      "instrumentIntent":{"family":"synth","role":"pad","timbre":"warm"},\n      "desiredInstrument":"warm analog pad",\n      "vst":{"name":"EXACT INSTALLED NAME","path":"EXACT INSTALLED PATH","vendor":"...","presetHint":"warm slow-attack pad"},\n      "midiRegions":[{"startBar":1,"lengthBars":4,"repeatCount":4,"notes":[{"pitch":60,"startBars":0,"lengthBars":4,"velocity":82}]}]\n    }\n  ]\n}`;
}

function buildMiniMaxTrackInstructions(plan: PlanDraft, track: GeneratedSessionTrack) {
  const sections = plan.sections.map((s) => `${s.name}: bars ${s.startBar}-${s.endBar}`).join("; ");
  const constraints = plan.hardConstraints.length ? plan.hardConstraints.map((x) => `- ${x}`).join("\n") : "- Preserve the supplied musical specification exactly.";
  const forbidden = plan.forbidden.length ? plan.forbidden.map((x) => `- ${x}`).join("\n") : "- Do not add unrequested lyrics, spoken words, or unrelated instruments.";
  const singer = track.singer ? `\nSINGER IDENTITY\nStable singer ID: ${track.singer.id}\nDisplay name: ${track.singer.displayName}\nVoice: ${track.singer.voiceDescription || "unspecified"}\nRange: ${track.singer.vocalRange || "unspecified"}\nStyle: ${track.singer.vocalStyle || "unspecified"}\nTreat this as durable character direction for this role.` : "";
  return `YSong isolated multitrack generation.\n\nHARD CONSTRAINTS\n${constraints}\n- Tempo: exactly ${plan.bpm} BPM.\n- Key / mode: exactly ${plan.keyLabel}.\n- Meter: ${plan.sigNum}/${plan.sigDen}.\n- This output must contain ONLY the ${track.name} / ${track.role} part. No full mix. No other instrument families.\n- Preserve full-song timeline and silence when this part is not active so it aligns at bar 1 in YSong.\n\nFORBIDDEN\n${forbidden}\n\nSECTION MAP\n${sections || `Full arrangement: bars 1-${plan.totalBars}`}\n\nTRACK DIRECTION\n${track.instructions}${singer}\n\nGLOBAL MINI MAX STRUCTURED CAPTION\n${plan.structuredCaption}`;
}

export default function CreateSongPane(_props: TabRendererProps) {
  const { tabs, openTab, activateTab } = useTabManager();
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const old = JSON.parse(localStorage.getItem("ysong:create-song:draft:v2") || localStorage.getItem("ysong:create-song:draft:v1") || "{}");
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { ...emptyDraft, ...old, ...current, bandId: current.bandId || getActiveBandId() || "", singerIds: Array.isArray(current.singerIds) ? current.singerIds : [] };
    } catch { return { ...emptyDraft, bandId: getActiveBandId() || "" }; }
  });
  const [lyricsDocument, setLyricsDocument] = useState<LyricsDocument>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LYRICS_KEY) || "null");
      if (saved?.id && Array.isArray(saved.sections) && Array.isArray(saved.versions)) return saved;
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const old = JSON.parse(localStorage.getItem("ysong:create-song:draft:v2") || localStorage.getItem("ysong:create-song:draft:v1") || "{}");
      return importPlainLyrics(current.lyrics || old.lyrics || "");
    } catch { return importPlainLyrics(""); }
  });
  const [bands, setBands] = useState<BandProfile[]>([]);
  const [singers, setSingers] = useState<SingerCharacter[]>([]);
  const [newSinger, setNewSinger] = useState({ displayName: "", voiceDescription: "", vocalRange: "", vocalStyle: "", avatar: null as File | null });
  const [plugins, setPlugins] = useState<BridgePlugin[]>([]);
  const [engine, setEngine] = useState<MusicEngineStatus | null>(null);
  const [plan, setPlan] = useState<PlanDraft | null>(() => {
    try { const saved = JSON.parse(localStorage.getItem(BLUEPRINT_KEY) || "null"); return saved?.plan?.tracks?.length ? saved.plan : null; } catch { return null; }
  });
  const [recovery, setRecovery] = useState<{ plan: PlanDraft; manifest: GeneratedSessionManifest } | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RECOVERY_KEY) || "null");
      return saved?.plan?.tracks && saved?.manifest?.tracks && saved?.manifest?.result?.parts ? saved : null;
    } catch { return null; }
  });
  const [planApproved, setPlanApproved] = useState(() => {
    try { return JSON.parse(localStorage.getItem(BLUEPRINT_KEY) || "null")?.approved === true; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [quantity,setQuantity]=useState(1);
  const [entitlement,setEntitlement]=useState<{enabled:boolean;remaining:number|null;superadmin:boolean}|null>(null);
  const [parentId,setParentId]=useState<string|undefined>();
  useEffect(()=>{void apiGet<{enabled:boolean;remaining:number|null;superadmin:boolean}>('/api/account/entitlements').then(setEntitlement).catch(()=>{});},[]);
  const reuseRequest=_props.tab.payload?.reuseGeneration as {requestId:string;title:string;prompt:string;lyrics:string;parentId?:string}|undefined;
  useEffect(()=>{if(!reuseRequest)return;setDraft(old=>({...old,title:reuseRequest.title,style:reuseRequest.prompt,lyrics:reuseRequest.lyrics}));setLyricsDocument(importPlainLyrics(reuseRequest.lyrics));setParentId(reuseRequest.parentId);setPlan(null);setPlanApproved(false);setRecovery(null);},[reuseRequest]);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(draft)); } catch {} }, [draft]);
  useEffect(() => { try { localStorage.setItem(LYRICS_KEY, JSON.stringify(lyricsDocument)); } catch { /* Storage can be unavailable in private browsing. */ } }, [lyricsDocument]);
  useEffect(() => { try { localStorage.setItem(BLUEPRINT_KEY, JSON.stringify({ plan, approved: planApproved })); } catch {} }, [plan, planApproved]);
  useEffect(() => { try { if (recovery) localStorage.setItem(RECOVERY_KEY, JSON.stringify(recovery)); else localStorage.removeItem(RECOVERY_KEY); } catch {} }, [recovery]);
  useEffect(() => {
    const load = () => void listBandProfiles().then(setBands).catch(() => {});
    load();
    window.addEventListener("ysong:bands-changed", load);
    return () => window.removeEventListener("ysong:bands-changed", load);
  }, []);
  useEffect(() => {
    const load = () => void listSingerCharacters().then(setSingers).catch(() => {});
    load();
    window.addEventListener("ysong:singers-changed", load);
    return () => window.removeEventListener("ysong:singers-changed", load);
  }, []);
  useEffect(() => {
    bridgeApi.getPlugins().then((r) => setPlugins(r.plugins ?? [])).catch(() => setPlugins([]));
    void refreshEngine();
  }, []);

  const patch = (next: Partial<Draft>) => { setDraft((d) => ({ ...d, ...next })); setPlan(null); setPlanApproved(false); };
  const changeLyrics = (next: LyricsDocument) => { setLyricsDocument(next); patch({ lyrics: lyricsToPlainText(next) }); };
  const selectedBand = useMemo(() => bands.find((b) => b.id === draft.bandId) ?? null, [bands, draft.bandId]);
  const selectedSingers = useMemo(() => singers.filter((singer) => draft.singerIds.includes(singer.id)), [singers, draft.singerIds]);
  const usableVsts = useMemo(() => plugins.filter((p) => p.kind === "instrument" && p.loadable !== false), [plugins]);

  async function createSinger() {
    const displayName = newSinger.displayName.trim();
    if (!displayName) { setError("Give the singer a display name."); return; }
    try {
      const id = crypto.randomUUID();
      const saved = await saveSingerCharacter({
        id, displayName, avatar: newSinger.avatar, avatarName: newSinger.avatar?.name,
        voiceDescription: newSinger.voiceDescription.trim(), vocalRange: newSinger.vocalRange.trim(),
        vocalStyle: newSinger.vocalStyle.trim(), tags: [],
      });
      setSingers((current) => [saved, ...current.filter((singer) => singer.id !== saved.id)]);
      patch({ singerIds: [...draft.singerIds, saved.id] });
      setNewSinger({ displayName: "", voiceDescription: "", vocalRange: "", vocalStyle: "", avatar: null });
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this singer character.");
    }
  }

  function toggleSinger(id: string) {
    patch({ singerIds: draft.singerIds.includes(id) ? draft.singerIds.filter((value) => value !== id) : [...draft.singerIds, id] });
  }

  function assignSinger(trackId: string, singer: SingerCharacter) {
    setPlan((current) => current ? { ...current, tracks: current.tracks.map((track) => track.id === trackId ? { ...track, singer: singerIdentity(singer) } : track) } : current);
    setPlanApproved(false);
  }

  async function refreshEngine() {
    try { setEngine(await getMusicEngineStatus()); }
    catch (e) { setEngine({ configured: true, reachable: false, baseUrl: "", model: "minimax_ttm", message: e instanceof Error ? e.message : "MiniMax status failed." }); }
  }

  async function planSession(): Promise<PlanDraft | null> {
    setBusy(true); setError(""); setProgress("YSong AI is turning the brief into a strict multitrack session…");
    try {
      const reply = await localAiChat([
        { role: "system", content: plannerPrompt(draft, selectedBand, plugins, selectedSingers) },
        { role: "user", content: "Build the session manifest now. Return JSON only." },
      ]);
      const normalized = await resolveInstruments(normalizePlan(parseJsonReply(reply), draft, plugins, singers));
      setPlan(normalized);
      setPlanApproved(false);
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
      const retrying = !!recovery;
      const activePlan = recovery?.plan ?? plan;
      if (!activePlan || (!retrying && !planApproved)) {
        setError("Review and approve the session blueprint before generation. YSong will not create a pile of tracks from an unapproved plan.");
        return;
      }
      const priorManifest = recovery?.manifest;
      if(entitlement?.enabled) {
        const token=localStorage.getItem('ys_token')??localStorage.getItem('ysong_auth_token');
        if(!token)throw new Error('Sign in before generation.');
        const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
        const owner=claims.uid??claims.id??claims.sub;
        if(typeof owner!=='string')throw new Error('Sign in before generation.');
        const pendingKey=`ysong:create-song:pending-batch:v1:${owner}`;
        const pending=JSON.parse(localStorage.getItem(pendingKey)??'null');
        const request=pending??{requestKey:crypto.randomUUID(),quantity,parentId,prompt:draft.style,lyrics:draft.instrumental?'[Instrumental]':draft.lyrics,
          plan:{...activePlan,tracks:activePlan.tracks.map(track=>({...track,renderInstructions:buildMiniMaxTrackInstructions(activePlan,track)}))}};
        const current=await apiGet<{remaining:number|null;superadmin:boolean}>('/api/account/entitlements');
        if(!pending&&!current.superadmin&&(current.remaining===null||quantity>current.remaining))throw new Error(`This request requires ${quantity} generation credits; ${current.remaining??0} remain.`);
        localStorage.setItem(pendingKey,JSON.stringify(request));
        setProgress('Saving batch request. If the response is interrupted, submit again to recover the same job.');
        await apiPost('/api/generations/batches',request);
        localStorage.removeItem(pendingKey);setProgress(`Batch saved: ${request.quantity} versions. You can leave this page; Generation History tracks their progress.`);
        window.dispatchEvent(new CustomEvent('ysong:jobs-submitted'));
        setEntitlement(await apiGet('/api/account/entitlements'));
        return;
      }
      const priorById = new Map((priorManifest?.tracks ?? []).map((track) => [track.id, track]));
      const priorResult = priorManifest?.result;
      const pendingIds = new Set(priorResult?.parts.filter((part) => part.status === "failed").map((part) => part.id) ?? activePlan.tracks.map((track) => track.id));
      const audioTracks = activePlan.tracks.filter((t) => t.mode === "audio" && pendingIds.has(t.id));
      let generationEngine: MusicEngineStatus | undefined;
      if (audioTracks.length) {
        const status = await getMusicEngineStatus();
        generationEngine = status;
        setEngine(status);
        if (!status.reachable) throw new Error(status.message || `MiniMax Music 3 is not reachable through ${status.provider === "audio_cpp" ? "the local audio.cpp runtime" : (status.baseUrl || "the configured endpoint")}.`);
      }

      const completed: GeneratedSessionTrack[] = activePlan.tracks.filter((track) => !pendingIds.has(track.id)).map((track) => priorById.get(track.id) ?? track);
      const failures = new Map<string, { code: "generation_failed" | "upload_failed"; message: string }>(priorResult?.parts.flatMap((part) => part.status === "failed" && !pendingIds.has(part.id) ? [[part.id, part.failure!] as const] : []) ?? []);
      const sharedSeed = priorResult?.source.seed ?? Math.floor(Math.random() * 2_000_000_000);
      for (let i = 0; i < activePlan.tracks.length; i++) {
        const track = activePlan.tracks[i];
        if (!pendingIds.has(track.id)) continue;
        if (track.mode === "midi") {
          setProgress(`Building editable MIDI/VST track ${i + 1}/${activePlan.tracks.length}: ${track.name}`);
          completed.push(track);
          continue;
        }
        setProgress(`Generating isolated audio track ${i + 1}/${activePlan.tracks.length}: ${track.name}`);
        const durationSeconds = Math.max(2, Math.min(600, activePlan.totalBars * activePlan.sigNum * (4 / activePlan.sigDen) * (60 / activePlan.bpm)));
        let blob: Blob;
        try { blob = await generateMiniMaxTrack({
          lyrics: track.useLyrics && !draft.instrumental ? (draft.lyrics || "[Instrumental]") : "[Instrumental]",
          instructions: buildMiniMaxTrackInstructions(activePlan, track),
          seed: sharedSeed,
          maxNewTokens: 9000,
          durationSeconds,
          quality: "standard",
        }); } catch (error) {
          failures.set(track.id, { code: "generation_failed", message: error instanceof Error ? error.message : "Audio generation failed." });
          completed.push(track);
          continue;
        }
        const durationSec = await decodeAudioDuration(blob).catch(() => undefined);
        setProgress(`Saving ${track.name} into YSong…`);
        const safeName = `${activePlan.projectName}-${track.name}`.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 150) || `Generated-${i + 1}`;
        try {
          const uploaded = await uploadGeneratedAudio(blob, `${safeName}.wav`);
          completed.push({ ...track, objectKey: uploaded.objectKey, durationSec });
        } catch (error) {
          failures.set(track.id, { code: "upload_failed", message: error instanceof Error ? error.message : "Audio upload failed." });
          completed.push(track);
        }
      }

      const manifest: GeneratedSessionManifest = { ...activePlan, v: 1, sessionId: priorManifest?.sessionId ?? crypto.randomUUID(), createdAt: priorManifest?.createdAt ?? Date.now(), tracks: activePlan.tracks.map((track) => completed.find((item) => item.id === track.id) ?? track) };
      const result = resultFromGeneratedSession(manifest,
        { origin: "create-song", prompt: activePlan.structuredCaption || "", seed: sharedSeed },
        { provider: generationEngine?.provider || "ysong-midi", name: generationEngine?.model || "structured-midi" }, failures);
      manifest.result = result;
      const nextRecovery = result.status === "complete" ? null : { plan: activePlan, manifest };
      // Save before tab navigation can unmount Create Song and skip its effects.
      localStorage.setItem(BLUEPRINT_KEY, JSON.stringify({ plan: activePlan, approved: true }));
      if (nextRecovery) localStorage.setItem(RECOVERY_KEY, JSON.stringify(nextRecovery));
      else localStorage.removeItem(RECOVERY_KEY);
      setRecovery(nextRecovery);
      if (result.status === "failed") {
        upsertGeneration({ id: result.id, status: "failed", title: manifest.projectName, createdAt: result.createdAt,
          source: { prompt: result.source.prompt, origin: "create-song" }, artifacts: [], songResult: result,
          error: "All generated parts failed. Review the part failures and try again." });
        throw new Error("All generated parts failed. No project was created.");
      }
      stageGeneratedSession(manifest);
      setProgress(result.status === "partial" ? "Partial session saved. Ready parts are kept; retry the missing parts below." : "Session generated. Opening the editable YSong project…");
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
          <div className="flex items-center justify-between gap-3"><span><b>{engine?.model === "minimax/music-2.6" ? "MiniMax Music 2.6" : "MiniMax Music 3"}:</b> {engine?.reachable ? `ready · ${engine.provider === "audio_cpp" ? `audio.cpp ${engine.backend || "local"}` : engine.model}${engine.busy ? " · busy" : ""}` : "local engine offline"}</span><button type="button" onClick={() => void refreshEngine()} className="rounded-lg border border-white/10 px-2 py-1">Check</button></div>
          {!engine?.reachable && <div className="mt-1 opacity-70">YSong can still plan the editable session. Audio generation starts once the local/open-weights engine is ready.</div>}
        </div>
        <AccountPlan quantity={quantity} />
        {entitlement?.enabled&&<label className="block text-sm">Quantity / Versions <input className="input" type="number" min={1} max={20} step={1} value={quantity} onChange={e=>setQuantity(Math.max(1,Math.min(20,Math.floor(Number(e.target.value)||1))))}/><span className="text-xs opacity-70">This generation reserves {quantity} credits; each saved usable version consumes one credit.</span></label>}
        <GenerationJobs />
        <Field label="Song title"><input value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Untitled song" className="input" /></Field>
        <Field label="Band / artist"><select className="input" value={draft.bandId} onChange={(e) => { const band = bands.find((item) => item.id === e.target.value); patch({ bandId: e.target.value, ...(band?.singerIds?.length ? { singerIds: band.singerIds } : {}) }); if (e.target.value) setActiveBandId(e.target.value); }}><option value="">No saved band selected</option>{bands.map((b) => <option key={b.id} value={b.id}>{b.name || "Untitled Band"}</option>)}</select></Field>
        {selectedBand && <div className="rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-xs text-neutral-400"><b className="text-neutral-200">{selectedBand.name}</b>{selectedBand.genre ? ` · ${selectedBand.genre}` : ""}<div className="mt-1">Band identity is included in the producer brief.</div></div>}
        {!draft.instrumental && <div className="rounded-xl border border-white/10 bg-white/[.025] p-3 space-y-3">
          <div><div className="text-[11px] uppercase tracking-wider text-neutral-500">Singer characters</div><div className="text-xs text-neutral-400 mt-1">Select reusable singers, then assign their avatar to each vocal part in the blueprint.</div></div>
          <div className="flex flex-wrap gap-2">{singers.map((singer) => <SingerBubble key={singer.id} singer={singer} active={draft.singerIds.includes(singer.id)} onClick={() => toggleSinger(singer.id)} />)}{!singers.length && <span className="text-xs text-neutral-500">Create your first singer below.</span>}</div>
          <div className="grid grid-cols-2 gap-2"><input className="input" value={newSinger.displayName} onChange={(e) => setNewSinger((value) => ({ ...value, displayName: e.target.value }))} placeholder="Singer name" /><input className="input" value={newSinger.vocalRange} onChange={(e) => setNewSinger((value) => ({ ...value, vocalRange: e.target.value }))} placeholder="Range (alto, bass…)" /><input className="input col-span-2" value={newSinger.voiceDescription} onChange={(e) => setNewSinger((value) => ({ ...value, voiceDescription: e.target.value }))} placeholder="Voice profile (warm, raspy, clean…)" /><input className="input" value={newSinger.vocalStyle} onChange={(e) => setNewSinger((value) => ({ ...value, vocalStyle: e.target.value }))} placeholder="Style / delivery" /><label className="input text-xs text-neutral-400 cursor-pointer truncate"><input type="file" accept="image/*" className="hidden" onChange={(e) => setNewSinger((value) => ({ ...value, avatar: e.target.files?.[0] ?? null }))} />{newSinger.avatar?.name || "Choose avatar"}</label></div>
          <button type="button" onClick={() => void createSinger()} className="rounded-lg border border-indigo-400/30 bg-indigo-500/15 px-3 py-1.5 text-xs">Save singer</button>
        </div>}
        <label className="flex items-center gap-3 rounded-xl border border-white/10 p-3"><input type="checkbox" checked={draft.instrumental} onChange={(e) => patch({ instrumental: e.target.checked })} /><span className="text-sm">Instrumental</span></label>
        {!draft.instrumental && <LyricsWorkspace document={lyricsDocument} onChange={changeLyrics} />}
        <Field label="Style"><textarea value={draft.style} onChange={(e) => patch({ style: e.target.value })} placeholder="Genre, instruments, mood, vocal style, production direction…" className="input min-h-[120px] resize-y" /></Field>
        <div className="grid grid-cols-3 gap-2"><Field label="BPM"><input value={draft.bpm} onChange={(e) => patch({ bpm: e.target.value })} placeholder="Auto" className="input" /></Field><Field label="Key / mode"><input value={draft.key} onChange={(e) => patch({ key: e.target.value })} placeholder="E Phrygian" className="input" /></Field><Field label="Length"><input value={draft.duration} onChange={(e) => patch({ duration: e.target.value })} placeholder="Auto" className="input" /></Field></div>
        <div className="text-[11px] text-neutral-500">Installed VST3 instruments visible to the producer: {usableVsts.length}. If none fits a part, YSong asks MiniMax for a separate audio track instead of silently substituting General MIDI.</div>
        <div className="flex flex-wrap gap-2"><button onClick={() => void planSession()} disabled={busy || generating || (!draft.style.trim() && !draft.lyrics.trim())} className="rounded-xl px-4 py-2 bg-indigo-500/25 border border-indigo-400/30 disabled:opacity-35">{busy ? "Planning…" : "Plan editable session"}</button>{plan && !planApproved && <button onClick={() => { setPlanApproved(true); setProgress("Session blueprint approved. Generation is now unlocked, but nothing has been created yet."); }} disabled={busy || generating} className="rounded-xl px-4 py-2 bg-emerald-500/15 border border-emerald-400/30 disabled:opacity-35">Approve blueprint</button>}{recovery && <button type="button" onClick={() => void generateSession()} disabled={busy || generating} className="rounded-xl px-4 py-2 bg-amber-500/15 border border-amber-400/30 text-amber-100 disabled:opacity-35">{generating ? "Retrying missing parts…" : `Retry ${recovery.manifest.result?.parts.filter((part) => part.status === "failed").length ?? 0} missing part(s)`}</button>}<button onClick={() => void generateSession()} disabled={busy || generating || !plan || !planApproved || (!draft.style.trim() && !draft.lyrics.trim())} className="rounded-xl px-4 py-2 bg-fuchsia-500/20 border border-fuchsia-400/30 disabled:opacity-35">{generating ? "Generating…" : "Generate Session"}</button></div>
        {recovery?.manifest.result && <div role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/[.05] p-3 text-xs"><div className="font-medium text-amber-100">Partial result · {recovery.manifest.result.parts.filter((part) => part.status === "ready").length} parts ready</div><div className="mt-2 space-y-1">{recovery.manifest.result.parts.map((part) => <div key={part.id} className={part.status === "ready" ? "text-emerald-200" : "text-amber-200"}>{part.status === "ready" ? "Ready" : "Needs retry"} · {part.name}{part.failure ? `: ${part.failure.message}` : ""}</div>)}</div><p className="mt-2 text-neutral-400">Retry runs only missing parts. Ready audio and editable MIDI are preserved.</p></div>}
        {(progress || error) && <div className={`rounded-xl border px-3 py-2 text-xs ${error ? "border-red-400/25 bg-red-400/[.06] text-red-200" : "border-white/10 bg-white/[.03] text-neutral-300"}`}>{error || progress}</div>}
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.035] min-h-[560px] p-5">
        <div className="flex items-center justify-between gap-3"><div><div className="text-xs uppercase tracking-widest text-neutral-500">Session blueprint</div><h2 className="text-xl font-semibold mt-1">What YSong will build</h2></div><button onClick={sendToAgent} className="rounded-xl px-3 py-2 text-sm border border-white/10 hover:bg-white/5">Open in DAW AI</button></div>
        {!plan ? <div className="mt-5 text-sm leading-6 text-neutral-400">Plan the song first. The surfer dude will turn your brief into hard musical constraints, a MiniMax structured caption, separate audio parts, and editable MIDI/VST parts chosen from the instruments Bridge can actually see.</div> : <div className="mt-5 space-y-5">
          <div className="grid sm:grid-cols-4 gap-2"><Stat label="Tempo" value={`${plan.bpm} BPM`} /><Stat label="Key / mode" value={plan.keyLabel} /><Stat label="Meter" value={`${plan.sigNum}/${plan.sigDen}`} /><Stat label="Tracks" value={String(plan.tracks.length)} /></div>
          <div className={`rounded-xl border px-3 py-2 text-xs ${planApproved ? "border-emerald-400/25 bg-emerald-400/[.06] text-emerald-100" : "border-amber-400/25 bg-amber-400/[.06] text-amber-100"}`}>{planApproved ? "✓ Blueprint approved. Generate Session is unlocked." : "Blueprint is proposal-only. Review it and press Approve blueprint before YSong may create tracks."}</div>
          <div><SectionTitle>Hard constraints</SectionTitle><div className="mt-2 flex flex-wrap gap-2">{plan.hardConstraints.length ? plan.hardConstraints.map((x, i) => <span key={i} className="rounded-full border border-amber-300/20 bg-amber-300/[.06] px-2.5 py-1 text-xs text-amber-100">{x}</span>) : <span className="text-xs text-neutral-500">No explicit hard constraints beyond the session specification.</span>}</div></div>
          <div><SectionTitle>Tracks</SectionTitle><div className="mt-2 grid lg:grid-cols-2 gap-2">{plan.tracks.map((track) => <div key={track.id} className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="flex items-center gap-2"><b className="text-sm">{track.name}</b><span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] ${track.mode === "midi" ? "bg-cyan-400/10 text-cyan-200" : "bg-fuchsia-400/10 text-fuchsia-200"}`}>{track.mode === "midi" ? "MIDI + VST" : "AUDIO"}</span></div><div className="text-xs text-neutral-500 mt-1">{track.role}</div>{isVocalPart(track) && selectedSingers.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{selectedSingers.map((singer) => <SingerBubble key={singer.id} singer={singer} active={track.singer?.id === singer.id} compact onClick={() => assignSinger(track.id, singer)} />)}</div>}{track.vst && <div className="text-xs text-cyan-200/75 mt-2">{track.vst.name}{track.vst.presetHint ? ` · ${track.vst.presetHint}` : ""}</div>}{track.instrumentResolution && <div className="mt-1 text-[11px] text-neutral-400">{track.instrumentResolution.status === "resolved" ? `Bridge match${track.instrumentResolution.score != null ? ` (${track.instrumentResolution.score})` : ""}: ${track.instrumentResolution.reasons?.[0] ?? "instrument tag evidence"}` : `${track.instrumentResolution.message} ${track.instrumentResolution.source === "legacy-path" ? "Using the validated planner choice." : "Using an audio part."}`}</div>}</div>)}</div></div>
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

function SingerBubble({ singer, active, compact = false, onClick }: { singer: SingerCharacter; active: boolean; compact?: boolean; onClick: () => void }) {
  const [avatarUrl, setAvatarUrl] = useState("");
  useEffect(() => {
    if (!singer.avatar) { setAvatarUrl(""); return; }
    const url = URL.createObjectURL(singer.avatar);
    setAvatarUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [singer.avatar]);
  return <button type="button" onClick={onClick} title={`${singer.displayName}${singer.voiceDescription ? ` · ${singer.voiceDescription}` : ""}`} className={`rounded-full border flex items-center gap-1.5 pr-2 transition ${active ? "border-indigo-300 bg-indigo-400/20 text-indigo-100" : "border-white/10 bg-black/20 text-neutral-400"}`}>
    <span className={`${compact ? "h-6 w-6 text-[9px]" : "h-8 w-8 text-[10px]"} rounded-full overflow-hidden bg-indigo-500/20 grid place-items-center font-bold shrink-0`}>{avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : singer.displayName.slice(0, 2).toUpperCase()}</span>
    <span className={`${compact ? "text-[10px]" : "text-xs"} max-w-28 truncate`}>{singer.displayName}</span>
  </button>;
}
