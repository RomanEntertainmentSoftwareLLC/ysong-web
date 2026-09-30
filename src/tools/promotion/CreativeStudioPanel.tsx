import { useCallback, useEffect, useState } from "react";
import { promotionApi, type AdCreative, type ReusableAdCreative } from "./api";
import type { CreativeStudioProject, StudioAspectRatio } from "./creativeStudioProject";
import { createStudioHistory, editStudioHistory, redoStudioHistory, undoStudioHistory, type StudioHistory } from "./creativeStudioHistory";
import { insertGeneratedStudioVideo, studioSources } from "./creativeStudioTracks";
import { generatedVideoSource, type CompletedVideoJob } from "./generatedVideoJobs";
import CreativeStudioTimeline from "./CreativeStudioTimeline";
import CreativeStudioVideoJobs from "./CreativeStudioVideoJobs";
import { previewStudioEditProposal, type StudioEditProposal } from "./studioEditProposals";
import { buildAdsCriticFixSuggestions } from "./adsCriticFixSuggestions";
import type { AdsCriticEvidencePacket } from "./adsCriticEvidenceContract";
import type { AdsStudioSelection } from "./AdsSmartAssistantPanel";
import { acceptStudioVideoRange, videoProviderCapabilities, type StudioVideoRange } from "./studioVideoRanges";
import SmartCreativeVariantPanel from "./SmartCreativeVariantPanel";

