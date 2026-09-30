import assert from "node:assert/strict";
import { test } from "node:test";
import { createStudioHistory, editStudioHistory, redoStudioHistory, STUDIO_HISTORY_BYTES, STUDIO_HISTORY_LIMIT, undoStudioHistory } from "../src/tools/promotion/creativeStudioHistory.ts";

const project = () => ({
  schemaVersion: 1, revision: 3, durationFrames: 300,
  timebase: { framesPerSecond: { numerator: 30, denominator: 1 } },
  tracks: [{ id: "visual", kind: "visual", clips: [{ id: "clip", mediaId: "media", startFrame: 0, durationFrames: 300, sourceInSeconds: 0, sourceOutSeconds: 10, transform: { x: .5, y: .5, scale: 1, rotationDegrees: 0, opacity: 1 }, keyframes: [] }] }],
  render: { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", backgroundColor: "#000000" },
  edit: { createdAt: "2026-09-29T00:00:00Z", updatedAt: "2026-09-29T00:00:00Z", source: "artist" },
});

test("undo and redo restore clip, transform, and keyframe edits without changing the saved revision", () => {
  const saved = project();
  const moved = { ...saved, tracks: [{ ...saved.tracks[0], clips: [{ ...saved.tracks[0].clips[0], startFrame: 10 }] }] };
  const transformed = { ...moved, tracks: [{ ...moved.tracks[0], clips: [{ ...moved.tracks[0].clips[0], transform: { ...moved.tracks[0].clips[0].transform, scale: 1.5 } }] }] };
  const keyed = { ...transformed, tracks: [{ ...transformed.tracks[0], clips: [{ ...transformed.tracks[0].clips[0], keyframes: [{ frame: 20, property: "x", value: .8, interpolation: "linear" }] }] }] };
  let history = createStudioHistory(saved);
  history = editStudioHistory(history, moved);
  history = editStudioHistory(history, transformed);
  history = editStudioHistory(history, keyed);
  assert.equal(history.past.length, 3);
  history = undoStudioHistory(undoStudioHistory(undoStudioHistory(history)));
  assert.equal(history.present, saved);
  assert.equal(history.present.revision, 3);
  history = redoStudioHistory(redoStudioHistory(redoStudioHistory(history)));
  assert.equal(history.present, keyed);
  assert.deepEqual(JSON.parse(JSON.stringify(history.present)), keyed);
  history = undoStudioHistory(history);
  history = editStudioHistory(history, { ...history.present, tracks: [] });
  assert.equal(history.future.length, 0);
});

test("slider edits group briefly; history remains bounded by steps and bytes", () => {
  let history = createStudioHistory(project());
  history = editStudioHistory(history, { ...history.present, durationFrames: 301 }, "scale", 1000);
  history = editStudioHistory(history, { ...history.present, durationFrames: 302 }, "scale", 1100);
  assert.equal(history.past.length, 1);
  history = editStudioHistory(history, { ...history.present, durationFrames: 303 }, "scale", 2200);
  assert.equal(history.past.length, 2);
  for (let n = 0; n < 40; n++) history = editStudioHistory(history, { ...history.present, durationFrames: 304 + n, edit: { ...history.present.edit, summary: `${n}`.repeat(120000) } });
  assert.ok(history.past.length <= STUDIO_HISTORY_LIMIT);
  assert.ok(history.past.reduce((bytes, item) => bytes + item.bytes, 0) <= STUDIO_HISTORY_BYTES);
  for (let n = 0; n < 10; n++) history = undoStudioHistory(history);
  assert.ok(history.past.length + history.future.length <= STUDIO_HISTORY_LIMIT);
  assert.ok([...history.past, ...history.future].reduce((bytes, item) => bytes + item.bytes, 0) <= STUDIO_HISTORY_BYTES);
  const noOp = editStudioHistory(history, history.present);
  assert.equal(noOp, history);
});
