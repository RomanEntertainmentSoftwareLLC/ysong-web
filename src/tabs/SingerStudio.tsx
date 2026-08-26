import { useEffect, useMemo, useState, type DragEvent } from "react";
import type { TabRendererProps } from "./core";
import { fetchAccountArtists, fetchSingers, saveSinger, type AccountArtist, type SingerProfile } from "../lib/artistApi";
import { uploadProfileAsset } from "../lib/profileApi";

type VoiceMode = "generate" | "reference" | "blend";
const blank = (): SingerProfile => ({ id: crypto.randomUUID(), name: "", description: "", voiceType: "", artistIds: [], referenceAudioObjectKey: "" });

export default function SingerStudioPane(_props: TabRendererProps) {
  const [artists, setArtists] = useState<AccountArtist[]>([]);
  const [singers, setSingers] = useState<SingerProfile[]>([]);
  const [draft, setDraft] = useState<SingerProfile>(() => blank());
  const [mode, setMode] = useState<VoiceMode>("generate");
  const [refFile, setRefFile] = useState<File | null>(null);
  const [draggingRef, setDraggingRef] = useState(false);
  const [blendAmount, setBlendAmount] = useState(35);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = () => Promise.all([fetchAccountArtists(), fetchSingers()]).then(([a, s]) => { setArtists(a.artists || []); setSingers(s.singers || []); });
  useEffect(() => { void refresh().catch(() => {}); }, []);
  const linked = useMemo(() => new Set(draft.artistIds || []), [draft.artistIds]);
  const toggleArtist = (id: string) => setDraft((d) => ({ ...d, artistIds: linked.has(id) ? d.artistIds.filter((x) => x !== id) : [...d.artistIds, id] }));

  const chooseReference = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(wav|flac|mp3|m4a|aac|ogg)$/i.test(file.name)) return setMessage("Choose an audio file for the reference voice.");
    setRefFile(file); setMessage("");
  };
  const dropReference = (e: DragEvent<HTMLLabelElement>) => { e.preventDefault(); setDraggingRef(false); chooseReference(e.dataTransfer.files?.[0]); };

  const save = async () => {
    if (!draft.name.trim()) return setMessage("Give this singer a name first.");
    setBusy(true); setMessage("");
    try {
      let referenceAudioObjectKey = draft.referenceAudioObjectKey || "";
      if (refFile) { const up = await uploadProfileAsset(refFile); referenceAudioObjectKey = up.objectKey; }
      await saveSinger({ ...draft, name: draft.name.trim(), referenceAudioObjectKey });
      setDraft((d) => ({ ...d, referenceAudioObjectKey })); setRefFile(null); setMessage("Singer saved to your account."); await refresh();
    } catch (e: any) { setMessage(e?.message || "Could not save singer."); } finally { setBusy(false); }
  };

  const generationUnavailable = () => setMessage("Voice generation is not connected yet. This UI is ready for the future YSong voice engine; no fake voice was generated.");

  return <div className="h-full overflow-y-auto bg-neutral-950 text-white"><div className="max-w-6xl mx-auto p-5 lg:p-8 space-y-6">
    <div><div className="text-xs uppercase tracking-[.22em] text-violet-300">Voice Library</div><h1 className="text-3xl font-semibold mt-1">Singer Studio</h1><p className="text-sm text-neutral-400 mt-2">Create a persistent singer from a generated description, an authorized reference, or a blend of both. Every path saves into the same reusable singer identity for future Create Song and band assignments.</p></div>
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5">
      <section className="rounded-2xl border border-white/10 bg-white/[.025] p-4 space-y-4">
        <div className="inline-flex rounded-xl border border-white/10 bg-black/25 p-1">
          {([['generate','Generate Voice'],['reference','Upload Reference'],['blend','Blend']] as [VoiceMode,string][]).map(([id,label]) => <button key={id} onClick={() => { setMode(id); setMessage(""); }} className={`rounded-lg px-3 py-2 text-sm transition ${mode === id ? "bg-violet-500/20 text-violet-100 shadow-sm" : "text-neutral-400 hover:text-white"}`}>{label}</button>)}
        </div>

        <Field label="Singer name"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Raven" /></Field>
        <Field label="Voice description"><textarea className="input min-h-28" value={draft.voiceType} onChange={(e) => setDraft({ ...draft, voiceType: e.target.value })} placeholder="Warm smoky alto, intimate verses, clean powerful belt, slight rasp, restrained vibrato…" /></Field>
        <Field label="Performance notes"><textarea className="input min-h-24" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Range, accent, languages, phrasing, vibrato, breathiness, preferred styles…" /></Field>

        {(mode === "reference" || mode === "blend") && <Field label="Authorized reference vocal"><label onDragEnter={(e) => { e.preventDefault(); setDraggingRef(true); }} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDraggingRef(true); }} onDragLeave={() => setDraggingRef(false)} onDrop={dropReference} className={`block rounded-xl border border-dashed p-4 cursor-pointer transition ${draggingRef ? "border-violet-300 bg-violet-500/10" : "border-white/15 hover:bg-white/5"}`}><input type="file" accept="audio/*,.wav,.flac,.mp3,.m4a" className="hidden" onChange={(e) => { chooseReference(e.target.files?.[0]); e.currentTarget.value = ""; }} /><div className="font-medium">{draggingRef ? "Drop vocal reference" : refFile?.name || (draft.referenceAudioObjectKey ? "Reference vocal saved" : "+ Drop or upload an authorized vocal sample")}</div><div className="text-xs text-neutral-500 mt-1">Use your own voice or audio you have permission to use.</div></label></Field>}

        {mode === "blend" && <Field label={`Reference influence · ${blendAmount}%`}><input type="range" min="0" max="100" value={blendAmount} onChange={(e) => setBlendAmount(Number(e.target.value))} className="w-full" /><div className="text-xs text-neutral-500 mt-1">Planned control for balancing generated character with an authorized reference. It is not applied until the voice engine supports blending.</div></Field>}

        {(mode === "generate" || mode === "blend") && <div className="rounded-xl border border-violet-400/15 bg-violet-500/5 p-3"><div className="text-sm font-medium">Voice audition</div><p className="text-xs text-neutral-500 mt-1">The generation provider is intentionally not faked. When YSong's voice engine lands, this area will generate short auditions, regenerate choices, and let you choose “Use This Voice.”</p><button onClick={generationUnavailable} className="mt-3 rounded-xl px-4 py-2 bg-violet-500/20 border border-violet-400/30 text-sm">Generate Voice Audition</button></div>}

        <div><div className="text-sm font-medium mb-2">Bands / artists</div><div className="flex flex-wrap gap-2">{artists.length ? artists.map((a) => <button key={a.id} onClick={() => toggleArtist(a.id)} className={`rounded-full border px-3 py-1.5 text-sm ${linked.has(a.id) ? "border-violet-400 bg-violet-500/15" : "border-white/10"}`}>{a.name}</button>) : <span className="text-xs text-neutral-500">Create an artist/band first if you want to link this singer.</span>}</div></div>
        {message && <div className="text-sm text-violet-200">{message}</div>}
        <div className="flex gap-2"><button onClick={() => void save()} disabled={busy} className="rounded-xl px-4 py-2 bg-violet-500/20 border border-violet-400/30 disabled:opacity-40">{busy ? "Saving…" : "Save Singer"}</button><button onClick={() => { setDraft(blank()); setRefFile(null); setMode("generate"); setMessage(""); }} className="rounded-xl px-4 py-2 border border-white/10">New Singer</button></div>
      </section>
      <aside className="rounded-2xl border border-white/10 bg-white/[.025] p-3"><div className="text-xs uppercase tracking-widest text-neutral-500 mb-2">Saved singers</div><div className="space-y-2">{singers.length ? singers.map((s) => <button key={s.id} onClick={() => { setDraft(s); setRefFile(null); setMode(s.referenceAudioObjectKey ? "reference" : "generate"); setMessage(""); }} className="w-full text-left rounded-xl border border-white/10 p-3 hover:bg-white/5"><div className="font-medium">{s.name}</div><div className="text-xs text-neutral-500 mt-1 line-clamp-2">{s.voiceType || "Voice description not set"} · {s.artistIds?.length || 0} linked artist(s)</div></button>) : <div className="text-xs text-neutral-500 p-3">No singers saved yet.</div>}</div></aside>
    </div>
    <style>{`.input{width:100%;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.28);border-radius:.75rem;padding:.65rem .75rem;outline:none}.input:focus{border-color:rgba(167,139,250,.6)}`}</style>
  </div></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><div className="text-sm font-medium mb-1.5">{label}</div>{children}</label>; }
