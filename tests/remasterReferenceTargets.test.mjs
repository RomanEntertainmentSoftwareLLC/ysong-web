import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceTargets } from '../src/tools/mastering/referenceTargets.ts';

const source = { integrated_lufs: -18, loudness_proxy: false, stereo: { side_to_mid_ratio: 0.4 } };
const reference = { values: { integrated_lufs: -12, side_to_mid_ratio: 0.8 }, proxies: { loudness: false, true_peak: false, dynamics: true } };
const selected = { tonal: false, loudness: true, dynamics: true, stereo: true };

test('reference strength interpolates measured targets with a guarded stereo limit', () => {
  const low = referenceTargets(source, reference, selected, 0);
  const high = referenceTargets(source, reference, selected, 0.6);
  assert.equal(low.targetLufs, -18);
  assert.equal(high.targetLufs, -12);
  assert.equal(high.stereoWidth, 1.1);
  assert.equal(high.transientAmount, undefined);
});

test('proxy loudness cannot silently become a measured LUFS target', () => {
  const result = referenceTargets({ ...source, loudness_proxy: true }, reference, selected, 0.6);
  assert.equal(result.targetLufs, undefined);
  assert.match(result.notes.join(' '), /methods differ/);
});
