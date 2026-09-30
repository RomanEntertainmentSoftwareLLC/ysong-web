import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCreativeStudioProject } from "../src/tools/promotion/creativeStudioProject.ts";
import { addStudioSource, moveStudioTrack, studioSources } from "../src/tools/promotion/creativeStudioTracks.ts";

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

test("source-backed tracks preserve identity and reject invalid controls", () => {
  const creative = {
    backgroundMedia: [{ mediaId: "media-1", objectKey: "private/video", mediaType: "video", source: "stock", attribution: { provider: "Pexels" } }],
    audioSnippets: [{ snippetId: "snippet-1", sourceTrackId: "song-1", sourceObjectKey: "private/audio", startSeconds: 2, durationSeconds: 8, label: "Hook" }],
    overlays: [{ id: "meme-1", kind: "sticker", assetObjectKey: "private/meme", startSeconds: 1, endSeconds: 5 }, { id: "text-1", kind: "text", text: "New release", startSeconds: 0, endSeconds: 4 }],
    caption: { text: "Hear the song" }, cta: { label: "Listen now" },
  };
  const sources = studioSources(creative, 450, 30);
  assert.equal(sources.length, 6);
  assert.match(sources[0].identity, /Stock · Pexels · media-1/);
  assert.equal(sources[1].track.clips[0].overlayId, "meme-1");
  const edit = project(); edit.tracks = [];
  const withSource = sources.reduce(addStudioSource, edit);
  assert.doesNotThrow(() => validateCreativeStudioProject(withSource, { ...refs, overlayIds: ["meme-1", "text-1"] }));
  assert.equal(addStudioSource(withSource, sources[0]), withSource);
  withSource.tracks[0].locked = true;
  assert.equal(moveStudioTrack(withSource, withSource.tracks[0].id, 1), withSource);
  withSource.tracks[1].muted = true;
  assert.throws(() => validateCreativeStudioProject(withSource, { ...refs, overlayIds: ["meme-1", "text-1"] }), /track.muted/);
});
