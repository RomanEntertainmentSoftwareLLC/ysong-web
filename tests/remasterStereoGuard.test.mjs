import assert from "node:assert/strict";
import { test } from "node:test";
import { stereoGuard } from "../src/tools/mastering/stereoGuard.ts";

const metrics = (correlation, sideToMid, channels = 2) => ({
  channels, stereo: { correlation, side_to_mid_ratio: sideToMid },
});

test("widening requires measured stereo and respects full-band cap", () => {
  assert.equal(stereoGuard(1.4).width, 1);
  assert.equal(stereoGuard(1.4, metrics(0.8, 0.3)).width, 1.1);
  assert.equal(stereoGuard(0.8).width, 0.8);
});

test("phasey and side-heavy sources cannot be widened", () => {
  assert.equal(stereoGuard(1.1, metrics(-0.1, 0.6)).width, 1);
  assert.equal(stereoGuard(1.1, metrics(0.1, 0.85)).width, 1);
  assert.equal(stereoGuard(1.1, metrics(0.7, 1.2)).width, 1);
  assert.equal(stereoGuard(1.1, metrics(null, null)).width, 1);
});
