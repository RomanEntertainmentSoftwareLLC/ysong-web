import type { ReusableAdCreative } from "./api";
import type { CreativeStudioProject, StudioTrack, StudioTransform, StudioVisualClip } from "./creativeStudioProject";

export type StudioSource = { id: string; kind: StudioTrack["kind"]; label: string; identity: string; track: StudioTrack };
export const STUDIO_VIDEO_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const transform: StudioTransform = { x: .5, y: .5, scale: 1, rotationDegrees: 0, opacity: 1 };
const style = { fontSize: 48, color: "#ffffff" };
const clipBase = (id: string, frames: number) => ({ id: `clip:${id}`, startFrame: 0, durationFrames: frames, keyframes: [] });

/** Source IDs stay on clips; object keys and signed URLs stay on the reusable creative. */
export function studioSources(creative: Pick<ReusableAdCreative, "audioSnippets" | "backgroundMedia" | "overlays" | "caption" | "cta">, durationFrames: number, fps: number): StudioSource[] {
  const seconds = durationFrames / fps;
  const sources: StudioSource[] = [];
  creative.backgroundMedia.forEach((media, index) => {
    const label = `${media.mediaType === "video" ? "Video" : "Image"} ${index + 1}`;
    const identity = `${media.source === "upload" ? "Uploaded" : media.source === "stock" ? "Stock" : media.source === "generated" ? "Generated" : "Catalog"}${media.attribution?.provider ? ` · ${media.attribution.provider}` : ""} · ${media.mediaId}`;
    sources.push({ id: `media:${media.mediaId}`, kind: "visual", label, identity, track: { id: `media:${media.mediaId}`, kind: "visual", clips: [{ ...clipBase(`media:${media.mediaId}`, durationFrames), mediaId: media.mediaId, sourceInSeconds: 0, sourceOutSeconds: seconds, transform }] } });
  });
  creative.overlays.forEach(overlay => {
    const startFrame = Math.max(0, Math.min(durationFrames - 1, Math.round(overlay.startSeconds * fps)));
    const endFrame = Math.max(startFrame + 1, Math.min(durationFrames, Math.round(overlay.endSeconds * fps)));
    const base = { ...clipBase(`overlay:${overlay.id}`, endFrame - startFrame), startFrame };
    if (overlay.kind === "text" && overlay.text?.trim()) {
      sources.push({ id: `overlay:${overlay.id}`, kind: "text", label: overlay.text, identity: `Text overlay · ${overlay.id}`, track: { id: `overlay:${overlay.id}`, kind: "text", clips: [{ ...base, overlayId: overlay.id, source: "text", text: overlay.text, transform, style }] } });
    } else if (overlay.assetObjectKey) {
      const label = overlay.kind === "sticker" ? "Meme / sticker" : overlay.kind === "logo" ? "Logo" : "Image overlay";
      sources.push({ id: `overlay:${overlay.id}`, kind: "visual", label, identity: `${label} · ${overlay.id}`, track: { id: `overlay:${overlay.id}`, kind: "visual", clips: [{ ...base, overlayId: overlay.id, sourceInSeconds: 0, sourceOutSeconds: (endFrame - startFrame) / fps, transform }] } });
    }
  });
  creative.audioSnippets.forEach(snippet => {
    const frames = Math.min(durationFrames, Math.max(1, Math.round(snippet.durationSeconds * fps)));
    sources.push({ id: `snippet:${snippet.snippetId}`, kind: "audio", label: snippet.label || "Audio snippet", identity: `Audio snippet · ${snippet.snippetId}`, track: { id: `snippet:${snippet.snippetId}`, kind: "audio", clips: [{ ...clipBase(`snippet:${snippet.snippetId}`, frames), snippetId: snippet.snippetId, sourceInSeconds: 0, sourceOutSeconds: snippet.durationSeconds, volume: 1 }] } });
  });
  if (creative.caption.text.trim()) sources.push({ id: "caption", kind: "text", label: creative.caption.text, identity: "Caption · reusable creative", track: { id: "caption", kind: "text", clips: [{ ...clipBase("caption", durationFrames), source: "caption", text: creative.caption.text, transform, style }] } });
  if (creative.cta.label.trim()) sources.push({ id: "cta", kind: "text", label: creative.cta.label, identity: "CTA · reusable creative", track: { id: "cta", kind: "text", clips: [{ ...clipBase("cta", durationFrames), source: "cta", text: creative.cta.label, transform, style }] } });
  return sources;
}

export function addStudioSource(project: CreativeStudioProject, source: StudioSource): CreativeStudioProject {
  if (project.tracks.some(track => track.id === source.id) || project.tracks.length >= 12) return project;
  return { ...project, tracks: [...project.tracks, source.track] };
}

