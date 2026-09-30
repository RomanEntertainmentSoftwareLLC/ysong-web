import assert from "node:assert/strict";
import { test } from "node:test";
import { compareReferenceDescriptors, descriptorProfile, parseReferenceProfile } from "../src/tools/mastering/referenceDescriptors.ts";

const metrics = {
  integrated_lufs: -16, true_peak_dbtp: -1, crest_factor_db: 11,
  dynamic_range_proxy_db: 7, spectral_centroid_hz: 2200,
  spectral_band_percent: { bass: 22, presence: 8 },
  stereo: { side_to_mid_ratio: 0.4, correlation: 0.8, left_right_balance_db: 0.1 },
  loudness_proxy: false, true_peak_proxy: false,
};

test("reference profile keeps only measured descriptors and round trips without audio", () => {
  const profile = descriptorProfile(metrics, "  Mix A  ");
  assert.equal(profile.name, "Mix A");
  assert.equal(profile.values.bass, 22);
  assert.equal(profile.values.air, undefined);
  assert.deepEqual(parseReferenceProfile(JSON.parse(JSON.stringify(profile))), profile);
  assert.equal(JSON.stringify(profile).includes("asset_id"), false);
});

test("comparisons use source-relative deltas and deadbands", () => {
  const profile = descriptorProfile(metrics, "Reference");
  const rows = compareReferenceDescriptors({ ...metrics, integrated_lufs: -18, crest_factor_db: 11.4, stereo: { ...metrics.stereo, side_to_mid_ratio: 0.55 } }, profile);
  assert.equal(rows.find(row => row.key === "integrated_lufs")?.difference, "quieter");
  assert.equal(rows.find(row => row.key === "crest_factor_db")?.difference, "similar");
  assert.equal(rows.find(row => row.key === "side_to_mid_ratio")?.difference, "wider");
  assert.match(rows.find(row => row.key === "side_to_mid_ratio")?.guidance || "", /10%/);
});

test("incompatible loudness and true-peak methods are not compared", () => {
  const profile = descriptorProfile(metrics, "Reference");
  const rows = compareReferenceDescriptors({ ...metrics, loudness_proxy: true, true_peak_proxy: true }, profile);
  assert.equal(rows.some(row => row.key === "integrated_lufs" || row.key === "true_peak_dbtp"), false);
  assert.equal(rows.some(row => row.key === "crest_factor_db"), true);
});

test("import rejects unknown, nonfinite, and out-of-range values", () => {
  const profile = descriptorProfile(metrics, "Reference");
  assert.throws(() => parseReferenceProfile({ ...profile, values: { ...profile.values, mystery: 5 } }));
  assert.throws(() => parseReferenceProfile({ ...profile, values: { integrated_lufs: 999 } }));
  assert.throws(() => parseReferenceProfile({ ...profile, values: { integrated_lufs: NaN } }));
  assert.throws(() => parseReferenceProfile({ ...profile, values: {} }));
});
