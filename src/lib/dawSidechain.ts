import { DAW_AUX_IDS, normalizeMixerStrip } from "./dawMixer.ts";

export type SidechainSource = { kind: "track" | "aux"; id: string };
export type SidechainRoute = { source: SidechainSource; targetTrackId: string; deviceId: string };
export type SidechainTrack = { id: string; mixer?: unknown };

export function normalizeSidechainSource(raw: unknown): SidechainSource | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.kind !== "track" && value.kind !== "aux") return null;
  if (typeof value.id !== "string" || !value.id.trim()) return null;
  if (value.kind === "aux" && !DAW_AUX_IDS.includes(value.id)) return null;
  return { kind: value.kind, id: value.id };
}

// All aux returns feed master. A destination cannot listen to a bus that it
// feeds through its output or an active send.
export function sidechainRouteError(route: SidechainRoute, tracks: SidechainTrack[]): string | null {
  const target = tracks.find((track) => track.id === route.targetTrackId);
  if (!target || !route.deviceId) return "Missing sidechain destination";
  const source = route.source;
  if (source.kind === "track") {
    const sender = tracks.find((track) => track.id === source.id);
    if (!sender) return "Missing sidechain source";
    if (sender.id === target.id) return "A device cannot sidechain from its own track";
  } else {
    if (!DAW_AUX_IDS.includes(source.id)) return "Missing sidechain bus";
    const mixer = normalizeMixerStrip(target.mixer);
    if (mixer.output === source.id || mixer.sends[DAW_AUX_IDS.indexOf(source.id)].level > 0)
      return "Destination feeds its sidechain bus";
  }
  return null;
}

export function normalizeSidechainRoute(raw: unknown, targetTrackId: string, deviceId: string, tracks: SidechainTrack[]): SidechainRoute | null {
  if (!raw || typeof raw !== "object") return null;
  const source = normalizeSidechainSource((raw as Record<string, unknown>).source);
  if (!source) return null;
  const route = { source, targetTrackId, deviceId };
  return sidechainRouteError(route, tracks) ? null : route;
}

export function sidechainSupport(deviceType: string): "unsupported" {
  // Neither Web Audio DynamicsCompressorNode nor the current Bridge effect
  // contract exposes a separate detector input. Keep routes inert until one does.
  void deviceType;
  return "unsupported";
}

export function validateProjectSidechains<T extends SidechainTrack & { effects?: { id: string; sidechainSource?: SidechainSource }[] }>(tracks: T[]): T[] {
  return tracks.map((track) => ({
    ...track,
    effects: track.effects?.map((effect) => {
      if (!effect.sidechainSource) return effect;
      const valid = normalizeSidechainRoute({ source: effect.sidechainSource }, track.id, effect.id, tracks);
      if (valid) return effect;
      const { sidechainSource: _removed, ...safeEffect } = effect;
      void _removed;
      return safeEffect;
    }),
  }));
}
