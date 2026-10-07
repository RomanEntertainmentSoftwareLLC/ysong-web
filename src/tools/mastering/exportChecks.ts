import type { MasteringReport } from "./api.ts";

// Inspect the rendered file's report without changing the requested target.
export function remasterExportWarnings(report: MasteringReport): string[] {
  const warnings: string[] = [];
  const rate = report.outputs?.sample_rate;
  const depth = report.outputs?.bit_depth;
  if (!Number.isInteger(rate) || !rate || rate < 8000 || rate > 384000) warnings.push("Rendered sample rate is missing or invalid; verify the downloaded WAV.");
  else if (rate !== report.after.sample_rate) warnings.push(`Rendered output reports ${rate} Hz but post-render analysis used ${report.after.sample_rate} Hz.`);
  if (depth !== 24) warnings.push(`Rendered bit depth is ${depth ?? "unknown"}; expected 24-bit PCM WAV.`);
  if (!Number.isFinite(report.after.true_peak_dbtp)) warnings.push("Post-render true peak is unavailable.");
  else {
    if (report.after.true_peak_proxy) warnings.push("Post-render true peak is a sample-peak proxy; verify with a dedicated true-peak meter.");
    if (report.after.true_peak_dbtp >= 0) warnings.push("Rendered audio may clip: measured peak reaches or exceeds 0 dBTP.");
    if (report.after.true_peak_dbtp > report.settings.true_peak_dbtp + 0.1) warnings.push(`Rendered true peak exceeds the requested ${report.settings.true_peak_dbtp.toFixed(1)} dBTP ceiling.`);
  }
  if (report.after.sample_peak_dbfs >= 0) warnings.push("Rendered samples reach or exceed 0 dBFS.");
  return warnings;
}
