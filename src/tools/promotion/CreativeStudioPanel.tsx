import { useEffect, useState } from "react";
import { promotionApi, type AdCreative, type ReusableAdCreative } from "./api";
import type { CreativeStudioProject } from "./creativeStudioProject";
import { createStudioHistory, editStudioHistory, redoStudioHistory, undoStudioHistory, type StudioHistory } from "./creativeStudioHistory";
import { studioSources } from "./creativeStudioTracks";
import CreativeStudioTimeline from "./CreativeStudioTimeline";

/** Edits the reusable creative; campaign renders remain derived bindings. */
export default function CreativeStudioPanel({ creative, mediaUrls, audioUrl }: { creative: AdCreative; mediaUrls: Record<string, string>; audioUrl: string }) {
  const [project, setProject] = useState<CreativeStudioProject | null>(null);
  const [baseline, setBaseline] = useState<CreativeStudioProject | null>(null);
  const [history, setHistory] = useState<StudioHistory | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const owner = creative.stableCreativeId && creative.audioSnippets && creative.backgroundMedia
    ? { id: creative.stableCreativeId, name: `Creative ${creative.stableCreativeId.slice(0, 8)}`, audioSnippets: creative.audioSnippets, backgroundMedia: creative.backgroundMedia, overlays: creative.overlays || [], caption: creative.caption || { text: "" }, cta: creative.cta || { label: "" } } satisfies Pick<ReusableAdCreative,"id"|"name"|"audioSnippets"|"backgroundMedia"|"overlays"|"caption"|"cta">
    : null;
  useEffect(() => {
    if (!owner) { setLoading(false); setError("This campaign render has no reusable creative edit source yet."); return; }
    let active = true;
    setLoading(true); setLoadFailed(false); setError(""); setNotice("");
    void promotionApi.loadStudioProject(owner).then(value => { if (active) {
      const durationFrames = Math.round(Math.max(1, Math.min(60, creative.timing?.durationSeconds || creative.durationSeconds || 30)) * 30);
      const now = new Date().toISOString();
      const starter: CreativeStudioProject = {
        schemaVersion: 1, revision: 0, durationFrames,
        timebase: { framesPerSecond: { numerator: 30, denominator: 1 } },
        tracks: studioSources(owner, durationFrames, 30).slice(0, 12).map(source => source.track),
        render: { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", backgroundColor: "#000000" },
        edit: { createdAt: creative.createdAt || now, updatedAt: now, source: "artist", parentRevision: 0 },
      };
      setProject(value); setBaseline(value || starter); setHistory(createStudioHistory(value || starter)); setLoading(false);
    } }).catch(cause => { if (active) { setLoadFailed(true); setError(cause instanceof Error ? cause.message : "Could not load this creative's project."); setLoading(false); } });
    return () => { active = false; };
    // The reusable creative ID determines the read; campaign render refreshes do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creative.stableCreativeId]);
  if (loading) return <p className="mt-3 text-xs text-neutral-500">Loading Creative Studio project…</p>;
  if (!owner) return <p role="alert" className="mt-3 text-xs text-amber-600">{error}</p>;
  if (loadFailed) return <p role="alert" className="mt-3 text-xs text-amber-600">{error}</p>;
  if (!history || !baseline) return null;
  const current = history.present;
  const dirty = current !== baseline || (!project && current.tracks.length > 0);
  async function save() {
    if (!owner) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const outgoing = { ...current, edit: { ...current.edit, parentRevision: current.revision, updatedAt: new Date().toISOString(), summary: "Updated Creative Studio tracks" } };
      const result = await promotionApi.saveStudioProject(owner, outgoing);
      const saved = result.creative.studioProject!;
      setProject(saved); setBaseline(saved); setHistory(createStudioHistory(saved)); setNotice("Timeline saved to reusable creative.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save timeline."); }
    finally { setSaving(false); }
  }
  return <div className="mt-3" onKeyDown={event => {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey || saving) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable='true']")) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey && history.past.length) { event.preventDefault(); setHistory(value => value && undoStudioHistory(value)); }
    else if (((key === "z" && event.shiftKey) || key === "y") && history.future.length) { event.preventDefault(); setHistory(value => value && redoStudioHistory(value)); }
  }}>
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs"><span className="text-neutral-500">{project ? `Revision ${project.revision}` : "New timeline from creative assets"}</span><button type="button" disabled={!history.past.length || saving} onClick={() => setHistory(value => value && undoStudioHistory(value))} className="rounded border px-3 py-2 disabled:opacity-40">Undo</button><button type="button" disabled={!history.future.length || saving} onClick={() => setHistory(value => value && redoStudioHistory(value))} className="rounded border px-3 py-2 disabled:opacity-40">Redo</button><button type="button" disabled={!dirty || saving} onClick={() => void save()} className="rounded border border-violet-500 px-3 py-2 font-semibold text-violet-600 disabled:opacity-40">{saving ? "Saving…" : "Save timeline"}</button><button type="button" disabled={!dirty || saving} onClick={() => setHistory(createStudioHistory(baseline))} className="rounded border px-3 py-2 disabled:opacity-40">Discard edits</button>{dirty && <span>Unsaved changes</span>}</div>
    {error && <p role="alert" className="mb-2 text-xs text-amber-600">{error}</p>}{notice && <p role="status" className="mb-2 text-xs text-emerald-600">{notice}</p>}
    <div inert={saving}><CreativeStudioTimeline creative={owner} project={current} onChange={(next, group) => setHistory(value => value && editStudioHistory(value, next, group))} mediaUrls={mediaUrls} audioUrl={audioUrl} /></div>
  </div>;
}
