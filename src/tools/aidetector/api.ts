const env = (import.meta as any).env || {};
export const AI_DETECTOR_BASE = String(env.VITE_AI_DETECTOR_URL || "/ai-detector").replace(/\/+$/, "");

export type DetectorHealth = { ok: boolean; service: string; version: string };
export type DetectorLayer = { id: number; name: string; score: number; reliability: number; detail: string };
export type DetectorReport = {
  schema: string;
  analysis_id: string;
  mode: "fast" | "deep" | string;
  elapsed_seconds: number;
  analysis_profile: { sampled_windows: number; decode_sample_rate: number; fft_size: number; segment_seconds: number };
  verdict: "likely_ai" | "ai_like" | "likely_human" | "uncertain" | string;
  verdict_label: string;
  ai_evidence_score: number;
  evidence_agreement: number;
  confidence: number;
  strong_provenance: boolean;
  strong_signal_fingerprint: boolean;
  file: { name: string; duration_seconds: number; sample_rate: number; channels: number; codec: string; format: string };
  provenance: {
    metadata: Record<string, unknown>;
    generator_metadata_hits: string[];
    manifest_generator_hits: string[];
    c2pa_markers: string[];
    digital_source_types: string[];
    claim_generator?: string | null;
    explicit_ai_manifest: boolean;
  };
  layers: DetectorLayer[];
  reasons: string[];
  measurements: Record<string, number>;
  visuals: { spectrum_db: number[]; energy_db: number[]; fakeprint?: number[] };
  windows: Array<{ start: number; duration: number }>;
  cautions: string[];
};

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    throw new Error(String(record?.detail || record?.message || payload || `${response.status} ${response.statusText}`));
  }
  return payload as T;
}

export async function checkAiDetectorHealth(): Promise<DetectorHealth> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      return await readJson<DetectorHealth>(await fetch(`${AI_DETECTOR_BASE}/health`));
    } catch (error) {
      lastError = error;
      if (attempt === 89) break;
      await new Promise(resolve => window.setTimeout(resolve, attempt < 5 ? 400 : 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("YSong AI Detector is offline.");
}

export async function analyzeAiOrigin(file: File, mode: "fast" | "deep"): Promise<DetectorReport> {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", mode);
  return readJson<DetectorReport>(await fetch(`${AI_DETECTOR_BASE}/api/analyze`, { method: "POST", body: form }));
}

export function aiDetectorReportUrl(analysisId: string): string {
  return `${AI_DETECTOR_BASE}/api/report/${encodeURIComponent(analysisId)}`;
}
