import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncABStreams } from '../src/tools/mastering/abSync.ts';
import { masteringRenderQuery, masteringPackageUrl, masteringFileUrl } from '../src/tools/mastering/api.ts';
import { remasterExportWarnings } from '../src/tools/mastering/exportChecks.ts';
import { descriptorProfile, parseReferenceProfile, compareReferenceDescriptors } from '../src/tools/mastering/referenceDescriptors.ts';
import { stereoGuard } from '../src/tools/mastering/stereoGuard.ts';

const metrics = (overrides = {}) => ({
  channels: 2, integrated_lufs: -17, true_peak_dbtp: -1.2, sample_peak_dbfs: -1.4,
  sample_rate: 48000, crest_factor_db: 11, dynamic_range_proxy_db: 7,
  spectral_centroid_hz: 2100, spectral_band_percent: { bass: 20, presence: 10 },
  stereo: { correlation: 0.75, side_to_mid_ratio: 0.3, left_right_balance_db: 0 },
  loudness_proxy: false, true_peak_proxy: false, ...overrides,
});
const settings = (overrides = {}) => ({
  mode: 'assistant', remasterMode: 'balanced', targetLufs: -14, truePeak: -1,
  strength: 0.58, stereoWidth: 1.08, transientAmount: 0.2,
  applyDynamicEq: true, referenceAssetId: null, referenceInfluence: 0.35, ...overrides,
});

test('A/B followers seek to the original clock only when drift exceeds tolerance and media is ready', () => {
  const original = { currentTime: 12.5, readyState: 4 };
  const master = { currentTime: 12.49, readyState: 4 };
  const difference = { currentTime: 12.1, readyState: 1 };
  syncABStreams(original, [master, difference]);
  assert.equal(master.currentTime, 12.49);
  assert.equal(difference.currentTime, 12.1);
  difference.readyState = 4;
  syncABStreams(original, [master, difference]);
  assert.equal(difference.currentTime, 12.5);
  original.currentTime = 19;
  syncABStreams(original, [master, difference]);
  assert.equal(master.currentTime, 19);
  assert.equal(difference.currentTime, 19);
});

test('generated descriptor profile survives project-style JSON reload without asset data', () => {
  const profile = descriptorProfile(metrics(), 'Reference.wav');
  const restored = parseReferenceProfile(JSON.parse(JSON.stringify(profile)));
  assert.deepEqual(restored, profile);
  assert.equal(JSON.stringify(restored).includes('asset_id'), false);
  assert.equal(compareReferenceDescriptors(metrics({ integrated_lufs: -20 }), restored).find(row => row.key === 'integrated_lufs')?.difference, 'quieter');
  assert.throws(() => parseReferenceProfile({ ...restored, schema_version: 2 }));
});

test('reloaded render controls preserve transient, width, limiter and export settings', () => {
  const restored = JSON.parse(JSON.stringify(settings({ referenceAssetId: 'ref-1' })));
  const query = masteringRenderQuery(restored);
  assert.equal(query.get('transient_amount'), '0.2');
  assert.equal(query.get('stereo_width'), '1.08');
  assert.equal(query.get('true_peak_dbtp'), '-1');
  assert.equal(query.get('remaster_mode'), 'balanced');
  assert.equal(query.get('reference_asset_id'), 'ref-1');
  assert.equal(masteringPackageUrl('source 1', 'run/1', false).includes('include_original=false'), true);
  assert.match(masteringFileUrl('source 1', 'run/1', 'master'), /source%201\/run%2F1\/master$/);
});

test('unsafe or absent measurements produce neutral defaults and guarded export warnings', () => {
  assert.equal(stereoGuard(1.4, metrics({ stereo: { correlation: -0.2, side_to_mid_ratio: 0.8 } })).width, 1);
  const query = masteringRenderQuery(settings({ targetLufs: NaN, truePeak: Infinity, stereoWidth: NaN, transientAmount: NaN }));
  assert.equal(query.get('target_lufs'), '-16');
  assert.equal(query.get('true_peak_dbtp'), '-1');
  assert.equal(query.get('stereo_width'), '1');
  assert.equal(query.get('transient_amount'), '0');
  const report = { outputs: { sample_rate: 48000, bit_depth: 24 }, after: metrics(), settings: { true_peak_dbtp: -1 } };
  assert.deepEqual(remasterExportWarnings(report), []);
  const warnings = remasterExportWarnings({ ...report, outputs: { sample_rate: 44100, bit_depth: 16 }, after: metrics({ true_peak_dbtp: 0.1, sample_peak_dbfs: 0 }) });
  assert.match(warnings.join(' '), /sample rate|post-render analysis/i);
  assert.match(warnings.join(' '), /24-bit/);
  assert.match(warnings.join(' '), /clip/);
  assert.match(warnings.join(' '), /ceiling/);
});
