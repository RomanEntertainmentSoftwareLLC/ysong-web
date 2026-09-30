import type { ReusableAdCreative } from "./api";
import type { CreativeStudioProject, StudioAudioClip, StudioTextClip, StudioVisualClip } from "./creativeStudioProject";
import { validateCreativeStudioProject } from "./creativeStudioProject.ts";

export type StudioRenderItem =
  | { kind: "visual"; clip: StudioVisualClip; url: string; mediaType: "video" | "image" }
  | { kind: "text"; clip: StudioTextClip }
  | { kind: "audio"; clip: StudioAudioClip; url: string; sourceStart: number };
export type StudioRenderTrack = { kind: "visual" | "text" | "audio"; items: StudioRenderItem[] };

/** Resolve the saved source IDs before recording. Never silently omit an unavailable layer. */
export function studioRenderPlan(project: CreativeStudioProject, creative: Pick<ReusableAdCreative, "audioSnippets" | "backgroundMedia" | "overlays">, urls: Record<string, string>): StudioRenderTrack[] {
  validateCreativeStudioProject(project, {
    audioSnippetIds: creative.audioSnippets.map(item => item.snippetId),
    backgroundMediaIds: creative.backgroundMedia.map(item => item.mediaId),
    overlayIds: creative.overlays.map(item => item.id),
  });
  const fps = project.timebase.framesPerSecond.numerator / project.timebase.framesPerSecond.denominator;
  return project.tracks.map(track => {
    if ((track.kind === "audio" && track.muted) || (track.kind !== "audio" && track.visible === false)) return { kind: track.kind, items: [] };
    const items: StudioRenderItem[] = track.clips.map(clip => {
      if (track.kind !== "visual" && [clip.transitionIn, clip.transitionOut].some(edge => edge && edge.kind !== "cut"))
        throw new Error(`${track.kind} clip ${clip.id}: transitions are not supported by reel export.`);
      if (track.kind === "text") return { kind: "text", clip: clip as StudioTextClip };
      if (track.kind === "audio") {
        const audioClip = clip as StudioAudioClip;
        if (audioClip.duckingIntent === "under-voiceover") throw new Error(`Audio clip ${clip.id}: voiceover ducking is not supported by reel export.`);
        const snippet = creative.audioSnippets.find(item => item.snippetId === audioClip.snippetId)!;
        if (audioClip.sourceOutSeconds > snippet.durationSeconds + .001 || audioClip.durationFrames / fps > audioClip.sourceOutSeconds - audioClip.sourceInSeconds + 1 / fps) throw new Error(`Audio clip ${clip.id}: trim exceeds its source.`);
        const url = urls[`audio:${audioClip.snippetId}`];
        if (!url) throw new Error(`Audio clip ${clip.id}: source URL is unavailable.`);
        return { kind: "audio", clip: audioClip, url, sourceStart: snippet.startSeconds + audioClip.sourceInSeconds };
      }
      const visualClip = clip as StudioVisualClip;
      const overlay = visualClip.overlayId && creative.overlays.find(item => item.id === visualClip.overlayId);
      const media = visualClip.mediaId ? creative.backgroundMedia.find(item => item.mediaId === visualClip.mediaId) : undefined;
      const mediaType = media?.mediaType || (visualClip.generatedVideo ? "video" : overlay ? "image" : undefined);
      const url = urls[visualClip.mediaId ? `media:${visualClip.mediaId}` : visualClip.generatedVideo ? `generated:${visualClip.generatedVideo.jobId}` : `overlay:${visualClip.overlayId}`];
      if (!mediaType || !url) throw new Error(`Visual clip ${clip.id}: source asset is unavailable.`);
      if (mediaType === "image" && visualClip.speed && visualClip.speed !== 1) throw new Error(`Visual clip ${clip.id}: image speed is unsupported.`);
      if (Math.abs((visualClip.sourceOutSeconds - visualClip.sourceInSeconds) / (visualClip.speed || 1) - visualClip.durationFrames / fps) > 1 / fps + .002 && mediaType === "video") throw new Error(`Visual clip ${clip.id}: trim, speed, and timeline duration disagree.`);
      return { kind: "visual", clip: visualClip, url, mediaType };
    });
    return { kind: track.kind, items };
  });
}
