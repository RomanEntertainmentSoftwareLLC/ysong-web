export type DawMixerSendState = {
  level: number; // 0..100
  pre: boolean;
};

export type DawMixerStripState = {
  inputGainDb: number;
  phaseInvert: boolean;

  hpfEnabled: boolean;
  hpfHz: number;
  lpfEnabled: boolean;
  lpfHz: number;

  compressorEnabled: boolean;
  compressorThresholdDb: number;
  compressorRatio: number;
  compressorAttackMs: number;
  compressorReleaseMs: number;

  gateEnabled: boolean;
  gateThresholdDb: number;
  gateRangeDb: number;
  gateAttackMs: number;
  gateReleaseMs: number;
  gateHoldMs: number;

  eqEnabled: boolean;
  lowGainDb: number;
  lowFreqHz: number;
  lowMidGainDb: number;
  lowMidFreqHz: number;
  lowMidQ: number;
  highMidGainDb: number;
  highMidFreqHz: number;
  highMidQ: number;
  highGainDb: number;
  highFreqHz: number;

  sends: DawMixerSendState[];
  pan: number; // -1..1
  width: number; // 0..200 percent
  output: string;
};

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

const bool = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;

export function createDefaultMixerStrip(): DawMixerStripState {
  return {
    inputGainDb: 0,
    phaseInvert: false,
    hpfEnabled: false,
    hpfHz: 80,
    lpfEnabled: false,
    lpfHz: 18000,
    compressorEnabled: false,
    compressorThresholdDb: -18,
    compressorRatio: 4,
    compressorAttackMs: 12,
    compressorReleaseMs: 180,
    gateEnabled: false,
    gateThresholdDb: -45,
    gateRangeDb: -40,
    gateAttackMs: 2,
    gateReleaseMs: 120,
    gateHoldMs: 50,
    eqEnabled: true,
    lowGainDb: 0,
    lowFreqHz: 120,
    lowMidGainDb: 0,
    lowMidFreqHz: 500,
    lowMidQ: 1,
    highMidGainDb: 0,
    highMidFreqHz: 2500,
    highMidQ: 1,
    highGainDb: 0,
    highFreqHz: 10000,
    sends: Array.from({ length: 8 }, () => ({ level: 0, pre: false })),
    pan: 0,
    width: 100,
    output: "MASTER",
  };
}

export function normalizeMixerStrip(raw: unknown): DawMixerStripState {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const defaults = createDefaultMixerStrip();
  const rawSends = Array.isArray(source.sends) ? source.sends : [];
  const sends = Array.from({ length: 8 }, (_, index) => {
    const item = rawSends[index] && typeof rawSends[index] === "object" ? rawSends[index] as Record<string, unknown> : {};
    return {
      level: clamp(item.level, 0, 100, 0),
      pre: bool(item.pre, false),
    };
  });

  return {
    inputGainDb: clamp(source.inputGainDb, -24, 24, defaults.inputGainDb),
    phaseInvert: bool(source.phaseInvert, defaults.phaseInvert),
    hpfEnabled: bool(source.hpfEnabled, defaults.hpfEnabled),
    hpfHz: clamp(source.hpfHz, 20, 2000, defaults.hpfHz),
    lpfEnabled: bool(source.lpfEnabled, defaults.lpfEnabled),
    lpfHz: clamp(source.lpfHz, 1000, 22000, defaults.lpfHz),
    compressorEnabled: bool(source.compressorEnabled, defaults.compressorEnabled),
    compressorThresholdDb: clamp(source.compressorThresholdDb, -60, 0, defaults.compressorThresholdDb),
    compressorRatio: clamp(source.compressorRatio, 1, 20, defaults.compressorRatio),
    compressorAttackMs: clamp(source.compressorAttackMs, 0.1, 200, defaults.compressorAttackMs),
    compressorReleaseMs: clamp(source.compressorReleaseMs, 10, 2000, defaults.compressorReleaseMs),
    gateEnabled: bool(source.gateEnabled, defaults.gateEnabled),
    gateThresholdDb: clamp(source.gateThresholdDb, -80, 0, defaults.gateThresholdDb),
    gateRangeDb: clamp(source.gateRangeDb, -80, 0, defaults.gateRangeDb),
    gateAttackMs: clamp(source.gateAttackMs, 0.1, 200, defaults.gateAttackMs),
    gateReleaseMs: clamp(source.gateReleaseMs, 5, 2000, defaults.gateReleaseMs),
    gateHoldMs: clamp(source.gateHoldMs, 0, 1000, defaults.gateHoldMs),
    eqEnabled: bool(source.eqEnabled, defaults.eqEnabled),
    lowGainDb: clamp(source.lowGainDb, -18, 18, defaults.lowGainDb),
    lowFreqHz: clamp(source.lowFreqHz, 30, 500, defaults.lowFreqHz),
    lowMidGainDb: clamp(source.lowMidGainDb, -18, 18, defaults.lowMidGainDb),
    lowMidFreqHz: clamp(source.lowMidFreqHz, 80, 4000, defaults.lowMidFreqHz),
    lowMidQ: clamp(source.lowMidQ, 0.2, 8, defaults.lowMidQ),
    highMidGainDb: clamp(source.highMidGainDb, -18, 18, defaults.highMidGainDb),
    highMidFreqHz: clamp(source.highMidFreqHz, 500, 12000, defaults.highMidFreqHz),
    highMidQ: clamp(source.highMidQ, 0.2, 8, defaults.highMidQ),
    highGainDb: clamp(source.highGainDb, -18, 18, defaults.highGainDb),
    highFreqHz: clamp(source.highFreqHz, 3000, 20000, defaults.highFreqHz),
    sends,
    pan: clamp(source.pan, -1, 1, defaults.pan),
    width: clamp(source.width, 0, 200, defaults.width),
    output: typeof source.output === "string" && source.output.trim() ? source.output.trim() : defaults.output,
  };
}

export function patchMixerStrip(current: DawMixerStripState | undefined, patch: Partial<DawMixerStripState>): DawMixerStripState {
  return normalizeMixerStrip({ ...normalizeMixerStrip(current), ...patch });
}
