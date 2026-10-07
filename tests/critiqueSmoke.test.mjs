import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareCritique, analyzeCritique } from "../src/tools/critique/workflow.ts";
import { requestAiCritiqueSummary, critiqueReportUrl } from "../src/tools/critique/api.ts";

function syntheticWav() {
  // A short original PCM pulse: deterministic and free of third-party audio.
  const bytes = new Uint8Array(44 + 4800 * 2);
  const view = new DataView(bytes.buffer);
  for (const [offset, word] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]]) {
    for (let i = 0; i < 4; i++) bytes[offset + i] = word.charCodeAt(i);
  }
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 96000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, bytes.length - 44, true);
  view.setInt16(44, 10000, true);
  return new Blob([bytes], { type: "audio/wav" });
}

const report = {
  engine: "ears-v2", asset_id: "smoke-asset", analysis_mode: "deep", duration_seconds: 1,
  sample_rate: 48000, channels: 1, technical_score: 82, verdict: "Review candidates",
  finding_counts: { critical: 0, warning: 1, info: 0 }, category_scores: {},
  metrics: { peak_dbfs: -1, tempo: { estimated_bpm: 120, confidence: .65 } },
  findings: [{ id: "click-1", type: "transient_click", category: "glitch", severity: "warning",
    confidence: .8, title: "Transient candidate", detail: "Audition this moment", recommendation: "Listen",
    start_seconds: .05, end_seconds: .08, frequency_low_hz: 1000, frequency_high_hz: 4000,
    suggested_action: "repair_click", score_penalty: 4 }],
  limitations: ["Short source"],
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("controlled Critique smoke: synthetic upload, job, BPM, finding, artist interpretation and report link", async () => {
  const oldFetch = globalThis.fetch;
  const oldWindow = globalThis.window;
  const oldStorage = globalThis.localStorage;
  const calls = [];
  globalThis.window = { setTimeout: callback => setTimeout(callback, 0), clearTimeout };
  globalThis.localStorage = { getItem: () => null };
  globalThis.fetch = async (url, init) => {
    calls.push([String(url), init]);
    if (String(url).endsWith("/v1/audio/upload")) {
      assert.equal(init.method, "POST");
      assert.equal((init.body.get("file")).type, "audio/wav");
      return json({ asset_id: "smoke-asset", original_filename: "synthetic.wav", prepared: true, warnings: [] });
    }
    if (String(url).includes("/v1/critique/jobs/analyze/")) return json({ job_id: "job-1", status: "queued", progress_percent: 0 });
    if (String(url).endsWith("/v1/jobs/job-1")) return json({ job_id: "job-1", status: "complete", progress_percent: 100, result: { report } });
    if (String(url) === "/api/critique/ai-summary") {
      const { evidence } = JSON.parse(init.body);
      assert.equal(evidence.evidence.find(row => row.code === "estimated_bpm")?.value, 120);
      assert.equal(evidence.evidence.find(row => row.id === "click-1")?.severity, "warning");
      assert.equal(JSON.stringify(evidence).includes("Audition this moment"), false);
      return json({ schemaVersion: 1, interpretations: [{ evidenceIds: ["click-1", "metric:estimated_bpm"],
        title: "Check this passage", explanation: "A transient and tempo candidate deserve a listen.",
        suggestedCheck: "Audition the opening.", confidence: "medium" }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const upload = await prepareCritique(new File([syntheticWav()], "synthetic.wav", { type: "audio/wav" }));
    const states = [];
    const result = await analyzeCritique(upload, true, job => states.push(job.status));
    assert.deepEqual(states, ["queued", "complete", "complete"]);
    assert.equal(result.metrics.tempo.estimated_bpm, 120);
    assert.equal(result.findings[0].id, "click-1");
    assert.match(critiqueReportUrl(upload.asset_id), /smoke-asset\/critique$/);
    const interpretation = await requestAiCritiqueSummary(result);
    assert.deepEqual(interpretation.interpretations[0].evidenceIds, ["click-1", "metric:estimated_bpm"]);
    assert.equal(calls.length, 4);
  } finally { globalThis.fetch = oldFetch; globalThis.window = oldWindow; globalThis.localStorage = oldStorage; }
});

test("backend job failure surfaces its message and does not produce a report", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes("/analyze/")
    ? json({ job_id: "failed-job", status: "queued", progress_percent: 0 })
    : json({ job_id: "failed-job", status: "failed", error: "Analyzer unavailable" });
  try {
    await assert.rejects(analyzeCritique({ asset_id: "smoke-asset" }, true, () => {}), /Analyzer unavailable/);
  } finally { globalThis.fetch = oldFetch; }
});

test("upload HTTP failure and missing report cannot enter report state", async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => json({ detail: "Unsupported audio" }, 422);
    await assert.rejects(prepareCritique(new File([syntheticWav()], "synthetic.wav")), /Unsupported audio/);
    globalThis.fetch = async url => String(url).includes("/analyze/")
      ? json({ job_id: "empty-job", status: "queued", progress_percent: 0 })
      : json({ job_id: "empty-job", status: "complete", result: {} });
    await assert.rejects(analyzeCritique({ asset_id: "smoke-asset" }, false, () => {}), /matching report/);
  } finally { globalThis.fetch = oldFetch; }
});

test("AI backend failure leaves the measured report available", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ message: "Critic unavailable" }, 503);
  try {
    await assert.rejects(requestAiCritiqueSummary(report), /Critic unavailable/);
    assert.equal(report.findings[0].id, "click-1");
    assert.equal(report.metrics.tempo.estimated_bpm, 120);
  } finally { globalThis.fetch = oldFetch; }
});
