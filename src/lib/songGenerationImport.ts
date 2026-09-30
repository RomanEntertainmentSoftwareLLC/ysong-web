import { parseSongGenerationResult, type SongGenerationResult } from "./songGenerationContract.ts";
import type { GeneratedMidiNote } from "./generatedSession.ts";

export type SongGenerationImportPart = {
  id: string;
  name: string;
  role: string;
  kind: "audio" | "midi";
  audio?: { objectKey: string; durationSec?: number; startBar: 1; lengthBars: number };
  midiClips?: Array<{ startBar: number; lengthBars: number; notes: GeneratedMidiNote[] }>;
};

/** Validate at the import boundary, then expand only ready parts on the shared bar grid. */
export function planSongGenerationImport(value: unknown): { result: SongGenerationResult; parts: SongGenerationImportPart[] } | null {
  const result = parseSongGenerationResult(value);
  if (!result || result.status === "failed") return null;
  const parts: SongGenerationImportPart[] = [];
  for (const part of result.parts) {
    if (part.status !== "ready") continue;
    if (part.kind === "audio" && part.audio) {
      parts.push({ id: part.id, name: part.name, role: part.role, kind: "audio",
        audio: { objectKey: part.audio.objectKey, durationSec: part.audio.durationSec, startBar: 1, lengthBars: result.timebase.totalBars } });
    } else if (part.kind === "midi" && part.midi) {
      const midiClips: NonNullable<SongGenerationImportPart["midiClips"]> = [];
      for (const region of part.midi.regions) {
        for (let repeat = 0; repeat < (region.repeatCount ?? 1); repeat++) {
          const startBar = region.startBar + repeat * region.lengthBars;
          if (startBar >= result.timebase.totalBars + 1) break;
          const lengthBars = Math.min(region.lengthBars, result.timebase.totalBars + 1 - startBar);
          midiClips.push({ startBar, lengthBars, notes: region.notes
            .filter((note) => note.startBars < lengthBars)
            .map((note) => ({ ...note, lengthBars: Math.min(note.lengthBars, lengthBars - note.startBars) })) });
        }
      }
      parts.push({ id: part.id, name: part.name, role: part.role, kind: "midi", midiClips });
    }
  }
  return parts.length ? { result, parts } : null;
}
