import type { CritiqueReport } from "./api";

export type CritiqueEvidence = {
  id: string;
  source: "local_technical_critique";
  kind: "measured" | "derived";
  code: string;
  severity: "critical" | "warning" | "info";
  confidence: number;
  timeRangeSeconds: { start: number; end: number } | null;
  frequencyRangeHz: { low: number; high: number } | null;
  value: number | null;
  unit: string | null;
};

export type CritiqueEvidencePacket = {
  schemaVersion: 1;
  assetId: string;
  engine: string;
  analysisMode: "deep" | "quick";
  durationSeconds: number;
  evidence: CritiqueEvidence[];
};

export type AiCritiqueSummary = {
  schemaVersion: 1;
  interpretations: Array<{
    evidenceIds: string[];
    title: string;
    explanation: string;
    suggestedCheck: string;
    confidence: "low" | "medium" | "high";
  }>;
  model?: string;
};

const fail = (reason: string): never => { throw new Error(`Invalid Critique evidence: ${reason}`); };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const safeText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/<[^>]*>|https?:\/\//i.test(value);
const code = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
const exact = (value: unknown, keys: string[], path: string) => {
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) fail(`${path} fields`);
  return value as Record<string, unknown>;
};

/** Only analyzer codes and numeric observations cross into model context. Free-form finding copy is excluded. */
export function buildCritiqueEvidence(report: CritiqueReport): CritiqueEvidencePacket {
  if (!id(report.asset_id) || !safeText(report.engine, 80) || !["deep", "quick"].includes(report.analysis_mode) || !finite(report.duration_seconds) || report.duration_seconds <= 0 || !finite(report.sample_rate) || report.sample_rate <= 0) fail("report identity");
  if (!Array.isArray(report.findings) || report.findings.length > 200) fail("finding count");
  const evidence: CritiqueEvidence[] = [];
  const seen = new Set<string>();
  for (const finding of report.findings) {
    if (!id(finding.id) || finding.id.startsWith("metric:") || seen.has(finding.id) || !code(finding.type) || !["critical", "warning", "info"].includes(finding.severity) || !finite(finding.confidence) || finding.confidence < 0 || finding.confidence > 1) fail("finding identity or classification");
    seen.add(finding.id);
    const start = finding.start_seconds;
    const end = finding.end_seconds;
    if ((start !== null && (!finite(start) || start < 0 || start > report.duration_seconds)) || (end !== null && (!finite(end) || start === null || end < start || end > report.duration_seconds))) fail("finding time range");
    const low = finding.frequency_low_hz;
    const high = finding.frequency_high_hz;
    if ((low !== null && (!finite(low) || low < 0 || low > report.sample_rate / 2)) || (high !== null && (!finite(high) || low === null || high < low || high > report.sample_rate / 2))) fail("finding frequency range");
    evidence.push({ id: finding.id, source: "local_technical_critique", kind: "derived", code: finding.type, severity: finding.severity as CritiqueEvidence["severity"], confidence: finding.confidence, timeRangeSeconds: start === null ? null : { start, end: end ?? start }, frequencyRangeHz: low === null ? null : { low, high: high ?? low }, value: null, unit: null });
  }
  const metrics: Array<[string, unknown, string]> = [
    ["peak_dbfs", report.metrics?.peak_dbfs, "dBFS"],
    ["rms_dbfs", report.metrics?.rms_dbfs, "dBFS"],
    ["crest_factor_db", report.metrics?.crest_factor_db, "dB"],
    ["dynamic_range_proxy_db", report.metrics?.dynamic_range_proxy_db, "dB"],
    ["spectral_centroid_hz", report.metrics?.spectral_centroid_hz, "Hz"],
    ["stereo_correlation", report.metrics?.stereo?.correlation, "ratio"],
    ["left_right_balance_db", report.metrics?.stereo?.left_right_balance_db, "dB"],
    ["side_to_mid_ratio", report.metrics?.stereo?.side_to_mid_ratio, "ratio"],
    ["estimated_bpm", report.metrics?.tempo?.estimated_bpm, "BPM"],
  ];
  for (const [name, value, unit] of metrics) if (finite(value)) evidence.push({ id: `metric:${name}`, source: "local_technical_critique", kind: name === "dynamic_range_proxy_db" || name === "estimated_bpm" ? "derived" : "measured", code: name, severity: "info", confidence: name === "estimated_bpm" ? (finite(report.metrics?.tempo?.confidence) ? Math.max(0, Math.min(1, report.metrics.tempo.confidence)) : 0) : 1, timeRangeSeconds: { start: 0, end: report.duration_seconds }, frequencyRangeHz: null, value, unit });
  return { schemaVersion: 1, assetId: report.asset_id, engine: report.engine, analysisMode: report.analysis_mode as "deep" | "quick", durationSeconds: report.duration_seconds, evidence };
}

/** Reject uncited prose and unsupported fields before the artist sees model output. */
export function validateAiCritiqueSummary(value: unknown, packet: CritiqueEvidencePacket): asserts value is AiCritiqueSummary {
  const root = exact(value, ["schemaVersion", "interpretations", "model"].filter(key => key !== "model" || record(value) && "model" in value), "response");
  if (root.schemaVersion !== 1 || !Array.isArray(root.interpretations) || root.interpretations.length > 12 || (root.model !== undefined && !safeText(root.model, 80))) fail("response shape");
  const available = new Set(packet.evidence.map(item => item.id));
  for (const item of root.interpretations as unknown[]) {
    const row = exact(item, ["evidenceIds", "title", "explanation", "suggestedCheck", "confidence"], "interpretation");
    if (!Array.isArray(row.evidenceIds) || row.evidenceIds.length < 1 || row.evidenceIds.length > 8 || new Set(row.evidenceIds).size !== row.evidenceIds.length || row.evidenceIds.some(ref => !available.has(ref))) fail("unsupported evidence reference");
    if (!["low", "medium", "high"].includes(String(row.confidence)) || !safeText(row.title, 120) || !safeText(row.explanation, 600) || !safeText(row.suggestedCheck, 300)) fail("interpretation content");
    if (/\b(?:will|guaranteed to|proven to)\s+(?:improve|fix|increase|remove)\b/i.test(`${row.title} ${row.explanation} ${row.suggestedCheck}`)) fail("unsupported certainty");
  }
}
