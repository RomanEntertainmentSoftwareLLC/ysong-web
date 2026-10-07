import { VOCAL_API_BASE, type LocalJob, type UploadResult, waitForLocalJob } from "../stemrestore/api.ts";
import { buildCritiqueEvidence, validateAiCritiqueSummary, type AiCritiqueSummary } from "./evidenceContract.ts";

type JsonErrorPayload = { detail?: unknown; message?: unknown; error?: unknown };

function asErrorPayload(value: unknown): JsonErrorPayload {
  return value && typeof value === "object" ? value as JsonErrorPayload : {};
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${VOCAL_API_BASE}${path}`, init);
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) as unknown : null; } catch { payload = text; }
  if (!response.ok) {
    const errorPayload = asErrorPayload(payload);
    const detail = errorPayload.detail || errorPayload.message || (typeof payload === "string" ? payload : `${response.status} ${response.statusText}`);
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
    tempo?: { estimated_bpm?: number | null; alternate_bpm?: number | null; interpretation?: string | null; confidence?: number; variability_percent?: number | null; chunk_bpms?: number[] };
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

export type { AiCritiqueSummary } from "./evidenceContract.ts";

export async function requestAiCritiqueSummary(report: CritiqueReport): Promise<AiCritiqueSummary> {
  const evidence = buildCritiqueEvidence(report);
  let token = "";
  try { token = localStorage.getItem("ys_token") || localStorage.getItem("ysong_auth_token") || ""; } catch { /* unavailable */ }
  const response = await fetch("/api/critique/ai-summary", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ evidence }),
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) as unknown : null; } catch { payload = null; }
  if (!response.ok) {
    const errorPayload = asErrorPayload(payload);
    throw new Error(String(errorPayload.message || errorPayload.error || `AI critic HTTP ${response.status}`));
  }
  validateAiCritiqueSummary(payload, evidence);
  return payload;
}
