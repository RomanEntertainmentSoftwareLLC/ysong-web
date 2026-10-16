import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/dawProcessingLoad.ts', import.meta.url), 'utf8');
const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const { averageSchedulingDelay, classifyNativeTrackLoad, classifySchedulingPressure, classifySustainedLoad, normalizeNativeLoad } = module.exports;

test('native load values are finite, nonnegative percentages', () => {
	assert.equal(normalizeNativeLoad(42.5), 42.5);
	assert.equal(normalizeNativeLoad(140), 100);
	assert.equal(normalizeNativeLoad(-1), undefined);
	assert.equal(normalizeNativeLoad('unavailable'), undefined);
});

test('sustained load classification waits for repeated samples', () => {
	assert.equal(classifySustainedLoad([50, 50, 50, 50]), 'normal');
	assert.equal(classifySustainedLoad([50, 50, 50, 50, 50]), 'overload');
	assert.equal(classifySustainedLoad([25, 25, 25, 25, 25]), 'elevated');
	assert.equal(classifySustainedLoad([10, 10, 10, 10, 10, 60]), 'elevated');
});

test('scheduling diagnostics average only the recent bounded window', () => {
	const samples = Array.from({ length: 11 }, (_, index) => ({ delayMs: index, updatedAt: index }));
	assert.equal(averageSchedulingDelay(samples), 5.5);
	assert.equal(classifySchedulingPressure(Array.from({ length: 5 }, () => ({ delayMs: 120, updatedAt: 0 }))), 'elevated');
	assert.equal(classifySchedulingPressure(Array.from({ length: 5 }, () => ({ delayMs: 300, updatedAt: 0 }))), 'overload');
});

test('native overload requires five recent Bridge load samples for the same track', () => {
	const samples = Array.from({ length: 4 }, (_, index) => ({ trackId: 'a', loadPercent: 80, updatedAt: index }));
	assert.equal(classifyNativeTrackLoad(samples, 'a'), 'normal');
	samples.push({ trackId: 'a', loadPercent: 80, updatedAt: 4 });
	assert.equal(classifyNativeTrackLoad(samples, 'a'), 'overload');
	assert.equal(classifyNativeTrackLoad(samples, 'b'), 'normal');
});
