import type { CreativeStudioProject, StudioMediaRefs, StudioTextClip, StudioTrack } from "./creativeStudioProject.ts";
import { validateCreativeStudioProject } from "./creativeStudioProject.ts";
import type { ReusableAdCreative } from "./api";

export type SmartCreativeDraft = {
  id: string;
  title: string;
  change: string;
  sourceCreativeId: string;
  sourceRevision: number;
  sourceCampaignId: string;
  aspectRatio: string;
  createdAt: string;
  project: CreativeStudioProject;
};

type Source = Pick<ReusableAdCreative, "id" | "backgroundMedia" | "audioSnippets" | "overlays">;

/** Editorial candidates are local projects. They contain no campaign binding or destination URL. */
export function proposeSmartCreativeVariants(project: CreativeStudioProject, source: Source, campaignId: string, aspectRatio: string): SmartCreativeDraft[] {
  const refs: StudioMediaRefs = { audioSnippetIds: source.audioSnippets.map(x => x.snippetId), backgroundMediaIds: source.backgroundMedia.map(x => x.mediaId), overlayIds: source.overlays.map(x => x.id) };
  validateCreativeStudioProject(project, refs);
  const candidates: Array<{ title: string; change: string; tracks: StudioTrack[] }> = [];
  const visual = project.tracks.find(track => track.kind === "visual" && !track.locked && track.clips.length);
  const text = project.tracks.find(track => track.kind === "text" && !track.locked && track.clips.length);
  const audio = project.tracks.find(track => track.kind === "audio" && !track.locked && track.clips.length);
  const replaceTrack = (id: string, update: (track: StudioTrack) => StudioTrack) => project.tracks.map(track => track.id === id ? update(track) : track);
  if (visual?.kind === "visual") {
    const first = visual.clips[0];
    const alternate = source.backgroundMedia.find(media => media.mediaId !== first.mediaId && media.source === "stock" && media.mediaType === "video");
    if (alternate && first.mediaId) candidates.push({ title: "Stock B-roll opening", change: `Replace the opening visual with attributed stock media ${alternate.mediaId}.`, tracks: replaceTrack(visual.id, track => track.kind === "visual" ? { ...track, clips: track.clips.map(clip => clip.id === first.id ? { ...clip, mediaId: alternate.mediaId } : clip) } : track) });
    const generated = project.tracks.flatMap(track => track.kind === "visual" ? track.clips : []).find(clip => clip.generatedVideo && clip.id !== first.id && clip.generatedVideo.durationSeconds >= first.sourceOutSeconds - first.sourceInSeconds);
    if (generated?.generatedVideo && first.mediaId) candidates.push({ title: "Generated B-roll opening", change: `Use the existing generated result ${generated.generatedVideo.jobId} for the opening, retaining its job provenance.`, tracks: replaceTrack(visual.id, track => track.kind === "visual" ? { ...track, clips: track.clips.map(clip => clip.id === first.id ? { ...clip, mediaId: undefined, generatedVideo: generated.generatedVideo, sourceInSeconds: 0, sourceOutSeconds: Math.min(generated.generatedVideo!.durationSeconds, clip.sourceOutSeconds - clip.sourceInSeconds) } : clip) } : track) });
    if (visual.clips.length > 1) {
      const [a, b] = visual.clips;
      candidates.push({ title: "Clip order", change: "Exchange the first two visual moments while keeping their source IDs and source ranges.", tracks: replaceTrack(visual.id, track => track.kind === "visual" ? { ...track, clips: track.clips.map(clip => clip.id === a.id ? { ...clip, startFrame: b.startFrame } : clip.id === b.id ? { ...clip, startFrame: a.startFrame } : clip).sort((x, y) => x.startFrame - y.startFrame) } : track) });
    }
    const fadeFrames = Math.min(12, first.durationFrames - (first.transitionOut?.durationFrames || 0));
    if (fadeFrames > 0 && first.transitionIn?.kind !== "fade") candidates.push({ title: "Opening fade", change: "Add a short fade to the opening visual.", tracks: replaceTrack(visual.id, track => track.kind === "visual" ? { ...track, clips: track.clips.map(clip => clip.id === first.id ? { ...clip, transitionIn: { kind: "fade", durationFrames: fadeFrames } } : clip) } : track) });
  }
  if (text?.kind === "text") {
    const headline = text.clips.find(clip => clip.source !== "cta") || text.clips[0];
    candidates.push({ title: "Headline treatment", change: "Move the first headline higher and enlarge its type for a mobile opening.", tracks: replaceTrack(text.id, track => track.kind === "text" ? { ...track, clips: track.clips.map(clip => clip.id === headline.id ? { ...clip, transform: { ...clip.transform, y: .22 }, style: { ...clip.style, fontSize: Math.min(160, Math.max(clip.style.fontSize + 8, 60)) } } : clip) } : track) });
    candidates.push({ title: "Meme caption treatment", change: "Give the first text overlay bold, high contrast caption styling. Edit the words in the timeline.", tracks: replaceTrack(text.id, track => track.kind === "text" ? { ...track, clips: track.clips.map(clip => clip.id === headline.id ? { ...clip, transform: { ...clip.transform, y: .78 }, style: { ...clip.style, fontWeight: 800, color: "#ffffff", fontSize: Math.min(160, Math.max(clip.style.fontSize, 64)) } } : clip) } : track) });
    const cta = project.tracks.flatMap(track => track.kind === "text" && !track.locked ? track.clips.map(clip => ({ track, clip })) : []).find(item => item.clip.source === "cta");
    if (cta) candidates.push({ title: "CTA timing", change: "Bring the existing CTA into the final third of the edit.", tracks: replaceTrack(cta.track.id, track => track.kind === "text" ? { ...track, clips: track.clips.map(clip => clip.id === cta.clip.id ? { ...clip, startFrame: Math.floor(project.durationFrames * .67), durationFrames: project.durationFrames - Math.floor(project.durationFrames * .67), keyframes: [] } : clip).sort((a, b) => a.startFrame - b.startFrame) } : track) });
    else if (project.tracks.length < 12) {
      const startFrame = Math.floor(project.durationFrames * .67);
      const clip: StudioTextClip = { id: "clip:smart-cta", startFrame, durationFrames: project.durationFrames - startFrame, keyframes: [], source: "cta", text: "Listen now", transform: { x: .5, y: .82, scale: 1, rotationDegrees: 0, opacity: 1 }, style: { fontSize: 52, color: "#ffffff" } };
      candidates.push({ title: "CTA option", change: "Add an editable closing CTA inside the creative. Choose its destination later in Campaign Setup.", tracks: [...project.tracks, { id: "smart-cta", kind: "text", clips: [clip] }] });
    }
  } else if (project.tracks.length < 12) {
    const clip: StudioTextClip = { id: "clip:smart-headline", startFrame: 0, durationFrames: Math.min(project.durationFrames, 90), keyframes: [], source: "text", text: "Listen for the hook", transform: { x: .5, y: .22, scale: 1, rotationDegrees: 0, opacity: 1 }, style: { fontSize: 64, color: "#ffffff" } };
    candidates.push({ title: "Headline opening", change: "Add an editable opening headline. Copy is a suggestion, not a performance claim.", tracks: [...project.tracks, { id: "smart-headline", kind: "text", clips: [clip] }] });
  }
  if (audio?.kind === "audio" && audio.clips[0].startFrame > 0) {
    const first = audio.clips[0];
    candidates.push({ title: "Hook first", change: "Move the opening audio hook to the first frame without changing its source range.", tracks: replaceTrack(audio.id, track => track.kind === "audio" ? { ...track, clips: track.clips.map(clip => clip.id === first.id ? { ...clip, startFrame: 0 } : clip).sort((a, b) => a.startFrame - b.startFrame) } : track) });
  }
  if (audio?.kind === "audio" && audio.clips[0].startFrame === 0 && audio.clips[0].durationFrames > 45) {
    const first = audio.clips[0];
    const cut = Math.min(15, Math.floor(first.durationFrames / 4));
    const offset = (first.sourceOutSeconds - first.sourceInSeconds) * cut / first.durationFrames;
    candidates.push({ title: "Later hook section", change: "Start the audio at a later point in the same verified snippet. Review the new entry in the timeline.", tracks: replaceTrack(audio.id, track => track.kind === "audio" ? { ...track, clips: track.clips.map(clip => clip.id === first.id ? { ...clip, durationFrames: clip.durationFrames - cut, sourceInSeconds: clip.sourceInSeconds + offset } : clip) } : track) });
  }
  const now = new Date().toISOString();
  return candidates.flatMap(candidate => {
    const next = { ...project, tracks: candidate.tracks, variants: undefined, edit: { ...project.edit, updatedAt: now, source: "artist" as const, parentRevision: project.revision, summary: candidate.change } };
    try {
      validateCreativeStudioProject(next, refs);
      if (JSON.stringify(next.tracks) === JSON.stringify(project.tracks)) return [];
      return [{ id: crypto.randomUUID(), title: candidate.title, change: candidate.change, sourceCreativeId: source.id, sourceRevision: project.revision, sourceCampaignId: campaignId, aspectRatio, createdAt: now, project: next }];
    } catch { return []; }
  }).slice(0, 8);
}
