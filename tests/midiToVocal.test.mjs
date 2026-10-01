import assert from "node:assert/strict";
import { test } from "node:test";
import { copyVocalSetup, prepareVocalRequest, vocalRequestIsCurrent } from "../src/lib/midiToVocal.ts";

const singer = { id: "singer-1", displayName: "Voice", avatarRef: "local-singer:singer-1", voiceDescription: "Warm alto", vocalRange: "G3-E5", vocalStyle: "Legato", tags: [] };
const source = { id: "clip-1", trackId: "track-1", startBar: 3, lengthBars: 2,
  midiNotes: [{ id: "n1", pitch: 60, startBars: 0.5, lengthBars: 0.5, velocity: 90 }, { id: "n2", pitch: 62, startBars: 1, lengthBars: 0.25, velocity: 80 }],
  midiPitchBend: [{ id: "b1", atBars: 0.75, value: 0.2 }], midiBendRange: 2,
  partGeneration: { origin: "vocal-transcription", sourceClipId: "original", sourceAssetId: "audio-1", algorithm: "ysong-yin-v1" } };
const time = { bpm: 120, sigNum: 6, sigDen: 8 };
const draft = () => ({ v: 1, singer: structuredClone(singer), lyrics: { n1: "hel", n2: "lo" } });

test("6/8 timing preserves leading silence, placement, expression and provenance", () => {
  const setup = draft();
  const request = prepareVocalRequest(source, time, setup);
  assert.equal(request.startSeconds, 3);
  assert.equal(request.durationSeconds, 3);
  assert.deepEqual(request.notes.map((n) => [n.startSeconds, n.durationSeconds]), [[0.75, 0.75], [1.5, 0.375]]);
  assert.deepEqual(request.source.partGeneration, source.partGeneration);
  assert.deepEqual(request.source.midiPitchBend, source.midiPitchBend);
  assert.equal(request.status, "unavailable");
  assert.equal(request.audio, undefined);
  setup.singer.displayName = "Changed later";
  assert.equal(request.singer.displayName, "Voice");
  assert.equal(prepareVocalRequest(source, { bpm: 60, sigNum: 3, sigDen: 4 }, draft()).startSeconds, 6);
});

test("project JSON roundtrip preserves snapshot and editable source; edits make request stale", () => {
  const setup = draft(); setup.request = prepareVocalRequest(source, time, setup);
  const project = JSON.parse(JSON.stringify({ clips: [{ ...source, vocalSetup: setup }], ...time }));
  const clip = project.clips[0];
  assert.equal(vocalRequestIsCurrent(clip, time, clip.vocalSetup), true);
  assert.deepEqual(clip.midiNotes, source.midiNotes);
  assert.deepEqual(clip.vocalSetup.singer, singer);
  for (const mutation of [
    (c) => { c.startBar++; }, (c) => { c.lengthBars++; }, (c) => { c.id = "copy"; },
    (c) => { c.midiNotes[0].pitch++; }, (c) => { c.midiPitchBend[0].value++; },
    (c) => { c.vocalSetup.lyrics.n1 = "ah"; }, (c) => { c.vocalSetup.singer.voiceDescription = "New voice"; },
  ]) {
    const changed = structuredClone(clip); mutation(changed);
    assert.equal(vocalRequestIsCurrent(changed, time, changed.vocalSetup), false);
  }
  assert.equal(vocalRequestIsCurrent(clip, { ...time, bpm: 90 }, clip.vocalSetup), false);
  assert.equal(vocalRequestIsCurrent(clip, { ...time, sigDen: 4 }, clip.vocalSetup), false);
});

test("rejects missing singer or syllables, polyphony, cropped notes and invalid timing", () => {
  assert.throws(() => prepareVocalRequest(source, time, { ...draft(), singer: undefined }), /singer/);
  assert.throws(() => prepareVocalRequest(source, time, { ...draft(), lyrics: {} }), /syllable/);
  for (const change of [{ midiNotes: [] }, { assetId: "audio" }, { startBar: 0 }, { lengthBars: NaN },
    { midiNotes: source.midiNotes.map((n) => ({ ...n, startBars: 0 })) },
    { midiNotes: [{ ...source.midiNotes[0], lengthBars: 4 }] },
    { midiNotes: [{ ...source.midiNotes[0], pitch: 128 }] },
    { midiPitchBend: [{ atBars: Infinity, value: 0 }] }]) {
    assert.throws(() => prepareVocalRequest({ ...source, ...change }, time, draft()));
  }
  for (const change of [{ bpm: 0 }, { bpm: Infinity }, { sigNum: 0 }, { sigDen: 3 }]) {
    assert.throws(() => prepareVocalRequest(source, { ...time, ...change }, draft()));
  }
});

test("paste remaps lyrics and retains an independent singer snapshot without a request", () => {
  const setup = draft(); setup.request = prepareVocalRequest(source, time, setup);
  const copied = copyVocalSetup(setup, source.midiNotes, source.midiNotes.map((n) => ({ ...n, id: `${n.id}-copy` })));
  assert.deepEqual(copied.lyrics, { "n1-copy": "hel", "n2-copy": "lo" });
  assert.equal(copied.request, undefined);
  copied.singer.tags.push("new");
  assert.deepEqual(setup.singer.tags, []);
  assert.equal(copyVocalSetup(undefined, [], []), undefined);
});
