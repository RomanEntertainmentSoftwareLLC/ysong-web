import assert from "node:assert/strict";
import { test } from "node:test";
import { completedVideoJobs, generatedVideoSource } from "../src/tools/promotion/generatedVideoJobs.ts";
import { insertGeneratedStudioVideo, splitStudioClip, trimStudioClip } from "../src/tools/promotion/creativeStudioTracks.ts";
import { validateCreativeStudioProject } from "../src/tools/promotion/creativeStudioProject.ts";
import { createStudioHistory, editStudioHistory, undoStudioHistory } from "../src/tools/promotion/creativeStudioHistory.ts";
import { studioRenderPlan } from "../src/tools/promotion/studioRenderPlan.ts";

const project = () => ({ schemaVersion: 1, revision: 0, durationFrames: 300, timebase: { framesPerSecond: { numerator: 30, denominator: 1 } }, tracks: [], render: { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", backgroundColor: "#000" }, edit: { createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z", source: "artist", parentRevision: 0 } });
const job = { id: "job-1", status: "completed", authorized: true, creativeId: "creative-1", provider: "provider-1", providerJobId: "remote-1", prompt: "Moving night sky", artifact: { objectKey: "private/generated/one.mp4", durationSeconds: 5, metadata: { seed: 42, model: "video-v1" } } };

test("only authorized completed artifacts for this creative are insertable", () => {
  const creative = { stableCreativeId: "creative-1", metadata: { aiVideoJobs: [job, { ...job, id: "draft", status: "draft" }, { ...job, id: "unauthorized", authorized: false }, { ...job, id: "foreign", creativeId: "other" }, { ...job, id: "empty", artifact: { ...job.artifact, objectKey: "" } }] } };
  assert.deepEqual(completedVideoJobs(creative).map(item => item.id), ["job-1"]);
});

test("insertion preserves provenance and source duration through edits and undo", () => {
  const original = project();
  const inserted = insertGeneratedStudioVideo(original, generatedVideoSource(job), 60, 90);
  const track = inserted.tracks[0];
  const clip = track.clips[0];
  assert.equal(clip.startFrame, 60);
  assert.equal(clip.durationFrames, 90);
  assert.equal(clip.sourceOutSeconds, 3);
  assert.deepEqual(clip.generatedVideo.artifactMetadata, job.artifact.metadata);
  assert.doesNotThrow(() => validateCreativeStudioProject(inserted, { audioSnippetIds: [], backgroundMediaIds: [] }));
  assert.equal(insertGeneratedStudioVideo(inserted, generatedVideoSource(job), 120), inserted);
  const split = splitStudioClip(inserted, track.id, clip.id, 90);
  assert.equal(split.tracks[0].clips[1].generatedVideo.jobId, job.id);
  const trimmed = trimStudioClip(inserted, track.id, clip.id, "end", 120);
  assert.equal(trimmed.tracks[0].clips[0].sourceOutSeconds, 2);
  assert.equal(studioRenderPlan(inserted, { audioSnippets: [], backgroundMedia: [], overlays: [] }, { "generated:job-1": "signed-url" })[0].items[0].url, "signed-url");
  const history = editStudioHistory(createStudioHistory(original), inserted);
  assert.deepEqual(undoStudioHistory(history).present, original);
});

test("insertion respects the project end and requires playable space", () => {
  const source = generatedVideoSource(job);
  assert.equal(insertGeneratedStudioVideo(project(), source, 300).tracks.length, 0);
  assert.equal(insertGeneratedStudioVideo(project(), source, 270).tracks[0].clips[0].durationFrames, 30);
});
