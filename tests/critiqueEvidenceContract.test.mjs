import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCritiqueEvidence, validateAiCritiqueSummary } from "../src/tools/critique/evidenceContract.ts";

const finding = {
  id: "click-1", type: "transient_click", category: "glitch", severity: "warning", confidence: .82,
  title: "Click at 4s", detail: "Free-form analyzer explanation", recommendation: "Repair it",
  start_seconds: 4, end_seconds: 4.2, frequency_low_hz: 1200, frequency_high_hz: 5000,
  suggested_action: "repair_click", score_penalty: 5,
};
const report = {
  engine: "ears-v2", asset_id: "asset-1", analysis_mode: "deep", duration_seconds: 60,
  sample_rate: 48000, channels: 2, technical_score: 81, verdict: "Review", finding_counts: { critical: 0, warning: 1, info: 0 }, category_scores: {},
  metrics: { peak_dbfs: -1.2, dynamic_range_proxy_db: 8.3, tempo: { estimated_bpm: 120, confidence: .7 } },
  findings: [finding], limitations: ["Audition suspected artifacts."],
};

test("model evidence contains only structured analyzer observations and derivations", () => {
  const packet = buildCritiqueEvidence(report);
  assert.equal(packet.evidence[0].severity, "warning");
  assert.equal(packet.evidence[0].confidence, .82);
  assert.deepEqual(packet.evidence[0].timeRangeSeconds, { start: 4, end: 4.2 });
  assert.deepEqual(packet.evidence[0].frequencyRangeHz, { low: 1200, high: 5000 });
  assert.equal(packet.evidence.find(row => row.code === "estimated_bpm")?.kind, "derived");
  for (const forbidden of ["Free-form", "Repair it", "Review", "score_penalty", "technical_score"]) assert.equal(JSON.stringify(packet).includes(forbidden), false);
});

test("rejects unsupported or malformed analyzer findings", () => {
  assert.throws(() => buildCritiqueEvidence({ ...report, findings: [{ ...finding, severity: "disaster" }] }), /classification/);
  assert.throws(() => buildCritiqueEvidence({ ...report, findings: [{ ...finding, confidence: 1.4 }] }), /classification/);
  assert.throws(() => buildCritiqueEvidence({ ...report, findings: [{ ...finding, end_seconds: 70 }] }), /time range/);
  assert.throws(() => buildCritiqueEvidence({ ...report, findings: [{ ...finding, frequency_high_hz: 30000 }] }), /frequency range/);
  assert.throws(() => buildCritiqueEvidence({ ...report, findings: [finding, finding] }), /classification/);
});

test("missing findings and metrics do not become fabricated evidence", () => {
  const packet = buildCritiqueEvidence({ ...report, findings: [], metrics: {}, limitations: ["Unknown"], verdict: "Perfect" });
  assert.deepEqual(packet.evidence, []);
  assert.equal(JSON.stringify(packet).includes("Perfect"), false);
  assert.equal(JSON.stringify(packet).includes("Unknown"), false);
});

test("model interpretations require current evidence citations and cannot add diagnostics fields", () => {
  const packet = buildCritiqueEvidence(report);
  const row = { evidenceIds: ["click-1"], title: "Audition the click candidate", explanation: "The analyzer marked a short transient here.", suggestedCheck: "Listen around four seconds.", confidence: "medium" };
  const response = { schemaVersion: 1, interpretations: [row] };
  assert.doesNotThrow(() => validateAiCritiqueSummary(response, packet));
  assert.throws(() => validateAiCritiqueSummary({ ...response, interpretations: [{ ...row, evidenceIds: ["invented"] }] }, packet), /unsupported evidence/);
  assert.throws(() => validateAiCritiqueSummary({ ...response, interpretations: [{ ...row, severity: "critical" }] }, packet), /fields/);
  assert.throws(() => validateAiCritiqueSummary({ ...response, interpretations: [{ ...row, explanation: "This will fix your mix." }] }, packet), /certainty/);
});
