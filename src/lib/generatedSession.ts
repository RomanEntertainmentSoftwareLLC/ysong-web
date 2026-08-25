import type { MidiScaleId } from "./midi";

export type GeneratedMidiNote = {
  pitch: number;
  startBars: number;
  lengthBars: number;
  velocity: number;
};

export type GeneratedMidiRegion = {
  startBar: number;
  lengthBars: number;
  repeatCount?: number;
  notes: GeneratedMidiNote[];
};

export type GeneratedVstChoice = {
  name: string;
  path: string;
  vendor?: string;
  presetHint?: string;
};

export type GeneratedSessionTrack = {
  id: string;
  name: string;
  role: string;
  mode: "audio" | "midi";
  instructions: string;
  useLyrics?: boolean;
  objectKey?: string;
  durationSec?: number;
  vst?: GeneratedVstChoice;
  gmProgram?: number;
  midiRegions?: GeneratedMidiRegion[];
};

export type GeneratedSongSection = {
  name: string;
  startBar: number;
  endBar: number;
};

export type GeneratedSessionManifest = {
  v: 1;
  createdAt: number;
  projectName: string;
  bpm: number;
  keyRoot: number;
  keyLabel: string;
  scaleId: MidiScaleId;
  sigNum: number;
  sigDen: number;
  totalBars: number;
  instrumental: boolean;
  hardConstraints: string[];
  forbidden: string[];
  structuredCaption: string;
  sections: GeneratedSongSection[];
  tracks: GeneratedSessionTrack[];
};

const PENDING_KEY = "ysong:pending-generated-session:v1";

export function stageGeneratedSession(manifest: GeneratedSessionManifest) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(manifest));
  window.dispatchEvent(new CustomEvent("ysong:generated-session-staged", { detail: manifest }));
}

export function peekGeneratedSession(): GeneratedSessionManifest | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GeneratedSessionManifest;
    return parsed?.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function consumeGeneratedSession(): GeneratedSessionManifest | null {
  const manifest = peekGeneratedSession();
  if (manifest) localStorage.removeItem(PENDING_KEY);
  return manifest;
}
