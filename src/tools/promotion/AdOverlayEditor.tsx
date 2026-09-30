import { useEffect, useState } from "react";

export type AdOverlaySettings = { headline: string; caption: string; cta: string; position: "top" | "center" | "bottom" };
const input = "mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 dark:border-neutral-700 dark:bg-neutral-950";
const presetKey = "ysong.ads.overlay-presets.v1";

export default function AdOverlayEditor({ value, onChange }: { value: AdOverlaySettings; onChange: (next: AdOverlaySettings) => void }) {
  const [presets, setPresets] = useState<Array<{ name: string; settings: AdOverlaySettings }>>([]);
  const [presetName, setPresetName] = useState("");
  useEffect(() => { try { const stored = JSON.parse(localStorage.getItem(presetKey) || "[]"); if (Array.isArray(stored)) setPresets(stored.filter((x): x is { name: string; settings: AdOverlaySettings } => !!x && typeof x.name === "string" && !!x.settings)); } catch { /* Presets are optional in restricted storage contexts. */ } }, []);
  function savePreset() {
    const name = presetName.trim(); if (!name) return;
    const next = [...presets.filter(item => item.name !== name), { name, settings: value }].slice(-12);
    setPresets(next); setPresetName(""); try { localStorage.setItem(presetKey, JSON.stringify(next)); } catch { /* Keep current editor usable if storage is unavailable. */ }
  }
  return <div className="mt-5 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-sm font-semibold">On-video text overlay</h4><p className="mt-1 text-xs text-neutral-500">Editable copy sits above the video; it does not alter the source creative.</p></div><span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] text-emerald-600">9:16 safe area</span></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-500">Overlay headline<input className={input} maxLength={50} value={value.headline} onChange={e => onChange({ ...value, headline: e.target.value })}/><span>{value.headline.length}/50</span></label><label className="text-xs text-neutral-500">Overlay caption<input className={input} maxLength={80} value={value.caption} onChange={e => onChange({ ...value, caption: e.target.value })}/><span>{value.caption.length}/80</span></label><label className="text-xs text-neutral-500">CTA label<input className={input} maxLength={20} value={value.cta} onChange={e => onChange({ ...value, cta: e.target.value })}/></label><label className="text-xs text-neutral-500">Overlay placement<select className={input} value={value.position} onChange={e => onChange({ ...value, position: e.target.value as AdOverlaySettings["position"] })}><option value="top">Upper safe area</option><option value="center">Center safe area</option><option value="bottom">Lower safe area</option></select></label></div>
    <div className="mt-4 flex flex-wrap gap-2">{presets.map(item => <button key={item.name} type="button" onClick={() => onChange(item.settings)} className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs hover:border-violet-500 dark:border-neutral-700">{item.name}</button>)}<input aria-label="Preset name" className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-xs dark:border-neutral-700" value={presetName} maxLength={32} onChange={e => setPresetName(e.target.value)} placeholder="Name this preset"/><button type="button" disabled={!presetName.trim()} onClick={savePreset} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Save preset</button></div>
    <p className="mt-3 text-[10px] text-neutral-500">Text stays inside the central 80% of the frame, clear of top and bottom interface controls. Platform ad copy below remains separate.</p>
  </div>;
}
