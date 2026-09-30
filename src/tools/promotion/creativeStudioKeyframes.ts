import type { CreativeStudioProject, StudioKeyframe, StudioKeyframeProperty, StudioTrack, StudioTransform } from "./creativeStudioProject";

export const STUDIO_KEYFRAME_BOUNDS: Record<StudioKeyframeProperty, readonly [number, number]> = {
  x: [-1, 2], y: [-1, 2], scale: [0, 3], rotationDegrees: [-180, 180], opacity: [0, 1], volume: [0, 1],
};
export const STUDIO_MOTION_PROPERTIES: StudioKeyframeProperty[] = ["x", "y", "scale", "rotationDegrees", "opacity"];

type KeyedClip = StudioTrack["clips"][number];
export function studioPropertyValue(clip: KeyedClip, property: StudioKeyframeProperty, frame: number): number {
  const base = property === "volume" ? ("volume" in clip ? clip.volume : 1) : ("transform" in clip ? clip.transform[property as keyof Pick<StudioTransform, "x" | "y" | "scale" | "rotationDegrees" | "opacity">] : 0);
  const keys = clip.keyframes.filter(key => key.property === property).sort((a, b) => a.frame - b.frame);
  const local = Math.max(0, Math.min(clip.durationFrames - 1, Math.round(frame)));
  if (!keys.length) return base;
  if (local < keys[0].frame) return base + (keys[0].value - base) * local / keys[0].frame;
  const previous = [...keys].reverse().find(key => key.frame <= local)!;
  const next = keys.find(key => key.frame > local);
  if (!next || previous.interpolation === "hold") return previous.value;
  return previous.value + (next.value - previous.value) * (local - previous.frame) / (next.frame - previous.frame);
}

export function studioTransformAt(clip: KeyedClip, frame: number): StudioTransform | null {
  if (!("transform" in clip)) return null;
  return { ...clip.transform, ...Object.fromEntries(STUDIO_MOTION_PROPERTIES.map(property => [property, studioPropertyValue(clip, property, frame)])) };
}

/** A property has at most one key at a clip-relative frame. Edits to locked tracks are ignored. */
export function editStudioKeyframe(project: CreativeStudioProject, trackId: string, clipId: string, property: StudioKeyframeProperty, oldFrame: number | null, next: StudioKeyframe | null): CreativeStudioProject {
  const track = project.tracks.find(item => item.id === trackId);
  const clip = track?.clips.find(item => item.id === clipId);
  if (!track || !clip || track.locked || (track.kind === "audio") !== (property === "volume")) return project;
  if (next && (next.property !== property || !Number.isSafeInteger(next.frame) || next.frame < 0 || next.frame >= clip.durationFrames || !Number.isFinite(next.value) || next.value < STUDIO_KEYFRAME_BOUNDS[property][0] || next.value > STUDIO_KEYFRAME_BOUNDS[property][1] || !["hold", "linear"].includes(next.interpolation))) return project;
  const existing = clip.keyframes.find(key => key.property === property && key.frame === oldFrame);
  if (oldFrame !== null && !existing) return project;
  if (next && clip.keyframes.some(key => key.property === property && key.frame === next.frame && key !== existing)) return project;
  if (next && !existing && clip.keyframes.length >= 200) return project;
  const keyframes = [...clip.keyframes.filter(key => key !== existing), ...(next ? [next] : [])].sort((a, b) => a.frame - b.frame || a.property.localeCompare(b.property));
  return { ...project, tracks: project.tracks.map(item => item.id === trackId ? { ...item, clips: item.clips.map(value => value.id === clipId ? { ...value, keyframes } : value) } as StudioTrack : item) };
}
