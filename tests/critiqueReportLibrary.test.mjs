import assert from "node:assert/strict";
import { test } from "node:test";
import { critiqueSourceHash, loadCritiques, saveCritique } from "../src/tools/critique/reportLibrary.ts";

test("saved critique retains source, engine, report and artifact provenance", async () => {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    const sourceSha256 = await critiqueSourceHash(new File(["audio bytes"], "mix.wav"));
    assert.equal(sourceSha256, await critiqueSourceHash(new File(["audio bytes"], "renamed.wav")));
    assert.notEqual(sourceSha256, await critiqueSourceHash(new File(["changed"], "mix.wav")));
    const upload = { asset_id: "asset-1", original_filename: "mix.wav", prepared: true, warnings: [] };
    const report = { asset_id: "asset-1", engine: "ears-v2", analysis_mode: "deep", findings: [] };
    const record = { id: "saved-1", savedAt: 123, sourceName: "mix.wav", sourceSha256,
      analysisMode: "deep", engine: "ears-v2", upload, report,
      reportArtifactUrl: "/audio-engine/v1/files/reports/asset-1/critique",
      sourceArtifactUrl: "/audio-engine/v1/files/audio/asset-1/source" };
    saveCritique(record);
    assert.deepEqual(loadCritiques(), [record]);
    values.set("ysong:critique-reports:v1", JSON.stringify([{ ...record, report: { ...report, asset_id: "other" } }]));
    assert.deepEqual(loadCritiques(), []);
  } finally { globalThis.localStorage = previous; }
});
