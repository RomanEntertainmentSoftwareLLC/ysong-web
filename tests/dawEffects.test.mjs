import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrowserEffect, createDynamicsC1Effect, normalizeTrackEffects, connectWebAudioEffects } from "../src/lib/dawEffects.ts";

class Node {
  constructor() {
    this.connections = [];
    this.gain = { value: 0 };
    this.frequency = { value: 0 };
    this.delayTime = { value: 0 };
    this.Q = { value: 0 };
    this.threshold = { value: 0 };
    this.ratio = { value: 0 };
    this.attack = { value: 0 };
    this.release = { value: 0 };
    this.knee = { value: 0 };
    this.started = false;
    this.stopped = false;
  }
  connect(target) { this.connections.push(target); }
  disconnect() { this.connections = []; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}
class Context {
  sampleRate = 48000;
  createGain() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createDelay() { return new Node(); }
  createOscillator() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createWaveShaper() { return new Node(); }
  createConvolver() { return new Node(); }
  createBuffer(channels, length) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (channel) => data[channel] };
  }
}

test("effect normalization retains order, bypass and bounded parameters for project round trips", () => {
  const originals = [createBrowserEffect("delay"), createDynamicsC1Effect(), createBrowserEffect("reverb")];
  originals[0].mix = 2;
  originals[2].enabled = false;
  const restored = normalizeTrackEffects(JSON.parse(JSON.stringify(originals)));
  assert.deepEqual(restored.map((effect) => effect.id), originals.map((effect) => effect.id));
  assert.deepEqual(restored.map((effect) => effect.type), ["delay", "compressor", "reverb"]);
  assert.equal(restored[0].mix, 1);
  assert.equal(restored[2].enabled, false);
  assert.equal(normalizeTrackEffects([{ type: "unknown" }]).length, 0);
});

test("browser chain connects supported devices in order and excludes bypassed devices", () => {
  const context = new Context(), input = new Node(), destination = new Node();
  const effects = ["delay", "chorus", "flanger", "phaser", "bitcrusher", "reverb"].map(createBrowserEffect);
  effects[2].enabled = false;
  const chain = connectWebAudioEffects(context, input, effects, destination);
  assert.deepEqual([...chain.keys()], effects.filter((effect) => effect.enabled).map((effect) => effect.id));
  const outputs = [...chain.values()].map((runtime) => runtime.nodes[2]);
  assert.ok(input.connections.includes(chain.get(effects[0].id).nodes[0]));
  for (let i = 0; i < outputs.length - 1; i++) assert.ok(outputs[i].connections.includes([...chain.values()][i + 1].nodes[0]));
  assert.ok(outputs.at(-1).connections.includes(destination));
  for (const runtime of chain.values()) runtime.stop?.();
  assert.ok(chain.get(effects[1].id).nodes.some((node) => node.stopped));
});
