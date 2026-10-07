import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceTargets, tonalMatchAssessment } from '../src/tools/mastering/referenceTargets.ts';

const source = { integrated_lufs: -18, crest_factor_db: 10, loudness_proxy: false, stereo: { side_to_mid_ratio: 0.4 } };
const reference = { values: { integrated_lufs: -12, crest_factor_db: 16, side_to_mid_ratio: 0.8 }, proxies: { loudness: false, true_peak: false, dynamics: true } };
const selected = { tonal: false, loudness: true, dynamics: true, stereo: true };

test('reference strength interpolates measured targets with a guarded stereo limit', () => {
  const low = referenceTargets(source, reference, selected, 0);
  const high = referenceTargets(source, reference, selected, 0.6);
  assert.equal(low.targetLufs, -18);
  assert.equal(high.targetLufs, -12);
  assert.equal(high.stereoWidth, 1.1);
  assert.equal(high.transientAmount, 0.14);
  assert.equal(high.targetCrestDb, 14);
});

test('crest suggestion is bounded, reversible and omitted for unusable descriptors', () => {
  assert.equal(referenceTargets(source, { ...reference, values: { ...reference.values, crest_factor_db: 2 } }, selected, 0.6).transientAmount, -0.14);
  assert.equal(referenceTargets(source, reference, selected, 0).transientAmount, 0);
  assert.equal(referenceTargets(source, { ...reference, values: { ...reference.values, crest_factor_db: 90 } }, selected, 0.6).transientAmount, undefined);
});

test('proxy loudness cannot silently become a measured LUFS target', () => {
  const result = referenceTargets({ ...source, loudness_proxy: true }, reference, selected, 0.6);
  assert.equal(result.targetLufs, undefined);
  assert.match(result.notes.join(' '), /methods differ/);
});

test('tonal matching is bounded by descriptor coverage and plausibility', () => {
  const shares = { sub: 5, bass: 20, low_mid: 20, mid: 20, high_mid: 15, presence: 15, air: 5 };
  const measuredSource = { ...source, spectral_band_percent: shares };
  const measuredReference = { ...reference, values: { ...reference.values, ...shares } };
  assert.equal(tonalMatchAssessment(measuredSource, measuredReference, 0.6).influence, 0.6);
  assert.equal(tonalMatchAssessment(measuredSource, measuredReference, 9).influence, 0.6);
  const partial = { ...measuredReference, values: { ...measuredReference.values, air: undefined } };
  assert.equal(tonalMatchAssessment(measuredSource, partial, 0.6).influence, 0.21);
  assert.equal(tonalMatchAssessment(measuredSource, reference, 0.6).influence, 0);
});
