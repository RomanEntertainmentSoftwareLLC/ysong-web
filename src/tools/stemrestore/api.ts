const env = (import.meta as any).env || {};
export const VOCAL_API_BASE = String(env.VITE_VOCAL_API_URL || "/audio-engine").replace(/\/+$/, "");

export type VocalHealth = { status: string; service: string; stage?: string };
export type UploadResult = {
  asset_id: string;
  original_filename: string;
  prepared: boolean;
  warnings: string[];
  work_wav_path?: string | null;
};

export type LocalJob = {
  job_id: string;
  kind: string;
  asset_id: string;
  status: "queued" | "running" | "complete" | "failed" | string;
  stage: string;
  progress_percent: number;
  error?: string | null;
  result?: any;
  log_tail?: string;
};

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

export function checkVocalHealth(): Promise<VocalHealth> {
  return jsonFetch<VocalHealth>("/health");
}

export async function uploadForStemRestore(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  return jsonFetch<UploadResult>("/v1/audio/upload", { method: "POST", body: form });
}

export function startStemSeparation(assetId: string): Promise<LocalJob> {
  return jsonFetch<LocalJob>(`/v1/stems/jobs/separate/${encodeURIComponent(assetId)}`, { method: "POST" });
}

export function startStemRestore(assetId: string, bandCount: 10 | 15 | 24, strength: number, cleanse: boolean): Promise<LocalJob> {
  const q = new URLSearchParams({
    band_count: String(bandCount),
    strength: String(Math.max(0, Math.min(1, strength))),
    cleanse: cleanse ? "true" : "false",
  });
  return jsonFetch<LocalJob>(`/v1/stems/jobs/restore/${encodeURIComponent(assetId)}?${q.toString()}`, { method: "POST" });
}

export function getLocalJob(jobId: string): Promise<LocalJob> {
  return jsonFetch<LocalJob>(`/v1/jobs/${encodeURIComponent(jobId)}`);
}

export function getSpectralBalance(assetId: string): Promise<any> {
  return jsonFetch<any>(`/v1/stems/balance/${encodeURIComponent(assetId)}`);
}

export async function waitForLocalJob(jobId: string, onUpdate: (job: LocalJob) => void, signal?: AbortSignal): Promise<LocalJob> {
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const job = await getLocalJob(jobId);
    onUpdate(job);
    if (job.status === "complete") return job;
    if (job.status === "failed") throw new Error(job.error || "Local audio job failed.");
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, 1000);
      signal?.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
  }
}

export function rawStemUrl(assetId: string, stem: "vocals" | "instrumental" | "reconstruction") {
  return `${VOCAL_API_BASE}/v1/files/stems/${encodeURIComponent(assetId)}/${stem}`;
}

export function restoreFileUrl(assetId: string, restoreId: string, kind: "vocals" | "instrumental" | "mix" | "vocals-difference" | "instrumental-difference" | "report") {
  return `${VOCAL_API_BASE}/v1/files/stem-restore/${encodeURIComponent(assetId)}/${encodeURIComponent(restoreId)}/${kind}`;
}
