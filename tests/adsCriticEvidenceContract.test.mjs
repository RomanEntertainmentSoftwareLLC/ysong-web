import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAdsCriticEvidence, validateAdsCriticResponse } from "../src/tools/promotion/adsCriticEvidenceContract.ts";

const project = {
  schemaVersion: 1, revision: 3, durationFrames: 300,
  timebase: { framesPerSecond: { numerator: 30, denominator: 1 } },
  tracks: [
    { id: "visual", kind: "visual", clips: [{ id: "clip-1", mediaId: "media-1", startFrame: 0, durationFrames: 300, sourceInSeconds: 0, sourceOutSeconds: 10, transform: { x: .5, y: .5, scale: 1, rotationDegrees: 0, opacity: 1 }, keyframes: [] }] },
    { id: "text", kind: "text", clips: [{ id: "clip-2", overlayId: "overlay-1", text: "Listen", startFrame: 30, durationFrames: 120, transform: { x: .5, y: .5, scale: 1, rotationDegrees: 0, opacity: 1 }, style: { fontSize: 40, color: "#ffffff" }, keyframes: [] }] },
  ],
  render: { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", backgroundColor: "#000000" },
  edit: { createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z", source: "artist" },
};
const refs = { audioSnippetIds: [], backgroundMediaIds: ["media-1"], overlayIds: ["overlay-1"] };
const measured = { id: "signal-1", kind: "measured", code: "overlay_duration", severity: "info", confidence: 1, range: { startFrame: 30, endFrame: 150 }, clipIds: ["clip-2"], overlayIds: ["overlay-1"], observation: { value: 4, unit: "seconds" }, rule: null };
const heuristic = { id: "signal-2", kind: "heuristic", code: "dense_text", severity: "warning", confidence: .7, range: { startFrame: 30, endFrame: 150 }, clipIds: ["clip-2"], overlayIds: ["overlay-1"], observation: { value: 20, unit: "characters" }, rule: { id: "text-density", version: 1, threshold: 18, unit: "characters" } };
const input = signals => ({ creativeId: "creative-1", project, refs, aspectRatio: "base", capturedAt: "2026-09-30T12:00:00Z", signals });

test("keeps measured facts and heuristics separate with exact Studio revision and references", () => {
  const packet = buildAdsCriticEvidence(input([measured, heuristic]));
  assert.equal(packet.studioRevision, 3);
  assert.equal(packet.evidence[0].kind, "measured");
  assert.equal(packet.evidence[1].kind, "heuristic");
  assert.equal(packet.evidence[0].source, "deterministic_ads_critic");
  assert.equal(JSON.stringify(packet).includes("media-1"), false);
  assert.doesNotThrow(() => validateAdsCriticResponse({ schemaVersion: 1, interpretations: [{ evidenceIds: ["signal-2"], title: "Review text", explanation: "The text exceeds the configured threshold.", suggestedCheck: "Preview at phone size.", confidence: "medium" }] }, packet));
});

test("rejects invented signal classes, stale clip references, and misplaced ranges", () => {
  assert.throws(() => buildAdsCriticEvidence(input([{ ...measured, code: "bad_hook" }])), /classification/);
  assert.throws(() => buildAdsCriticEvidence(input([{ ...measured, clipIds: ["other"] }])), /unmatched clip/);
  assert.throws(() => buildAdsCriticEvidence(input([{ ...measured, range: { startFrame: 200, endFrame: 300 } }])), /unmatched clip/);
  assert.throws(() => buildAdsCriticEvidence(input([{ ...heuristic, severity: "critical" }])), /heuristic signal requirements/);
  assert.throws(() => buildAdsCriticEvidence(input([{ ...measured, observation: { value: 8, unit: "seconds" } }])), /overlay duration mismatch/);
  assert.throws(() => buildAdsCriticEvidence(input([{ ...measured, severity: "critical" }])), /unsupported critical severity/);
});

test("AI commentary must cite existing evidence and cannot add action or outcome fields", () => {
  const packet = buildAdsCriticEvidence(input([measured]));
  const row = { evidenceIds: ["signal-1"], title: "Check the overlay", explanation: "It appears for four seconds in the saved timeline.", suggestedCheck: "Preview the rendered ad.", confidence: "medium" };
  assert.throws(() => validateAdsCriticResponse({ schemaVersion: 1, interpretations: [{ ...row, evidenceIds: ["fabricated"] }] }, packet), /unsupported evidence/);
  assert.throws(() => validateAdsCriticResponse({ schemaVersion: 1, interpretations: [{ ...row, publish: true }] }, packet), /fields/);
  assert.throws(() => validateAdsCriticResponse({ schemaVersion: 1, interpretations: [{ ...row, explanation: "This will increase clicks." }] }, packet), /explanation/);
});
