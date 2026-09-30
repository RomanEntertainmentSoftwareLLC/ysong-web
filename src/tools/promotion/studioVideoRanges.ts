import type { CreativeStudioProject, StudioAspectRatio, StudioVisualClip } from "./creativeStudioProject";

export type StudioVideoAction = "regenerate" | "extend" | "fill";
export type StudioVideoRange = { action: StudioVideoAction; aspect: StudioAspectRatio; trackId: string; clipId?: string; startFrame: number; durationFrames: number; sourceVersion?: string; source?: StudioVisualClip["generatedVideo"] };
export type VideoProviderCapabilities = { provider: string; regenerate: boolean; extend: boolean; fill: boolean; maxDurationSeconds: number };

/** Missing or malformed provider claims never enable an action. */
export function videoProviderCapabilities(value: unknown): VideoProviderCapabilities | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.provider !== "string" || !item.provider.trim() || typeof item.maxDurationSeconds !== "number" || !Number.isFinite(item.maxDurationSeconds) || item.maxDurationSeconds <= 0 || item.maxDurationSeconds > 60) return null;
  if ([item.regenerate, item.extend, item.fill].some(flag => typeof flag !== "boolean")) return null;
  return item as VideoProviderCapabilities;
}

export function studioVideoGaps(project: CreativeStudioProject, trackId: string): Array<{ startFrame: number; durationFrames: number }> {
  const track = project.tracks.find(item => item.id === trackId);
  if (!track || track.kind !== "visual" || track.locked) return [];
  const occupied = [...track.clips].sort((a, b) => a.startFrame - b.startFrame);
  const gaps: Array<{ startFrame: number; durationFrames: number }> = [];
  let end = 0;
  for (const clip of occupied) {
    if (clip.startFrame > end) gaps.push({ startFrame: end, durationFrames: clip.startFrame - end });
    end = Math.max(end, clip.startFrame + clip.durationFrames);
  }
  if (end < project.durationFrames) gaps.push({ startFrame: end, durationFrames: project.durationFrames - end });
  return gaps;
}

export function planStudioVideoRange(project: CreativeStudioProject, aspect: StudioAspectRatio, action: StudioVideoAction, trackId: string, clipId?: string, gapStart?: number): StudioVideoRange | null {
  const track = project.tracks.find(item => item.id === trackId);
  if (!track || track.kind !== "visual" || track.locked) return null;
  if (action === "fill") {
    const gap = studioVideoGaps(project, trackId).find(item => item.startFrame === gapStart);
    return gap ? { action, aspect, trackId, startFrame: gap.startFrame, durationFrames: gap.durationFrames } : null;
  }
  const clip = track.clips.find(item => item.id === clipId);
  if (!clip) return null;
  if (action === "regenerate") return { action, aspect, trackId, clipId, startFrame: clip.startFrame, durationFrames: clip.durationFrames, sourceVersion: JSON.stringify(clip), source: clip.generatedVideo };
  if (!clip.generatedVideo) return null;
  const gap = studioVideoGaps(project, trackId).find(item => item.startFrame === clip.startFrame + clip.durationFrames);
  return gap ? { action, aspect, trackId, clipId, startFrame: gap.startFrame, durationFrames: gap.durationFrames, sourceVersion: JSON.stringify(clip), source: clip.generatedVideo } : null;
}

/** Accepting a result is the only operation that changes the original clip. */
export function acceptStudioVideoRange(project: CreativeStudioProject, range: StudioVideoRange, video: NonNullable<StudioVisualClip["generatedVideo"]>): CreativeStudioProject {
  const fresh = planStudioVideoRange(project, range.aspect, range.action, range.trackId, range.clipId, range.startFrame);
  if (!fresh || fresh.startFrame !== range.startFrame || fresh.durationFrames !== range.durationFrames || fresh.sourceVersion !== range.sourceVersion || !video.jobId || !video.objectKey) return project;
  const fps = project.timebase.framesPerSecond.numerator / project.timebase.framesPerSecond.denominator;
  if (video.durationSeconds * fps + .001 < range.durationFrames) return project;
  const track = project.tracks.find(item => item.id === range.trackId)!;
  if (track.kind !== "visual" || project.tracks.some(item => item.kind === "visual" && item.clips.some(clip => clip.generatedVideo?.jobId === video.jobId))) return project;
  if (range.action === "regenerate") {
    return { ...project, tracks: project.tracks.map(item => item.id !== track.id || item.kind !== "visual" ? item : { ...item, clips: item.clips.map(clip => clip.id !== range.clipId ? clip : { ...clip, mediaId: undefined, overlayId: undefined, generatedVideo: video, sourceInSeconds: 0, sourceOutSeconds: range.durationFrames / fps, speed: 1 }) }) };
  }
  const clip: StudioVisualClip = { id: `clip:generated:${crypto.randomUUID()}`, startFrame: range.startFrame, durationFrames: range.durationFrames, keyframes: [], generatedVideo: video, sourceInSeconds: 0, sourceOutSeconds: range.durationFrames / fps, transform: { x: .5, y: .5, scale: 1, rotationDegrees: 0, opacity: 1 } };
  return { ...project, tracks: project.tracks.map(item => item.id !== track.id || item.kind !== "visual" ? item : { ...item, clips: [...item.clips, clip].sort((a, b) => a.startFrame - b.startFrame) }) };
}
