import { useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { CreativeStudioProject, StudioTrack } from "./creativeStudioProject";
import type { ReusableAdCreative } from "./api";
import useAudioWaveform from "./useAudioWaveform";

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
export default function CreativeStudioTimeline({ creative, project, mediaUrls = {}, audioUrl = "" }: {
  creative: Pick<ReusableAdCreative,"name"|"audioSnippets"|"backgroundMedia">;
  project: CreativeStudioProject;
  mediaUrls?: Record<string, string>;
  audioUrl?: string;
}) {
  const [zoom, setZoom] = useState(80);
  const [snap, setSnap] = useState(true);
  const [playhead, setPlayhead] = useState(0);
  const [selection, setSelection] = useState<{ trackId: string; clipId: string } | null>(null);
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
  const trackName = (track: StudioTrack) => track.kind === "visual" ? "Video" : track.kind === "audio" ? "Audio" : "Text";
  const clipName = (track: StudioTrack, clip: StudioTrack["clips"][number]) => {
    if (track.kind === "text" && "text" in clip) return clip.text;
    if (track.kind === "audio" && "snippetId" in clip) return creative.audioSnippets.find(item => item.snippetId === clip.snippetId)?.label || "Audio clip";
    if ("mediaId" in clip) return creative.backgroundMedia.findIndex(item => item.mediaId === clip.mediaId) + 1 ? `Background ${creative.backgroundMedia.findIndex(item => item.mediaId === clip.mediaId) + 1}` : "Background";
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
        <button type="button" aria-pressed={snap} onClick={() => setSnap(value => !value)} className={`min-h-11 rounded-lg border px-3 ${snap ? "border-violet-500 text-violet-600 dark:text-violet-300" : "border-neutral-300 dark:border-neutral-700"}`}>Snap {snap ? "on" : "off"}</button>
        <label className="flex items-center gap-2">Zoom <input aria-label="Timeline zoom" type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={8} value={zoom} onChange={event => setZoom(Number(event.target.value))} className="w-24 sm:w-32" /></label>
      </div>
    </div>
    <div className="flex min-w-0">
      <div className="z-10 w-[124px] shrink-0 border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex h-[38px] items-center border-b border-neutral-200 px-3 text-[11px] text-neutral-500 dark:border-neutral-800">{clock(playhead / fps)}</div>
        {project.tracks.map((track, index) => <div key={track.id} style={{ height: ROW }} className="flex flex-col justify-center border-b border-neutral-200 px-3 dark:border-neutral-800"><span className="text-xs font-semibold">{trackName(track)} {index + 1}</span><span className="text-[10px] text-neutral-500">{track.clips.length} clips</span></div>)}
      </div>
      <div ref={viewport} aria-label="Timeline tracks; swipe horizontally to scroll" className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain touch-pan-x" style={{ scrollbarWidth: "thin" }}>
        <div className="relative" style={{ width, minWidth: "100%" }}>
          <div role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={project.durationFrames} aria-valuenow={playhead} aria-valuetext={clock(playhead / fps)} tabIndex={0} onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); setPlayhead(value => Math.max(0, Math.min(project.durationFrames, value + (event.key === "ArrowRight" ? 1 : -1) * (snapFrames || 1)))); } }} onPointerDown={rulerDown} onPointerMove={event => { if (drag.current === event.pointerId) seek(event); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} className="relative h-[38px] cursor-crosshair select-none border-b border-neutral-200 bg-neutral-50 touch-pan-x dark:border-neutral-800 dark:bg-neutral-900">
            {ticks.map(time => <div key={time} className="absolute inset-y-0 border-l border-neutral-300 pl-1 pt-1 text-[10px] text-neutral-500 dark:border-neutral-700" style={{ left: time * zoom }}>{clock(time)}</div>)}
          </div>
          {project.tracks.map(track => <div key={track.id} className="relative border-b border-neutral-200 bg-[linear-gradient(to_right,transparent_calc(100%-1px),rgba(128,128,128,.12)_100%)] dark:border-neutral-800" style={{ height: ROW, backgroundSize: `${majorSeconds * zoom}px 100%` }} onPointerDown={event => { if (event.target === event.currentTarget) { setSelection(null); seek(event); } }}>
            {track.clips.map(clip => {
              const selected = selection?.trackId === track.id && selection.clipId === clip.id;
              const name = clipName(track, clip);
              const media = "mediaId" in clip ? mediaUrls[clip.mediaId] : undefined;
              return <button key={clip.id} type="button" aria-label={`${name}, ${clock(clip.startFrame / fps)} to ${clock((clip.startFrame + clip.durationFrames) / fps)}`} aria-pressed={selected} onClick={() => setSelection({ trackId: track.id, clipId: clip.id })} className={`absolute top-1.5 h-11 min-w-0 overflow-hidden rounded-md border text-left shadow-sm focus-visible:outline-2 focus-visible:outline-violet-500 ${selected ? "border-violet-300 ring-2 ring-violet-500" : "border-white/25"} ${track.kind === "audio" ? "bg-emerald-700 text-white" : track.kind === "text" ? "bg-fuchsia-700 text-white" : "bg-indigo-700 text-white"}`} style={{ left: frameToPx(clip.startFrame), width: Math.max(2, frameToPx(clip.durationFrames)) }}>
                {media && <video src={media} muted playsInline preload="metadata" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40" />}
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
  </section>;
}
