import { useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { CreativeStudioProject, StudioTrack, StudioTransition, StudioTransitionKind, StudioVisualClip } from "./creativeStudioProject";
import type { ReusableAdCreative } from "./api";
import useAudioWaveform from "./useAudioWaveform";
import { addStudioSource, deleteStudioClip, moveStudioTrack, setStudioVideoSpeed, STUDIO_VIDEO_SPEEDS, splitStudioClip, studioSources, trimStudioClip } from "./creativeStudioTracks";
import { editStudioKeyframe, STUDIO_KEYFRAME_BOUNDS, STUDIO_MOTION_PROPERTIES, studioPropertyValue, studioTransformAt } from "./creativeStudioKeyframes";
import type { StudioKeyframeProperty } from "./creativeStudioProject";

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
  const [keySelection, setKeySelection] = useState<{ property: StudioKeyframeProperty; frame: number } | null>(null);
  const [keyProperty, setKeyProperty] = useState<StudioKeyframeProperty>("x");
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
  const updateVisualTransform = (trackId: string, clipId: string, patch: Partial<StudioVisualClip["transform"]>) => onChange({ ...project, tracks: project.tracks.map(track => track.id !== trackId || track.kind !== "visual" ? track : { ...track, clips: track.clips.map(clip => clip.id === clipId ? { ...clip, transform: { ...clip.transform, ...patch } } : clip) }) });
  const updateVisualColor = (trackId: string, clipId: string, key: keyof NonNullable<StudioVisualClip["color"]>, value: number) => onChange({ ...project, tracks: project.tracks.map(track => track.id !== trackId || track.kind !== "visual" ? track : { ...track, clips: track.clips.map(clip => clip.id === clipId ? { ...clip, color: { brightness: 100, contrast: 100, saturation: 100, temperature: 0, tint: 0, ...clip.color, [key]: value } } : clip) }) });
  const updateVisualTransition = (trackId: string, clipId: string, edge: "transitionIn" | "transitionOut", transition: StudioTransition | undefined) => {
    const tracks = project.tracks.map(track => {
      if (track.id !== trackId || track.kind !== "visual") return track;
      const clips = track.clips.map(clip => {
        if (clip.id !== clipId) return clip;
        const other = edge === "transitionIn" ? clip.transitionOut?.durationFrames || 0 : clip.transitionIn?.durationFrames || 0;
        const durationFrames = transition ? Math.min(clip.durationFrames - other, transition.durationFrames) : 0;
        return { ...clip, [edge]: transition ? { ...transition, durationFrames } : undefined };
      });
      return { ...track, clips };
    });
    onChange({ ...project, tracks });
  };
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
              return <div key={clip.id}><button type="button" aria-label={`${name}, ${sourceFor(track, clip)?.identity || clip.id}, ${clock(clip.startFrame / fps)} to ${clock((clip.startFrame + clip.durationFrames) / fps)}`} aria-pressed={selected} onClick={() => { setSelection({ trackId: track.id, clipId: clip.id }); setKeySelection(null); }} className={`absolute top-1.5 h-11 min-w-0 overflow-hidden rounded-md border text-left shadow-sm focus-visible:outline-2 focus-visible:outline-violet-500 ${selected ? "border-violet-300 ring-2 ring-violet-500" : "border-white/25"} ${track.kind === "audio" ? "bg-emerald-700 text-white" : track.kind === "text" ? "bg-fuchsia-700 text-white" : "bg-indigo-700 text-white"}`} style={{ left: frameToPx(clip.startFrame), width: Math.max(2, frameToPx(clip.durationFrames)) }}>
                {media && ("mediaId" in clip && creative.backgroundMedia.find(item => item.mediaId === clip.mediaId)?.mediaType === "image" ? <img src={media} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40" /> : <video src={media} muted playsInline preload="metadata" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40" />)}
                {track.kind === "audio" && "sourceInSeconds" in clip && waveform.duration > 0 && <svg aria-hidden="true" viewBox="0 0 100 40" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full opacity-40">{Array.from({ length: 72 }, (_, index) => { const sourceTime = clip.sourceInSeconds + (clip.sourceOutSeconds - clip.sourceInSeconds) * index / 72; const peak = waveform.peaks[Math.min(waveform.peaks.length - 1, Math.max(0, Math.floor(sourceTime / waveform.duration * waveform.peaks.length)))] || 0; const height = Math.max(2, peak * 36); return <rect key={index} x={index / 72 * 100} y={(40 - height) / 2} width={.9} height={height} fill="currentColor" />; })}</svg>}
                <span className="relative block truncate px-2 text-xs font-semibold">{name}</span><span className="relative block px-2 text-[10px] opacity-80">{(clip.durationFrames / fps).toFixed(1)}s</span>
              </button>{clip.keyframes.map(key => <button key={`${key.property}:${key.frame}`} type="button" title={`${key.property} at frame ${key.frame}: ${key.value}`} aria-label={`Select ${key.property} keyframe at frame ${key.frame}`} aria-pressed={selected && keySelection?.property === key.property && keySelection.frame === key.frame} onClick={() => { setSelection({ trackId: track.id, clipId: clip.id }); setKeySelection({ property: key.property, frame: key.frame }); setKeyProperty(key.property); setPlayhead(clip.startFrame + key.frame); }} className={`absolute z-10 h-3 w-3 -translate-x-1/2 rotate-45 border border-white bg-amber-400 focus-visible:outline-2 focus-visible:outline-violet-500 ${selected && keySelection?.property === key.property && keySelection.frame === key.frame ? "ring-2 ring-violet-500" : ""}`} style={{ left: frameToPx(clip.startFrame + key.frame), top: 1 + Math.max(0, (track.kind === "audio" ? ["volume"] : STUDIO_MOTION_PROPERTIES).indexOf(key.property)) * 8 }} />)}</div>;
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
      const visualClip = track.kind === "visual" ? clip as StudioVisualClip : null;
      const previewUrl = visualClip?.mediaId ? mediaUrls[visualClip.mediaId] : undefined;
      const previewMedia = visualClip?.mediaId ? creative.backgroundMedia.find(item => item.mediaId === visualClip.mediaId) : undefined;
      const localFrame = Math.max(0, Math.min(clip.durationFrames - 1, playhead - clip.startFrame));
      const animatedTransform = studioTransformAt(clip, localFrame);
      const color = visualClip?.color || { brightness: 100, contrast: 100, saturation: 100, temperature: 0, tint: 0 };
      const temperatureHue = color.temperature === 0 ? 0 : color.temperature < 0 ? 210 : 30;
      const colorFilter = `brightness(${color.brightness}%) contrast(${color.contrast}%) saturate(${color.saturation}%) sepia(${Math.abs(color.temperature) * .0035}) hue-rotate(${temperatureHue}deg) hue-rotate(${color.tint * .12}deg)`;
      const transition = visualClip && (() => {
        const incoming = visualClip.transitionIn;
        const outgoing = visualClip.transitionOut;
        if (incoming && incoming.durationFrames > 0 && localFrame < incoming.durationFrames) return { value: incoming, progress: localFrame / incoming.durationFrames };
        const outStart = visualClip.durationFrames - (outgoing?.durationFrames || 0);
        if (outgoing && outgoing.durationFrames > 0 && localFrame >= outStart) return { value: outgoing, progress: (localFrame - outStart) / outgoing.durationFrames };
        return null;
      })();
      const transitionStyle: React.CSSProperties = transition && transition.value.kind !== "cut" ? (() => {
        const entering = !!visualClip?.transitionIn && transition.value === visualClip.transitionIn;
        const progress = Math.max(0, Math.min(1, transition.progress));
        if (transition.value.kind === "dip" || transition.value.kind === "fade") return { opacity: (animatedTransform?.opacity ?? 1) * (entering ? progress : 1 - progress) };
        if (transition.value.kind === "wipe-left" || transition.value.kind === "wipe-right" || transition.value.kind === "wipe-up" || transition.value.kind === "wipe-down") {
          const hidden = `${(1 - progress) * 100}%`;
          const inset = transition.value.kind === "wipe-left" ? `0 ${hidden} 0 0` : transition.value.kind === "wipe-right" ? `0 0 0 ${hidden}` : transition.value.kind === "wipe-up" ? `${hidden} 0 0 0` : `0 0 ${hidden} 0`;
          return { opacity: animatedTransform?.opacity, clipPath: `inset(${inset})` };
        }
        return { opacity: (animatedTransform?.opacity ?? 1) * (entering ? progress : 1) };
      })() : { opacity: animatedTransform?.opacity };
      const properties = track.kind === "audio" ? ["volume" as const] : STUDIO_MOTION_PROPERTIES;
      const activeProperty = properties.includes(keyProperty as never) ? keyProperty : properties[0];
      const activeKey = keySelection && clip.keyframes.find(key => key.property === keySelection.property && key.frame === keySelection.frame);
      const valueAtPlayhead = studioPropertyValue(clip, activeProperty, localFrame);
      const [minValue, maxValue] = STUDIO_KEYFRAME_BOUNDS[activeKey?.property || activeProperty];
      const changeKey = (frame: number, value: number, interpolation: "hold" | "linear") => {
        const property = activeKey?.property || activeProperty;
        const oldFrame = activeKey ? activeKey.frame : null;
        const next = { frame, property, value, interpolation };
        const changed = editStudioKeyframe(project, track.id, clip.id, property, oldFrame, next);
        if (changed !== project) { onChange(changed); setKeySelection({ property, frame }); }
      };
      return <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
        {visualClip && <div className="flex w-full flex-wrap items-start gap-4 border-b border-neutral-200 py-3 dark:border-neutral-800">
          <div className="w-36 shrink-0"><div aria-label="9 by 16 clip preview" className="relative aspect-[9/16] w-full overflow-hidden rounded-lg bg-black" style={{ backgroundColor: project.render.backgroundColor }}>
            {previewUrl && animatedTransform && (previewMedia?.mediaType === "video" ? <video ref={element => { if (element) element.playbackRate = visualClip.speed || 1; }} src={previewUrl} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full" style={{ objectFit: animatedTransform.fit || "cover", objectPosition: `${(animatedTransform.anchorX ?? .5) * 100}% ${(animatedTransform.anchorY ?? .5) * 100}%`, transformOrigin: `${(animatedTransform.anchorX ?? .5) * 100}% ${(animatedTransform.anchorY ?? .5) * 100}%`, transform: `translate(${(animatedTransform.x - .5) * 100}%, ${(animatedTransform.y - .5) * 100}%) scale(${animatedTransform.scale}) rotate(${animatedTransform.rotationDegrees}deg)`, filter: colorFilter, ...transitionStyle }} /> : <img src={previewUrl} alt="" className="absolute inset-0 h-full w-full" style={{ objectFit: animatedTransform.fit || "cover", objectPosition: `${(animatedTransform.anchorX ?? .5) * 100}% ${(animatedTransform.anchorY ?? .5) * 100}%`, transformOrigin: `${(animatedTransform.anchorX ?? .5) * 100}% ${(animatedTransform.anchorY ?? .5) * 100}%`, transform: `translate(${(animatedTransform.x - .5) * 100}%, ${(animatedTransform.y - .5) * 100}%) scale(${animatedTransform.scale}) rotate(${animatedTransform.rotationDegrees}deg)`, filter: colorFilter, ...transitionStyle }} />)}
            {!previewUrl && <span className="absolute inset-0 grid place-items-center px-2 text-center text-[10px] text-white/70">Preview unavailable</span>}
          </div><p className="mt-1 text-center text-[10px] text-neutral-500">9:16 ad preview</p></div>
          <div className="grid min-w-[220px] flex-1 grid-cols-2 gap-x-4 gap-y-2">
            {previewMedia?.mediaType === "video" && <label className="grid gap-1">Video speed<select aria-label="Video speed" value={visualClip.speed || 1} disabled={locked} onChange={event => onChange(setStudioVideoSpeed(project, track.id, clip.id, Number(event.target.value) as typeof STUDIO_VIDEO_SPEEDS[number], fps))} className="rounded border bg-transparent p-2">{STUDIO_VIDEO_SPEEDS.map(speed => { const frames = Math.max(1, Math.round((visualClip.sourceOutSeconds - visualClip.sourceInSeconds) / speed * fps)); const fits = visualClip.startFrame + frames <= project.durationFrames; return <option key={speed} value={speed} disabled={!fits}>{speed}× · {(frames / fps).toFixed(2)}s{fits ? "" : " (over project end)"}</option>; })}</select><span className="text-[10px] text-neutral-500">Source audio is muted; speed changes affect video only. No pitch processing.</span></label>}
            <label className="grid gap-1">Position X <input aria-label="Clip position X" type="range" min="0" max="1" step="0.01" value={visualClip.transform.x} disabled={locked} onChange={event => updateVisualTransform(track.id, clip.id, { x: Number(event.target.value) })} /></label>
            <label className="grid gap-1">Position Y <input aria-label="Clip position Y" type="range" min="0" max="1" step="0.01" value={visualClip.transform.y} disabled={locked} onChange={event => updateVisualTransform(track.id, clip.id, { y: Number(event.target.value) })} /></label>
            <label className="grid gap-1">Scale <input aria-label="Clip scale" type="range" min="0.25" max="3" step="0.01" value={Math.max(.25, Math.min(3, visualClip.transform.scale))} disabled={locked} onChange={event => updateVisualTransform(track.id, clip.id, { scale: Number(event.target.value) })} /></label>
            <label className="grid gap-1">Rotation <input aria-label="Clip rotation" type="range" min="-180" max="180" step="1" value={Math.max(-180, Math.min(180, visualClip.transform.rotationDegrees))} disabled={locked} onChange={event => updateVisualTransform(track.id, clip.id, { rotationDegrees: Number(event.target.value) })} /></label>
            <label className="grid gap-1">Crop / fit <select aria-label="Clip crop fit" value={visualClip.transform.fit || "cover"} disabled={locked} onChange={event => updateVisualTransform(track.id, clip.id, { fit: event.target.value as "cover" | "contain" | "fill" })} className="rounded border bg-transparent p-1"><option value="cover">Fill frame (crop)</option><option value="contain">Fit whole image</option><option value="fill">Stretch to frame</option></select></label>
            <label className="grid gap-1">Anchor <select aria-label="Clip anchor" value={`${visualClip.transform.anchorX ?? .5},${visualClip.transform.anchorY ?? .5}`} disabled={locked} onChange={event => { const [anchorX, anchorY] = event.target.value.split(",").map(Number); updateVisualTransform(track.id, clip.id, { anchorX, anchorY }); }} className="rounded border bg-transparent p-1"><option value="0,0">Top left</option><option value="0.5,0">Top center</option><option value="1,0">Top right</option><option value="0,0.5">Center left</option><option value="0.5,0.5">Center</option><option value="1,0.5">Center right</option><option value="0,1">Bottom left</option><option value="0.5,1">Bottom center</option><option value="1,1">Bottom right</option></select></label>
            {([ ["brightness", "Brightness", 0, 200, 100], ["contrast", "Contrast", 0, 200, 100], ["saturation", "Saturation", 0, 200, 100], ["temperature", "Temperature", -100, 100, 0], ["tint", "Tint", -100, 100, 0] ] as const).map(([key, label, min, max, neutral]) => <label key={key} className="grid gap-1">{label} <span className="text-[10px] text-neutral-500">{color[key] ?? neutral}</span><input aria-label={`Clip ${label.toLowerCase()}`} type="range" min={min} max={max} step="1" value={color[key] ?? neutral} disabled={locked} onChange={event => updateVisualColor(track.id, clip.id, key, Number(event.target.value))} /></label>)}
          </div>
          <div className="grid w-full grid-cols-2 gap-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
            {(["transitionIn", "transitionOut"] as const).map(edge => {
              const value = visualClip[edge];
              const kind = value?.kind || "cut";
              const setKind = (next: StudioTransitionKind) => updateVisualTransition(track.id, clip.id, edge, next === "cut" ? undefined : { kind: next, durationFrames: value?.durationFrames || Math.min(15, Math.floor(visualClip.durationFrames / 2)) });
              return <div key={edge} className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1">{edge === "transitionIn" ? "Transition in" : "Transition out"}<select aria-label={`${edge === "transitionIn" ? "Transition in" : "Transition out"} type`} value={kind} disabled={locked} onChange={event => setKind(event.target.value as StudioTransitionKind)} className="rounded border bg-transparent p-2"><option value="cut">Cut</option><option value="dissolve">Crossfade / dissolve</option><option value="dip">Dip to black</option><option value="wipe-left">Wipe left</option><option value="wipe-right">Wipe right</option><option value="wipe-up">Wipe up</option><option value="wipe-down">Wipe down</option></select></label>
                <label className="grid gap-1">Duration (frames)<input aria-label={`${edge === "transitionIn" ? "Transition in" : "Transition out"} duration frames`} type="number" min={1} max={Math.max(1, visualClip.durationFrames - (visualClip[edge === "transitionIn" ? "transitionOut" : "transitionIn"]?.durationFrames || 0))} step={1} value={value?.durationFrames || 15} disabled={locked || kind === "cut"} onChange={event => updateVisualTransition(track.id, clip.id, edge, { kind: kind as StudioTransitionKind, durationFrames: Number(event.target.value) })} className="w-28 rounded border bg-transparent p-2" /></label>
              </div>;
            })}
            <p className="col-span-2 text-[10px] text-neutral-500">Preview uses the selected clip and playhead frame for repeatable transition feedback.</p>
          </div>
        </div>}
        <div className="flex w-full flex-wrap items-end gap-2 border-b border-neutral-200 py-3 dark:border-neutral-800">
          <span className="w-full font-medium">Property keyframes · clip frame {localFrame} · {clip.keyframes.length}/200</span>
          <label className="grid gap-1">Property <select aria-label="Keyframe property" value={activeProperty} disabled={locked} onChange={event => { setKeyProperty(event.target.value as StudioKeyframeProperty); setKeySelection(null); }} className="rounded border bg-transparent p-2">{properties.map(property => <option key={property} value={property}>{property === "x" ? "Position X" : property === "y" ? "Position Y" : property === "rotationDegrees" ? "Rotation" : property[0].toUpperCase() + property.slice(1)}</option>)}</select></label>
          <button type="button" disabled={locked || playhead < clip.startFrame || playhead >= clipEnd || clip.keyframes.length >= 200 || clip.keyframes.some(key => key.property === activeProperty && key.frame === localFrame)} onClick={() => { const changed = editStudioKeyframe(project, track.id, clip.id, activeProperty, null, { frame: localFrame, property: activeProperty, value: valueAtPlayhead, interpolation: "linear" }); if (changed !== project) { onChange(changed); setKeySelection({ property: activeProperty, frame: localFrame }); } }} className="rounded border px-3 py-2 disabled:opacity-40">Add key at playhead</button>
          {activeKey && <>
            <label className="grid gap-1">Clip frame <input aria-label="Keyframe frame" type="number" min={0} max={clip.durationFrames - 1} step={1} value={activeKey.frame} disabled={locked} onChange={event => changeKey(Number(event.target.value), activeKey.value, activeKey.interpolation)} className="w-24 rounded border bg-transparent p-2" /></label>
            <label className="grid gap-1">Value <input aria-label="Keyframe value" type="number" min={minValue} max={maxValue} step="0.01" value={activeKey.value} disabled={locked} onChange={event => changeKey(activeKey.frame, Number(event.target.value), activeKey.interpolation)} className="w-24 rounded border bg-transparent p-2" /></label>
            <label className="grid gap-1">Interpolation <select aria-label="Keyframe interpolation" value={activeKey.interpolation} disabled={locked} onChange={event => changeKey(activeKey.frame, activeKey.value, event.target.value as "hold" | "linear")} className="rounded border bg-transparent p-2"><option value="linear">Linear</option><option value="hold">Hold</option></select></label>
            <button type="button" disabled={locked} onClick={() => { onChange(editStudioKeyframe(project, track.id, clip.id, activeKey.property, activeKey.frame, null)); setKeySelection(null); }} className="rounded border border-rose-300 px-3 py-2 text-rose-700 disabled:opacity-40">Delete key</button>
          </>}
          <span className="text-neutral-500">At playhead: {valueAtPlayhead.toFixed(2)}. Select a diamond marker to move or edit it.</span>
        </div>
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
