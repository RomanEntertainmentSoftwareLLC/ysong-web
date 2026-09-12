import { VOCAL_API_BASE, type LocalJob, type UploadResult, waitForLocalJob } from "../stemrestore/api";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${VOCAL_API_BASE}${path}`, init);
  const text = await response.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const detail = payload?.detail || payload?.message || (typeof payload === "string" ? payload : `${response.status} ${response.statusText}`);
    throw new Error(String(detail));
  }
  return payload as T;
}

export type CritiqueFinding = {
  id: string;
  type: string;
  category: string;
  severity: "critical" | "warning" | "info" | string;
  confidence: number;
  title: string;
  detail: string;
  recommendation: string;
  start_seconds: number | null;
  end_seconds: number | null;
  frequency_low_hz: number | null;
  frequency_high_hz: number | null;
  suggested_action: string;
  score_penalty: number;
};

export type CritiqueReport = {
  engine: string;
  asset_id: string;
  analysis_mode: "deep" | "quick" | string;
  duration_seconds: number;
  sample_rate: number;
  channels: number;
  technical_score: number;
  verdict: string;
  finding_counts: { critical: number; warning: number; info: number };
  category_scores: Record<string, number>;
  metrics: {
    peak_dbfs?: number;
    rms_dbfs?: number;
    crest_factor_db?: number;
    dynamic_range_proxy_db?: number;
    spectral_centroid_hz?: number;
    spectral_band_percent?: Record<string, number>;
    stereo?: { correlation?: number; left_right_balance_db?: number; side_to_mid_ratio?: number };
    tempo?: { estimated_bpm?: number | null; confidence?: number; variability_percent?: number | null; chunk_bpms?: number[] };
  };
  findings: CritiqueFinding[];
  limitations?: string[];
};

export async function uploadForCritique(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  return jsonFetch<UploadResult>("/v1/audio/upload", { method: "POST", body: form });
}

export function startCritique(assetId: string, deepScan: boolean): Promise<LocalJob> {
  const q = new URLSearchParams({ deep_scan: deepScan ? "true" : "false" });
  return jsonFetch<LocalJob>(`/v1/critique/jobs/analyze/${encodeURIComponent(assetId)}?${q.toString()}`, { method: "POST" });
}

export { waitForLocalJob };

export function sourceAudioUrl(assetId: string) {
  return `${VOCAL_API_BASE}/v1/files/audio/${encodeURIComponent(assetId)}/source`;
}

export function critiqueReportUrl(assetId: string) {
  return `${VOCAL_API_BASE}/v1/files/reports/${encodeURIComponent(assetId)}/critique`;
}
