import type { MidiAutomationPoint, MidiNote } from "./midi";
import type { SingerIdentity } from "./singerLibrary";

export type VocalSetup = {
  v: 1;
  singer?: SingerIdentity;
  lyrics: Record<string, string>; // Stable MIDI note IDs, one syllable per note.
  request?: VocalRenderRequest;
};
export type VocalSource = {
  id: string;
  trackId: string;
  startBar: number;
  lengthBars: number;
  assetId?: string;
  midiNotes?: MidiNote[];
  midiPitchBend?: MidiAutomationPoint[];
  midiModulation?: MidiAutomationPoint[];
  midiBendRange?: number;
  partGeneration?: unknown;
};
export type VocalTimebase = { bpm: number; sigNum: number; sigDen: number };
export type VocalRenderRequest = {
  v: 1;
  status: "unavailable";
  reason: "No singing synthesis engine is connected.";
  singer: SingerIdentity;
  source: VocalSource;
  timebase: VocalTimebase;
  startSeconds: number;
  durationSeconds: number;
  notes: Array<MidiNote & { syllable: string; startSeconds: number; durationSeconds: number }>;
};

const finite = (n: number) => Number.isFinite(n);
/** Pure preparation boundary. Never produces audio or calls a provider. */
export function prepareVocalRequest(source: VocalSource, time: VocalTimebase, setup: VocalSetup): VocalRenderRequest {
  if (setup.v !== 1 || !setup.singer?.id?.trim() || !setup.singer.displayName?.trim()) throw new Error("Choose a saved singer first.");
  if (!finite(time.bpm) || time.bpm <= 0 || !Number.isInteger(time.sigNum) || time.sigNum <= 0 ||
      ![1, 2, 4, 8, 16, 32].includes(time.sigDen)) throw new Error("Invalid project tempo or time signature.");
  if (source.assetId || !source.id || !source.trackId || !finite(source.startBar) || source.startBar < 1 ||
      !finite(source.lengthBars) || source.lengthBars <= 0 || !source.midiNotes?.length) throw new Error("Select a nonempty MIDI clip.");
  const ordered = [...source.midiNotes].sort((a, b) => a.startBars - b.startBars || a.id.localeCompare(b.id));
  const ids = new Set<string>();
  let end = 0;
  const secondsPerBar = 60 / time.bpm * time.sigNum * 4 / time.sigDen;
  const notes = ordered.map((note) => {
    if (!note.id || ids.has(note.id) || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127 ||
        !Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127 || !finite(note.startBars) || note.startBars < 0 ||
        !finite(note.lengthBars) || note.lengthBars <= 0 || note.startBars + note.lengthBars > source.lengthBars + 1e-9) throw new Error("MIDI notes must be valid and fit inside the clip.");
    if (note.startBars < end - 1e-9) throw new Error("Use a monophonic melody: notes must not overlap.");
    ids.add(note.id); end = note.startBars + note.lengthBars;
    const syllable = setup.lyrics[note.id]?.trim();
    if (!syllable) throw new Error("Enter a syllable for every note (use ah for wordless singing).");
    return { ...note, syllable, startSeconds: note.startBars * secondsPerBar, durationSeconds: note.lengthBars * secondsPerBar };
  });
  for (const lane of [source.midiPitchBend, source.midiModulation]) {
    if (lane?.some((p) => !finite(p.atBars) || p.atBars < 0 || p.atBars > source.lengthBars || !finite(p.value))) throw new Error("Invalid MIDI expression timing.");
  }
  if (source.midiBendRange !== undefined && (!finite(source.midiBendRange) || source.midiBendRange <= 0)) throw new Error("Invalid pitch bend range.");
  // Whitelist source fields: no recursive request/setup, audio blobs, or provider credentials.
  return structuredClone({ v: 1, status: "unavailable", reason: "No singing synthesis engine is connected.",
    singer: setup.singer, source: { id: source.id, trackId: source.trackId, startBar: source.startBar, lengthBars: source.lengthBars,
      midiNotes: ordered, midiPitchBend: source.midiPitchBend, midiModulation: source.midiModulation,
      midiBendRange: source.midiBendRange, partGeneration: source.partGeneration },
    timebase: time, startSeconds: (source.startBar - 1) * secondsPerBar, durationSeconds: source.lengthBars * secondsPerBar, notes });
}

export function vocalRequestIsCurrent(source: VocalSource, time: VocalTimebase, setup: VocalSetup): boolean {
  if (!setup.request) return false;
  try { return JSON.stringify(setup.request) === JSON.stringify(prepareVocalRequest(source, time, setup)); }
  catch { return false; }
}

/** Paste creates new note IDs. Keep lyric alignment, but never copy a render claim. */
export function copyVocalSetup(setup: VocalSetup | undefined, before: MidiNote[], after: MidiNote[]): VocalSetup | undefined {
  if (!setup) return undefined;
  return structuredClone({ v: 1, singer: setup.singer,
    lyrics: Object.fromEntries(after.map((note, index) => [note.id, setup.lyrics[before[index]?.id] ?? ""])) });
}
