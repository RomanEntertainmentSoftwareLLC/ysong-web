import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCompRange, normalizeCompRanges, MAX_DAW_COMP_RANGES } from '../src/lib/dawTakes.ts';

const takes = [{ id: 'take-1', name: 'Second pass', assetId: 'asset-2' }];

test('comp ranges retain only valid, bounded selections for available takes', () => {
  assert.deepEqual(normalizeCompRanges([
    { startBar: -1, endBar: 2, takeId: 'take-1' },
    { startBar: 3, endBar: 9, takeId: 'take-1' },
    { startBar: 0, endBar: 1, takeId: 'deleted-take' },
    { startBar: 2, endBar: 2, takeId: 'take-1' },
  ], 4, takes), [
    { startBar: 0, endBar: 2, takeId: 'take-1' },
    { startBar: 3, endBar: 4, takeId: 'take-1' },
  ]);
});

test('comp range count remains bounded across edits and JSON reopen', () => {
  let ranges = [];
  for (let index = 0; index < MAX_DAW_COMP_RANGES + 10; index++) {
    ranges = addCompRange(ranges, { startBar: 0, endBar: 1, takeId: 'take-1' }, 4, takes);
  }
  assert.equal(ranges.length, MAX_DAW_COMP_RANGES);
  assert.deepEqual(normalizeCompRanges(JSON.parse(JSON.stringify(ranges)), 4, JSON.parse(JSON.stringify(takes))), ranges);
});
