import test from 'node:test';
import assert from 'node:assert/strict';
import { measureExport, validateExportSettings } from '../src/lib/exportValidation.ts';
import { remasterExportWarnings } from '../src/tools/mastering/exportChecks.ts';

test('offline measurement reports clipped samples and intersample overs', () => {
  const clipped = measureExport(new Float32Array([0, 1.1, 0]), new Float32Array(3));
  assert.equal(clipped.clippedSamples, 1);
  assert.ok(clipped.truePeakDbtp >= clipped.samplePeakDbfs);
  const alternating = Float32Array.from({ length: 64 }, (_, i) => i % 2 ? -0.9 : 0.9);
  const measured = measureExport(alternating, alternating);
  assert.ok(measured.truePeakDbtp > measured.samplePeakDbfs);
});

test('export settings reject unsupported rate and format without changing targets', () => {
  assert.equal(validateExportSettings('wav24', 48000), null);
  assert.match(validateExportSettings('wav32', 48000), /bit depth/);
  assert.match(validateExportSettings('mp3', 96000), /MP3/);
});

test('remaster report warns when rendered output misses the requested ceiling or format', () => {
  const report = { outputs: { sample_rate: 48000, bit_depth: 16 }, after: { true_peak_dbtp: -0.2, sample_peak_dbfs: -0.3 }, settings: { true_peak_dbtp: -1 } };
  const warnings = remasterExportWarnings(report).join(' ');
  assert.match(warnings, /bit depth/);
  assert.match(warnings, /requested -1.0 dBTP/);
  assert.equal(report.settings.true_peak_dbtp, -1);
});
