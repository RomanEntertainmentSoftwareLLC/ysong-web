import type { DawSessionSnapshot } from "./dawSessionBus.ts";
import { normalizeFxChainPlan, type FxChainPlan } from "./fxChainPlanner.ts";

export type DawAgentProposal =
  | { kind: "fx-plan"; trackId: string; trackName: string; plan: FxChainPlan }
  | { kind: "arrangement"; summary: string; suggestion: string }
  | { kind: "sound-design"; trackId: string; trackName: string; intent: string };

const short = (value: unknown, max: number) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function buildDawAgentContext(snapshot: DawSessionSnapshot | null) {
  if (!snapshot) return { session: null };
  const selected = snapshot.tracks.find((track) => track.id === snapshot.selectedTrackId);
  const tracks = selected ? [selected, ...snapshot.tracks.filter((track) => track.id !== selected.id).slice(0, 15)] : snapshot.tracks.slice(0, 16);
  return {
    project: { name: short(snapshot.projectName, 100), bpm: snapshot.bpm, meter: `${snapshot.sigNum}/${snapshot.sigDen}`, endBar: snapshot.endBar, playheadBar: snapshot.playheadBar },
    selectedTrackId: selected?.id ?? null,
    trackCount: snapshot.tracks.length,
    tracks: tracks.map((track) => ({
      id: track.id, name: short(track.name, 80), type: track.type, mute: track.mute, solo: track.solo, level: track.level, pan: track.mixer.pan,
      sends: track.mixer.sends.slice(0, 8).map((send) => ({ level: send.level, pre: send.pre })),
      instrument: short(track.instrumentLabel, 80), preset: short(track.presetHint, 80),
      browserEffectsAvailable: !track.nativeVst,
      devices: track.effects.slice(0, 8).map((effect) => ({ name: short(effect.name, 80), type: effect.type, enabled: effect.enabled, parameters: Object.fromEntries(Object.entries(effect.parameters).slice(0, 12)) })),
      clipCount: track.clipCount ?? 0,
    })),
  };
}

export function parseDawAgentReply(reply: string, snapshot: DawSessionSnapshot | null): { message: string; proposals: DawAgentProposal[] } {
  let raw: unknown;
  try { raw = JSON.parse(reply.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { return { message: short(reply, 2000), proposals: [] }; }
  const body = record(raw);
  if (!body) return { message: "I couldn't read that proposal.", proposals: [] };
  const proposals: DawAgentProposal[] = [];
  if (snapshot && Array.isArray(body.proposals)) for (const item of body.proposals.slice(0, 4)) {
    const candidate = record(item);
    if (!candidate) continue;
    if (candidate.kind === "arrangement") {
      const summary = short(candidate.summary, 100), suggestion = short(candidate.suggestion, 600);
      if (summary && suggestion) proposals.push({ kind: "arrangement", summary, suggestion });
      continue;
    }
    const track = snapshot.tracks.find((entry) => entry.id === candidate.trackId);
    if (!track) continue;
    if (candidate.kind === "sound-design" && track.type === "instrument") {
      const intent = short(candidate.intent, 300);
      if (intent) proposals.push({ kind: "sound-design", trackId: track.id, trackName: track.name, intent });
    }
    if (candidate.kind === "fx-plan") {
      const planInput = record(candidate.plan);
      if (!planInput) continue;
      const intent = short(planInput.intent, 120);
      const plan = normalizeFxChainPlan({ ...planInput, devices: Array.isArray(planInput.devices) ? planInput.devices.slice(0, 6) : [] }, intent, { browserEffectsAvailable: !track.nativeVst, source: "ai" });
      if (intent && plan.devices.length) proposals.push({ kind: "fx-plan", trackId: track.id, trackName: track.name, plan });
    }
  }
  return { message: short(body.message, 2000) || (proposals.length ? "Review these proposals below." : "I couldn't turn that into a supported proposal."), proposals };
}
