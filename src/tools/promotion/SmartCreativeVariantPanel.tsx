import { useEffect, useState } from "react";
import type { ReusableAdCreative } from "./api";
import type { CreativeStudioProject, StudioAspectRatio } from "./creativeStudioProject";
import { validateCreativeStudioProject } from "./creativeStudioProject";
import { proposeSmartCreativeVariants, type SmartCreativeDraft } from "./smartCreativeVariants";
import CreativeStudioTimeline from "./CreativeStudioTimeline";

type Source = Pick<ReusableAdCreative, "id" | "name" | "audioSnippets" | "backgroundMedia" | "overlays" | "caption" | "cta">;

export default function SmartCreativeVariantPanel({ source, campaignId, aspect, project, mediaUrls, audioUrl }: { source: Source; campaignId: string; aspect: StudioAspectRatio; project: CreativeStudioProject; mediaUrls: Record<string, string>; audioUrl: string }) {
  const key = `ysong.ads.smart-variants.v1.${campaignId}.${source.id}.${project.revision}.${aspect}`;
  const refs = { audioSnippetIds: source.audioSnippets.map(x => x.snippetId), backgroundMediaIds: source.backgroundMedia.map(x => x.mediaId), overlayIds: source.overlays.map(x => x.id) };
  const [drafts, setDrafts] = useState<SmartCreativeDraft[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(saved)) throw new Error();
      const valid = saved.filter((draft): draft is SmartCreativeDraft => {
        try {
          if (!draft || typeof draft !== "object" || draft.sourceCreativeId !== source.id || draft.sourceRevision !== project.revision || draft.sourceCampaignId !== campaignId || draft.aspectRatio !== aspect) return false;
          validateCreativeStudioProject(draft.project, refs);
          return typeof draft.id === "string" && typeof draft.title === "string" && typeof draft.change === "string";
        } catch { return false; }
      }).slice(0, 12);
      setDrafts(valid);
    } catch { setDrafts([]); }
    setActiveId(null);
    setMessage("");
    // The key is the identity of this saved source revision and campaign.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const active = drafts.find(draft => draft.id === activeId);
  function persist(next: SmartCreativeDraft[]) {
    setDrafts(next);
    try { localStorage.setItem(key, JSON.stringify(next)); setMessage("Drafts saved in this browser. No render or campaign change was requested."); }
    catch { setMessage("Browser storage is unavailable. Drafts remain in this tab until you leave it."); }
  }
  function generate() {
    const options = proposeSmartCreativeVariants(project, source, campaignId, aspect);
    if (!options.length) { setMessage("No valid changes are available for this timeline. Add editable clips or stock media, then try again."); return; }
    persist([...drafts, ...options].slice(-12));
    setActiveId(options[0].id);
  }
  function updateProject(next: CreativeStudioProject) {
    if (!active) return;
    try {
      validateCreativeStudioProject(next, refs);
      persist(drafts.map(draft => draft.id === active.id ? { ...draft, project: next } : draft));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid draft edit."); }
  }
  return <section aria-label="Smart creative variants" className="mb-3 rounded-xl border border-violet-500/30 p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-semibold">Smart Assistant · Creative variants</h4><p className="mt-1 text-neutral-500">Explore editable versions of this saved {aspect} creative. Drafts stay with this browser, campaign, and source revision.</p></div><button type="button" onClick={generate} className="rounded bg-violet-600 px-3 py-2 font-medium text-white">Propose variants</button></div>
    <p className="mt-2 text-neutral-500">Source {source.id} · revision {project.revision} · campaign {campaignId}. Destination and launch settings stay in Campaign Setup. Review a draft before any render or launch approval.</p>
    {message && <p role="status" className="mt-2 text-neutral-600 dark:text-neutral-300">{message}</p>}
    {drafts.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{drafts.map(draft => <article key={draft.id} className={`rounded-lg border p-3 ${activeId === draft.id ? "border-violet-500" : "border-neutral-300 dark:border-neutral-700"}`}><input aria-label={`Title for ${draft.title}`} value={draft.title} maxLength={80} onChange={event => persist(drafts.map(item => item.id === draft.id ? { ...item, title: event.target.value } : item))} className="w-full rounded border bg-transparent px-2 py-1 font-medium"/><p className="mt-2 text-neutral-500">{draft.change}</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => setActiveId(draft.id)} className="rounded border px-2 py-1">Edit draft</button><button type="button" onClick={() => { persist(drafts.filter(item => item.id !== draft.id)); if (activeId === draft.id) setActiveId(null); }} className="rounded border px-2 py-1">Remove</button></div></article>)}</div>}
    {active && <div className="mt-3 border-t pt-3 dark:border-neutral-700"><div className="font-medium">Editing draft: {active.title}</div><p className="mt-1 text-neutral-500">Timeline edits save to this draft only. The source creative and its renders are untouched.</p><CreativeStudioTimeline creative={source} project={active.project} onChange={updateProject} mediaUrls={mediaUrls} audioUrl={audioUrl} /></div>}
  </section>;
}
