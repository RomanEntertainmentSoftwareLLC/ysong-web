import assert from "node:assert/strict";
import { test } from "node:test";
import { planSongGenerationImport } from "../src/lib/songGenerationImport.ts";

const bundle = {
  v: 1, id: "generation-1", status: "partial", createdAt: 1_700_000_000_000,
  timebase: { bpm: 93, sigNum: 3, sigDen: 4, startBar: 1, totalBars: 8 },
  source: { origin: "generator", prompt: "A song" }, model: { provider: "provider", name: "model" },
  parts: [
    { id: "voice", name: "Lead Vocal", role: "lead vocal", kind: "audio", status: "ready",
      audio: { objectKey: "songs/voice.wav", startBar: 1, lengthBars: 8, sourceOffsetSec: 0, durationSec: 15 } },
    { id: "keys", name: "Keys", role: "piano", kind: "midi", status: "ready",
      midi: { regions: [{ startBar: 2, lengthBars: 3, repeatCount: 3, notes: [{ pitch: 60, startBars: 0, lengthBars: 2, velocity: 90 }] }] } },
    { id: "bass", name: "Bass", role: "bass", kind: "audio", status: "failed",
      failure: { code: "generation_failed", message: "Unavailable" } },
  ],
};

test("imports ready audio and expanded editable MIDI on the bundle timebase", () => {
  const planned = planSongGenerationImport(bundle);
  assert.ok(planned);
  assert.deepEqual(planned.result.timebase, bundle.timebase);
  assert.deepEqual(planned.parts.map((part) => part.name), ["Lead Vocal", "Keys"]);
  assert.deepEqual(planned.parts[0].audio, { objectKey: "songs/voice.wav", durationSec: 15, startBar: 1, lengthBars: 8 });
  assert.deepEqual(planned.parts[1].midiClips.map(({ startBar, lengthBars }) => ({ startBar, lengthBars })),
    [{ startBar: 2, lengthBars: 3 }, { startBar: 5, lengthBars: 3 }, { startBar: 8, lengthBars: 1 }]);
  assert.deepEqual(planned.parts[1].midiClips[0].notes, bundle.parts[1].midi.regions[0].notes);
  assert.equal(planned.parts[1].midiClips[2].notes[0].lengthBars, 1);
});

test("rejects an invalid or entirely failed bundle", () => {
  assert.equal(planSongGenerationImport({ ...bundle, timebase: { ...bundle.timebase, bpm: 0 } }), null);
  assert.equal(planSongGenerationImport({ ...bundle, status: "failed" }), null);
});
