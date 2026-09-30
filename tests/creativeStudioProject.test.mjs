import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCreativeStudioProject } from "../src/tools/promotion/creativeStudioProject.ts";

const refs = { audioSnippetIds: ["snippet-1"], backgroundMediaIds: ["media-1"] };
const transform = { x: 0.5, y: 0.5, scale: 1, rotationDegrees: 0, opacity: 1 };
const project = () => ({
  schemaVersion: 1, revision: 2, durationFrames: 450,
  timebase: { framesPerSecond: { numerator: 30, denominator: 1 } },
  tracks: [
    { id: "visual", kind: "visual", clips: [{ id: "visual-1", mediaId: "media-1", startFrame: 0, durationFrames: 450, sourceInSeconds: 1, sourceOutSeconds: 16, transform, keyframes: [{ frame: 0, property: "opacity", value: 0, interpolation: "linear" }], transitionIn: { kind: "fade", durationFrames: 15 } }] },
    { id: "audio", kind: "audio", clips: [{ id: "audio-1", snippetId: "snippet-1", startFrame: 0, durationFrames: 450, sourceInSeconds: 0, sourceOutSeconds: 15, volume: 1, keyframes: [] }] },
    { id: "text", kind: "text", clips: [{ id: "text-1", text: "Listen now", startFrame: 30, durationFrames: 240, transform, style: { fontSize: 48, color: "#ffffff" }, keyframes: [] }] },
  ],
  render: { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", backgroundColor: "#000000" },
  edit: { createdAt: "2026-09-29T00:00:00Z", updatedAt: "2026-09-29T01:00:00Z", source: "artist", parentRevision: 2 },
});

test("valid multi-track Ads project survives JSON persistence", () => {
  assert.doesNotThrow(() => validateCreativeStudioProject(JSON.parse(JSON.stringify(project())), refs));
});

test("rejects dangling media, timeline overflow, and incompatible keyframes", () => {
  const dangling = project(); dangling.tracks[0].clips[0].mediaId = "missing";
  assert.throws(() => validateCreativeStudioProject(dangling, refs), /unknown mediaId/);
  const overflow = project(); overflow.tracks[2].clips[0].durationFrames = 450;
  assert.throws(() => validateCreativeStudioProject(overflow, refs), /clip order or bounds/);
  const keyframe = project(); keyframe.tracks[1].clips[0].keyframes.push({ frame: 0, property: "opacity", value: 1, interpolation: "linear" });
  assert.throws(() => validateCreativeStudioProject(keyframe, refs), /incompatible/);
});

test("rejects unsafe versions, frames, and transition lengths", () => {
  const version = project(); version.schemaVersion = 2;
  assert.throws(() => validateCreativeStudioProject(version, refs), /unsupported schemaVersion/);
  const frame = project(); frame.tracks[0].clips[0].startFrame = NaN;
  assert.throws(() => validateCreativeStudioProject(frame, refs), /clip.startFrame/);
  const transition = project(); transition.tracks[0].clips[0].transitionIn.durationFrames = 451;
  assert.throws(() => validateCreativeStudioProject(transition, refs), /transitionIn/);
});
