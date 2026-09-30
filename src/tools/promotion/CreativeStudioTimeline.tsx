import { useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { CreativeStudioProject, StudioTrack } from "./creativeStudioProject";
import type { ReusableAdCreative } from "./api";
import useAudioWaveform from "./useAudioWaveform";
import { addStudioSource, deleteStudioClip, moveStudioTrack, splitStudioClip, studioSources, trimStudioClip } from "./creativeStudioTracks";

const ROW = 56;
const MIN_ZOOM = 24;
const MAX_ZOOM = 240;

function clock(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function timelineFrameAt(clientX: number, rectLeft: number, scrollLeft: number, pixelsPerSecond: number, fps: number, durationFrames: number, snapFrames: number) {
  const raw = Math.round(Math.max(0, clientX - rectLeft + scrollLeft) / pixelsPerSecond * fps);
  return Math.max(0, Math.min(durationFrames, snapFrames > 0 ? Math.round(raw / snapFrames) * snapFrames : raw));
}

/** The project is owned by the reusable creative. This view only changes local timeline UI state. */
export default function CreativeStudioTimeline({ creative, project, onChange, mediaUrls = {}, audioUrl = "" }: {
  creative: Pick<ReusableAdCreative,"name"|"audioSnippets"|"backgroundMedia"|"overlays"|"caption"|"cta">;
  project: CreativeStudioProject;
  onChange: (project: CreativeStudioProject) => void;
  mediaUrls?: Record<string, string>;
  audioUrl?: string;
}) {
  const [zoom, setZoom] = useState(80);
  const [snap, setSnap] = useState(true);
  const [playhead, setPlayhead] = useState(0);
  const [selection, setSelection] = useState<{ trackId: string; clipId: string } | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [rippleDelete, setRippleDelete] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const waveform = useAudioWaveform(audioUrl);
  const fps = project.timebase.framesPerSecond.numerator / project.timebase.framesPerSecond.denominator;
  const seconds = project.durationFrames / fps;
  const width = Math.max(320, seconds * zoom);
  const majorSeconds = zoom >= 100 ? 1 : zoom >= 48 ? 2 : 5;
  const ticks = useMemo(() => Array.from({ length: Math.ceil(seconds / majorSeconds) + 1 }, (_, i) => i * majorSeconds).filter(t => t <= seconds), [seconds, majorSeconds]);
  const snapFrames = snap ? Math.max(1, Math.round(fps * (zoom >= 100 ? .25 : zoom >= 48 ? .5 : 1))) : 0;
  const frameToPx = (frame: number) => frame / fps * zoom;
  const sources = studioSources(creative, project.durationFrames, fps);
  const availableSources = sources.filter(source => !project.tracks.some(track => track.id === source.id || track.clips.some(clip => source.track.clips.some(item => item.id === clip.id))));
  const sourceFor = (track: StudioTrack, clip: StudioTrack["clips"][number]) => sources.find(source => source.track.kind === track.kind && source.track.clips.some(item => item.id === clip.id || ("mediaId" in item && "mediaId" in clip && item.mediaId === clip.mediaId) || ("snippetId" in item && "snippetId" in clip && item.snippetId === clip.snippetId) || ("overlayId" in item && "overlayId" in clip && item.overlayId === clip.overlayId) || ("source" in item && "source" in clip && item.source !== "text" && item.source === clip.source)));
  const updateTrack = (trackId: string, change: Partial<StudioTrack>) => onChange({ ...project, tracks: project.tracks.map(track => track.id === trackId ? { ...track, ...change } as StudioTrack : track) });
  const trackName = (track: StudioTrack) => track.kind === "visual" ? "Video" : track.kind === "audio" ? "Audio" : "Text";
  const clipName = (track: StudioTrack, clip: StudioTrack["clips"][number]) => {
    if (track.kind === "text" && "text" in clip) return clip.text;
    if (track.kind === "audio" && "snippetId" in clip) return creative.audioSnippets.find(item => item.snippetId === clip.snippetId)?.label || "Audio clip";
    if ("overlayId" in clip && clip.overlayId) return creative.overlays.find(item => item.id === clip.overlayId)?.kind === "sticker" ? "Meme / sticker" : "Overlay asset";
    if ("mediaId" in clip) return sources.find(item => item.id === `media:${clip.mediaId}`)?.label || "Visual asset";
    return "Clip";
  };
  function seek(event: PointerEvent<HTMLDivElement>) {
    const el = viewport.current;
    if (!el) return;
    const left = el.getBoundingClientRect().left;
    setPlayhead(timelineFrameAt(event.clientX, left, el.scrollLeft, zoom, fps, project.durationFrames, snapFrames));
  }
  function rulerDown(event: PointerEvent<HTMLDivElement>) {
    drag.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    seek(event);
  }
  return <section aria-label="Ads Creative Studio timeline" className="min-w-0 rounded-2xl border border-neutral-200 bg-white/80 text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-neutral-100">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-3 dark:border-neutral-800">
      <div><h4 className="text-sm font-semibold">Creative Studio timeline</h4><p className="text-xs text-neutral-500">{creative.name} · {clock(seconds)} · {fps.toFixed(2)} fps</p></div>
      <div className="flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1">Add source <select aria-label="Add source" value={sourceId} onChange={event => setSourceId(event.target.value)} className="max-w-40 rounded border bg-transparent p-2"><option value="">Choose asset</option>{availableSources.map(source => <option key={source.id} value={source.id}>{source.label} ({source.identity})</option>)}</select></label>
        <button type="button" disabled={!sourceId || project.tracks.length >= 12} onClick={() => { const source = availableSources.find(item => item.id === sourceId); if (source) { onChange(addStudioSource(project, source)); setSelection({ trackId: source.id, clipId: source.track.clips[0].id }); setSourceId(""); } }} className="rounded border px-3 py-2 disabled:opacity-40">Add track</button>
        <button type="button" aria-pressed={snap} onClick={() => setSnap(value => !value)} className={`min-h-11 rounded-lg border px-3 ${snap ? "border-violet-500 text-violet-600 dark:text-violet-300" : "border-neutral-300 dark:border-neutral-700"}`}>Snap {snap ? "on" : "off"}</button>
        <label className="flex items-center gap-2">Zoom <input aria-label="Timeline zoom" type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={8} value={zoom} onChange={event => setZoom(Number(event.target.value))} className="w-24 sm:w-32" /></label>
      </div>
    </div>
    <div className="flex min-w-0">
      <div className="z-10 w-[216px] shrink-0 border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex h-[38px] items-center border-b border-neutral-200 px-3 text-[11px] text-neutral-500 dark:border-neutral-800">{clock(playhead / fps)}</div>
        {project.tracks.map((track, index) => <div key={track.id} style={{ height: ROW }} className="flex flex-col justify-center border-b border-neutral-200 px-2 dark:border-neutral-800"><div className="flex items-center justify-between gap-1"><span className="truncate text-xs font-semibold" title={track.id}>{trackName(track)} {index + 1}</span><div className="flex gap-1"><button type="button" aria-label={`Move ${trackName(track)} ${index + 1} up`} disabled={index === 0 || track.locked || project.tracks[index - 1]?.locked} onClick={() => onChange(moveStudioTrack(project, track.id, -1))}>↑</button><button type="button" aria-label={`Move ${trackName(track)} ${index + 1} down`} disabled={index === project.tracks.length - 1 || track.locked || project.tracks[index + 1]?.locked} onClick={() => onChange(moveStudioTrack(project, track.id, 1))}>↓</button><button type="button" aria-label={`${track.locked ? "Unlock" : "Lock"} ${trackName(track)} ${index + 1}`} aria-pressed={!!track.locked} onClick={() => updateTrack(track.id, { locked: !track.locked })}>{track.locked ? "🔒" : "🔓"}</button><button type="button" aria-label={`${track.kind === "audio" ? track.muted ? "Unmute" : "Mute" : track.visible === false ? "Show" : "Hide"} ${trackName(track)} ${index + 1}`} aria-pressed={track.kind === "audio" ? !!track.muted : track.visible === false} disabled={track.locked} onClick={() => track.kind === "audio" ? updateTrack(track.id, { muted: !track.muted }) : updateTrack(track.id, { visible: track.visible === false })}>{track.kind === "audio" ? track.muted ? "🔇" : "🔊" : track.visible === false ? "◌" : "◉"}</button></div></div><span className="truncate text-[10px] text-neutral-500" title={track.clips.map(clip => sourceFor(track, clip)?.identity || clip.id).join(", ")}>{track.clips.length} clips · {track.clips.map(clip => sourceFor(track, clip)?.identity || clip.id).join(", ")}</span></div>)}
      </div>
      <div ref={viewport} aria-label="Timeline tracks; swipe horizontally to scroll" className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain touch-pan-x" style={{ scrollbarWidth: "thin" }}>
        <div className="relative" style={{ width, minWidth: "100%" }}>
          <div role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={project.durationFrames} aria-valuenow={playhead} aria-valuetext={clock(playhead / fps)} tabIndex={0} onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); setPlayhead(value => Math.max(0, Math.min(project.durationFrames, value + (event.key === "ArrowRight" ? 1 : -1) * (snapFrames || 1)))); } }} onPointerDown={rulerDown} onPointerMove={event => { if (drag.current === event.pointerId) seek(event); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} className="relative h-[38px] cursor-crosshair select-none border-b border-neutral-200 bg-neutral-50 touch-pan-x dark:border-neutral-800 dark:bg-neutral-900">
            {ticks.map(time => <div key={time} className="absolute inset-y-0 border-l border-neutral-300 pl-1 pt-1 text-[10px] text-neutral-500 dark:border-neutral-700" style={{ left: time * zoom }}>{clock(time)}</div>)}
          </div>
          {project.tracks.map(track => <div key={track.id} className={`relative border-b border-neutral-200 bg-[linear-gradient(to_right,transparent_calc(100%-1px),rgba(128,128,128,.12)_100%)] dark:border-neutral-800 ${(track.kind === "audio" ? track.muted : track.visible === false) ? "opacity-40" : ""}`} style={{ height: ROW, backgroundSize: `${majorSeconds * zoom}px 100%` }} onPointerDown={event => { if (event.target === event.currentTarget) { setSelection(null); seek(event); } }}>
            {track.clips.map(clip => {
              const selected = selection?.trackId === track.id && selection.clipId === clip.id;
              const name = clipName(track, clip);
              const media = "mediaId" in clip && clip.mediaId ? mediaUrls[clip.mediaId] : undefined;
              return <button key={clip.id} type="button" aria-label={`${name}, ${sourceFor(track, clip)?.identity || clip.id}, ${clock(clip.startFrame / fps)} to ${clock((clip.startFrame + clip.durationFrames) / fps)}`} aria-pressed={selected} onClick={() => setSelection({ trackId: track.id, clipId: clip.id })} className={`absolute top-1.5 h-11 min-w-0 overflow-hidden rounded-md border text-left shadow-sm focus-visible:outline-2 focus-visible:outline-violet-500 ${selected ? "border-violet-300 ring-2 ring-violet-500" : "border-white/25"} ${track.kind === "audio" ? "bg-emerald-700 text-white" : track.kind === "text" ? "bg-fuchsia-700 text-white" : "bg-indigo-700 text-white"}`} style={{ left: frameToPx(clip.startFrame), width: Math.max(2, frameToPx(clip.durationFrames)) }}>
                {media && ("mediaId" in clip && creative.backgroundMedia.find(item => item.mediaId === clip.mediaId)?.mediaType === "image" ? <img src={media} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40" /> : <video src={media} muted playsInline preload="metadata" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40" />)}
                {track.kind === "audio" && "sourceInSeconds" in clip && waveform.duration > 0 && <svg aria-hidden="true" viewBox="0 0 100 40" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full opacity-40">{Array.from({ length: 72 }, (_, index) => { const sourceTime = clip.sourceInSeconds + (clip.sourceOutSeconds - clip.sourceInSeconds) * index / 72; const peak = waveform.peaks[Math.min(waveform.peaks.length - 1, Math.max(0, Math.floor(sourceTime / waveform.duration * waveform.peaks.length)))] || 0; const height = Math.max(2, peak * 36); return <rect key={index} x={index / 72 * 100} y={(40 - height) / 2} width={.9} height={height} fill="currentColor" />; })}</svg>}
                <span className="relative block truncate px-2 text-xs font-semibold">{name}</span><span className="relative block px-2 text-[10px] opacity-80">{(clip.durationFrames / fps).toFixed(1)}s</span>
              </button>;
            })}
          </div>)}
          <div aria-hidden="true" className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-rose-500" style={{ left: frameToPx(playhead) }}><div className="absolute -left-1.5 top-0 h-3 w-3 rotate-45 bg-rose-500" /></div>
        </div>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-3 p-3 text-xs text-neutral-500">{selection ? <span>Selected: {project.tracks.flatMap(track => track.clips.map(clip => ({ track, clip }))).filter(item => item.track.id === selection.trackId && item.clip.id === selection.clipId).map(item => `${clipName(item.track, item.clip)} · ${clock(item.clip.startFrame / fps)}–${clock((item.clip.startFrame + item.clip.durationFrames) / fps)}`)[0]}</span> : <span>Select a clip or tap the ruler to seek.</span>}{audioUrl && <audio controls preload="none" src={audioUrl} className="ml-auto h-9 max-w-full" />}</div>
    {selection && (() => {
      const track = project.tracks.find(item => item.id === selection.trackId);
      const clip = track?.clips.find(item => item.id === selection.clipId);
      if (!track || !clip) return null;
      const locked = !!track.locked;
      const clipEnd = clip.startFrame + clip.durationFrames;
      const hasSourceRange = "sourceInSeconds" in clip;
      return <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
        <span className="mr-1 font-medium">Edit clip</span>
        <button type="button" disabled={locked || playhead <= clip.startFrame || playhead >= clipEnd} onClick={() => onChange(splitStudioClip(project, track.id, clip.id, snapFrames ? Math.round(playhead / snapFrames) * snapFrames : playhead))} className="rounded border px-3 py-2 disabled:opacity-40">Split at playhead</button>
        <button type="button" disabled={locked || playhead <= clip.startFrame || playhead >= clipEnd} onClick={() => onChange(trimStudioClip(project, track.id, clip.id, "start", snapFrames ? Math.round(playhead / snapFrames) * snapFrames : playhead))} className="rounded border px-3 py-2 disabled:opacity-40">Trim start to playhead</button>
        <button type="button" disabled={locked || playhead <= clip.startFrame || playhead >= clipEnd} onClick={() => onChange(trimStudioClip(project, track.id, clip.id, "end", snapFrames ? Math.round(playhead / snapFrames) * snapFrames : playhead))} className="rounded border px-3 py-2 disabled:opacity-40">Trim end to playhead</button>
        <label className="flex items-center gap-1"><input type="checkbox" checked={rippleDelete} onChange={event => setRippleDelete(event.target.checked)} disabled={locked} />Ripple later clips on this track</label>
        <button type="button" disabled={locked} onClick={() => { onChange(deleteStudioClip(project, track.id, clip.id, rippleDelete)); setSelection(null); }} className="rounded border border-rose-300 px-3 py-2 text-rose-700 disabled:opacity-40 dark:text-rose-300">Delete clip</button>
        <button type="button" disabled={locked} onClick={() => { onChange({ ...project, tracks: project.tracks.filter(item => item.id !== track.id) }); setSelection(null); }} className="rounded border px-3 py-2 disabled:opacity-40">Remove track</button>
        {hasSourceRange && <span className="text-neutral-500">Source {clip.sourceInSeconds.toFixed(2)}–{clip.sourceOutSeconds.toFixed(2)}s</span>}
        <span className="text-neutral-500">{locked ? "Unlock this track to edit clips." : "Source media stays intact. Ripple only closes the gap on this track; project length stays fixed."}</span>
      </div>;
    })()}
  </section>;
}
