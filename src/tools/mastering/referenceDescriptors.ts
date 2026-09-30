import type { MasterMetrics } from "./api";

export type DescriptorKey = "integrated_lufs" | "true_peak_dbtp" | "crest_factor_db" | "dynamic_range_proxy_db" | "spectral_centroid_hz" | "side_to_mid_ratio" | "stereo_correlation" | "left_right_balance_db" | "sub" | "bass" | "low_mid" | "mid" | "high_mid" | "presence" | "air";
export type ReferenceProfile = {
  schema_version: 1;
  kind: "ysong-remaster-reference-descriptors";
  name: string;
  values: Partial<Record<DescriptorKey, number>>;
  proxies: { loudness: boolean; true_peak: boolean; dynamics: true };
};
export type DescriptorComparison = { key: DescriptorKey; label: string; difference: string; detail: string; delta: number; unit: string; guidance: string };

const definitions: Array<{ key: DescriptorKey; label: string; unit: string; deadband: number; lower: string; higher: string; guidance: string; min: number; max: number }> = [
  { key: "integrated_lufs", label: "Loudness", unit: " LU", deadband: 1, lower: "quieter", higher: "louder", guidance: "Choose a loudness target separately; keep the true-peak guard.", min: -70, max: 5 },
  { key: "true_peak_dbtp", label: "True peak", unit: " dB", deadband: 0.5, lower: "more headroom", higher: "less headroom", guidance: "Keep the selected true-peak ceiling.", min: -70, max: 10 },
  { key: "crest_factor_db", label: "Crest / punch", unit: " dB", deadband: 1, lower: "less crest", higher: "more crest", guidance: "Treat crest as character, not a compression target.", min: 0, max: 60 },
  { key: "dynamic_range_proxy_db", label: "Short-term dynamics", unit: " dB", deadband: 1, lower: "less dynamic", higher: "more dynamic", guidance: "50 ms proxy; inspect A/B before changing dynamics.", min: 0, max: 80 },
  { key: "spectral_centroid_hz", label: "Spectral centroid", unit: " Hz", deadband: 150, lower: "darker", higher: "brighter", guidance: "Compare broad tone; any EQ suggestion stays within 2 dB.", min: 0, max: 24000 },
  { key: "side_to_mid_ratio", label: "Stereo width", unit: "", deadband: 0.08, lower: "narrower", higher: "wider", guidance: "Limit width adjustment to 10% and check mono compatibility.", min: 0, max: 20 },
  { key: "stereo_correlation", label: "Stereo correlation", unit: "", deadband: 0.1, lower: "less correlated", higher: "more correlated", guidance: "Check mono compatibility before widening.", min: -1, max: 1 },
  { key: "left_right_balance_db", label: "Left/right balance", unit: " dB", deadband: 0.5, lower: "lower balance reading", higher: "higher balance reading", guidance: "Inspect channel balance before adjusting.", min: -60, max: 60 },
  ...(["sub", "bass", "low_mid", "mid", "high_mid", "presence", "air"] as const).map(key => ({
    key, label: `${key.replaceAll("_", " ")} share`, unit: " percentage points", deadband: 2,
    lower: "less energy", higher: "more energy", guidance: "Broad tonal guidance is capped at 2 dB; compare by ear.", min: 0, max: 100,
  })),
];

function measured(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function descriptorProfile(metrics: MasterMetrics, name: string): ReferenceProfile {
  const raw: Partial<Record<DescriptorKey, unknown>> = {
    integrated_lufs: metrics.integrated_lufs, true_peak_dbtp: metrics.true_peak_dbtp,
    crest_factor_db: metrics.crest_factor_db, dynamic_range_proxy_db: metrics.dynamic_range_proxy_db,
    spectral_centroid_hz: metrics.spectral_centroid_hz, side_to_mid_ratio: metrics.stereo?.side_to_mid_ratio,
    stereo_correlation: metrics.stereo?.correlation, left_right_balance_db: metrics.stereo?.left_right_balance_db,
    ...metrics.spectral_band_percent,
  };
  const values: ReferenceProfile["values"] = {};
  for (const { key, min, max } of definitions) if (measured(raw[key], min, max)) values[key] = raw[key];
  return { schema_version: 1, kind: "ysong-remaster-reference-descriptors", name: name.trim().slice(0, 100) || "Reference descriptors", values,
    proxies: { loudness: Boolean(metrics.loudness_proxy), true_peak: Boolean(metrics.true_peak_proxy), dynamics: true } };
}

export function parseReferenceProfile(input: unknown): ReferenceProfile {
  if (!input || typeof input !== "object") throw new Error("Invalid reference descriptor file.");
  const data = input as Record<string, unknown>;
  if (data.kind !== "ysong-remaster-reference-descriptors" || data.schema_version !== 1 || typeof data.name !== "string" || !data.values || typeof data.values !== "object" || Array.isArray(data.values)) {
    throw new Error("Unsupported reference descriptor format.");
  }
  const supplied = data.values as Record<string, unknown>;
  if (Object.keys(supplied).some(key => !definitions.some(definition => definition.key === key))) throw new Error("Unknown reference descriptor.");
  const values: ReferenceProfile["values"] = {};
  for (const { key, min, max } of definitions) {
    if (key in supplied) {
      if (!measured(supplied[key], min, max)) throw new Error(`Invalid ${key} measurement.`);
      values[key] = supplied[key];
    }
  }
  if (!Object.keys(values).length) throw new Error("Reference descriptor file has no measurements.");
  const proxies = data.proxies as Record<string, unknown> | undefined;
  if (!proxies || typeof proxies.loudness !== "boolean" || typeof proxies.true_peak !== "boolean" || proxies.dynamics !== true) throw new Error("Missing measurement method flags.");
  return { schema_version: 1, kind: "ysong-remaster-reference-descriptors", name: data.name.trim().slice(0, 100) || "Reference descriptors", values,
    proxies: { loudness: proxies.loudness, true_peak: proxies.true_peak, dynamics: true } };
}

export function compareReferenceDescriptors(source: MasterMetrics, reference: ReferenceProfile): DescriptorComparison[] {
  const sourceValues = descriptorProfile(source, "Source").values;
  return definitions.flatMap(({ key, label, unit, deadband, lower, higher, guidance }) => {
    if (key === "integrated_lufs" && Boolean(source.loudness_proxy) !== reference.proxies.loudness) return [];
    if (key === "true_peak_dbtp" && Boolean(source.true_peak_proxy) !== reference.proxies.true_peak) return [];
    const a = sourceValues[key], b = reference.values[key];
    if (a === undefined || b === undefined) return [];
    const delta = a - b;
    const digits = key === "spectral_centroid_hz" ? 0 : key === "side_to_mid_ratio" || key === "stereo_correlation" ? 2 : 1;
    const method = key === "integrated_lufs" && (source.loudness_proxy || reference.proxies.loudness) ? " (RMS proxy)" : key === "true_peak_dbtp" && (source.true_peak_proxy || reference.proxies.true_peak) ? " (sample-peak proxy)" : key === "dynamic_range_proxy_db" ? " (50 ms proxy)" : "";
    return [{ key, label, difference: Math.abs(delta) < deadband ? "similar" : delta < 0 ? lower : higher,
      detail: `Source ${a.toFixed(digits)} vs reference ${b.toFixed(digits)}; ${delta >= 0 ? "+" : ""}${delta.toFixed(digits)}${unit}${method}.`,
      delta, unit, guidance }];
  });
}
