import type { ReusableAdCreative } from "./api";
import type { CreativeStudioProject, StudioTrack, StudioTransform } from "./creativeStudioProject";

export type StudioSource = { id: string; kind: StudioTrack["kind"]; label: string; identity: string; track: StudioTrack };
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

export function moveStudioTrack(project: CreativeStudioProject, trackId: string, direction: -1 | 1): CreativeStudioProject {
  const index = project.tracks.findIndex(track => track.id === trackId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= project.tracks.length || project.tracks[index].locked || project.tracks[target].locked) return project;
  const tracks = [...project.tracks];
  [tracks[index], tracks[target]] = [tracks[target], tracks[index]];
  return { ...project, tracks };
}
