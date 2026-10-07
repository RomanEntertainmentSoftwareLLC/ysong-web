import type { MasterMetrics } from "./api";
import type { ReferenceProfile } from "./referenceDescriptors";

export type MatchDimension = "tonal" | "loudness" | "dynamics" | "stereo";
export type MatchSelection = Record<MatchDimension, boolean>;

export const defaultMatchSelection: MatchSelection = { tonal: true, loudness: false, dynamics: false, stereo: false };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

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
  if (selected.tonal) result.notes.push("Tonal bands guide the reference engine when reference audio is prepared. Saved descriptors show tonal differences only; no EQ curve is copied.");
  return result;
}