/** Insert a completed provider artifact as a normal visual clip on its own editable track. */
export function insertGeneratedStudioVideo(project: CreativeStudioProject, generatedVideo: NonNullable<StudioVisualClip["generatedVideo"]>, startFrame: number, rangeFrames?: number): CreativeStudioProject {
  if (project.tracks.length >= 12 || !Number.isFinite(startFrame) || !Number.isFinite(generatedVideo.durationSeconds) || generatedVideo.durationSeconds <= 0 || !generatedVideo.objectKey || !generatedVideo.jobId || !generatedVideo.provider || !generatedVideo.providerJobId || !generatedVideo.prompt) return project;
  if (project.tracks.some(track => track.clips.some(clip => "generatedVideo" in clip && clip.generatedVideo?.jobId === generatedVideo.jobId))) return project;
  const fps = project.timebase.framesPerSecond.numerator / project.timebase.framesPerSecond.denominator;
  const start = Math.max(0, Math.round(startFrame));
  const available = project.durationFrames - start;
  const durationFrames = Math.min(available, Math.round(generatedVideo.durationSeconds * fps), rangeFrames === undefined ? Infinity : Math.round(rangeFrames));
  if (durationFrames < 1) return project;
  const id = crypto.randomUUID();
  const clip: StudioVisualClip = { id: `clip:generated:${id}`, startFrame: start, durationFrames, keyframes: [], generatedVideo, sourceInSeconds: 0, sourceOutSeconds: durationFrames / fps, transform: { ...transform } };
  return { ...project, tracks: [...project.tracks, { id: `generated:${id}`, kind: "visual", clips: [clip] }] };
}

/** Changes source playback speed and recalculates timeline length from the unchanged source range. */
export function setStudioVideoSpeed(project: CreativeStudioProject, trackId: string, clipId: string, speed: typeof STUDIO_VIDEO_SPEEDS[number], fps: number): CreativeStudioProject {
  const track = project.tracks.find(item => item.id === trackId);
  const clip = track?.kind === "visual" ? track.clips.find(item => item.id === clipId) : undefined;
  if (!track || track.kind !== "visual" || !clip || track.locked || !STUDIO_VIDEO_SPEEDS.includes(speed)) return project;
  const durationFrames = Math.max(1, Math.round((clip.sourceOutSeconds - clip.sourceInSeconds) / speed * fps));
  if (clip.startFrame + durationFrames > project.durationFrames) return project;
  const ratio = durationFrames / clip.durationFrames;
  const transitionIn = clip.transitionIn && { ...clip.transitionIn, durationFrames: Math.min(durationFrames, Math.round(clip.transitionIn.durationFrames * ratio)) };
  const transitionOut = clip.transitionOut && { ...clip.transitionOut, durationFrames: Math.min(durationFrames - (transitionIn?.durationFrames || 0), Math.round(clip.transitionOut.durationFrames * ratio)) };
  const updated = { ...clip, speed, durationFrames, transitionIn, transitionOut,
    keyframes: clip.keyframes.flatMap(key => { const frame = Math.round(key.frame * ratio); return frame < durationFrames ? [{ ...key, frame }] : []; }) };
  return { ...project, tracks: project.tracks.map(item => item.id === trackId && item.kind === "visual" ? { ...item, clips: item.clips.map(value => value.id === clipId ? updated : value) } : item) };
}

export function moveStudioTrack(project: CreativeStudioProject, trackId: string, direction: -1 | 1): CreativeStudioProject {
  const index = project.tracks.findIndex(track => track.id === trackId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= project.tracks.length || project.tracks[index].locked || project.tracks[target].locked) return project;
  const tracks = [...project.tracks];
  [tracks[index], tracks[target]] = [tracks[target], tracks[index]];
  return { ...project, tracks };
}

