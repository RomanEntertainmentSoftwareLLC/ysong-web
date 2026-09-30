import type { AdsCriticEvidencePacket, CriticEvidence } from "./adsCriticEvidenceContract.ts";
import type { CreativeStudioProject, StudioMediaRefs, StudioTrack } from "./creativeStudioProject.ts";
import { previewStudioEditProposal, type StudioEditProposal } from "./studioEditProposals.ts";

export type AdsCriticFixSuggestion = {
  evidenceId: string;
  title: string;
  detail: string;
  proposal: StudioEditProposal | null;
};

/** Only deterministic findings on the exact saved revision may offer an edit. */
export function buildAdsCriticFixSuggestions(packet: AdsCriticEvidencePacket, project: CreativeStudioProject, refs: StudioMediaRefs, beatFrames: readonly number[] = []): AdsCriticFixSuggestion[] {
  if (packet.studioRevision !== project.revision || packet.durationFrames !== project.durationFrames ||
      packet.timebase.framesPerSecond.numerator !== project.timebase.framesPerSecond.numerator ||
      packet.timebase.framesPerSecond.denominator !== project.timebase.framesPerSecond.denominator) return [];
  const tracks = packet.aspectRatio === "base" ? project.tracks : project.variants?.[packet.aspectRatio]?.tracks;
  if (!tracks) return [];
  const variant = project.variants?.[packet.aspectRatio as "9:16" | "1:1" | "16:9"];
  const editingProject = { ...project, tracks, render: variant ? { ...project.render, width: variant.width, height: variant.height } : project.render };
  const locate = (finding: CriticEvidence): { track: StudioTrack; clip: StudioTrack["clips"][number] } | null => {
    for (const track of tracks) {
      if (track.locked) continue;
      const clip = track.clips.find(item => finding.clipIds.includes(item.id));
      if (clip) return { track, clip };
    }
    return null;
  };
  const suggestions: AdsCriticFixSuggestion[] = [];
  for (const finding of packet.evidence) {
    let candidate: Omit<AdsCriticFixSuggestion, "evidenceId"> | null = null;
    const target = locate(finding);
    if (finding.code === "brief_opening") {
      const first = tracks.flatMap(track => track.kind === "visual" && !track.locked ? track.clips.map(clip => ({ track, clip })) : []).sort((a, b) => a.clip.startFrame - b.clip.startFrame)[0];
      if (first?.clip.startFrame === finding.range.endFrame) candidate = { title: "Bring the opening visual forward", detail: "Move the first visual to the start of the timeline.", proposal: { kind: "move_hook", trackId: first.track.id, clipId: first.clip.id, startFrame: 0 } };
    } else if (finding.code === "late_cta" && target?.track.kind === "text") {
      const startFrame = Math.max(0, Math.floor(project.durationFrames * .7) - target.clip.durationFrames);
      candidate = { title: "Bring the CTA forward", detail: "Preview an earlier CTA position and check for overlap.", proposal: { kind: "move_hook", trackId: target.track.id, clipId: target.clip.id, startFrame } };
    } else if (finding.code === "dense_text" && target?.track.kind === "text") {
      candidate = { title: "Move the headline higher", detail: "Review placement and readability in the mobile preview.", proposal: { kind: "reposition_text", trackId: target.track.id, clipId: target.clip.id, x: .5, y: .25 } };
    } else if (finding.code === "long_visual_hold" && target?.track.kind === "visual") {
      const cuts = [...new Set(beatFrames)].filter(frame => Number.isSafeInteger(frame) && frame > target.clip.startFrame && frame < target.clip.startFrame + target.clip.durationFrames).slice(0, 8);
      candidate = cuts.length ? { title: "Cut at beat markers", detail: "Split the long visual at available music beats; review the pacing.", proposal: { kind: "cut_on_beats", trackId: target.track.id, clipId: target.clip.id, frames: cuts } } : { title: "Review alternate B-roll", detail: "Select this visual in Studio to generate a replacement. Accept a completed result before it changes the timeline.", proposal: null };
    } else if (finding.code === "visual_gap") {
      candidate = { title: "Review B-roll for the gap", detail: "Use the Studio video tools to fill this range with an approved result.", proposal: null };
    }
    if (!candidate) continue;
    if (candidate.proposal) {
      try { previewStudioEditProposal(candidate.proposal, editingProject, refs); }
      catch { continue; }
    }
    suggestions.push({ evidenceId: finding.id, ...candidate });
  }
  return suggestions;
}
