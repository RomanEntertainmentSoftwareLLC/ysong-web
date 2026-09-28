import assert from "node:assert/strict";
import { test } from "node:test";
import { fallbackFxChainPlan, normalizeFxChainPlan } from "../src/lib/fxChainPlanner.ts";

test("AI FX plans reject unknown devices and clamp every supported parameter", () => {
  const plan = normalizeFxChainPlan({
    summary: "  Very loud   future chain ",
    devices: [
      { type: "execute-javascript", code: "alert(1)", reason: "unsafe" },
      { type: "compressor", thresholdDb: -999, ratio: 900, attackMs: -4, releaseMs: 9000, outputGainDb: 99, arbitrary: "ignored", reason: "peak control" },
      { effect: { type: "delay", mix: 4, timeMs: 90000, feedback: 2, rateHz: -1 }, reason: "space" },
      { type: "mystery-reverb", mix: 0.5 },
    ],
  }, "future vocal", { browserEffectsAvailable: true, source: "ai" });
  assert.deepEqual(plan.devices.map((device) => device.effect.type), ["compressor", "delay"]);
  assert.equal(plan.devices[0].effect.thresholdDb, -60);
  assert.equal(plan.devices[0].effect.ratio, 20);
  assert.equal(plan.devices[0].effect.attackMs, 0.1);
  assert.equal(plan.devices[0].effect.releaseMs, 2000);
  assert.equal(plan.devices[0].effect.outputGainDb, 24);
  assert.equal("arbitrary" in plan.devices[0].effect, false);
  assert.equal(plan.devices[1].effect.mix, 1);
  assert.equal(plan.devices[1].effect.timeMs, 1000);
  assert.equal(plan.devices[1].effect.feedback, 0.85);
});

test("fallback planner creates deterministic supported chains for common intentions", () => {
  const spacious = fallbackFxChainPlan("spacious lead vocal", { browserEffectsAvailable: true });
  assert.deepEqual(spacious.devices.map((device) => device.effect.type), ["compressor", "delay", "reverb"]);
  assert.equal(spacious.source, "fallback");
  const cyber = fallbackFxChainPlan("futuristic cyber vocal", { browserEffectsAvailable: true });
  assert.deepEqual(cyber.devices.map((device) => device.effect.type), ["compressor", "bitcrusher", "flanger", "delay"]);
  assert.ok(cyber.devices.every((device) => device.reason.length > 0));
});

test("native-only tracks cannot receive browser effects from AI or fallback plans", () => {
  const normalized = normalizeFxChainPlan({ devices: [{ type: "reverb" }, { type: "compressor" }, { type: "delay" }] }, "cleaner mix", { browserEffectsAvailable: false });
  assert.deepEqual(normalized.devices.map((device) => device.effect.type), ["compressor"]);
  const fallback = fallbackFxChainPlan("wide synth", { browserEffectsAvailable: false });
  assert.deepEqual(fallback.devices.map((device) => device.effect.type), ["compressor"]);
});

test("normalized applied chains survive the existing JSON project round trip", () => {
  const effects = fallbackFxChainPlan("distorted lo-fi texture", { browserEffectsAvailable: true }).devices.map((device) => device.effect);
  const restored = JSON.parse(JSON.stringify({ tracks: [{ effects }] })).tracks[0].effects;
  const normalized = normalizeFxChainPlan({ devices: restored }, "restored", { browserEffectsAvailable: true });
  assert.deepEqual(normalized.devices.map((device) => device.effect.type), effects.map((effect) => effect.type));
  assert.deepEqual(normalized.devices.map((device) => device.effect.enabled), effects.map((effect) => effect.enabled));
});
