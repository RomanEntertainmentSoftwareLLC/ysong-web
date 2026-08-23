export type BuiltinInstrument = "sine" | "triangle" | "sawtooth" | "square" | "pluck" | "warm-pad";

export type MidiNote = {
  id: string;
  pitch: number; // MIDI 0..127
  startBars: number; // relative to clip start
  lengthBars: number;
  velocity: number; // 1..127
};

export type MidiAutomationPoint = {
  id: string;
  atBars: number; // relative to clip start
  value: number;
};

export type MidiScaleId =
  | "chromatic"
  | "major"
  | "natural-minor"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "locrian"
  | "harmonic-minor"
  | "melodic-minor"
  | "phrygian-dominant"
  | "major-pentatonic"
  | "minor-pentatonic"
  | "blues";

export type MidiScaleRule = {
  id: string;
  root: number; // pitch class 0..11
  scaleId: MidiScaleId;
};

export type MidiScaleLock = "off" | "soft" | "strict";

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export const SCALE_DEFINITIONS: Array<{ id: MidiScaleId; label: string; friendlyLabel?: string; intervals: number[] }> = [
  { id: "chromatic", label: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: "major", label: "Major / Ionian", friendlyLabel: "Major (Ionian)", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "natural-minor", label: "Natural Minor / Aeolian", friendlyLabel: "Minor (Aeolian)", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "dorian", label: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "phrygian", label: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: "lydian", label: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "mixolydian", label: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "locrian", label: "Locrian", intervals: [0, 1, 3, 5, 6, 8, 10] },
  { id: "harmonic-minor", label: "Harmonic Minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: "melodic-minor", label: "Melodic Minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: "phrygian-dominant", label: "Phrygian Dominant", intervals: [0, 1, 4, 5, 7, 8, 10] },
  { id: "major-pentatonic", label: "Major Pentatonic", intervals: [0, 2, 4, 7, 9] },
  { id: "minor-pentatonic", label: "Minor Pentatonic", intervals: [0, 3, 5, 7, 10] },
  { id: "blues", label: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
];

export const BUILTIN_INSTRUMENTS: Array<{ id: BuiltinInstrument; label: string }> = [
  { id: "sine", label: "YSong Sine" },
  { id: "triangle", label: "YSong Triangle" },
  { id: "sawtooth", label: "YSong Saw" },
  { id: "square", label: "YSong Square" },
  { id: "pluck", label: "YSong Pluck" },
  { id: "warm-pad", label: "YSong Warm Pad" },
];

// General MIDI Level 1 program map. MIDI stores program numbers as 0..127,
// while musicians usually see them displayed as 1..128. YSong keeps the raw
// 0-based program number in project data so imported .mid program changes can
// map directly onto instrument tracks without translation hacks.
export const GM_PROGRAM_NAMES = [
  "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano",
  "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
  "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)",
  "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
  "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass",
  "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
  "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2",
  "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
  "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
  "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
  "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)",
  "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
  "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)",
  "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
  "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)",
  "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
  "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bag Pipe", "Fiddle", "Shanai",
  "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot",
] as const;

export type GmProgram = number; // clamped to 0..127 by helpers below

export const GM_PROGRAMS = GM_PROGRAM_NAMES.map((label, program) => ({
  program,
  number: program + 1,
  label,
}));

export function normalizeGmProgram(program: number | undefined | null) {
  return Math.max(0, Math.min(127, Math.round(Number(program ?? 0) || 0)));
}

export function midiToName(midi: number) {
  const n = Math.max(0, Math.min(127, Math.round(midi)));
  const octave = Math.floor(n / 12) - 1;
  return `${NOTE_NAMES[n % 12]}${octave}`;
}


function scaleIntervals(scaleId: MidiScaleId) {
  return SCALE_DEFINITIONS.find((x) => x.id === scaleId)?.intervals ?? SCALE_DEFINITIONS[0].intervals;
}

export function pitchAllowedByScales(pitch: number, rules: MidiScaleRule[]) {
  if (!rules.length) return true;
  const pc = ((Math.round(pitch) % 12) + 12) % 12;
  return rules.some((rule) => {
    const rel = ((pc - rule.root) % 12 + 12) % 12;
    return scaleIntervals(rule.scaleId).includes(rel);
  });
}

export function nearestAllowedPitch(pitch: number, rules: MidiScaleRule[]) {
  const p = Math.max(0, Math.min(127, Math.round(pitch)));
  if (!rules.length || pitchAllowedByScales(p, rules)) return p;
  for (let distance = 1; distance <= 12; distance++) {
    const down = p - distance;
    const up = p + distance;
    if (down >= 0 && pitchAllowedByScales(down, rules)) return down;
    if (up <= 127 && pitchAllowedByScales(up, rules)) return up;
  }
  return p;
}

export function interpolateAutomation(points: MidiAutomationPoint[] | undefined, atBars: number, fallback = 0) {
  if (!points?.length) return fallback;
  const sorted = [...points].sort((a, b) => a.atBars - b.atBars);
  if (atBars <= sorted[0].atBars) return sorted[0].value;
  if (atBars >= sorted[sorted.length - 1].atBars) return sorted[sorted.length - 1].value;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (atBars <= b.atBars) {
      const t = (atBars - a.atBars) / Math.max(1e-9, b.atBars - a.atBars);
      return a.value + (b.value - a.value) * t;
    }
  }
  return fallback;
}
