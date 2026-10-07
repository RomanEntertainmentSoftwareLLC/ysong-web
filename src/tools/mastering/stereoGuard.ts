import type { MasterMetrics } from "./api.ts";

// The engine does not expose a separate bass-width control. Keep full-band
// widening modest until it can protect low frequencies independently.
export const MAX_SAFE_WIDTH = 1.1;

export function stereoGuard(width: number, metrics?: MasterMetrics | null) {
  if (!Number.isFinite(width) || width <= 1) return { width: Number.isFinite(width) ? width : 1, warnings: [] as string[] };
  const warnings: string[] = [];
  const correlation = metrics?.stereo?.correlation;
  const ratio = metrics?.stereo?.side_to_mid_ratio;
  if (!metrics || metrics.channels < 2 || !Number.isFinite(correlation) || !Number.isFinite(ratio)) {
    warnings.push("Analyze stereo correlation and mono compatibility before widening. Width stays at 100%.");
    return { width: 1, warnings };
  }
  if (correlation! <= 0 || ratio! >= 1) {
    warnings.push("Source has anti-phase or side-dominant content that may cancel in mono. Widening is disabled.");
    return { width: 1, warnings };
  }
  // A high side/mid ratio leaves little headroom before mono cancellation.
  const maxWidth = ratio! >= 0.8 || correlation! < 0.2 ? 1 : MAX_SAFE_WIDTH;
  if (maxWidth === 1) warnings.push("Source is close to the mono-compatibility limit. Widening is disabled.");
  else if (width > maxWidth) warnings.push("Widening is capped at 110% because the engine cannot isolate low-frequency width.");
  return { width: Math.min(width, maxWidth), warnings };
}
