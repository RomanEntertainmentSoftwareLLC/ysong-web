import assert from "node:assert/strict";
import { test } from "node:test";
import { planShortAdEdits } from "../src/tools/promotion/shortAdEditPlan.ts";

test("confident tempo and nearby onsets produce stable bounded suggestions", () => {
  const input = { startSeconds: 10, durationSeconds: 12, bpm: 120, confidence: 0.9, onsetsSeconds: [13.02, 16.01, 19.01] };
  const first = planShortAdEdits(input);
  assert.deepEqual(first, planShortAdEdits(input));
  assert.deepEqual(first.cuts.map(cut => cut.source), ["onset", "onset", "onset"]);
  assert.deepEqual(first.cuts.map(cut => cut.cutSeconds), [3.02, 6.01, 9.01]);
  assert.equal(first.mode, "beat");
});

test("weak confidence and invalid tempo fall back to even cuts", () => {
  for (const options of [{ bpm: 120, confidence: 0.3 }, { bpm: Infinity, confidence: 1 }]) {
    const plan = planShortAdEdits({ startSeconds: 5, durationSeconds: 20, ...options, onsetsSeconds: [10, 15, 20] });
    assert.equal(plan.mode, "fallback");
    assert.deepEqual(plan.cuts.map(cut => cut.cutSeconds), [5, 10, 15]);
  }
});

test("confident tempo alone uses a reproducible grid when a beat is near the target", () => {
  const plan = planShortAdEdits({ startSeconds: 0.1, durationSeconds: 12, bpm: 120, confidence: 0.8 });
  assert.equal(plan.mode, "beat");
  assert.equal(plan.cuts[0].source, "tempo");
  assert.equal(plan.cuts[0].cutSeconds, 2.9);
});

test("suggestions remain ordered and inside a short clip", () => {
  const plan = planShortAdEdits({ startSeconds: 0, durationSeconds: 5, bpm: 240, confidence: 1, cutCount: 99 });
  assert.equal(plan.cuts.length, 5);
  assert.ok(plan.cuts.every((cut, index) => cut.cutSeconds > (plan.cuts[index - 1]?.cutSeconds ?? 0) && cut.cutSeconds < 5));
});
