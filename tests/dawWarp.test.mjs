import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectWarpTransients, normalizeWarpMarkers } from '../src/lib/dawWarp.ts';

test('warp markers retain ordered source-to-timeline mapping inside clip bounds', () => {
  assert.deepEqual(normalizeWarpMarkers([
    { sourceSec: 2, atBar: 3 }, { sourceSec: 1, atBar: 1 },
    { sourceSec: 3, atBar: 2 }, { sourceSec: 4, atBar: 4 },
  ], 4, 4), [{ sourceSec: 1, atBar: 1 }, { sourceSec: 2, atBar: 3 }]);
});

test('transient detection finds impulses in the source window', () => {
  const samples = new Float32Array(4000);
  samples[1000] = 1; samples[2000] = 1;
  const markers = detectWarpTransients([samples], 1000, 0, 4);
  assert.ok(markers.some((sec) => Math.abs(sec - 1) < 0.02));
  assert.ok(markers.some((sec) => Math.abs(sec - 2) < 0.02));
  assert.deepEqual(detectWarpTransients([samples], 1000, 2.5, 1), []);
});
