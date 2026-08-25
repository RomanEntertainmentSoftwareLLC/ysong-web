export type DynamicsC1Effect = {
  id: string;
  type: "compressor";
  name: "YSong Dynamics C•1";
  enabled: boolean;
  inputGainDb: number;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  outputGainDb: number;
};

export type DawTrackEffect = DynamicsC1Effect;

export function createDynamicsC1Effect(): DynamicsC1Effect {
  return {
    id: crypto.randomUUID(),
    type: "compressor",
    name: "YSong Dynamics C•1",
    enabled: true,
    inputGainDb: 0,
    thresholdDb: -18,
    ratio: 4,
    attackMs: 12,
    releaseMs: 180,
    kneeDb: 18,
    outputGainDb: 0,
  };
}

export function normalizeTrackEffects(raw: unknown): DawTrackEffect[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item: any) => item && item.type === "compressor")
    .map((item: any) => ({
      id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
      type: "compressor" as const,
      name: "YSong Dynamics C•1" as const,
      enabled: item.enabled !== false,
      inputGainDb: clampNumber(item.inputGainDb, -24, 24, 0),
      thresholdDb: clampNumber(item.thresholdDb, -60, 0, -18),
      ratio: clampNumber(item.ratio, 1, 20, 4),
      attackMs: clampNumber(item.attackMs, 0.1, 200, 12),
      releaseMs: clampNumber(item.releaseMs, 10, 2000, 180),
      kneeDb: clampNumber(item.kneeDb, 0, 40, 18),
      outputGainDb: clampNumber(item.outputGainDb, -24, 24, 0),
    }));
}

function clampNumber(raw: unknown, min: number, max: number, fallback: number) {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function dbToGain(db: number) {
  return Math.pow(10, db / 20);
}

export type WebAudioEffectRuntime = {
  compressor?: DynamicsCompressorNode;
  nodes: AudioNode[];
};

export function connectWebAudioEffects(
  context: BaseAudioContext,
  input: AudioNode,
  effects: DawTrackEffect[],
  destination: AudioNode,
): Map<string, WebAudioEffectRuntime> {
  const runtimes = new Map<string, WebAudioEffectRuntime>();
  let cursor = input;

  for (const effect of effects) {
    if (effect.type !== "compressor" || !effect.enabled) continue;
    const pre = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const post = context.createGain();
    pre.gain.value = dbToGain(effect.inputGainDb);
    compressor.threshold.value = effect.thresholdDb;
    compressor.ratio.value = effect.ratio;
    compressor.attack.value = effect.attackMs / 1000;
    compressor.release.value = effect.releaseMs / 1000;
    compressor.knee.value = effect.kneeDb;
    post.gain.value = dbToGain(effect.outputGainDb);

    cursor.connect(pre);
    pre.connect(compressor);
    compressor.connect(post);
    cursor = post;
    runtimes.set(effect.id, { compressor, nodes: [pre, compressor, post] });
  }

  cursor.connect(destination);
  return runtimes;
}
