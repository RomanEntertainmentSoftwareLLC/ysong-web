import { useState } from "react";
import type { AdCreative } from "./api";
import type { AdsStudioSelection } from "./AdsSmartAssistantPanel";
import type { StudioAspectRatio } from "./creativeStudioProject";
import { completedVideoJobs, type CompletedVideoJob } from "./generatedVideoJobs";
import type { CreativeStudioProject } from "./creativeStudioProject";
import { planStudioVideoRange, studioVideoGaps, videoProviderCapabilities, type StudioVideoAction, type StudioVideoRange } from "./studioVideoRanges";

type VideoJob = {
  id: string;
  prompt: string;
  durationSeconds: number;
  aspectRatio: StudioAspectRatio;
  reference?: { name: string; type: string; size: number };
  context: { creativeId: string | null; song: string | null; timeline: AdsStudioSelection };
  status: "draft";
  provider: null;
  estimatedCost: null;
  artifact: null;
  createdAt: string;
};

export default function CreativeStudioVideoJobs({ creative, selection, onInsert, onAccept, canInsert, playheadSeconds, project, aspect }: { creative: AdCreative; selection: AdsStudioSelection; onInsert: (job: CompletedVideoJob, range: boolean) => void; onAccept: (range: StudioVideoRange, requestId: string, job: CompletedVideoJob) => void; canInsert: boolean; playheadSeconds: number; project: CreativeStudioProject; aspect: StudioAspectRatio }) {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(10);
  const [ratio, setRatio] = useState<StudioAspectRatio>("9:16");
  const [reference, setReference] = useState<File | null>(null);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [rangeJobs, setRangeJobs] = useState<Array<{ id: string; range: StudioVideoRange; prompt: string; provider: string; creativeId: string; song: string | null }>>([]);
  const song = selection?.kind === "audio" ? selection.label : creative.audioSnippets?.[0]?.label || null;
  const hasValidReference = !reference || reference.type.startsWith("image/") || reference.type.startsWith("video/");
  const completed = completedVideoJobs(creative);
  const capabilities = videoProviderCapabilities(creative.metadata?.aiVideoCapabilities);
  const fps = project.timebase.framesPerSecond.numerator / project.timebase.framesPerSecond.denominator;
  const visualSelection = selection?.kind === "visual" ? selection : null;
  const gaps = visualSelection ? studioVideoGaps(project, visualSelection.trackId) : [];
  const actions: Array<{ action: StudioVideoAction; label: string; range: StudioVideoRange | null }> = visualSelection ? [
    { action: "regenerate", label: "Regenerate selected clip", range: planStudioVideoRange(project, aspect, "regenerate", visualSelection.trackId, visualSelection.clipId) },
    { action: "extend", label: "Extend selected clip", range: planStudioVideoRange(project, aspect, "extend", visualSelection.trackId, visualSelection.clipId) },
    ...gaps.map((gap, index) => ({ action: "fill" as const, label: `Fill gap ${index + 1} (${(gap.startFrame / fps).toFixed(1)}–${((gap.startFrame + gap.durationFrames) / fps).toFixed(1)}s)`, range: planStudioVideoRange(project, aspect, "fill", visualSelection.trackId, undefined, gap.startFrame) })),
  ] : [];
  const supported = (action: StudioVideoAction, range: StudioVideoRange | null) => !!range && !!capabilities?.[action] && range.durationFrames / fps <= capabilities.maxDurationSeconds && (action !== "extend" || range.source?.provider === capabilities.provider);

  function createJob() {
    const job: VideoJob = {
      id: crypto.randomUUID(), prompt: prompt.trim(), durationSeconds: duration, aspectRatio: ratio,
      reference: reference ? { name: reference.name, type: reference.type, size: reference.size } : undefined,
      context: { creativeId: creative.stableCreativeId || null, song, timeline: selection },
      status: "draft", provider: null, estimatedCost: null, artifact: null, createdAt: new Date().toISOString(),
    };
    setJobs(current => [job, ...current]);
  }

  return <section aria-label="AI video generation" className="my-4 rounded-2xl border border-cyan-500/25 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="text-[10px] uppercase tracking-[.18em] text-cyan-600">AI video</div><h3 className="mt-1 font-semibold">Build a generation job</h3><p className="mt-1 max-w-2xl text-xs text-neutral-500">Describe a video and connect it to this ad’s song and timeline. Jobs stay drafts until an authorized provider is configured.</p></div>
      <span className="rounded-full border border-amber-500/30 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-300">{capabilities ? `${capabilities.provider} capabilities · draft only` : "Provider unavailable · no generation service connected"}</span>
    </div>
    {completed.length > 0 && <div className="mt-4 space-y-2"><h4 className="text-sm font-semibold">Completed authorized videos</h4>{completed.map(job => <article key={job.id} className="rounded-xl border p-3 text-xs"><div className="font-medium">{job.provider} · {job.artifact.durationSeconds.toFixed(1)}s</div><p className="mt-1 whitespace-pre-wrap">{job.prompt}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={!canInsert} onClick={() => onInsert(job, false)} className="rounded border px-2 py-1 disabled:opacity-40">Insert at playhead ({playheadSeconds.toFixed(1)}s)</button>{selection && <button type="button" disabled={!canInsert} onClick={() => onInsert(job, true)} className="rounded border px-2 py-1 disabled:opacity-40">Insert in selected range</button>}</div></article>)}</div>}
    <div className="mt-4 rounded-xl border p-3 text-xs"><h4 className="font-semibold">Selected timeline range</h4><p className="mt-1 text-neutral-500">{capabilities ? `${capabilities.provider}: regenerate ${capabilities.regenerate ? "supported" : "unavailable"}, extend ${capabilities.extend ? "supported" : "unavailable"}, fill ${capabilities.fill ? "supported" : "unavailable"}; maximum ${capabilities.maxDurationSeconds}s.` : "No verified provider capabilities. Range actions stay unavailable."} Select a visual clip to choose its clip or a gap on its track.</p>
      <div className="mt-2 flex flex-wrap gap-2">{actions.map(({ action, label, range }) => <button key={label} type="button" disabled={!supported(action, range) || !prompt.trim() || !creative.stableCreativeId} onClick={() => { if (range && capabilities && creative.stableCreativeId) setRangeJobs(current => [{ id: crypto.randomUUID(), range, prompt: prompt.trim(), provider: capabilities.provider, creativeId: creative.stableCreativeId!, song }, ...current]); }} className="rounded border px-2.5 py-1.5 disabled:opacity-40">{label}</button>)}</div>
      {rangeJobs.length > 0 && <div className="mt-3 space-y-2">{rangeJobs.map(request => { const matching = completed.filter(job => job.artifact.metadata.requestId === request.id && job.provider === request.provider); const fresh = planStudioVideoRange(project, request.range.aspect, request.range.action, request.range.trackId, request.range.clipId, request.range.startFrame); const valid = request.creativeId === creative.stableCreativeId && aspect === request.range.aspect && fresh?.startFrame === request.range.startFrame && fresh?.durationFrames === request.range.durationFrames && fresh?.sourceVersion === request.range.sourceVersion; return <div key={request.id} className="rounded border p-2"><div>Draft {request.range.action} request · {request.provider} · {(request.range.startFrame / fps).toFixed(1)}–{((request.range.startFrame + request.range.durationFrames) / fps).toFixed(1)}s</div><p className="mt-1 whitespace-pre-wrap text-neutral-500">{request.prompt}</p><p className="mt-1 text-neutral-500">Song: {request.song || "None"} · Request ID: {request.id}. Original clip stays until acceptance.</p>{matching.map(job => <button key={job.id} type="button" disabled={!valid || !supported(request.range.action, fresh) || job.artifact.durationSeconds * fps + .001 < request.range.durationFrames} onClick={() => onAccept(request.range, request.id, job)} className="mt-2 rounded border px-2 py-1 disabled:opacity-40">Accept {job.provider} result</button>)}{!matching.length && <p className="mt-1 text-amber-700 dark:text-amber-300">Waiting for a completed authorized result linked to this request. Drafts are local; no provider submission is connected.</p>}</div>; })}</div>}
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs sm:col-span-2">Video prompt<textarea aria-label="Video generation prompt" value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={2000} rows={3} placeholder="Describe the scene, movement, lighting, and visual style…" className="rounded-lg border bg-transparent p-2.5" /></label>
      <label className="grid gap-1 text-xs">Duration<select aria-label="Video duration" value={duration} onChange={event => setDuration(Number(event.target.value))} className="rounded-lg border bg-transparent p-2"><option value={5}>5 seconds</option><option value={10}>10 seconds</option><option value={15}>15 seconds</option><option value={30}>30 seconds</option></select></label>
      <label className="grid gap-1 text-xs">Aspect ratio<select aria-label="Video aspect ratio" value={ratio} onChange={event => setRatio(event.target.value as StudioAspectRatio)} className="rounded-lg border bg-transparent p-2"><option value="9:16">9:16 · Vertical</option><option value="1:1">1:1 · Square</option><option value="16:9">16:9 · Landscape</option></select></label>
      <label className="grid gap-1 text-xs sm:col-span-2">Optional reference image or video<input aria-label="Reference image or video" type="file" accept="image/*,video/*" onChange={event => setReference(event.target.files?.[0] || null)} className="rounded-lg border bg-transparent p-2" />{reference && <span className="text-neutral-500">{reference.name} · {Math.ceil(reference.size / 1024)} KB (not uploaded)</span>}{!hasValidReference && <span role="alert" className="text-rose-600">Choose an image or video file.</span>}</label>
    </div>
    <div className="mt-3 rounded-lg bg-neutral-100 p-3 text-xs dark:bg-neutral-900"><div className="font-medium">Attached creative context</div><div className="mt-1 text-neutral-500">Song: {song || "None selected"} · {selection ? `${selection.kind} “${selection.label}” at ${selection.startSeconds.toFixed(1)}s for ${selection.durationSeconds.toFixed(1)}s` : "No timeline range selected"}</div></div>
    <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" disabled={!prompt.trim() || !hasValidReference} onClick={createJob} className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Create draft job</button><span className="text-xs text-neutral-500">Provider: unavailable · Cost: not available · Status: draft · Artifact: none</span></div>
    {jobs.length > 0 && <div className="mt-4 space-y-2"><h4 className="text-sm font-semibold">Generation jobs</h4>{jobs.map(job => <article key={job.id} className="rounded-xl border p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">Draft · {job.durationSeconds}s · {job.aspectRatio}</span><span className="text-amber-700 dark:text-amber-300">Provider unavailable · no artifact</span></div><p className="mt-2 whitespace-pre-wrap">{job.prompt}</p><div className="mt-2 text-neutral-500">Song: {job.context.song || "None"} · Timeline: {job.context.timeline ? `${job.context.timeline.label}, ${job.context.timeline.startSeconds.toFixed(1)}–${(job.context.timeline.startSeconds + job.context.timeline.durationSeconds).toFixed(1)}s` : "None selected"} · Cost: unavailable{job.reference ? ` · Reference: ${job.reference.name} (metadata only)` : ""}</div></article>)}</div>}
  </section>;
}
