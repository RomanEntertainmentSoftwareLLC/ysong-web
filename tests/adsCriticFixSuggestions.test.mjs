import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeAdsCreativeTimeline, buildAdsCriticEvidence } from "../src/tools/promotion/adsCriticEvidenceContract.ts";
import { buildAdsCriticFixSuggestions } from "../src/tools/promotion/adsCriticFixSuggestions.ts";
import { previewStudioEditProposal } from "../src/tools/promotion/studioEditProposals.ts";
import { createStudioHistory, editStudioHistory, undoStudioHistory } from "../src/tools/promotion/creativeStudioHistory.ts";

const refs = { audioSnippetIds: [], backgroundMediaIds: ["media-1"], overlayIds: ["overlay-1"] };
const project = () => ({
  schemaVersion: 1, revision: 4, durationFrames: 300,
  timebase: { framesPerSecond: { numerator: 30, denominator: 1 } },
  tracks: [
    { id: "visual", kind: "visual", clips: [{ id: "opening", mediaId: "media-1", startFrame: 30, durationFrames: 240, sourceInSeconds: 0, sourceOutSeconds: 8, transform: { x: .5, y: .5, scale: 1, rotationDegrees: 0, opacity: 1 }, keyframes: [] }] },
    { id: "text", kind: "text", clips: [{ id: "headline", overlayId: "overlay-1", text: "A long headline for this ad", startFrame: 30, durationFrames: 120, transform: { x: .5, y: .5, scale: 1, rotationDegrees: 0, opacity: 1 }, style: { fontSize: 40, color: "#fff" }, keyframes: [] }] },
  ],
  render: { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", backgroundColor: "#000000" },
  edit: { createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z", source: "artist" },
});

test("Critic fixes cite the saved revision, preview valid edits, and preserve undo", () => {
  const saved = project();
  const packet = buildAdsCriticEvidence({ creativeId: "creative-1", project: saved, refs, aspectRatio: "base", capturedAt: saved.edit.updatedAt, signals: analyzeAdsCreativeTimeline(saved) });
  const suggestions = buildAdsCriticFixSuggestions(packet, saved, refs, [60, 90]);
  assert.ok(suggestions.some(item => item.title === "Bring the opening visual forward"));
  assert.ok(suggestions.some(item => item.title === "Move the headline higher"));
  assert.ok(suggestions.some(item => item.title === "Cut at beat markers"));
  const fix = suggestions.find(item => item.title === "Bring the opening visual forward");
  const preview = previewStudioEditProposal(fix.proposal, saved, refs);
  assert.equal(preview.project.tracks[0].clips[0].startFrame, 0);
  const history = editStudioHistory(createStudioHistory(saved), preview.project);
  assert.deepEqual(undoStudioHistory(history).present, saved);
  assert.equal(buildAdsCriticFixSuggestions(packet, { ...saved, revision: 5 }, refs).length, 0);
});

test("locked clips and unavailable beat markers do not create unvalidated edits", () => {
  const saved = project();
  saved.tracks[0].locked = true;
  const packet = buildAdsCriticEvidence({ creativeId: "creative-1", project: saved, refs, aspectRatio: "base", capturedAt: saved.edit.updatedAt, signals: analyzeAdsCreativeTimeline(saved) });
  const suggestions = buildAdsCriticFixSuggestions(packet, saved, refs);
  assert.equal(suggestions.some(item => item.proposal?.trackId === "visual"), false);
  assert.ok(suggestions.some(item => item.title === "Review B-roll for the gap" && item.proposal === null));
});
