import type { MidiNote } from "./midi";

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function quantizeNotes(notes: MidiNote[], ids: Set<string>, step: number, strength: number): MidiNote[] {
  const amount = clamp(strength, 0, 100) / 100;
  if (!Number.isFinite(step) || step <= 0) return notes;
  return notes.map((note) => ids.has(note.id) ? {
    ...note,
    startBars: Math.max(0, note.startBars + (Math.round(note.startBars / step) * step - note.startBars) * amount),
  } : note);
}

export function transformNotes(notes: MidiNote[], ids: Set<string>, edit: {
  velocity?: number; lengthBars?: number; transpose?: number;
}): MidiNote[] {
  return notes.map((note) => ids.has(note.id) ? {
    ...note,
    ...(edit.velocity === undefined ? {} : { velocity: clamp(Math.round(edit.velocity), 1, 127) }),
    ...(edit.lengthBars === undefined ? {} : { lengthBars: Math.max(1 / 1024, edit.lengthBars) }),
    ...(edit.transpose === undefined ? {} : { pitch: clamp(note.pitch + Math.round(edit.transpose), 0, 127) }),
  } : note);
}

export function humanizeNotes(notes: MidiNote[], ids: Set<string>, timingBars: number, velocityAmount: number, random = Math.random): MidiNote[] {
  const timing = clamp(timingBars, 0, 1);
  const velocity = clamp(velocityAmount, 0, 127);
  return notes.map((note) => ids.has(note.id) ? {
    ...note,
    startBars: Math.max(0, note.startBars + (random() * 2 - 1) * timing),
    velocity: clamp(Math.round(note.velocity + (random() * 2 - 1) * velocity), 1, 127),
  } : note);
}