/** Clip edits keep their source range attached to the timeline range. */
export function trimStudioClip(project: CreativeStudioProject, trackId: string, clipId: string, edge: "start" | "end", frame: number): CreativeStudioProject {
  const track = project.tracks.find(item => item.id === trackId);
  const clip = track?.clips.find(item => item.id === clipId);
  if (!track || !clip || track.locked) return project;
  const boundary = Math.max(0, Math.min(project.durationFrames, Math.round(frame)));
  const oldEnd = clip.startFrame + clip.durationFrames;
  const nextStart = edge === "start" ? Math.min(boundary, oldEnd - 1) : clip.startFrame;
  const nextEnd = edge === "end" ? Math.max(boundary, clip.startFrame + 1) : oldEnd;
  const sourceSpan = "sourceInSeconds" in clip ? clip.sourceOutSeconds - clip.sourceInSeconds : 0;
  const sourcePerFrame = sourceSpan / clip.durationFrames;
  const removedStart = nextStart - clip.startFrame;
  const durationFrames = nextEnd - nextStart;
  const transitionInFrames = Math.min(clip.transitionIn?.durationFrames ?? 0, durationFrames);
  const transitionOutFrames = Math.min(clip.transitionOut?.durationFrames ?? 0, durationFrames - transitionInFrames);
  const trimmed = {
    ...clip,
    startFrame: nextStart,
    durationFrames,
    ...(clip.transitionIn ? { transitionIn: { ...clip.transitionIn, durationFrames: transitionInFrames } } : {}),
    ...(clip.transitionOut ? { transitionOut: { ...clip.transitionOut, durationFrames: transitionOutFrames } } : {}),
    keyframes: clip.keyframes.flatMap(key => {
      const localFrame = key.frame - removedStart;
      return localFrame >= 0 && localFrame < durationFrames ? [{ ...key, frame: localFrame }] : [];
    }),
    ...( "sourceInSeconds" in clip ? {
      sourceInSeconds: clip.sourceInSeconds + removedStart * sourcePerFrame,
      sourceOutSeconds: clip.sourceOutSeconds - (oldEnd - nextEnd) * sourcePerFrame,
    } : {}),
  } as typeof clip;
  return { ...project, tracks: project.tracks.map(item => item.id === trackId ? { ...item, clips: item.clips.map(value => value.id === clipId ? trimmed : value) } as StudioTrack : item) };
}

export function splitStudioClip(project: CreativeStudioProject, trackId: string, clipId: string, frame: number): CreativeStudioProject {
  const track = project.tracks.find(item => item.id === trackId);
  const clip = track?.clips.find(item => item.id === clipId);
  const splitFrame = Math.round(frame);
  if (!track || !clip || track.locked || splitFrame <= clip.startFrame || splitFrame >= clip.startFrame + clip.durationFrames) return project;
  const leftLength = splitFrame - clip.startFrame;
  const rightLength = clip.durationFrames - leftLength;
  const ratio = leftLength / clip.durationFrames;
  const rightId = `clip:${crypto.randomUUID()}`;
  const makeHalf = (startFrame: number, durationFrames: number, offset: number, left: boolean) => ({
    ...clip,
    id: left ? clip.id : rightId,
    startFrame,
    durationFrames,
    keyframes: clip.keyframes.flatMap(key => {
      const localFrame = key.frame - offset;
      return localFrame >= 0 && localFrame < durationFrames ? [{ ...key, frame: localFrame }] : [];
    }),
    ...( "sourceInSeconds" in clip ? {
      sourceInSeconds: left ? clip.sourceInSeconds : clip.sourceInSeconds + (clip.sourceOutSeconds - clip.sourceInSeconds) * ratio,
      sourceOutSeconds: left ? clip.sourceInSeconds + (clip.sourceOutSeconds - clip.sourceInSeconds) * ratio : clip.sourceOutSeconds,
    } : {}),
    transitionIn: left && clip.transitionIn ? { ...clip.transitionIn, durationFrames: Math.min(clip.transitionIn.durationFrames, durationFrames) } : undefined,
    transitionOut: !left && clip.transitionOut ? { ...clip.transitionOut, durationFrames: Math.min(clip.transitionOut.durationFrames, durationFrames) } : undefined,
  });
  const halves = [makeHalf(clip.startFrame, leftLength, 0, true), makeHalf(splitFrame, rightLength, leftLength, false)] as typeof track.clips;
  const clips = track.clips.flatMap(value => value.id === clipId ? halves : [value]);
  return { ...project, tracks: project.tracks.map(item => item.id === trackId ? { ...item, clips } as StudioTrack : item) };
}

/** Ripple is intentionally bounded to later clips on the same track and never changes project duration. */
export function deleteStudioClip(project: CreativeStudioProject, trackId: string, clipId: string, ripple: boolean): CreativeStudioProject {
  const track = project.tracks.find(item => item.id === trackId);
  const clip = track?.clips.find(item => item.id === clipId);
  if (!track || !clip || track.locked) return project;
  const end = clip.startFrame + clip.durationFrames;
  const clips = track.clips.filter(item => item.id !== clipId).map(item => ripple && item.startFrame >= end ? { ...item, startFrame: Math.max(0, item.startFrame - clip.durationFrames) } : item);
  return { ...project, tracks: project.tracks.map(item => item.id === trackId ? { ...item, clips } as StudioTrack : item) };
}
