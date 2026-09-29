import { useEffect, useState } from "react";
import type { TabRendererProps } from "./core";
import { deleteSingerCharacter, listSingerCharacters, saveSingerCharacter, type SingerCharacter } from "../lib/singerLibrary";

type SingerDraft = Omit<SingerCharacter, "createdAt" | "updatedAt">;
const blank = (): SingerDraft => ({ id: crypto.randomUUID(), displayName: "", avatar: null, avatarName: "", avatarRef: "", voiceDescription: "", vocalRange: "", vocalStyle: "", tags: [] });

export default function SingerStudioPane(_props: TabRendererProps) {
  const [singers, setSingers] = useState<SingerCharacter[]>([]);
  const [draft, setDraft] = useState<SingerDraft>(blank);
  const [isNew, setIsNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = async () => setSingers(await listSingerCharacters());

  useEffect(() => {
    void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load singer characters."));
    const changed = () => void refresh().catch(() => {});
    window.addEventListener("ysong:singers-changed", changed);
    return () => window.removeEventListener("ysong:singers-changed", changed);
  }, []);

  const edit = (singer: SingerCharacter) => {
    setDraft({ id: singer.id, displayName: singer.displayName, avatar: singer.avatar ?? null, avatarName: singer.avatarName ?? "", avatarRef: singer.avatarRef, voiceDescription: singer.voiceDescription, vocalRange: singer.vocalRange, vocalStyle: singer.vocalStyle, tags: singer.tags ?? [] });
    setIsNew(false); setMessage("");
  };
  const save = async () => {
    if (!draft.displayName.trim()) { setMessage("Give this singer a display name first."); return; }
    setBusy(true); setMessage("");
    try {
      const saved = await saveSingerCharacter({ ...draft, displayName: draft.displayName.trim() });
      await refresh(); edit(saved); setMessage(isNew ? "Singer character created." : "Singer character updated."); setIsNew(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save singer character."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    const name = draft.displayName || "this singer";
    if (!window.confirm(`Delete “${name}”? This also removes the singer from saved band rosters. Generated songs keep their saved singer details.`)) return;
    setBusy(true); setMessage("");
    try { await deleteSingerCharacter(draft.id); await refresh(); setDraft(blank()); setIsNew(true); setMessage("Singer character deleted and band roster links removed."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete singer character."); }
    finally { setBusy(false); }
  };

  return <div className="h-full overflow-y-auto bg-neutral-950 text-white"><div className="max-w-6xl mx-auto p-5 lg:p-8 space-y-6">
    <header><div className="text-xs uppercase tracking-[.22em] text-violet-300">Character Library</div><h1 className="text-3xl font-semibold mt-1">Singer Studio</h1><p className="text-sm text-neutral-400 mt-2">Create and maintain reusable singer characters for Create Song and band rosters. Editing keeps the singer’s stable ID.</p></header>
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5">
      <section className="rounded-2xl border border-white/10 bg-white/[.025] p-4 space-y-4">
        <Field label="Singer name"><input className="input" value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} placeholder="Raven" /></Field>
        <Field label="Voice description"><textarea className="input min-h-28" value={draft.voiceDescription} onChange={(e) => setDraft({ ...draft, voiceDescription: e.target.value })} placeholder="Warm smoky alto, intimate verses, clean powerful belt…" /></Field>
        <Field label="Vocal range"><input className="input" value={draft.vocalRange} onChange={(e) => setDraft({ ...draft, vocalRange: e.target.value })} placeholder="Alto, G3–E5" /></Field>
        <Field label="Vocal style"><textarea className="input min-h-24" value={draft.vocalStyle} onChange={(e) => setDraft({ ...draft, vocalStyle: e.target.value })} placeholder="Phrasing, vibrato, accent, preferred styles…" /></Field>
        <Field label="Character image"><input className="input file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-white" type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file?.type.startsWith("image/")) setDraft({ ...draft, avatar: file, avatarName: file.name, avatarRef: `local-singer:${draft.id}` }); else if (file) setMessage("Choose an image file."); }} /><span className="mt-1 block text-xs text-neutral-500">{draft.avatarName || "Optional image"}</span></Field>
        {message && <p role="status" className="text-sm text-violet-200">{message}</p>}
        <div className="flex flex-wrap gap-2"><button onClick={() => void save()} disabled={busy} className="rounded-xl px-4 py-2 bg-violet-500/20 border border-violet-400/30 disabled:opacity-40">{busy ? "Saving…" : isNew ? "Create Singer" : "Save Changes"}</button><button onClick={() => { setDraft(blank()); setIsNew(true); setMessage(""); }} className="rounded-xl px-4 py-2 border border-white/10">New Singer</button>{!isNew && <button onClick={() => void remove()} disabled={busy} className="rounded-xl px-4 py-2 border border-red-400/30 text-red-300 disabled:opacity-40">Delete Singer</button>}</div>
        {!isNew && <p className="text-xs text-neutral-500">Stable ID: {draft.id}</p>}
      </section>
      <aside className="rounded-2xl border border-white/10 bg-white/[.025] p-3"><div className="text-xs uppercase tracking-widest text-neutral-500 mb-2">Saved singers</div><div className="space-y-2">{singers.length ? singers.map((singer) => <button key={singer.id} onClick={() => edit(singer)} className={`w-full text-left rounded-xl border p-3 ${draft.id === singer.id && !isNew ? "border-violet-400/50 bg-violet-500/10" : "border-white/10 hover:bg-white/5"}`}><div className="font-medium">{singer.displayName}</div><div className="text-xs text-neutral-500 mt-1 line-clamp-2">{singer.voiceDescription || singer.vocalRange || "Voice details not set"}</div></button>) : <p className="text-xs text-neutral-500 p-3">No singer characters saved yet.</p>}</div></aside>
    </div>
    <style>{`.input{width:100%;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.28);border-radius:.75rem;padding:.65rem .75rem;outline:none}.input:focus{border-color:rgba(167,139,250,.6)}`}</style>
  </div></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><div className="text-sm font-medium mb-1.5">{label}</div>{children}</label>; }
