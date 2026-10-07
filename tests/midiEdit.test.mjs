import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanizeNotes, quantizeNotes, transformNotes } from '../src/lib/midiEdit.ts';

const notes = [
  { id: 'a', pitch: 60, startBars: 0.18, lengthBars: 0.3, velocity: 100 },
  { id: 'b', pitch: 127, startBars: 0.62, lengthBars: 0.5, velocity: 127 },
];
const selected = new Set(['a']);

test('bounded quantize affects selected notes only', () => {
  assert.equal(quantizeNotes(notes, selected, 0.25, 50)[0].startBars, 0.215);
  assert.equal(quantizeNotes(notes, selected, 0.25, 200)[0].startBars, 0.25);
  assert.deepEqual(quantizeNotes(notes, selected, 0.25, 50)[1], notes[1]);
  assert.deepEqual(notes[0], { id: 'a', pitch: 60, startBars: 0.18, lengthBars: 0.3, velocity: 100 });
});

test('length velocity and transpose clamp to MIDI limits', () => {
  const edited = transformNotes(notes, new Set(['a', 'b']), { velocity: 200, lengthBars: 0, transpose: 12 });
  assert.equal(edited[0].pitch, 72);
  assert.equal(edited[1].pitch, 127);
  assert.equal(edited[0].velocity, 127);
  assert.equal(edited[0].lengthBars, 1 / 1024);
});

test('humanize is bounded and retains original note data', () => {
  const edited = humanizeNotes(notes, selected, 0.1, 20, () => 0);
  assert.ok(Math.abs(edited[0].startBars - 0.08) < 1e-9);
  assert.equal(edited[0].velocity, 80);
  assert.equal(edited[1], notes[1]);
  assert.equal(notes[0].velocity, 100);
});
