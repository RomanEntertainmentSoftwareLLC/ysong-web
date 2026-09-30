import type { CreativeStudioProject, StudioTrack } from "./creativeStudioProject";
import { validateCreativeStudioProject } from "./creativeStudioProject.ts";

export type CriticRange = { startFrame: number; endFrame: number }; // Half open, in the selected Studio timebase.
export type CriticSeverity = "critical" | "warning" | "info";
export type CriticConfidence = "low" | "medium" | "high";
export type CriticSignal = {
  id: string;
  kind: "measured" | "heuristic" | "uncertainty";
  code: "timeline_duration" | "visual_gap" | "audio_gap" | "overlay_duration" |
    "brief_opening" | "dense_text" | "late_cta" |
    "render_unchecked" | "source_duration_unverified" | "placement_unverified";
  severity: CriticSeverity;
  confidence: number; // Deterministic engine confidence, 0..1; never an outcome probability.
  range: CriticRange;
  clipIds: string[];
  overlayIds: string[];
  observation: { value: number; unit: "frames" | "seconds" | "characters" } | null;
  rule: { id: string; version: number; threshold: number; unit: "frames" | "seconds" | "characters" } | null;
};
export type CriticEvidence = CriticSignal & { source: "deterministic_ads_critic"; capturedAt: string };
export type AdsCriticEvidencePacket = {
  schemaVersion: 1;
  creativeId: string;
  studioRevision: number;
  aspectRatio: "base" | "9:16" | "1:1" | "16:9";
  timebase: CreativeStudioProject["timebase"];
  durationFrames: number;
  capturedAt: string;
  evidence: CriticEvidence[];
};
export type AdsCriticInterpretation = {
  evidenceIds: string[];
  title: string;
  explanation: string;
  suggestedCheck: string;
  confidence: CriticConfidence;
};
export type AdsCriticResponse = { schemaVersion: 1; interpretations: AdsCriticInterpretation[] };

const measured = ["timeline_duration", "visual_gap", "audio_gap", "overlay_duration"];
const heuristics = ["brief_opening", "dense_text", "late_cta"];
const uncertainties = ["render_unchecked", "source_duration_unverified", "placement_unverified"];
const fail = (reason: string): never => { throw new Error(`Invalid Ads Critic evidence: ${reason}`); };
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: unknown, keys: readonly string[], path: string): Record<string, unknown> => {
  if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) fail(`${path} fields`);
  return value as Record<string, unknown>;
};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const id = (value: unknown, path: string): string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value) ? value : fail(path);
const ids = (value: unknown, path: string): string[] => {
  if (!Array.isArray(value) || value.length > 32) fail(path);
  const result = (value as unknown[]).map(item => id(item, path));
  if (new Set(result).size !== result.length) fail(`${path} duplicates`);
  return result;
};

