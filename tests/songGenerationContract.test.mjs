import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSongGenerationResult, resultFromGeneratedSession } from "../src/lib/songGenerationContract.ts";

const manifest = () => ({
  v: 1, sessionId: "session-1", createdAt: 1_700_000_000_000, projectName: "Song", bpm: 120,
  sigNum: 4, sigDen: 4, totalBars: 8, structuredCaption: "A song",
  tracks: [
    { id: "drums", name: "Drums", role: "drums", mode: "midi", midiRegions: [{ startBar: 1, lengthBars: 4, repeatCount: 2, notes: [{ pitch: 36, startBars: 0, lengthBars: 0.25, velocity: 100 }] }] },
    { id: "vocal", name: "Vocal", role: "lead vocal", mode: "audio", objectKey: "songs/vocal.wav", durationSec: 16.2 },
  ],
});

test("keeps aligned audio and editable MIDI in a provider-neutral project result", () => {
  const result = resultFromGeneratedSession(manifest(), { origin: "create-song", prompt: "A song", seed: 12 }, { provider: "local", name: "music-v1" });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.timebase, { bpm: 120, sigNum: 4, sigDen: 4, startBar: 1, totalBars: 8 });
  assert.deepEqual(result.parts[1].audio, { objectKey: "songs/vocal.wav", startBar: 1, lengthBars: 8, sourceOffsetSec: 0, durationSec: 16.2 });
  assert.equal(result.parts[0].midi.regions[0].notes[0].pitch, 36);
  const withProviderPayload = { ...result, rawProviderResponse: { token: "secret" }, parts: result.parts.map((part) => ({ ...part, providerJobId: "private" })) };
  assert.deepEqual(parseSongGenerationResult(withProviderPayload), result);
});

test("preserves failed parts and distinguishes partial from total failure", () => {
  const input = manifest();
  const failures = new Map([["vocal", { code: "upload_failed", message: "Upload unavailable" }]]);
  const partial = resultFromGeneratedSession(input, { origin: "create-song", prompt: "A song" }, { provider: "local", name: "music-v1" }, failures);
  assert.equal(partial.status, "partial");
  assert.equal(partial.parts[1].audio, undefined);
  assert.deepEqual(partial.parts[1].failure, { code: "upload_failed", message: "Upload unavailable" });
  failures.set("drums", { code: "generation_failed", message: "Model unavailable" });
  assert.equal(resultFromGeneratedSession(input, { origin: "create-song", prompt: "A song" }, { provider: "local", name: "music-v1" }, failures).status, "failed");
});

test("rejects inconsistent status, duplicate ids, and unaligned audio", () => {
  const result = resultFromGeneratedSession(manifest(), { origin: "create-song", prompt: "A song" }, { provider: "local", name: "music-v1" });
  assert.equal(parseSongGenerationResult({ ...result, status: "partial" }), null);
  assert.equal(parseSongGenerationResult({ ...result, parts: [result.parts[0], result.parts[0]] }), null);
  assert.equal(parseSongGenerationResult({ ...result, parts: [result.parts[0], { ...result.parts[1], audio: { ...result.parts[1].audio, startBar: 2 } }] }), null);
});
