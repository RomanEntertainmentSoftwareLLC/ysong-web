import type { CreativeStudioProject, StudioMediaRefs, StudioTrack, StudioTransitionKind } from "./creativeStudioProject";
import { validateCreativeStudioProject } from "./creativeStudioProject.ts";
import { editStudioKeyframe } from "./creativeStudioKeyframes.ts";
import { splitStudioClip, trimStudioClip } from "./creativeStudioTracks.ts";

/** A deliberately small data contract. Model output is never interpreted as a command. */
export type StudioEditProposal =
  | { kind: "trim_opening"; trackId: string; clipId: string; frames: number }
  | { kind: "move_hook"; trackId: string; clipId: string; startFrame: number }
  | { kind: "cut_on_beats"; trackId: string; clipId: string; frames: number[] }
  | { kind: "reposition_text"; trackId: string; clipId: string; x: number; y: number }
  | { kind: "caption_size"; trackId: string; clipId: string; fontSize: number }
  | { kind: "swap_stock"; trackId: string; clipId: string; mediaId: string }
  | { kind: "transition"; trackId: string; clipId: string; edge: "in" | "out"; transition: StudioTransitionKind; frames: number }
  | { kind: "zoom_keyframe"; trackId: string; clipId: string; frame: number; scale: number };

const fields: Record<StudioEditProposal["kind"], string[]> = {
  trim_opening: ["frames"], move_hook: ["startFrame"], cut_on_beats: ["frames"],
  reposition_text: ["x", "y"], caption_size: ["fontSize"], swap_stock: ["mediaId"],
  transition: ["edge", "transition", "frames"], zoom_keyframe: ["frame", "scale"],
};
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);

