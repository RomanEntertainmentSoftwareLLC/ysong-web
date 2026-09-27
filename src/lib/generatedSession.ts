import type { MidiScaleId } from "./midi";
import type { InstrumentRoleIntent } from "./bridgeApi";

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

export type GeneratedInstrumentResolution = {
  status: "resolved" | "weak" | "ambiguous" | "no-match" | "unavailable";
  source: "bridge-match" | "legacy-path" | "none";
  instrumentId?: string;
  score?: number;
  evidence?: Array<{ dimension: string; requested: string; matched: string; source: string; points: number }>;
  reasons?: string[];
  weakEvidence?: boolean;
  message?: string;
};

export type GeneratedSessionTrack = {
  id: string;
  name: string;
  role: string;
  vocalRole?: "lead vocal" | "harmony vocal" | "backing vocal" | "vocal double" | "ad-lib vocal" | "ensemble vocal";
  mode: "audio" | "midi";
  instructions: string;
  useLyrics?: boolean;
  objectKey?: string;
  durationSec?: number;
  vst?: GeneratedVstChoice;
  instrumentIntent?: InstrumentRoleIntent;
  desiredInstrument?: string;
  presetHint?: string;
  instrumentResolution?: GeneratedInstrumentResolution;
  gmProgram?: number;
  midiRegions?: GeneratedMidiRegion[];
};

export function classifyVocalRole(role: string): GeneratedSessionTrack["vocalRole"] {
  const value = role.toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(ad lib|adlib|vocal run|vocal riff)s?\b/.test(value)) return "ad-lib vocal";
  if (/\b(double|doubled|doubling)s?\b/.test(value)) return "vocal double";
  if (/\b(harmon(y|ies)|harmonized)\b/.test(value)) return "harmony vocal";
  if (/\b(choir|ensemble|group|gang|chorus vocal)s?\b/.test(value)) return "ensemble vocal";
  if (/\b(backing|background|backup|back up)\b/.test(value)) return "backing vocal";
  if (/\b(lead|main|primary)\b.*\b(vocal|voice|sing)|\b(vocal|voice|sing)\b.*\b(lead|main|primary)\b/.test(value)) return "lead vocal";
  return undefined;
}

export type GeneratedSongSection = {
  name: string;
  startBar: number;
  endBar: number;
};

export type GeneratedSessionManifest = {
  v: 1;
  sessionId?: string;
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
