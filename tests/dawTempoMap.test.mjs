import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTempoMap, barToQuarterBeats, barToSeconds, secondsToBar } from "../src/lib/dawTempoMap.ts";
import { buildStandardMidiFile } from "../src/lib/dawExport.ts";

test("legacy projects remain single tempo with bar 1 at time zero", () => {
  const map = normalizeTempoMap(undefined, { bpm: 120, sigNum: 4, sigDen: 4 });
  assert.deepEqual(map, [{ id: "tempo:1", bar: 1, bpm: 120, sigNum: 4, sigDen: 4 }]);
  assert.equal(barToSeconds(5, map), 8);
  assert.equal(secondsToBar(8, map), 5);
  assert.equal(barToQuarterBeats(5, map), 16);
});

test("tempo and meter boundaries preserve bar anchored MIDI positions", () => {
  const map = normalizeTempoMap([
    { id: "change", bar: 3, bpm: 60, sigNum: 3, sigDen: 4 },
    { id: "initial", bar: 1, bpm: 120, sigNum: 4, sigDen: 4 },
  ], { bpm: 120, sigNum: 4, sigDen: 4 });
  assert.equal(barToQuarterBeats(4, map), 11);
  assert.equal(barToSeconds(4, map), 7);
  assert.equal(secondsToBar(7, map), 4);
  assert.equal(secondsToBar(5.5, map), 3.5);
  const midi = buildStandardMidiFile({ bpm: 120, sigNum: 4, sigDen: 4, endBar: 5, tempoMap: map,
    tracks: [{ name: "Keys", notes: [{ pitch: 60, startBars: 2, lengthBars: 1, velocity: 90 }] }] });
  assert.ok(midi.length > 80);
});

test("invalid and duplicate map events are bounded", () => {
  const map = normalizeTempoMap([
    { id: "a", bar: 2, bpm: 90, sigNum: 4, sigDen: 4 },
    { id: "b", bar: 2, bpm: 100, sigNum: 4, sigDen: 4 },
    { id: "bad", bar: 3, bpm: NaN, sigNum: 4, sigDen: 4 },
  ], { bpm: 120, sigNum: 4, sigDen: 4 });
  assert.deepEqual(map.map(event => event.bar), [1, 2]);
  assert.throws(() => barToSeconds(-1, map), RangeError);
});
