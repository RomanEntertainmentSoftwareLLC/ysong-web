import { VOCAL_API_BASE, type LocalJob, type UploadResult, waitForLocalJob } from "../stemrestore/api";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${VOCAL_API_BASE}${path}`, init);
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const record = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : null;
    const detail = record?.detail || record?.message || (typeof payload === "string" ? payload : `${response.status} ${response.statusText}`);
    throw new Error(String(detail));
  }
  return payload as T;
}

export type MasterMetrics = {
  duration_seconds: number;
  sample_rate: number;
  channels: number;
  sample_peak_dbfs: number;
  rms_dbfs: number;
  crest_factor_db: number;
  dynamic_range_proxy_db: number;
  integrated_lufs: number;
  true_peak_dbtp: number;
  loudness_range_lu: number | null;
  loudness_method?: string;
  loudness_proxy?: boolean;
  true_peak_proxy?: boolean;
  spectral_centroid_hz: number;
  spectral_band_percent: Record<string, number>;
  stereo: { correlation?: number | null; left_right_balance_db?: number | null; side_to_mid_ratio?: number | null };
};

export type DynamicEqCandidate = {
  id: string;
  type: string;
  title: string;
  start_seconds: number;
  end_seconds: number;
  frequency_low_hz: number;
  frequency_high_hz: number;
  center_hz: number;
  q: number;
  suggested_gain_db: number;
  confidence: number;
  reason: string;
  source: string;
};

export type ReferenceDescriptor = { dimension: string; difference: string; detail: string };

export type MasteringAnalysis = {
  schema_version: number;
  engine: string;
  asset_id: string;
  analysis: MasterMetrics;
  tonal_description: string[];
  dynamic_eq_candidates: DynamicEqCandidate[];
  suggestions: Array<{ type: string; title: string; detail: string; proposed?: Record<string, unknown> }>;
  critique_integration: {
    source: string;
    technical_score?: number;
    verdict?: string;
    finding_count: number;
    frequency_time_hints_used: number;
    policy: string;
  };
  reference?: null | {
    asset_id: string;
    metrics: MasterMetrics;
    match: {
      descriptors: ReferenceDescriptor[];
      suggested_broad_eq_moves: Array<{ band: string; center_hz: number; q: number; difference_db: number; max_suggested_move_db: number }>;
      policy: string;
    };
  };
  targets: Record<string, { label: string; target_lufs: number; true_peak_dbtp: number }>;
  limitations?: string[];
};

export type MasteringReport = {
  schema_version: number;
  engine: string;
  status: string;
  asset_id: string;
  run_id: string;
  mode: "quick" | "assistant" | "reference" | string;
  settings: {
    target_lufs: number;
    true_peak_dbtp: number;
    strength: number;
    stereo_width: number;
    transient_amount: number;
    apply_dynamic_eq: boolean;
    reference_asset_id?: string | null;
    reference_influence: number;
  };
  before: MasterMetrics;
  after: MasterMetrics;
  difference: { rms_dbfs: number; change_percent_of_source_rms: number };
  analysis: MasteringAnalysis;
  stages: Array<Record<string, unknown>>;
  warnings: string[];
  safety: { source_overwritten: boolean; difference_track_written: boolean; reference_cloning: boolean };
};

export async function uploadForMastering(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  return jsonFetch<UploadResult>("/v1/audio/upload", { method: "POST", body: form });
}

export function startMasteringAnalysis(assetId: string, referenceAssetId?: string | null): Promise<LocalJob> {
  const q = new URLSearchParams();
  if (referenceAssetId) q.set("reference_asset_id", referenceAssetId);
  const suffix = q.size ? `?${q.toString()}` : "";
  return jsonFetch<LocalJob>(`/v1/mastering/jobs/analyze/${encodeURIComponent(assetId)}${suffix}`, { method: "POST" });
}

export function startMasteringRender(
  assetId: string,
  settings: {
    mode: "quick" | "assistant" | "reference";
    targetLufs: number;
    truePeak: number;
    strength: number;
    stereoWidth: number;
    transientAmount: number;
    applyDynamicEq: boolean;
    referenceAssetId?: string | null;
    referenceInfluence: number;
  },
): Promise<LocalJob> {
  const q = new URLSearchParams({
    mode: settings.mode,
    target_lufs: String(settings.targetLufs),
    true_peak_dbtp: String(settings.truePeak),
    strength: String(settings.strength),
    stereo_width: String(settings.stereoWidth),
    transient_amount: String(settings.transientAmount),
    apply_dynamic_eq: settings.applyDynamicEq ? "true" : "false",
    reference_influence: String(settings.referenceInfluence),
  });
  if (settings.referenceAssetId) q.set("reference_asset_id", settings.referenceAssetId);
  return jsonFetch<LocalJob>(`/v1/mastering/jobs/render/${encodeURIComponent(assetId)}?${q.toString()}`, { method: "POST" });
}

export { waitForLocalJob };

export function sourceAudioUrl(assetId: string) {
  return `${VOCAL_API_BASE}/v1/files/audio/${encodeURIComponent(assetId)}/source`;
}

export function masteringFileUrl(assetId: string, runId: string, kind: "master" | "difference" | "report") {
  return `${VOCAL_API_BASE}/v1/files/mastering/${encodeURIComponent(assetId)}/${encodeURIComponent(runId)}/${kind}`;
}

export function masteringAnalysisUrl(assetId: string) {
  return `${VOCAL_API_BASE}/v1/files/reports/${encodeURIComponent(assetId)}/mastering-analysis`;
}
