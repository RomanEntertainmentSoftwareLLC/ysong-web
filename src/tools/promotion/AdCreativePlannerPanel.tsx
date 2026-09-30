import { useEffect, useState } from "react";
import { proposeCreativePlan, validateCreativePlan, type CreativeConcept, type CreativePlan, type CreativePlanContext } from "./adCreativePlanner";

const fieldClass = "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950";

export default function AdCreativePlannerPanel({ context, onUseSources }: { context: CreativePlanContext | null; onUseSources: (hookId: string, assetIds: string[]) => void }) {
  const [plan, setPlan] = useState<CreativePlan | null>(null);
  const [message, setMessage] = useState("");
  const key = context ? `ysong.ads.creative-plan.v1.${context.campaignId}.${context.track.id}` : "";
  useEffect(() => {
    setPlan(null); setMessage("");
    if (!context) return;
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return;
      const parsed: unknown = JSON.parse(stored);
      validateCreativePlan(parsed, context);
      setPlan(parsed);
    } catch { setMessage("A saved proposal has unavailable sources. Generate fresh drafts after checking the song and assets."); }
  }, [context?.campaignId, context?.track.id, key]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(index: number, patch: Partial<CreativeConcept>) {
    setPlan(current => current && ({ ...current, concepts: current.concepts.map((item, i) => i === index ? { ...item, ...patch } : item) }));
    setMessage("");
  }
  function save() {
    if (!context || !plan) return;
    try { validateCreativePlan(plan, context); localStorage.setItem(key, JSON.stringify(plan)); setMessage("Proposal drafts saved in this browser. Nothing was rendered or published."); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not validate proposal drafts."); }
  }
  function selectSources(item: CreativeConcept) {
    if (!context || !plan) return;
    try { validateCreativePlan(plan, context); onUseSources(item.hookId, item.assetIds); setMessage("Sources selected for the render batch. Review and edit the creative before rendering."); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Proposal sources are unavailable."); }
  }
  return <section aria-label="Ad creative planner" className="mt-5 rounded-2xl border border-violet-500/25 bg-violet-500/[0.035] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Ad creative planner</h3><p className="mt-1 text-xs text-neutral-500">Evidence-led concepts are editable drafts. Check visuals, lyrics, rights, and timing before production.</p></div><button type="button" disabled={!context?.hooks.length} onClick={() => { if (!context) return; try { setPlan(proposeCreativePlan(context)); setMessage("New unsaved drafts created. Edit and save the concepts you want to keep."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not plan concepts."); } }} className="rounded-lg border border-violet-500/40 px-3 py-2 text-xs font-semibold text-violet-600 disabled:opacity-40 dark:text-violet-300">Propose concepts</button></div>
    {!context?.hooks.length && <p className="mt-3 text-xs text-neutral-500">Save a verified hook clip first. Imported stock and uploaded videos can then be referenced in concepts.</p>}
    {message && <p role="status" className="mt-3 text-xs text-violet-600 dark:text-violet-300">{message}</p>}
    {context && plan && <><div className="mt-3 grid gap-3 lg:grid-cols-2">{plan.concepts.map((item, index) => <article key={item.format} className="rounded-xl border border-neutral-200 bg-white/70 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-violet-500">{item.format} · draft</div>
      {([ ["title", "Concept title"], ["opening", "Opening"], ["visualDirection", "Visual direction"], ["textOverlay", "On-screen text"], ["callToAction", "Call to action"] ] as const).map(([field, label]) => <label key={field} className="mt-2 block text-xs text-neutral-500">{label}<textarea aria-label={`${item.format} ${label}`} rows={field === "visualDirection" ? 2 : 1} maxLength={500} value={item[field]} onChange={event => update(index, { [field]: event.target.value })} className={fieldClass}/></label>)}
      <label className="mt-2 block text-xs text-neutral-500">Hook source<select aria-label={`${item.format} hook source`} value={item.hookId} onChange={event => update(index, { hookId: event.target.value })} className={fieldClass}>{context.hooks.map(hook => <option key={hook.id} value={hook.id}>{hook.label || hook.id} · {hook.startSeconds.toFixed(1)}s–{(hook.startSeconds + hook.durationSeconds).toFixed(1)}s</option>)}</select></label>
      <div className="mt-2 text-xs text-neutral-500">Visual sources</div><div className="mt-1 max-h-24 space-y-1 overflow-auto">{context.assets.length ? context.assets.map(asset => <label key={asset.id} className="flex gap-2 text-xs"><input type="checkbox" checked={item.assetIds.includes(asset.id)} onChange={event => update(index, { assetIds: event.target.checked ? [...item.assetIds, asset.id].slice(0, 3) : item.assetIds.filter(id => id !== asset.id), evidence: event.target.checked ? [...new Set([...item.evidence, "asset" as const])] : item.assetIds.length === 1 ? item.evidence.filter(ref => ref !== "asset") : item.evidence })}/><span>{asset.name} · {asset.source}{asset.provider ? ` / ${asset.provider}` : ""}</span></label>) : <span className="text-xs text-neutral-400">No imported or uploaded video yet.</span>}</div>
      <div className="mt-3 text-[11px] text-neutral-500">Sources: track {context.track.id} · hook {item.hookId}{item.assetIds.length ? ` · assets ${item.assetIds.join(", ")}` : ""}</div>
      <div className="mt-1 text-[11px] text-neutral-500">Evidence: {item.evidence.map(ref => ref === "genre" ? `genre ${context.track.genre}` : ref === "energy" ? `energy ${context.track.energy?.label} (${Math.round((context.track.energy?.confidence || 0) * 100)}%)` : ref === "artwork" ? `release artwork ${context.release.id}` : ref === "hook" ? `saved hook ${item.hookId}` : `selected assets ${item.assetIds.join(", ")}`).join(" · ")}</div>
      <button type="button" onClick={() => selectSources(item)} className="mt-3 rounded-lg border px-3 py-1.5 text-xs">Use hook and videos in render setup</button>
    </article>)}</div><button type="button" onClick={save} className="mt-3 rounded-lg border border-violet-500/40 px-3 py-2 text-xs font-semibold text-violet-600 dark:text-violet-300">Save proposal drafts</button><p className="mt-2 text-[11px] text-neutral-500">Saving stores proposal text and source IDs in this browser only. Using sources fills the render selection; it does not create an ad or publish it.</p></>}
  </section>;
}
