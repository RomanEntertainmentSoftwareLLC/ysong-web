import assert from "node:assert/strict";
import { test } from "node:test";
import { previewStudioEditProposal } from "../src/tools/promotion/studioEditProposals.ts";

const refs = { audioSnippetIds: ["hook"], backgroundMediaIds: ["old", "stock"], stockMediaIds: ["stock"], overlayIds: [] };
function project() {
  return {
    schemaVersion: 1, revision: 2, durationFrames: 300,
    timebase: { framesPerSecond: { numerator: 30, denominator: 1 } },
    tracks: [
      { id: "visual", kind: "visual", clips: [{ id: "video", startFrame: 0, durationFrames: 300, mediaId: "old", sourceInSeconds: 0, sourceOutSeconds: 10, transform: { x: .5, y: .5, scale: 1, rotationDegrees: 0, opacity: 1 }, keyframes: [] }] },
      { id: "text", kind: "text", clips: [{ id: "caption", startFrame: 0, durationFrames: 300, text: "Listen", transform: { x: .5, y: .5, scale: 1, rotationDegrees: 0, opacity: 1 }, style: { fontSize: 48, color: "#fff" }, keyframes: [] }] },
    ],
    render: { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", backgroundColor: "#000" },
    edit: { createdAt: "2026-09-29T00:00:00Z", updatedAt: "2026-09-29T00:00:00Z", source: "artist" },
  };
}
const target = { trackId: "visual", clipId: "video" };

test("preview is immutable and applies each supported edit only to a copy", () => {
  const original = project();
  const proposals = [
    { kind: "trim_opening", ...target, frames: 15 },
    { kind: "cut_on_beats", ...target, frames: [30, 60] },
    { kind: "reposition_text", trackId: "text", clipId: "caption", x: .5, y: .25 },
    { kind: "caption_size", trackId: "text", clipId: "caption", fontSize: 60 },
    { kind: "swap_stock", ...target, mediaId: "stock" },
    { kind: "transition", ...target, edge: "in", transition: "fade", frames: 12 },
    { kind: "zoom_keyframe", ...target, frame: 150, scale: 1.15 },
  ];
  for (const proposal of proposals) {
    const preview = previewStudioEditProposal(proposal, original, refs);
    assert.notEqual(preview.project, original);
    assert.ok(preview.before && preview.after);
    assert.equal(preview.project.revision, original.revision);
  }
  assert.equal(original.tracks[0].clips.length, 1);
  assert.equal(original.tracks[0].clips[0].mediaId, "old");
  assert.equal(previewStudioEditProposal(proposals[1], original, refs).project.tracks[0].clips.length, 3);
});

test("rejects command-like fields, unknown sources, locked clips, and invalid timing", () => {
  const original = project();
  const rejected = [
    { kind: "trim_opening", ...target, frames: 15, command: "delete everything" },
    { kind: "swap_stock", ...target, mediaId: "unverified" },
    { kind: "cut_on_beats", ...target, frames: [0, 30] },
    { kind: "zoom_keyframe", ...target, frame: 300, scale: 1.5 },
    { kind: "caption_size", ...target, fontSize: 60 },
    { kind: "reposition_text", trackId: "text", clipId: "caption", x: .5, y: .5 },
  ];
  for (const proposal of rejected) assert.throws(() => previewStudioEditProposal(proposal, original, refs));
  original.tracks[0].locked = true;
  assert.throws(() => previewStudioEditProposal({ kind: "transition", ...target, edge: "in", transition: "fade", frames: 10 }, original, refs));
});

test("moving a hook earlier preserves source timing and rejects overlap", () => {
  const original = project();
  original.tracks[0].clips[0].startFrame = 60;
  original.tracks[0].clips[0].durationFrames = 100;
  const moved = previewStudioEditProposal({ kind: "move_hook", ...target, startFrame: 0 }, original, refs).project.tracks[0].clips[0];
  assert.equal(moved.startFrame, 0);
  assert.equal(moved.sourceInSeconds, 0);
  original.tracks[0].clips.push({ ...original.tracks[0].clips[0], id: "other", startFrame: 170, durationFrames: 100 });
  assert.throws(() => previewStudioEditProposal({ kind: "move_hook", ...target, startFrame: 100 }, original, refs));
});
