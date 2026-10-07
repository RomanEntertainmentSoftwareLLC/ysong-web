import type { MasterMetrics } from "./api";
import type { ReferenceProfile } from "./referenceDescriptors";

export type MatchDimension = "tonal" | "loudness" | "dynamics" | "stereo";
export type MatchSelection = Record<MatchDimension, boolean>;

export const defaultMatchSelection: MatchSelection = { tonal: true, loudness: false, dynamics: false, stereo: false };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const tonalBands = ["sub", "bass", "low_mid", "mid", "high_mid", "presence", "air"] as const;

export function tonalMatchAssessment(source: MasterMetrics, reference: ReferenceProfile, requestedInfluence: number) {
  const bands = tonalBands.flatMap(key => {
    const a = source.spectral_band_percent?.[key];
    const b = reference.values[key];
    return typeof a === "number" && Number.isFinite(a) && a >= 0 && a <= 100 &&
      typeof b === "number" && Number.isFinite(b) && b >= 0 && b <= 100 ? [{ key, source: a, target: b }] : [];
  });
  const sourceTotal = bands.reduce((sum, band) => sum + band.source, 0);
  const targetTotal = bands.reduce((sum, band) => sum + band.target, 0);
  const coherent = bands.length === tonalBands.length && sourceTotal >= 85 && sourceTotal <= 115 && targetTotal >= 85 && targetTotal <= 115;
  const confidence = coherent ? 1 : bands.length >= 5 && sourceTotal > 20 && targetTotal > 20 ? 0.35 : 0;
  // The DSP owns the actual broad EQ and peak guard. Restrict its input when the
  // descriptor evidence is incomplete, and never increase the requested amount.
  const influence = Math.round(clamp(requestedInfluence, 0, 0.6) * confidence * 100) / 100;
  return { bands, confidence, influence };
}

export function referenceTargets(source: MasterMetrics, reference: ReferenceProfile, selected: MatchSelection, matchStrength: number) {
  const influence = clamp(matchStrength, 0, 0.6);
  const result: { targetLufs?: number; stereoWidth?: number; transientAmount?: number; notes: string[] } = { notes: [] };
  if (selected.loudness) {
    const target = reference.values.integrated_lufs;
    if (target !== undefined && Number.isFinite(target) && Number.isFinite(source.integrated_lufs) && !source.loudness_proxy && !reference.proxies.loudness) {
      result.targetLufs = Math.round(clamp(source.integrated_lufs + (target - source.integrated_lufs) * influence / 0.6, -24, -7) * 10) / 10;
      result.notes.push("Loudness target filled from compatible measured LUFS; the limiter and peak ceiling can stop short.");
    } else result.notes.push("Loudness target unchanged: measured LUFS is unavailable or measurement methods differ.");
  }
  if (selected.stereo) {
    const a = source.stereo?.side_to_mid_ratio;
    const b = reference.values.side_to_mid_ratio;
    if (typeof a === "number" && Number.isFinite(a) && a > 0.01 && typeof b === "number" && Number.isFinite(b)) {
      result.stereoWidth = Math.round(clamp(1 + ((b / a) - 1) * influence / 0.6, 0.9, 1.1) * 100) / 100;
      result.notes.push("Width filled from side/mid ratio, capped at 10%; check mono compatibility.");
    } else result.notes.push("Width unchanged: a usable side/mid ratio is unavailable.");
  }
  if (selected.dynamics) result.notes.push("Crest and 50 ms dynamics are comparison guides. Set transient shape and correction strength by ear; no compressor target is inferred.");
  if (selected.tonal) {
    const tonal = tonalMatchAssessment(source, reference, matchStrength);
    result.notes.push(tonal.confidence === 1
      ? "Complete tonal descriptors support bounded reference guidance; the engine retains its EQ and peak guards."
      : tonal.confidence > 0
        ? "Incomplete tonal descriptors: reference influence is reduced to avoid aggressive correction."
        : "Tonal target skipped: insufficient reliable band measurements.");
  }
  return result;
}
