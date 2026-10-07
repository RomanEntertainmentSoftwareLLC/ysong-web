import { normalizeSidechainSource, type SidechainSource } from "./dawSidechain.ts";

export type DynamicsC1Effect = {
  id: string; type: "compressor"; name: "YSong Dynamics C•1"; enabled: boolean;
  inputGainDb: number; thresholdDb: number; ratio: number; attackMs: number;
  releaseMs: number; kneeDb: number; outputGainDb: number;
  sidechainSource?: SidechainSource;
};
export type BrowserEffectType = "delay" | "chorus" | "flanger" | "phaser" | "bitcrusher" | "reverb";
export type BrowserEffect = {
  id: string; type: BrowserEffectType; name: string; enabled: boolean; mix: number;
  rateHz: number; depth: number; timeMs: number; feedback: number; bits: number;
  cutoffHz: number; decaySeconds: number;
};
export type DawTrackEffect = DynamicsC1Effect | BrowserEffect;
export const browserEffectNames: Record<BrowserEffectType, string> = {
  delay: "Echo Delay", chorus: "Chorus", flanger: "Flanger", phaser: "Phaser",
  bitcrusher: "Bit Crusher", reverb: "Reverb",
};
export function createDynamicsC1Effect(): DynamicsC1Effect {
  return { id: crypto.randomUUID(), type: "compressor", name: "YSong Dynamics C•1", enabled: true,
    inputGainDb: 0, thresholdDb: -18, ratio: 4, attackMs: 12, releaseMs: 180, kneeDb: 18, outputGainDb: 0 };
}
export function createBrowserEffect(type: BrowserEffectType): BrowserEffect {
  return { id: crypto.randomUUID(), type, name: browserEffectNames[type], enabled: true,
    mix: type === "reverb" ? 0.25 : 0.35, rateHz: type === "phaser" ? 0.5 : 0.8, depth: 0.5,
    timeMs: type === "delay" ? 320 : type === "chorus" ? 25 : 4, feedback: type === "delay" ? 0.35 : 0.2,
    bits: 8, cutoffHz: 900, decaySeconds: 2.2 };
}
const clampNumber = (raw: unknown, min: number, max: number, fallback: number) => {
  const value = Number(raw); return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
};
export function normalizeTrackEffects(raw: unknown): DawTrackEffect[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown): DawTrackEffect[] => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === "string" && entry.id ? entry.id : crypto.randomUUID();
    const enabled = entry.enabled !== false;
    if (entry.type === "compressor") return [{
      id, type: "compressor" as const, name: "YSong Dynamics C•1" as const, enabled,
      ...(normalizeSidechainSource(entry.sidechainSource) ? { sidechainSource: normalizeSidechainSource(entry.sidechainSource)! } : {}),
      inputGainDb: clampNumber(entry.inputGainDb, -24, 24, 0), thresholdDb: clampNumber(entry.thresholdDb, -60, 0, -18),
      ratio: clampNumber(entry.ratio, 1, 20, 4), attackMs: clampNumber(entry.attackMs, 0.1, 200, 12),
      releaseMs: clampNumber(entry.releaseMs, 10, 2000, 180), kneeDb: clampNumber(entry.kneeDb, 0, 40, 18),
      outputGainDb: clampNumber(entry.outputGainDb, -24, 24, 0),
    }];
    if (typeof entry.type !== "string" || !(entry.type in browserEffectNames)) return [];
    const type = entry.type as BrowserEffectType, defaults = createBrowserEffect(type);
    return [{ id, type, name: browserEffectNames[type], enabled,
      mix: clampNumber(entry.mix, 0, 1, defaults.mix), rateHz: clampNumber(entry.rateHz, 0.05, 8, defaults.rateHz),
      depth: clampNumber(entry.depth, 0, 1, defaults.depth), timeMs: clampNumber(entry.timeMs, 1, 1000, defaults.timeMs),
      feedback: clampNumber(entry.feedback, 0, 0.85, defaults.feedback), bits: clampNumber(entry.bits, 2, 16, defaults.bits),
      cutoffHz: clampNumber(entry.cutoffHz, 100, 5000, defaults.cutoffHz),
      decaySeconds: clampNumber(entry.decaySeconds, 0.2, 8, defaults.decaySeconds) }];
  });
}
export function dbToGain(db: number) { return Math.pow(10, db / 20); }
export type WebAudioEffectRuntime = { compressor?: DynamicsCompressorNode; nodes: AudioNode[]; stop?: () => void };
function impulse(context: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.round(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let seed = 0x1234567 + channel * 0x9e3779b;
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      data[i] = ((seed >>> 0) / 2147483648 - 1) * Math.pow(1 - i / length, 2);
    }
  }
  return buffer;
}
export function connectWebAudioEffects(context: BaseAudioContext, input: AudioNode, effects: DawTrackEffect[], destination: AudioNode): Map<string, WebAudioEffectRuntime> {
  const runtimes = new Map<string, WebAudioEffectRuntime>();
  let cursor = input;
  for (const effect of effects) {
    if (!effect.enabled) continue;
    if (effect.type === "compressor") {
      const pre = context.createGain(), compressor = context.createDynamicsCompressor(), post = context.createGain();
      pre.gain.value = dbToGain(effect.inputGainDb); compressor.threshold.value = effect.thresholdDb;
      compressor.ratio.value = effect.ratio; compressor.attack.value = effect.attackMs / 1000;
      compressor.release.value = effect.releaseMs / 1000; compressor.knee.value = effect.kneeDb;
      post.gain.value = dbToGain(effect.outputGainDb);
      cursor.connect(pre); pre.connect(compressor); compressor.connect(post); cursor = post;
      runtimes.set(effect.id, { compressor, nodes: [pre, compressor, post] }); continue;
    }
    const dry = context.createGain(), wet = context.createGain(), output = context.createGain();
    dry.gain.value = 1 - effect.mix; wet.gain.value = effect.mix;
    cursor.connect(dry); dry.connect(output);
    const nodes: AudioNode[] = [dry, wet, output]; let stop: (() => void) | undefined;
    if (effect.type === "delay" || effect.type === "chorus" || effect.type === "flanger") {
      const delay = context.createDelay(1.1); delay.delayTime.value = effect.timeMs / 1000;
      cursor.connect(delay); delay.connect(wet); nodes.push(delay);
      if (effect.type !== "chorus") {
        const feedback = context.createGain(); feedback.gain.value = effect.feedback;
        delay.connect(feedback); feedback.connect(delay); nodes.push(feedback);
      }
      if (effect.type !== "delay") {
        const lfo = context.createOscillator(), amount = context.createGain();
        lfo.frequency.value = effect.rateHz;
        amount.gain.value = Math.min(effect.timeMs / 1000, 0.02) * effect.depth * 0.8;
        lfo.connect(amount); amount.connect(delay.delayTime); lfo.start();
        nodes.push(lfo, amount); stop = () => lfo.stop();
      }
    } else if (effect.type === "phaser") {
      const lfo = context.createOscillator(), amount = context.createGain();
      lfo.frequency.value = effect.rateHz; amount.gain.value = Math.min(effect.cutoffHz * effect.depth, 2500);
      let stage: AudioNode = cursor;
      for (let i = 0; i < 4; i++) {
        const filter = context.createBiquadFilter(); filter.type = "allpass";
        filter.frequency.value = Math.min(context.sampleRate * 0.45, effect.cutoffHz * (0.55 + i * 0.35));
        filter.Q.value = 0.7; stage.connect(filter); amount.connect(filter.frequency);
        stage = filter; nodes.push(filter);
      }
      stage.connect(wet); lfo.connect(amount); lfo.start(); nodes.push(lfo, amount); stop = () => lfo.stop();
    } else if (effect.type === "bitcrusher") {
      const shaper = context.createWaveShaper(), levels = 2 ** effect.bits;
      const curve = new Float32Array(65536);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.round(((i / (curve.length - 1)) * 2 - 1) * levels / 2) / (levels / 2);
      shaper.curve = curve; cursor.connect(shaper); shaper.connect(wet); nodes.push(shaper);
    } else if (effect.type === "reverb") {
      const convolver = context.createConvolver(); convolver.buffer = impulse(context, effect.decaySeconds);
      cursor.connect(convolver); convolver.connect(wet); nodes.push(convolver);
    }
    wet.connect(output); cursor = output; runtimes.set(effect.id, { nodes, stop });
  }
  cursor.connect(destination); return runtimes;
}
