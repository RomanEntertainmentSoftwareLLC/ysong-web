import assert from "node:assert/strict";
import { test } from "node:test";
import { studioRenderPlan } from "../src/tools/promotion/studioRenderPlan.ts";

const transform = { x: .5, y: .5, scale: 1, rotationDegrees: 0, opacity: 1 };
const project = () => ({
  schemaVersion: 1, revision: 3, durationFrames: 90,
  timebase: { framesPerSecond: { numerator: 30, denominator: 1 } },
  tracks: [
    { id: "video", kind: "visual", clips: [{ id: "v", mediaId: "v1", startFrame: 0, durationFrames: 90, sourceInSeconds: 1, sourceOutSeconds: 4, transform, keyframes: [] }] },
    { id: "audio", kind: "audio", clips: [{ id: "a", snippetId: "a1", startFrame: 0, durationFrames: 90, sourceInSeconds: 2, sourceOutSeconds: 5, volume: .8, keyframes: [] }] },
    { id: "text", kind: "text", clips: [{ id: "t", text: "Listen", startFrame: 0, durationFrames: 90, transform, style: { fontSize: 48, color: "#fff" }, keyframes: [] }] },
  ],
  render: { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", backgroundColor: "#000" },
  edit: { createdAt: "2026-09-29T00:00:00Z", updatedAt: "2026-09-29T00:00:00Z", source: "artist" },
});
const creative = { backgroundMedia: [{ mediaId: "v1", mediaType: "video" }], audioSnippets: [{ snippetId: "a1", startSeconds: 10, durationSeconds: 6 }], overlays: [] };
const urls = { "media:v1": "video-url", "audio:a1": "audio-url" };

test("resolves ordered layers and absolute audio source trim", () => {
  const tracks = studioRenderPlan(project(), creative, urls);
  assert.deepEqual(tracks.map(track => track.items.map(item => item.kind)), [["visual"], ["audio"], ["text"]]);
  assert.equal(tracks[1].items[0].sourceStart, 12);
});

test("rejects missing media and unsupported audio ducking", () => {
  assert.throws(() => studioRenderPlan(project(), creative, { "audio:a1": "audio-url" }), /source asset is unavailable/);
  const withDucking = project(); withDucking.tracks[1].clips[0].duckingIntent = "under-voiceover";
  assert.throws(() => studioRenderPlan(withDucking, creative, urls), /ducking is not supported/);
});

test("rejects trims that cannot fill their timeline interval", () => {
  const tooShort = project(); tooShort.tracks[0].clips[0].sourceOutSeconds = 2;
  assert.throws(() => studioRenderPlan(tooShort, creative, urls), /trim, speed, and timeline duration disagree/);
  const beyondSnippet = project(); beyondSnippet.tracks[1].clips[0].sourceOutSeconds = 8;
  assert.throws(() => studioRenderPlan(beyondSnippet, creative, urls), /trim exceeds its source/);
});

test("rejects nonvisual transitions instead of omitting them", () => {
  const withTransition = project();
  withTransition.tracks[2].clips[0].transitionIn = { kind: "fade", durationFrames: 10 };
  assert.throws(() => studioRenderPlan(withTransition, creative, urls), /transitions are not supported/);
});
