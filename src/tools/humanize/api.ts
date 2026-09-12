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

export type HumanizeProfile = "clean" | "natural" | "live";

export type HumanizeEvent = {
  type: string;
  start_seconds?: number;
  end_seconds?: number;
  confidence?: number;
  repaired?: boolean;
  changed_bins?: number;
  low_hz?: number | null;
  high_hz?: number | null;
  note?: string;
};

export type HumanizeReport = {
  asset_id: string;
  run_id: string;
  engine: string;
  version: string;
  profile: HumanizeProfile;
  metrics: Record<string, number | boolean>;
  naturalize?: {
    applied?: boolean;
    profile?: string;
    max_gain_db?: number;
    max_width_percent?: number;
    pitch_modulation?: boolean;
    time_warping?: boolean;
    note?: string;
  };
  events?: HumanizeEvent[];
  critique_hints_seen?: Array<{ type?: string; title?: string; start_seconds?: number | null; severity?: string }>;
  algorithm?: Record<string, any>;
  safety?: Record<string, any>;
};

export async function uploadForHumanize(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  return jsonFetch<UploadResult>("/v1/audio/upload", { method: "POST", body: form });
}

export function startHumanize(
  assetId: string,
  profile: HumanizeProfile,
  strength: number,
  options: { deClick: boolean; repairMicroGaps: boolean; spectralCleanse: boolean; softenEnd: boolean },
): Promise<LocalJob> {
  const q = new URLSearchParams({
    profile,
    strength: String(Math.max(0, Math.min(1, strength))),
    de_click: options.deClick ? "true" : "false",
    repair_micro_gaps: options.repairMicroGaps ? "true" : "false",
    spectral_cleanse: options.spectralCleanse ? "true" : "false",
    soften_end: options.softenEnd ? "true" : "false",
  });
  return jsonFetch<LocalJob>(`/v1/humanize/jobs/process/${encodeURIComponent(assetId)}?${q.toString()}`, { method: "POST" });
}

export { waitForLocalJob };

export function humanizeFileUrl(assetId: string, runId: string, kind: "cleaned" | "humanized" | "difference" | "report") {
  return `${VOCAL_API_BASE}/v1/files/humanize/${encodeURIComponent(assetId)}/${encodeURIComponent(runId)}/${kind}`;
}

export function sourceAudioUrl(assetId: string) {
  return `${VOCAL_API_BASE}/v1/files/audio/${encodeURIComponent(assetId)}/source`;
}