/** Build the only model-facing evidence packet from a validated, saved Studio revision and engine signals. */
export function buildAdsCriticEvidence(input: {
  creativeId: string;
  project: CreativeStudioProject;
  refs: { audioSnippetIds: readonly string[]; backgroundMediaIds: readonly string[]; overlayIds: readonly string[] };
  aspectRatio: AdsCriticEvidencePacket["aspectRatio"];
  capturedAt: string;
  signals: CriticSignal[];
}): AdsCriticEvidencePacket {
  id(input.creativeId, "creativeId");
  validateCreativeStudioProject(input.project, input.refs);
  if (!Number.isFinite(Date.parse(input.capturedAt)) || !/^\d{4}-\d\d-\d\dT/.test(input.capturedAt)) fail("capturedAt");
  if (!["base", "9:16", "1:1", "16:9"].includes(input.aspectRatio)) fail("aspectRatio");
  if (input.aspectRatio !== "base" && !input.project.variants?.[input.aspectRatio]) fail("missing aspect variant");
  if (!Array.isArray(input.signals) || input.signals.length > 100) fail("signal count");
  const tracks: StudioTrack[] = input.aspectRatio === "base" ? input.project.tracks : input.project.variants![input.aspectRatio]!.tracks;
  const clips = new Map(tracks.flatMap(track => track.clips.map(clip => [clip.id, clip] as const)));
  const overlays = new Map(tracks.flatMap(track => track.clips.flatMap(clip => "overlayId" in clip && clip.overlayId ? [[clip.overlayId, clip] as const] : [])));
  const seen = new Set<string>();
  const evidence = input.signals.map(signal => {
    const row = exact(signal, ["id", "kind", "code", "severity", "confidence", "range", "clipIds", "overlayIds", "observation", "rule"], "signal");
    const signalId = id(row.id, "signal.id");
    if (seen.has(signalId)) fail("duplicate signal.id");
    seen.add(signalId);
    const codes = row.kind === "measured" ? measured : row.kind === "heuristic" ? heuristics : row.kind === "uncertainty" ? uncertainties : fail("signal.kind");
    if (!codes.includes(String(row.code)) || !["critical", "warning", "info"].includes(String(row.severity)) || !finite(row.confidence) || row.confidence < 0 || row.confidence > 1) fail("signal classification");
    if (row.kind === "measured" && (row.confidence !== 1 || row.rule !== null || row.observation === null)) fail("measured signal requirements");
    if (row.kind === "heuristic" && (row.rule === null || row.observation === null || row.confidence === 1 || row.severity === "critical")) fail("heuristic signal requirements");
    if (row.kind === "uncertainty" && (row.rule !== null || row.observation !== null || row.severity === "critical")) fail("uncertainty signal requirements");
    const range = exact(row.range, ["startFrame", "endFrame"], "range");
    if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) || Number(range.startFrame) < 0 || Number(range.endFrame) <= Number(range.startFrame) || Number(range.endFrame) > input.project.durationFrames) fail("range bounds");
    const clipIds = ids(row.clipIds, "clipIds");
    const overlayIds = ids(row.overlayIds, "overlayIds");
    for (const clipId of clipIds) {
      const clip = clips.get(clipId);
      if (!clip || clip.startFrame >= Number(range.endFrame) || clip.startFrame + clip.durationFrames <= Number(range.startFrame)) fail("unmatched clip range");
    }
    for (const overlayId of overlayIds) {
      const clip = overlays.get(overlayId);
      if (!clip || clip.startFrame >= Number(range.endFrame) || clip.startFrame + clip.durationFrames <= Number(range.startFrame)) fail("unmatched overlay range");
    }
    if (row.observation !== null) {
      const observation = exact(row.observation, ["value", "unit"], "observation");
      if (!finite(observation.value) || observation.value < 0 || !["frames", "seconds", "characters"].includes(String(observation.unit))) fail("observation");
    }
    if (row.rule !== null) {
      const rule = exact(row.rule, ["id", "version", "threshold", "unit"], "rule");
      id(rule.id, "rule.id");
      if (!Number.isSafeInteger(rule.version) || Number(rule.version) < 1 || !finite(rule.threshold) || rule.threshold < 0 || !["frames", "seconds", "characters"].includes(String(rule.unit)) || rule.unit !== (row.observation as Record<string, unknown>)?.unit) fail("rule");
    }
    if (row.kind === "measured") {
      const start = Number(range.startFrame);
      const end = Number(range.endFrame);
      const observation = row.observation as { value: number; unit: string };
      const fps = input.project.timebase.framesPerSecond.numerator / input.project.timebase.framesPerSecond.denominator;
      if (row.code === "timeline_duration") {
        if (start !== 0 || end !== input.project.durationFrames || clipIds.length || overlayIds.length || observation.unit === "characters" || Math.abs(observation.value - (observation.unit === "frames" ? end : end / fps)) > .001) fail("timeline duration mismatch");
      } else if (row.code === "overlay_duration") {
        if (!overlayIds.length || overlayIds.some(overlayId => { const clip = overlays.get(overlayId)!; return clip.startFrame !== start || clip.startFrame + clip.durationFrames !== end; }) || observation.unit === "characters" || Math.abs(observation.value - (observation.unit === "frames" ? end - start : (end - start) / fps)) > .001) fail("overlay duration mismatch");
      } else if (row.code === "visual_gap" || row.code === "audio_gap") {
        const kind = row.code === "visual_gap" ? "visual" : "audio";
        if (clipIds.length || overlayIds.length || observation.unit !== "frames" || observation.value !== end - start || tracks.some(track => track.kind === kind && track.clips.some(clip => clip.startFrame < end && clip.startFrame + clip.durationFrames > start))) fail("gap mismatch");
      }
      if (row.severity === "critical" && !(row.code === "visual_gap" && start === 0 && end === input.project.durationFrames)) fail("unsupported critical severity");
    }
    return { ...signal, source: "deterministic_ads_critic" as const, capturedAt: input.capturedAt };
  });
  return { schemaVersion: 1, creativeId: input.creativeId, studioRevision: input.project.revision, aspectRatio: input.aspectRatio, timebase: input.project.timebase, durationFrames: input.project.durationFrames, capturedAt: input.capturedAt, evidence };
}

/** AI supplies commentary only. Citations must resolve to the exact packet shown to the artist. */
export function validateAdsCriticResponse(value: unknown, packet: AdsCriticEvidencePacket): asserts value is AdsCriticResponse {
  const root = exact(value, ["schemaVersion", "interpretations"], "response");
  if (root.schemaVersion !== 1 || !Array.isArray(root.interpretations) || root.interpretations.length > 12) fail("response shape");
  const available = new Set(packet.evidence.map(item => item.id));
  for (const item of root.interpretations as unknown[]) {
    const row = exact(item, ["evidenceIds", "title", "explanation", "suggestedCheck", "confidence"], "interpretation");
    const refs = ids(row.evidenceIds, "evidenceIds");
    if (!refs.length || refs.some(ref => !available.has(ref))) fail("unsupported evidence reference");
    if (!["low", "medium", "high"].includes(String(row.confidence))) fail("interpretation confidence");
    for (const key of ["title", "explanation", "suggestedCheck"] as const) {
      if (typeof row[key] !== "string" || !row[key].trim() || row[key].length > (key === "title" ? 120 : 600) || /<[^>]*>|https?:\/\/|\b(?:will|guaranteed to|proven to)\s+(?:increase|improve|boost|lower|reduce)\b/i.test(row[key])) fail(`interpretation ${key}`);
    }
  }
}