/** Edits the reusable creative; campaign renders remain derived bindings. */
export default function CreativeStudioPanel({ creative, mediaUrls, audioUrl, beatCutsBySnippet = {}, criticPacket, onSaved, onSelectionChange }: { creative: AdCreative; mediaUrls: Record<string, string>; audioUrl: string; beatCutsBySnippet?: Record<string, number[]>; criticPacket?: AdsCriticEvidencePacket | null; onSaved?: (project: CreativeStudioProject) => void; onSelectionChange?: (selection: AdsStudioSelection) => void }) {
  const [project, setProject] = useState<CreativeStudioProject | null>(null);
  const [baseline, setBaseline] = useState<CreativeStudioProject | null>(null);
  const [history, setHistory] = useState<StudioHistory | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aspect, setAspect] = useState<StudioAspectRatio>("9:16");
  const [selection, setSelection] = useState<AdsStudioSelection>(null);
  const [playheadFrame, setPlayheadFrame] = useState(0);
  const [generatedUrls, setGeneratedUrls] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{ source: CreativeStudioProject; aspect: StudioAspectRatio; proposal: StudioEditProposal; before: string; after: string } | null>(null);
  const [proposalError, setProposalError] = useState("");
  const handleSelectionChange = useCallback((value: AdsStudioSelection) => {
    setSelection(previous => previous?.trackId === value?.trackId && previous?.clipId === value?.clipId && previous?.startSeconds === value?.startSeconds && previous?.durationSeconds === value?.durationSeconds ? previous : value);
    onSelectionChange?.(value);
  }, [onSelectionChange]);
  useEffect(() => {
    const clips = history?.present.variants?.[aspect]?.tracks.flatMap(track => track.kind === "visual" ? track.clips : []) || [];
    const sources = [...new Map(clips.flatMap(clip => clip.generatedVideo ? [[clip.generatedVideo.jobId, clip.generatedVideo.objectKey] as const] : []))];
    let active = true;
    sources.forEach(([id, key]) => { void promotionApi.signedUrl(key).then(result => { if (active) setGeneratedUrls(previous => ({ ...previous, [`generated:${id}`]: result.url })); }).catch(() => {}); });
    return () => { active = false; };
  }, [history, aspect]);
  const owner = creative.stableCreativeId && creative.audioSnippets && creative.backgroundMedia
    ? { id: creative.stableCreativeId, name: `Creative ${creative.stableCreativeId.slice(0, 8)}`, audioSnippets: creative.audioSnippets, backgroundMedia: creative.backgroundMedia, overlays: creative.overlays || [], caption: creative.caption || { text: "" }, cta: creative.cta || { label: "" } } satisfies Pick<ReusableAdCreative,"id"|"name"|"audioSnippets"|"backgroundMedia"|"overlays"|"caption"|"cta">
    : null;
  useEffect(() => {
    if (!owner) { setLoading(false); setError("This campaign render has no reusable creative edit source yet."); return; }
    let active = true;
    setLoading(true); setLoadFailed(false); setError(""); setNotice(""); setPending(null); setSelection(null);
    void promotionApi.loadStudioProject(owner).then(value => { if (active) {
      const durationFrames = Math.round(Math.max(1, Math.min(60, creative.timing?.durationSeconds || creative.durationSeconds || 30)) * 30);
      const now = new Date().toISOString();
      const starter: CreativeStudioProject = {
        schemaVersion: 1, revision: 0, durationFrames,
        timebase: { framesPerSecond: { numerator: 30, denominator: 1 } },
        tracks: studioSources(owner, durationFrames, 30).slice(0, 12).map(source => source.track),
        render: { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", backgroundColor: "#000000" },
        variants: {},
        edit: { createdAt: creative.createdAt || now, updatedAt: now, source: "artist", parentRevision: 0 },
      };
      const source = value || starter;
      const dimensions: Record<StudioAspectRatio, [number, number]> = { "9:16": [1080, 1920], "1:1": [1080, 1080], "16:9": [1920, 1080] };
      const normalized: CreativeStudioProject = { ...source, variants: Object.fromEntries((Object.keys(dimensions) as StudioAspectRatio[]).map(key => {
        const [width, height] = dimensions[key];
        return [key, source.variants?.[key] || { width, height, tracks: source.tracks }];
      })) };
      setAspect("9:16"); setProject(value); setBaseline(normalized); setHistory(createStudioHistory(normalized)); setLoading(false);
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
  const dimensions: Record<StudioAspectRatio, [number, number]> = { "9:16": [1080, 1920], "1:1": [1080, 1080], "16:9": [1920, 1080] };
  const activeVariant = current.variants?.[aspect];
  const editingProject: CreativeStudioProject = { ...current, tracks: activeVariant?.tracks || current.tracks, render: { ...current.render, width: activeVariant?.width || dimensions[aspect][0], height: activeVariant?.height || dimensions[aspect][1] } };
  const savedVariant = baseline.variants?.[aspect];
  const variantSource: CreativeStudioProject = { ...baseline, tracks: savedVariant?.tracks || baseline.tracks, render: { ...baseline.render, width: savedVariant?.width || dimensions[aspect][0], height: savedVariant?.height || dimensions[aspect][1] }, variants: undefined };
  const refs = { audioSnippetIds: owner.audioSnippets.map(item => item.snippetId), backgroundMediaIds: owner.backgroundMedia.map(item => item.mediaId), overlayIds: owner.overlays.map(item => item.id), stockMediaIds: owner.backgroundMedia.filter(item => item.source === "stock").map(item => item.mediaId) };
  const fps = current.timebase.framesPerSecond.numerator / current.timebase.framesPerSecond.denominator;
  const criticAspectMatches = criticPacket?.aspectRatio === aspect || (criticPacket?.aspectRatio === "base" && aspect === "9:16" && !project?.variants?.["9:16"]);
  const criticReady = !!criticPacket && criticPacket.creativeId === owner.id && criticPacket.studioRevision === baseline.revision && criticAspectMatches && current === baseline;
  const criticSuggestions = criticReady ? buildAdsCriticFixSuggestions(criticPacket, baseline, refs, Object.values(beatCutsBySnippet).flat().map(second => Math.round(second * fps))) : [];
  const targetTrack = selection && editingProject.tracks.find(item => item.id === selection.trackId);
  const targetClip = selection && targetTrack?.clips.find(item => item.id === selection.clipId);
  const ideas: Array<{ label: string; proposal: StudioEditProposal }> = [];
  if (selection && targetClip && targetTrack && !targetTrack.locked) {
    const target = { trackId: selection.trackId, clipId: selection.clipId };
    if (targetClip.startFrame === 0 && targetClip.durationFrames > Math.max(1, Math.round(fps * .8)) + 1) ideas.push({ label: "Trim opening by 0.8s", proposal: { kind: "trim_opening", ...target, frames: Math.max(1, Math.round(fps * .8)) } });
    if (targetClip.startFrame > 0) ideas.push({ label: "Move the hook earlier", proposal: { kind: "move_hook", ...target, startFrame: 0 } });
    const snippetId = "snippetId" in targetClip ? targetClip.snippetId : owner.audioSnippets[0]?.snippetId;
    const cuts = [...new Set((beatCutsBySnippet[snippetId] || []).map(second => Math.round(second * fps)))].filter(frame => frame > targetClip.startFrame && frame < targetClip.startFrame + targetClip.durationFrames).slice(0, 8);
    if (cuts.length) ideas.push({ label: "Cut on these beats", proposal: { kind: "cut_on_beats", ...target, frames: cuts } });
    if (targetTrack.kind === "text") {
      if ("transform" in targetClip && (targetClip.transform.x !== .5 || targetClip.transform.y !== .25)) ideas.push({ label: "Reposition text higher", proposal: { kind: "reposition_text", ...target, x: .5, y: .25 } });
      if ("style" in targetClip && targetClip.style.fontSize < 160) ideas.push({ label: "Increase caption size", proposal: { kind: "caption_size", ...target, fontSize: Math.min(160, Math.round(targetClip.style.fontSize * 1.25)) } });
    }
    if (targetTrack.kind === "visual") {
      const currentMedia = "mediaId" in targetClip ? owner.backgroundMedia.find(item => item.mediaId === targetClip.mediaId) : undefined;
      const alternate = currentMedia?.source === "stock" && owner.backgroundMedia.find(item => item.source === "stock" && item.mediaType === currentMedia.mediaType && item.mediaId !== currentMedia.mediaId);
      if (alternate) ideas.push({ label: "Swap this stock clip", proposal: { kind: "swap_stock", ...target, mediaId: alternate.mediaId } });
      const fadeFrames = Math.min(Math.max(1, Math.round(fps * .4)), targetClip.durationFrames - (targetClip.transitionOut?.durationFrames || 0));
      if (fadeFrames > 0 && (targetClip.transitionIn?.kind !== "fade" || targetClip.transitionIn.durationFrames !== fadeFrames)) ideas.push({ label: "Add a fade transition", proposal: { kind: "transition", ...target, edge: "in", transition: "fade", frames: fadeFrames } });
      const zoomFrame = Math.floor(targetClip.durationFrames / 2);
      if (targetClip.durationFrames > 2 && !targetClip.keyframes.some(key => key.property === "scale" && key.frame === zoomFrame)) ideas.push({ label: "Create a zoom keyframe", proposal: { kind: "zoom_keyframe", ...target, frame: zoomFrame, scale: 1.15 } });
    }
  }
  function propose(proposal: StudioEditProposal) {
    setProposalError("");
    try {
      const preview = previewStudioEditProposal(proposal, editingProject, refs);
      setPending({ source: current, aspect, proposal: preview.proposal, before: preview.before, after: preview.after });
    } catch (cause) { setPending(null); setProposalError(cause instanceof Error ? cause.message : "Could not preview this edit."); }
  }
  function applyProposal() {
    if (!pending || pending.source !== current || pending.aspect !== aspect) return;
    try {
      const preview = previewStudioEditProposal(pending.proposal, editingProject, refs);
      updateAspectProject(preview.project);
      setPending(null); setProposalError(""); setNotice("Assistant edit applied locally. Save the timeline to keep it.");
    } catch (cause) { setPending(null); setProposalError(cause instanceof Error ? cause.message : "Could not apply this edit."); }
  }
  function updateAspectProject(next: CreativeStudioProject, group?: string) {
    setHistory(value => value && editStudioHistory(value, { ...current, variants: { ...current.variants, [aspect]: { width: next.render.width, height: next.render.height, tracks: next.tracks } } }, group));
  }
  function insertVideo(job: CompletedVideoJob, range: boolean) {
    if (saving) return;
    const startFrame = range && selection ? Math.round(selection.startSeconds * fps) : playheadFrame;
    const rangeFrames = range && selection ? Math.round(selection.durationSeconds * fps) : undefined;
    const next = insertGeneratedStudioVideo(editingProject, generatedVideoSource(job), startFrame, rangeFrames);
    if (next === editingProject) { setNotice("Video cannot fit here, has already been inserted, or the timeline has 12 tracks."); return; }
    updateAspectProject(next);
    setNotice("Generated video inserted. Save the timeline to keep it; Undo removes this insertion.");
  }
  function acceptVideo(range: StudioVideoRange, requestId: string, job: CompletedVideoJob) {
    const capabilities = videoProviderCapabilities(creative.metadata?.aiVideoCapabilities);
    if (saving || range.aspect !== aspect || job.creativeId !== creative.stableCreativeId || job.artifact.metadata.requestId !== requestId || !capabilities || !capabilities[range.action] || capabilities.provider !== job.provider || range.durationFrames / fps > capabilities.maxDurationSeconds || (range.action === "extend" && range.source?.provider !== job.provider)) return;
    const next = acceptStudioVideoRange(editingProject, range, generatedVideoSource(job));
    if (next === editingProject) { setNotice("The timeline changed or the result does not fit this range. Create a new request."); return; }
    updateAspectProject(next);
    setNotice("Video result accepted locally. Save the timeline to keep it; Undo restores the original clip.");
  }
  async function save() {
    if (!owner) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const outgoing = { ...current, edit: { ...current.edit, parentRevision: current.revision, updatedAt: new Date().toISOString(), summary: "Updated Creative Studio tracks" } };
      const result = await promotionApi.saveStudioProject(owner, outgoing);
      const saved = result.creative.studioProject!;
      setProject(saved); setBaseline(saved); setHistory(createStudioHistory(saved)); onSaved?.(saved); setNotice("Timeline saved to reusable creative.");
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
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs"><label className="flex items-center gap-2 font-medium">Social aspect<select aria-label="Social aspect ratio" value={aspect} disabled={saving} onChange={event => setAspect(event.target.value as StudioAspectRatio)} className="rounded border bg-transparent p-2"><option value="9:16">9:16 Vertical</option><option value="1:1">1:1 Square</option><option value="16:9">16:9 Landscape</option></select></label><span className="text-neutral-500">Each layout keeps its own crop and overlay positions.</span><span className="text-neutral-500">{project ? `Revision ${project.revision}` : "New timeline from creative assets"}</span><button type="button" disabled={!history.past.length || saving} onClick={() => setHistory(value => value && undoStudioHistory(value))} className="rounded border px-3 py-2 disabled:opacity-40">Undo</button><button type="button" disabled={!history.future.length || saving} onClick={() => setHistory(value => value && redoStudioHistory(value))} className="rounded border px-3 py-2 disabled:opacity-40">Redo</button><button type="button" disabled={!dirty || saving} onClick={() => void save()} className="rounded border border-violet-500 px-3 py-2 font-semibold text-violet-600 disabled:opacity-40">{saving ? "Saving…" : "Save timeline"}</button><button type="button" disabled={!dirty || saving} onClick={() => setHistory(createStudioHistory(baseline))} className="rounded border px-3 py-2 disabled:opacity-40">Discard edits</button>{dirty && <span>Unsaved changes</span>}</div>
    {error && <p role="alert" className="mb-2 text-xs text-amber-600">{error}</p>}{notice && <p role="status" className="mb-2 text-xs text-emerald-600">{notice}</p>}
    {project ? <SmartCreativeVariantPanel key={`${creative.adCampaignId}:${owner.id}:${baseline.revision}:${aspect}`} source={owner} campaignId={creative.adCampaignId} aspect={aspect} project={variantSource} mediaUrls={{ ...mediaUrls, ...generatedUrls }} audioUrl={audioUrl} /> : <p className="mb-3 text-xs text-neutral-500">Save this Creative Studio timeline before proposing variants from it.</p>}
    <section aria-label="Smart timeline edit proposals" className="mb-3 rounded-xl border border-violet-500/25 p-3 text-xs">
      <div className="font-semibold">Ads Smart Assistant · Timeline proposals</div>
      <p className="mt-1 text-neutral-500">Select a clip to preview a validated edit for the {aspect} layout.</p>
      {criticSuggestions.length > 0 && <div className="mt-3 space-y-2"><div className="font-medium">Ads Critic fixes · saved revision {criticPacket?.studioRevision}</div>{criticSuggestions.map(item => <div key={item.evidenceId} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"><div><div className="font-medium">{item.title}</div><div className="text-neutral-500">{item.detail} · Evidence {item.evidenceId}</div></div>{item.proposal ? <button type="button" disabled={saving} onClick={() => propose(item.proposal!)} className="rounded border border-violet-500 px-2.5 py-1.5 disabled:opacity-40">Preview fix</button> : <span className="text-neutral-500">Review in video tools below</span>}</div>)}</div>}
      {criticPacket && !criticReady && <p className="mt-2 text-neutral-500">Ads Critic fixes require the matching saved aspect and revision. Save current edits or select that aspect to review them.</p>}
      <div className="mt-2 flex flex-wrap gap-2">{ideas.map(idea => <button key={idea.label} type="button" disabled={saving} onClick={() => propose(idea.proposal)} className="rounded border px-2.5 py-1.5 disabled:opacity-40">{idea.label}</button>)}</div>
      {proposalError && <p role="alert" className="mt-2 text-amber-600">{proposalError}</p>}
      {pending && <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3"><div className="font-medium">Proposed change · {aspect}</div><div className="mt-1 text-neutral-500">Before: {pending.before}</div><div className="mt-1">After: {pending.after}</div><div className="mt-2 flex gap-2"><button type="button" disabled={saving || pending.source !== current || pending.aspect !== aspect} onClick={applyProposal} className="rounded bg-violet-600 px-3 py-1.5 font-medium text-white disabled:opacity-40">Apply edit</button><button type="button" onClick={() => setPending(null)} className="rounded border px-3 py-1.5">Dismiss</button></div>{(pending.source !== current || pending.aspect !== aspect) && <p className="mt-1 text-amber-600">Timeline changed. Preview the proposal again.</p>}</div>}
    </section>
    <div inert={saving}><CreativeStudioTimeline creative={owner} project={editingProject} onChange={updateAspectProject} mediaUrls={{ ...mediaUrls, ...generatedUrls }} audioUrl={audioUrl} onSelectionChange={handleSelectionChange} onPlayheadChange={setPlayheadFrame} /></div>
    <CreativeStudioVideoJobs creative={creative} selection={selection} onInsert={insertVideo} onAccept={acceptVideo} canInsert={!saving && editingProject.tracks.length < 12} playheadSeconds={playheadFrame / fps} project={editingProject} aspect={aspect} />
  </div>;
}
