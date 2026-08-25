import type { DawMixerStripState } from "./dawMixer";

export type DawSessionTrackSnapshot = {
  id: string;
  type: "audio" | "instrument";
  name: string;
  mute: boolean;
  solo: boolean;
  arm: boolean;
  level: number;
  meter: number;
  instrumentLabel?: string;
  presetHint?: string;
  desktopVstUnavailable?: boolean;
  effects: { id: string; name: string; enabled: boolean }[];
  mixer: DawMixerStripState;
};

export type DawSessionSnapshot = {
  projectName: string;
  playing: boolean;
  playheadBar: number;
  bpm: number;
  sigNum: number;
  sigDen: number;
  bridgeAvailable: boolean | null;
  selectedTrackId: string | null;
  tracks: DawSessionTrackSnapshot[];
  masterLevel: number;
  masterMeter: number;
};

export type DawSessionCommand =
  | { type: "set-level"; trackId: string; value: number }
  | { type: "set-mute"; trackId: string; value: boolean }
  | { type: "set-solo"; trackId: string; value: boolean }
  | { type: "set-mixer"; trackId: string; patch: Partial<DawMixerStripState> }
  | { type: "set-send"; trackId: string; index: number; level?: number; pre?: boolean }
  | { type: "set-master-level"; value: number }
  | { type: "transport-toggle" }
  | { type: "transport-stop" }
  | { type: "open-track-fx"; trackId: string }
  | { type: "set-bpm"; value: number }
  | { type: "select-track"; trackId: string }
  | { type: "rename-track"; trackId: string; name: string }
  | { type: "create-track"; kind: "audio" | "instrument"; name?: string }
  | { type: "add-c1"; trackId: string };

const SNAPSHOT_EVENT = "ysong:daw-session-snapshot";
const COMMAND_EVENT = "ysong:daw-session-command";
let latestSnapshot: DawSessionSnapshot | null = null;

export function publishDawSessionSnapshot(snapshot: DawSessionSnapshot) {
  latestSnapshot = snapshot;
  window.dispatchEvent(new CustomEvent<DawSessionSnapshot>(SNAPSHOT_EVENT, { detail: snapshot }));
}

export function getLatestDawSessionSnapshot() {
  return latestSnapshot;
}

export function subscribeDawSessionSnapshot(listener: (snapshot: DawSessionSnapshot) => void) {
  if (latestSnapshot) listener(latestSnapshot);
  const handler = (event: Event) => listener((event as CustomEvent<DawSessionSnapshot>).detail);
  window.addEventListener(SNAPSHOT_EVENT, handler);
  return () => window.removeEventListener(SNAPSHOT_EVENT, handler);
}

export function sendDawSessionCommand(command: DawSessionCommand) {
  window.dispatchEvent(new CustomEvent<DawSessionCommand>(COMMAND_EVENT, { detail: command }));
}

export function subscribeDawSessionCommands(listener: (command: DawSessionCommand) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<DawSessionCommand>).detail);
  window.addEventListener(COMMAND_EVENT, handler);
  return () => window.removeEventListener(COMMAND_EVENT, handler);
}
