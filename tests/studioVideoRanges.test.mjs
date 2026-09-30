import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptStudioVideoRange, planStudioVideoRange, studioVideoGaps, videoProviderCapabilities } from "../src/tools/promotion/studioVideoRanges.ts";
import { validateCreativeStudioProject } from "../src/tools/promotion/creativeStudioProject.ts";

const source = { jobId: "old", provider: "provider-a", providerJobId: "old-provider", prompt: "Old shot", objectKey: "old/key", durationSeconds: 2, artifactMetadata: {} };
const replacement = { jobId: "new", provider: "provider-a", providerJobId: "new-provider", prompt: "New shot", objectKey: "new/key", durationSeconds: 2, artifactMetadata: {} };
const project = () => ({ durationFrames: 150, timebase: { framesPerSecond: { numerator: 30, denominator: 1 } }, tracks: [{ id: "visual", kind: "visual", clips: [{ id: "clip", startFrame: 0, durationFrames: 60, generatedVideo: source, sourceInSeconds: 0, sourceOutSeconds: 2, keyframes: [], transform: { x: .5, y: .5, scale: 1, rotationDegrees: 0, opacity: 1 } }, { id: "later", startFrame: 120, durationFrames: 30, mediaId: "media", sourceInSeconds: 0, sourceOutSeconds: 1, keyframes: [], transform: { x: .5, y: .5, scale: 1, rotationDegrees: 0, opacity: 1 } }] }] });

test("only valid explicit provider capabilities enable range work", () => {
  assert.equal(videoProviderCapabilities({ provider: "a", regenerate: true, extend: false, fill: true, maxDurationSeconds: 10 })?.extend, false);
  assert.equal(videoProviderCapabilities({ provider: "a", regenerate: true, fill: true, maxDurationSeconds: 10 }), null);
  assert.equal(videoProviderCapabilities({ provider: "a", regenerate: true, extend: true, fill: true, maxDurationSeconds: Infinity }), null);
});

test("ranges stay within selected clip or actual gap", () => {
  const edit = project();
  assert.deepEqual(studioVideoGaps(edit, "visual"), [{ startFrame: 60, durationFrames: 60 }]);
  assert.equal(planStudioVideoRange(edit, "9:16", "fill", "visual", undefined, 61), null);
  assert.deepEqual(planStudioVideoRange(edit, "9:16", "extend", "visual", "clip")?.startFrame, 60);
  assert.equal(planStudioVideoRange(edit, "9:16", "extend", "visual", "later"), null);
  edit.tracks[0].locked = true;
  assert.equal(planStudioVideoRange(edit, "9:16", "regenerate", "visual", "clip"), null);
});

test("replacement waits for acceptance and rejects short or stale results", () => {
  const edit = project();
  const range = planStudioVideoRange(edit, "9:16", "regenerate", "visual", "clip");
  assert.equal(edit.tracks[0].clips[0].generatedVideo.jobId, "old");
  assert.equal(acceptStudioVideoRange(edit, range, { ...replacement, durationSeconds: 1 }), edit);
  const accepted = acceptStudioVideoRange(edit, range, replacement);
  assert.equal(accepted.tracks[0].clips[0].generatedVideo.jobId, "new");
  assert.equal(edit.tracks[0].clips[0].generatedVideo.jobId, "old");
  const changed = project(); changed.tracks[0].clips[0].generatedVideo = { ...source, jobId: "another" };
  assert.equal(acceptStudioVideoRange(changed, range, replacement), changed);
});

test("filling and extending add only within the gap and keep the original", () => {
  const edit = project();
  const range = planStudioVideoRange(edit, "9:16", "extend", "visual", "clip");
  const extended = acceptStudioVideoRange(edit, range, replacement);
  assert.equal(extended.tracks[0].clips.length, 3);
  assert.equal(extended.tracks[0].clips[0].generatedVideo.jobId, "old");
  assert.equal(extended.tracks[0].clips[1].startFrame, 60);
  assert.equal(studioVideoGaps(extended, "visual").length, 0);
  assert.equal(acceptStudioVideoRange(extended, range, replacement), extended);
  const complete = { ...extended, schemaVersion: 1, revision: 0, render: { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", backgroundColor: "#000000" }, edit: { createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z", source: "artist" } };
  assert.doesNotThrow(() => validateCreativeStudioProject(complete, { audioSnippetIds: [], backgroundMediaIds: ["media"] }));
});
