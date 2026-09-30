import assert from "node:assert/strict";
import { test } from "node:test";
import { masteringRenderQuery } from "../src/tools/mastering/api.ts";

const settings = {
  mode: "assistant", remasterMode: "balanced", targetLufs: -14, truePeak: -1,
  strength: 0.6, stereoWidth: 1.2, transientAmount: 0.15,
  applyDynamicEq: true, referenceAssetId: "reference-1", referenceInfluence: 0.3,
};

test("advanced controls travel with the selected engine strategy", () => {
  const query = masteringRenderQuery(settings);
  assert.equal(query.get("remaster_mode"), "balanced");
  assert.equal(query.get("stereo_width"), "1.2");
  assert.equal(query.get("transient_amount"), "0.15");
  assert.equal(query.get("true_peak_dbtp"), "-1");
  assert.equal(query.get("reference_asset_id"), "reference-1");
});

test("quick render always uses the preserve chain and neutral width and transients", () => {
  const query = masteringRenderQuery({ ...settings, mode: "quick", remasterMode: "aggressive", strength: 0.9 });
  assert.equal(query.get("remaster_mode"), "preserve");
  assert.equal(query.get("strength"), "0.35");
  assert.equal(query.get("stereo_width"), "1");
  assert.equal(query.get("transient_amount"), "0");
  assert.equal(query.has("reference_asset_id"), false);
});

test("invalid numbers cannot enter the render request", () => {
  const query = masteringRenderQuery({ ...settings, targetLufs: NaN, truePeak: Infinity, stereoWidth: 9, transientAmount: -9 });
  assert.equal(query.get("target_lufs"), "-16");
  assert.equal(query.get("true_peak_dbtp"), "-1");
  assert.equal(query.get("stereo_width"), "1.5");
  assert.equal(query.get("transient_amount"), "-0.35");
});