/** Reject extra fields, unknown IDs, locked tracks, invalid bounds, and unsupported sources. */
export function previewStudioEditProposal(value: unknown, project: CreativeStudioProject, refs: StudioMediaRefs & { stockMediaIds?: readonly string[] }): { proposal: StudioEditProposal; project: CreativeStudioProject; before: string; after: string } {
  validateCreativeStudioProject(project, refs);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid edit proposal.");
  const row = value as Record<string, unknown>;
  const kind = row.kind;
  if (typeof kind !== "string" || !(kind in fields)) throw new Error("Unsupported edit proposal.");
  const keys = ["kind", "trackId", "clipId", ...fields[kind as StudioEditProposal["kind"]]];
  if (Object.keys(row).length !== keys.length || keys.some(key => !(key in row)) || Object.keys(row).some(key => !keys.includes(key))) throw new Error("Invalid edit proposal fields.");
  if (typeof row.trackId !== "string" || typeof row.clipId !== "string") throw new Error("Invalid edit target.");
  const track = project.tracks.find(item => item.id === row.trackId);
  const clip = track?.clips.find(item => item.id === row.clipId);
  if (!track || !clip || track.locked) throw new Error("Edit target is unavailable or locked.");
  const fps = project.timebase.framesPerSecond.numerator / project.timebase.framesPerSecond.denominator;
  const seconds = (frames: number) => `${(frames / fps).toFixed(2)}s`;
  let next: CreativeStudioProject = project;
  let before = "";
  let after = "";
  const replace = (change: (item: StudioTrack["clips"][number]) => StudioTrack["clips"][number]) => ({ ...project, tracks: project.tracks.map(item => item.id === track.id ? { ...item, clips: item.clips.map(part => part.id === clip.id ? change(part) : part) } as StudioTrack : item) });
  switch (kind) {
    case "trim_opening": {
      if (!integer(row.frames) || Number(row.frames) < 1 || Number(row.frames) >= clip.durationFrames || clip.startFrame !== 0) throw new Error("Opening trim is outside this clip.");
      next = trimStudioClip(project, track.id, clip.id, "start", Number(row.frames));
      before = `Opening starts at ${seconds(clip.startFrame)}`; after = `Opening starts at ${seconds(Number(row.frames))}`;
      break;
    }
    case "move_hook": {
      if (!integer(row.startFrame) || Number(row.startFrame) >= clip.startFrame || Number(row.startFrame) + clip.durationFrames > project.durationFrames) throw new Error("Hook position is invalid.");
      const startFrame = Number(row.startFrame);
      if (track.clips.some(other => other.id !== clip.id && startFrame < other.startFrame + other.durationFrames && startFrame + clip.durationFrames > other.startFrame)) throw new Error("Hook would overlap another clip.");
      next = replace(part => ({ ...part, startFrame }));
      next = { ...next, tracks: next.tracks.map(item => item.id === track.id ? { ...item, clips: [...item.clips].sort((a, b) => a.startFrame - b.startFrame) } as StudioTrack : item) };
      before = `Hook starts at ${seconds(clip.startFrame)}`; after = `Hook starts at ${seconds(startFrame)}`;
      break;
    }
    case "cut_on_beats": {
      if (!Array.isArray(row.frames) || row.frames.length < 1 || row.frames.length > 8 || !row.frames.every(integer) || new Set(row.frames).size !== row.frames.length || row.frames.some(frame => frame <= clip.startFrame || frame >= clip.startFrame + clip.durationFrames)) throw new Error("Beat cuts are outside this clip.");
      for (const frame of [...row.frames].sort((a, b) => Number(b) - Number(a))) {
        const part = next.tracks.find(item => item.id === track.id)?.clips.find(item => item.id === clip.id);
        if (!part || Number(frame) >= part.startFrame + part.durationFrames) throw new Error("Beat cut is invalid.");
        next = splitStudioClip(next, track.id, clip.id, Number(frame));
      }
      before = "One continuous clip"; after = `${row.frames.length + 1} clips cut at ${[...row.frames].sort((a, b) => Number(a) - Number(b)).map(frame => seconds(Number(frame))).join(", ")}`;
      break;
    }
    case "reposition_text": {
      if (track.kind !== "text" || !finite(row.x) || !finite(row.y) || Number(row.x) < 0 || Number(row.x) > 1 || Number(row.y) < 0 || Number(row.y) > 1) throw new Error("Text position is invalid.");
      next = replace(part => ({ ...part, transform: { ...("transform" in part ? part.transform : {}), x: Number(row.x), y: Number(row.y) } }) as StudioTrack["clips"][number]);
      before = `Text at ${("transform" in clip ? clip.transform.x : 0).toFixed(2)}, ${("transform" in clip ? clip.transform.y : 0).toFixed(2)}`; after = `Text at ${Number(row.x).toFixed(2)}, ${Number(row.y).toFixed(2)}`;
      break;
    }
    case "caption_size": {
      if (track.kind !== "text" || !finite(row.fontSize) || Number(row.fontSize) < 12 || Number(row.fontSize) > 160) throw new Error("Caption size is invalid.");
      next = replace(part => ({ ...part, style: { ...("style" in part ? part.style : {}), fontSize: Number(row.fontSize) } }) as StudioTrack["clips"][number]);
      before = `${"style" in clip ? clip.style.fontSize : 0}px`; after = `${row.fontSize}px`;
      break;
    }
    case "swap_stock": {
      if (track.kind !== "visual" || !("mediaId" in clip) || !clip.mediaId || typeof row.mediaId !== "string" || !refs.stockMediaIds?.includes(row.mediaId) || row.mediaId === clip.mediaId) throw new Error("Stock source is unavailable.");
      next = replace(part => ({ ...part, mediaId: row.mediaId }) as StudioTrack["clips"][number]);
      before = `Media ${clip.mediaId}`; after = `Media ${row.mediaId}`;
      break;
    }
    case "transition": {
      if (track.kind !== "visual" || (row.edge !== "in" && row.edge !== "out") || !["fade", "dissolve", "dip", "wipe-left", "wipe-right", "wipe-up", "wipe-down"].includes(String(row.transition)) || !integer(row.frames) || Number(row.frames) < 1 || Number(row.frames) + (row.edge === "in" ? clip.transitionOut?.durationFrames || 0 : clip.transitionIn?.durationFrames || 0) > clip.durationFrames) throw new Error("Transition is invalid.");
      const edge = row.edge === "in" ? "transitionIn" : "transitionOut";
      next = replace(part => ({ ...part, [edge]: { kind: row.transition, durationFrames: row.frames } }) as StudioTrack["clips"][number]);
      before = `${row.edge} transition: ${clip[edge]?.kind || "none"}`; after = `${row.edge} transition: ${row.transition} for ${seconds(Number(row.frames))}`;
      break;
    }
    case "zoom_keyframe": {
      if (track.kind !== "visual" || !integer(row.frame) || Number(row.frame) >= clip.durationFrames || !finite(row.scale) || Number(row.scale) < 0 || Number(row.scale) > 3 || clip.keyframes.some(key => key.property === "scale" && key.frame === row.frame)) throw new Error("Zoom keyframe is invalid.");
      next = editStudioKeyframe(project, track.id, clip.id, "scale", null, { frame: Number(row.frame), property: "scale", value: Number(row.scale), interpolation: "linear" });
      before = `Scale ${("transform" in clip ? clip.transform.scale : 1).toFixed(2)} at ${seconds(Number(row.frame))}`; after = `Scale ${Number(row.scale).toFixed(2)} keyframe at ${seconds(Number(row.frame))}`;
      break;
    }
  }
  if (next === project || JSON.stringify(next.tracks) === JSON.stringify(project.tracks)) throw new Error("Proposal made no change.");
  validateCreativeStudioProject(next, refs);
  return { proposal: value as StudioEditProposal, project: next, before, after };
}
