import { startCritique, uploadForCritique, waitForLocalJob, type CritiqueReport } from "./api.ts";
import type { LocalJob, UploadResult } from "../stemrestore/api";

/** The UI and smoke test share this sequence; callers own the visible state transitions. */
export async function prepareCritique(file: File): Promise<UploadResult> {
  return uploadForCritique(file);
}

export async function analyzeCritique(
  upload: UploadResult,
  deepScan: boolean,
  onJob: (job: LocalJob) => void,
  signal?: AbortSignal,
): Promise<CritiqueReport> {
  const started = await startCritique(upload.asset_id, deepScan);
  onJob(started);
  const finished = await waitForLocalJob(started.job_id, onJob, signal);
  onJob(finished);
  const report = finished.result?.report as CritiqueReport | undefined;
  if (!report?.asset_id || report.asset_id !== upload.asset_id) {
    throw new Error("Critique completed without a matching report.");
  }
  return report;
}
