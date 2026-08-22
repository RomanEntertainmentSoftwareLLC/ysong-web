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

export type GmPreviewPartial = {
  ratio: number;
  gain: number;
  oscillator?: OscillatorType;
  detuneCents?: number;
};

export type GmPreviewProfile = {
  family: string;
  partials: GmPreviewPartial[];
  filterHz: number;
  filterQ: number;
  attack: number;
  release: number;
  // When present, the voice naturally decays even while the key remains held.
  // This is what makes piano/guitar/mallet previews behave like struck/plucked
  // instruments instead of the old endless generic oscillator.
  decay?: number;
  sustain?: number;
  vibratoHz?: number;
  vibratoCents?: number;
};

// Dependency-free browser fallback used only when no native VST is assigned.
// This is still a synthesised preview rather than a multi-gigabyte sample bank,
// but the timbre/envelope now follows the selected GM family: pianos are struck
// additive voices, organs use drawbar-like harmonics, guitars/basses decay,
// strings/choirs swell, brass/reeds carry brighter harmonic spectra, etc.
export function gmPreviewProfile(programRaw: number): GmPreviewProfile {
  const p = normalizeGmProgram(programRaw);
  const family = Math.floor(p / 8);

  if (family === 0) { // Piano
    const bright = p === 1 || p === 3;
    return {
      family: "Piano",
      partials: [
        { ratio: 1, gain: 1, oscillator: "sine" },
        { ratio: 2, gain: bright ? 0.48 : 0.36, oscillator: "sine" },
        { ratio: 3, gain: bright ? 0.24 : 0.16, oscillator: "sine" },
        { ratio: 4, gain: 0.10, oscillator: "sine" },
        { ratio: 6, gain: 0.045, oscillator: "sine" },
      ],
      filterHz: bright ? 9800 : 7600, filterQ: 0.35, attack: 0.0025, release: 0.16, decay: p >= 4 ? 1.5 : 1.15, sustain: 0.035,
    };
  }

  if (family === 1) { // Chromatic percussion
    const bellLike = p === 8 || p === 9 || p === 10 || p === 14;
    return {
      family: "Chromatic Percussion",
      partials: bellLike
        ? [{ ratio: 1, gain: 1, oscillator: "sine" }, { ratio: 2.76, gain: 0.42, oscillator: "sine" }, { ratio: 5.4, gain: 0.16, oscillator: "sine" }]
        : [{ ratio: 1, gain: 1, oscillator: "sine" }, { ratio: 2, gain: 0.24, oscillator: "sine" }, { ratio: 3, gain: 0.10, oscillator: "triangle" }],
      filterHz: 11000, filterQ: 0.25, attack: 0.0015, release: bellLike ? 0.9 : 0.24, decay: bellLike ? 2.4 : 0.72, sustain: 0.012,
    };
  }

  if (family === 2) { // Organ
    const church = p === 19;
    return {
      family: "Organ",
      partials: church
        ? [{ ratio: 0.5, gain: 0.20, oscillator: "sine" }, { ratio: 1, gain: 1, oscillator: "sine" }, { ratio: 2, gain: 0.72, oscillator: "sine" }, { ratio: 3, gain: 0.38, oscillator: "sine" }, { ratio: 4, gain: 0.26, oscillator: "sine" }]
        : [{ ratio: 0.5, gain: 0.14, oscillator: "sine" }, { ratio: 1, gain: 1, oscillator: "sine" }, { ratio: 2, gain: 0.58, oscillator: "sine" }, { ratio: 3, gain: 0.24, oscillator: "sine" }, { ratio: 4, gain: 0.16, oscillator: "sine" }, { ratio: 6, gain: 0.08, oscillator: "sine" }],
      filterHz: church ? 6200 : 9000, filterQ: 0.3, attack: 0.008, release: church ? 0.38 : 0.10, sustain: 0.92, vibratoHz: p === 16 || p === 17 ? 6.2 : undefined, vibratoCents: p === 16 || p === 17 ? 5 : undefined,
    };
  }

  if (family === 3) { // Guitar
    const distorted = p >= 29;
    return {
      family: "Guitar",
      partials: distorted
        ? [{ ratio: 1, gain: 1, oscillator: "sawtooth" }, { ratio: 2, gain: 0.22, oscillator: "square", detuneCents: 2 }]
        : [{ ratio: 1, gain: 1, oscillator: "triangle" }, { ratio: 2, gain: 0.30, oscillator: "sine" }, { ratio: 3, gain: 0.12, oscillator: "sine" }],
      filterHz: distorted ? 5200 : 6800, filterQ: distorted ? 0.9 : 0.45, attack: 0.0018, release: 0.14, decay: distorted ? 1.4 : 0.72, sustain: distorted ? 0.18 : 0.025,
    };
  }

  if (family === 4) { // Bass
    return {
      family: "Bass",
      partials: [{ ratio: 1, gain: 1, oscillator: p >= 38 ? "sawtooth" : "triangle" }, { ratio: 2, gain: 0.22, oscillator: "sine" }, { ratio: 0.5, gain: 0.10, oscillator: "sine" }],
      filterHz: p >= 38 ? 2600 : 1900, filterQ: 0.65, attack: 0.003, release: 0.12, decay: p === 32 ? 0.85 : undefined, sustain: p === 32 ? 0.06 : 0.78,
    };
  }

  if (family === 5) { // Solo strings / harp / timpani
    if (p === 45) return { family: "Pizzicato Strings", partials: [{ ratio: 1, gain: 1, oscillator: "triangle" }, { ratio: 2, gain: 0.28, oscillator: "sine" }], filterHz: 6200, filterQ: 0.4, attack: 0.002, release: 0.13, decay: 0.52, sustain: 0.02 };
    if (p === 46) return { family: "Harp", partials: [{ ratio: 1, gain: 1, oscillator: "triangle" }, { ratio: 2, gain: 0.30, oscillator: "sine" }, { ratio: 3, gain: 0.12, oscillator: "sine" }], filterHz: 7600, filterQ: 0.3, attack: 0.002, release: 0.30, decay: 1.55, sustain: 0.02 };
    if (p === 47) return { family: "Timpani", partials: [{ ratio: 0.5, gain: 0.55, oscillator: "sine" }, { ratio: 1, gain: 1, oscillator: "triangle" }], filterHz: 1800, filterQ: 1.0, attack: 0.002, release: 0.20, decay: 0.72, sustain: 0.01 };
    return {
      family: "Strings",
      partials: [{ ratio: 1, gain: 1, oscillator: "sawtooth", detuneCents: -3 }, { ratio: 1, gain: 0.72, oscillator: "sawtooth", detuneCents: 3 }, { ratio: 2, gain: 0.12, oscillator: "sine" }],
      filterHz: 4700, filterQ: 0.45, attack: p === 44 ? 0.028 : 0.055, release: 0.34, sustain: 0.82, vibratoHz: 5.2, vibratoCents: 4,
    };
  }

  if (family === 6) { // Ensembles / choir
    const choir = p >= 52 && p <= 54;
    return {
      family: choir ? "Choir" : "String Ensemble",
      partials: choir
        ? [{ ratio: 1, gain: 1, oscillator: "sine", detuneCents: -4 }, { ratio: 1, gain: 0.86, oscillator: "triangle", detuneCents: 4 }, { ratio: 2, gain: 0.16, oscillator: "sine" }]
        : [{ ratio: 1, gain: 1, oscillator: "sawtooth", detuneCents: -5 }, { ratio: 1, gain: 0.72, oscillator: "sawtooth", detuneCents: 5 }],
      filterHz: choir ? 3300 : 4400, filterQ: choir ? 1.05 : 0.55, attack: choir ? 0.13 : 0.09, release: 0.48, sustain: 0.80, vibratoHz: choir ? 5.0 : 5.4, vibratoCents: choir ? 3 : 4,
    };
  }

  if (family === 7) { // Brass
    return { family: "Brass", partials: [{ ratio: 1, gain: 1, oscillator: "sawtooth" }, { ratio: 1, gain: 0.25, oscillator: "square", detuneCents: 2 }], filterHz: p === 58 ? 2600 : 5200, filterQ: 0.8, attack: 0.018, release: 0.16, sustain: 0.82, vibratoHz: 5.1, vibratoCents: 2.5 };
  }

  if (family === 8) { // Reed
    return { family: "Reed", partials: [{ ratio: 1, gain: 1, oscillator: "square" }, { ratio: 2, gain: 0.18, oscillator: "sawtooth" }], filterHz: 4300, filterQ: 1.1, attack: 0.018, release: 0.14, sustain: 0.78, vibratoHz: 5.3, vibratoCents: 4 };
  }

  if (family === 9) { // Pipe
    return { family: "Pipe", partials: [{ ratio: 1, gain: 1, oscillator: "sine" }, { ratio: 2, gain: 0.16, oscillator: "triangle" }], filterHz: 7800, filterQ: 0.28, attack: 0.026, release: 0.18, sustain: 0.84, vibratoHz: 5.0, vibratoCents: 3 };
  }

  if (family === 10) { // Synth lead
    return { family: "Synth Lead", partials: [{ ratio: 1, gain: 1, oscillator: p % 2 ? "sawtooth" : "square" }, { ratio: 1, gain: 0.32, oscillator: "sawtooth", detuneCents: 7 }], filterHz: 7200, filterQ: 0.7, attack: 0.004, release: 0.12, sustain: 0.88, vibratoHz: 5.8, vibratoCents: 5 };
  }

  if (family === 11) { // Synth pad
    return { family: "Synth Pad", partials: [{ ratio: 1, gain: 1, oscillator: "sawtooth", detuneCents: -8 }, { ratio: 1, gain: 0.90, oscillator: "triangle", detuneCents: 8 }, { ratio: 2, gain: 0.12, oscillator: "sine" }], filterHz: p === 93 ? 6200 : 2800, filterQ: 0.9, attack: 0.20, release: 0.65, sustain: 0.78, vibratoHz: 4.6, vibratoCents: 5 };
  }

  if (family === 12) { // Synth effects
    return { family: "Synth FX", partials: [{ ratio: 1, gain: 1, oscillator: "sine" }, { ratio: 1.5, gain: 0.24, oscillator: "triangle" }, { ratio: 2.01, gain: 0.14, oscillator: "sine" }], filterHz: 5400, filterQ: 1.2, attack: 0.08, release: 0.70, sustain: 0.68, vibratoHz: 3.7, vibratoCents: 10 };
  }

  if (family === 13) { // Ethnic
    return { family: "Ethnic", partials: [{ ratio: 1, gain: 1, oscillator: "triangle" }, { ratio: 2, gain: 0.26, oscillator: "sine" }, { ratio: 3, gain: 0.09, oscillator: "sine" }], filterHz: 6500, filterQ: 0.5, attack: 0.003, release: 0.18, decay: p === 104 || p === 107 ? 0.78 : undefined, sustain: 0.70 };
  }

  if (family === 14) { // Percussive
    return { family: "Percussive", partials: [{ ratio: 1, gain: 1, oscillator: "triangle" }, { ratio: 2.41, gain: 0.24, oscillator: "sine" }], filterHz: 7600, filterQ: 0.4, attack: 0.0015, release: 0.14, decay: 0.42, sustain: 0.015 };
  }

  // GM sound effects are intentionally short synthetic cues in the browser fallback.
  return { family: "Sound FX", partials: [{ ratio: 1, gain: 1, oscillator: "sine" }, { ratio: 1.73, gain: 0.28, oscillator: "triangle" }], filterHz: 9000, filterQ: 0.25, attack: 0.0015, release: 0.20, decay: 0.35, sustain: 0.01 };
}

export function midiToName(midi: number) {
  const n = Math.max(0, Math.min(127, Math.round(midi)));
  const octave = Math.floor(n / 12) - 1;
  return `${NOTE_NAMES[n % 12]}${octave}`;
}

export function midiToFrequency(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
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
