import assert from "node:assert/strict";
import { test } from "node:test";
import { pitchFramesToNotes, transcribeMonophonicVocal } from "../src/lib/vocalToMidi.ts";

function frame(timeSec, midi, confidence = 0.96, rms = 0.1) {
  return { timeSec, frequencyHz: midi == null ? null : 440 * 2 ** ((midi - 69) / 12), confidence: midi == null ? 0 : confidence, rms: midi == null ? 0 : rms };
}

test("vibrato, a brief pitch glitch, and a short dropout remain one usable note", () => {
  const frames = [];
  for (let index = 0; index < 50; index++) {
    const vibrato = Math.sin(index / 2) * 0.32;
    frames.push(frame(index * 0.02, index === 20 ? 73 : index >= 31 && index <= 32 ? null : 69 + vibrato));
  }
  const result = pitchFramesToNotes(frames);
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].pitch, 69);
  assert.ok(result.notes[0].durationSeconds > 0.9);
  assert.ok(result.pitchBend.length < 20);
});

test("silence separates two synthetic sung notes without frame-sized fragments", () => {
  const sampleRate = 8000;
  const segments = [
    { seconds: 0.25, frequency: 0 },
    { seconds: 0.8, frequency: 440 },
    { seconds: 0.18, frequency: 0 },
    { seconds: 0.8, frequency: 523.251 },
  ];
  const total = segments.reduce((sum, segment) => sum + Math.round(segment.seconds * sampleRate), 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const segment of segments) {
    const length = Math.round(segment.seconds * sampleRate);
    for (let index = 0; index < length; index++) {
      samples[offset + index] = segment.frequency ? 0.16 * Math.sin(2 * Math.PI * segment.frequency * index / sampleRate) : 0;
    }
    offset += length;
  }
  const result = transcribeMonophonicVocal(samples, sampleRate);
  assert.equal(result.notes.length, 2);
  assert.deepEqual(result.notes.map((note) => note.pitch), [69, 72]);
  assert.ok(result.notes.every((note) => note.durationSeconds > 0.6 && note.velocity >= 48 && note.velocity <= 127));
});

test("short accidental note fragments are folded into a stable neighboring melody", () => {
  const pitches = [...Array(18).fill(60), 61, 61, ...Array(18).fill(62)];
  const result = pitchFramesToNotes(pitches.map((pitch, index) => frame(index * 0.02, pitch)));
  assert.equal(result.notes.length, 2);
  assert.deepEqual(result.notes.map((note) => note.pitch), [60, 62]);
});
