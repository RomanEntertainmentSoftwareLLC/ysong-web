import type { GeneratedMidiRegion, GeneratedSessionManifest } from "./generatedSession";

/** Versioned, provider-neutral result carried by a YSong project and its library record.
 * Bars are one-based at the project boundary; MIDI note starts are relative to a region.
 * Every ready part shares this immutable timebase and spans the same arrangement range.
 */
export type SongGenerationTimebase = {
  bpm: number;
  sigNum: number;
  sigDen: number;
  startBar: 1;
  totalBars: number;
};

export type SongGenerationPart = {
  id: string;
  name: string;
  role: string;
  kind: "audio" | "midi";
  status: "ready" | "failed";
  audio?: { objectKey: string; startBar: 1; lengthBars: number; sourceOffsetSec: 0; durationSec?: number };
  midi?: { regions: GeneratedMidiRegion[] };
  failure?: { code: "generation_failed" | "upload_failed"; message: string };
};

export type SongGenerationResult = {
  v: 1;
  id: string;
  status: "complete" | "partial" | "failed";
  createdAt: number;
  timebase: SongGenerationTimebase;
  source: { origin: string; prompt: string; seed?: number };
  model: { provider: string; name: string };
  parts: SongGenerationPart[];
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Validates persisted/imported data and copies only project-facing fields. */
export function parseSongGenerationResult(value: unknown): SongGenerationResult | null {
  if (!record(value) || value.v !== 1 || !nonempty(value.id) || !positive(value.createdAt) ||
      !record(value.timebase) || !record(value.source) || !record(value.model) || !Array.isArray(value.parts)) return null;
  const time = value.timebase;
  if (!positive(time.bpm) || !Number.isInteger(time.sigNum) || !positive(time.sigNum) ||
      !Number.isInteger(time.sigDen) || !positive(time.sigDen) || time.startBar !== 1 ||
      !Number.isInteger(time.totalBars) || !positive(time.totalBars)) return null;
  if (!nonempty(value.source.origin) || typeof value.source.prompt !== "string" ||
      (value.source.seed !== undefined && (!Number.isInteger(value.source.seed) || !Number.isFinite(value.source.seed))) ||
      !nonempty(value.model.provider) || !nonempty(value.model.name)) return null;
  const parts: SongGenerationPart[] = [];
  const ids = new Set<string>();
  for (const item of value.parts) {
    if (!record(item) || !nonempty(item.id) || ids.has(item.id) || !nonempty(item.name) || !nonempty(item.role) ||
        (item.kind !== "audio" && item.kind !== "midi") || (item.status !== "ready" && item.status !== "failed")) return null;
    ids.add(item.id);
    const base = { id: item.id, name: item.name, role: item.role, kind: item.kind, status: item.status } as SongGenerationPart;
    if (item.status === "failed") {
      if (item.audio !== undefined || item.midi !== undefined || !record(item.failure) ||
          (item.failure.code !== "generation_failed" && item.failure.code !== "upload_failed") || !nonempty(item.failure.message)) return null;
      base.failure = { code: item.failure.code, message: item.failure.message };
    } else if (item.kind === "audio") {
      if (item.midi !== undefined || item.failure !== undefined || !record(item.audio) || !nonempty(item.audio.objectKey) ||
          item.audio.startBar !== 1 || item.audio.lengthBars !== time.totalBars || item.audio.sourceOffsetSec !== 0 ||
          (item.audio.durationSec !== undefined && !positive(item.audio.durationSec))) return null;
      base.audio = { objectKey: item.audio.objectKey, startBar: 1, lengthBars: time.totalBars, sourceOffsetSec: 0,
        ...(item.audio.durationSec === undefined ? {} : { durationSec: item.audio.durationSec }) };
    } else {
      if (item.audio !== undefined || item.failure !== undefined || !record(item.midi) || !Array.isArray(item.midi.regions)) return null;
      const regions: GeneratedMidiRegion[] = [];
      for (const region of item.midi.regions) {
        if (!record(region) || !positive(region.startBar) || !positive(region.lengthBars) || !Array.isArray(region.notes) ||
            (region.repeatCount !== undefined && (!Number.isInteger(region.repeatCount) || !positive(region.repeatCount)))) return null;
        const notes = [];
        for (const note of region.notes) {
          if (!record(note) || !Number.isInteger(note.pitch) || (note.pitch as number) < 0 || (note.pitch as number) > 127 ||
              typeof note.startBars !== "number" || !Number.isFinite(note.startBars) || note.startBars < 0 ||
              !positive(note.lengthBars) || !Number.isInteger(note.velocity) || (note.velocity as number) < 1 || (note.velocity as number) > 127) return null;
          notes.push({ pitch: note.pitch as number, startBars: note.startBars, lengthBars: note.lengthBars, velocity: note.velocity as number });
        }
        regions.push({ startBar: region.startBar, lengthBars: region.lengthBars, ...(region.repeatCount === undefined ? {} : { repeatCount: region.repeatCount as number }), notes });
      }
      base.midi = { regions };
    }
    parts.push(base);
  }
  const ready = parts.filter((part) => part.status === "ready").length;
  const expected = ready === parts.length ? "complete" : ready === 0 ? "failed" : "partial";
  if (!parts.length || value.status !== expected) return null;
  return { v: 1, id: value.id, status: expected, createdAt: value.createdAt,
    timebase: { bpm: time.bpm, sigNum: time.sigNum as number, sigDen: time.sigDen as number, startBar: 1, totalBars: time.totalBars as number },
    source: { origin: value.source.origin, prompt: value.source.prompt, ...(value.source.seed === undefined ? {} : { seed: value.source.seed as number }) },
    model: { provider: value.model.provider, name: value.model.name }, parts };
}

/** Create Song adapter: provider responses are reduced to stable asset and MIDI references. */
export function resultFromGeneratedSession(
  manifest: GeneratedSessionManifest,
  source: SongGenerationResult["source"],
  model: SongGenerationResult["model"],
  failures: ReadonlyMap<string, { code: "generation_failed" | "upload_failed"; message: string }> = new Map(),
): SongGenerationResult {
  const result: SongGenerationResult = {
    v: 1, id: manifest.sessionId || crypto.randomUUID(), status: "complete", createdAt: manifest.createdAt,
    timebase: { bpm: manifest.bpm, sigNum: manifest.sigNum, sigDen: manifest.sigDen, startBar: 1, totalBars: manifest.totalBars },
    source, model,
    parts: manifest.tracks.map((track) => {
      const base = { id: track.id, name: track.name, role: track.role, kind: track.mode };
      const failure = failures.get(track.id);
      if (failure) return { ...base, status: "failed", failure } as SongGenerationPart;
      if (track.mode === "audio") {
        if (!track.objectKey) return { ...base, status: "failed", failure: { code: "generation_failed", message: "No saved audio asset." } } as SongGenerationPart;
        return { ...base, status: "ready", audio: { objectKey: track.objectKey, startBar: 1, lengthBars: manifest.totalBars, sourceOffsetSec: 0, ...(track.durationSec ? { durationSec: track.durationSec } : {}) } } as SongGenerationPart;
      }
      return { ...base, status: "ready", midi: { regions: track.midiRegions ?? [] } } as SongGenerationPart;
    }),
  };
  const ready = result.parts.filter((part) => part.status === "ready").length;
  result.status = ready === result.parts.length ? "complete" : ready ? "partial" : "failed";
  const parsed = parseSongGenerationResult(result);
  if (!parsed) throw new Error("Generated session does not satisfy the project generation contract.");
  return parsed;
}
