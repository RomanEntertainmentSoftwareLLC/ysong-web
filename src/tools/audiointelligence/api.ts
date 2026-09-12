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

export type IntelligenceCapabilities = {
  available: boolean;
  backend: string;
  reason?: string;
  install?: string;
  model?: string;
  learned?: boolean;
  policy?: string;
};

export type RankedLabel = { label: string; similarity?: number; relative_strength?: number; relative_confidence?: number };
export type AudioIntelligenceReport = {
  schema_version: number;
  engine: string;
  model: string;
  asset_id: string;
  cache?: { hit: boolean; policy: string };
  analysis_policy: { audio_embedding_passes: number; windows_analyzed: number; reuse: string };
  genre: { primary_genre: string | null; primary_subgenre: string | null; candidates: Array<{ genre: string; family: string; relative_confidence: number; score: number }> };
  mood: { candidates: RankedLabel[] };
  energy: { primary: RankedLabel | null; candidates: RankedLabel[] };
  tempo: { estimated_bpm: number | null; confidence: number; method: string; cross_check: { expected_bpm?: number | null; status: string; delta_bpm?: number } };
  key: { estimated_key: string | null; confidence: number; method: string; runner_up?: string; cross_check: { expected_key?: string | null; status: string } };
  presence: { vocal: number; instrumental: number; tags: RankedLabel[] };
  sonic_fingerprint: { cues: Array<{ name: string; score: number; strength: number }> };
  explicit_content: { status: string; explicit: boolean | null; confidence: number; reason: string; matched_term_count: number };
  ai_likelihood: { label: string; ai_like_score: number; confidence: number; uncertainty: number; method: string; warning: string };
  downstream_metadata: Record<string, unknown> & { consumer_targets?: string[] };
  limitations?: string[];
};

export async function uploadForAudioIntelligence(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  return jsonFetch<UploadResult>("/v1/audio/upload", { method: "POST", body: form });
}

export function getAudioIntelligenceCapabilities(): Promise<IntelligenceCapabilities> {
  return jsonFetch<IntelligenceCapabilities>("/v1/audio-intelligence/capabilities");
}

export function startAudioIntelligence(
  assetId: string,
  options: { expectedBpm?: number | null; expectedKey?: string; lyrics?: string; force?: boolean },
): Promise<LocalJob> {
  return jsonFetch<LocalJob>(`/v1/audio-intelligence/jobs/analyze/${encodeURIComponent(assetId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expected_bpm: options.expectedBpm ?? null,
      expected_key: options.expectedKey?.trim() || null,
      lyrics: options.lyrics?.trim() || null,
      force: Boolean(options.force),
    }),
  });
}

export { waitForLocalJob };

export function audioIntelligenceReportUrl(assetId: string) {
  return `${VOCAL_API_BASE}/v1/files/reports/${encodeURIComponent(assetId)}/audio-intelligence`;
}
