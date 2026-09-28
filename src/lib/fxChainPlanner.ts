import {
  createBrowserEffect,
  createDynamicsC1Effect,
  normalizeTrackEffects,
  type BrowserEffect,
  type DawTrackEffect,
  type DynamicsC1Effect,
} from "./dawEffects.ts";

export type FxChainPlanDevice = { effect: DawTrackEffect; reason: string };
export type FxChainPlan = {
  v: 1;
  intent: string;
  summary: string;
  source: "ai" | "fallback";
  devices: FxChainPlanDevice[];
};

export type FxChainPlanOptions = { browserEffectsAvailable: boolean; source?: FxChainPlan["source"] };

const concise = (value: unknown, fallback: string, maximum = 180) => {
  if (typeof value !== "string") return fallback;
  return value.trim().replace(/\s+/g, " ").slice(0, maximum) || fallback;
};

export function normalizeFxChainPlan(raw: unknown, intent: string, options: FxChainPlanOptions): FxChainPlan {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const input = Array.isArray(record.devices) ? record.devices : Array.isArray(record.effects) ? record.effects : [];
  const devices: FxChainPlanDevice[] = [];
  for (const candidate of input.slice(0, 8)) {
    if (!candidate || typeof candidate !== "object") continue;
    const device = candidate as Record<string, unknown>;
    const proposed = device.effect && typeof device.effect === "object" ? device.effect : device;
    const type = (proposed as Record<string, unknown>).type;
    if (type !== "compressor" && !options.browserEffectsAvailable) continue;
    const normalized = normalizeTrackEffects([proposed])[0];
    if (!normalized) continue;
    devices.push({
      effect: { ...normalized, id: crypto.randomUUID() },
      reason: concise(device.reason, `Supports the ${intent || "requested"} processing direction.`),
    });
  }
  return {
    v: 1,
    intent: concise(intent, "balanced track polish", 120),
    summary: concise(record.summary, `Editable ${intent || "track processing"} chain using YSong effects.`),
    source: options.source ?? "ai",
    devices,
  };
}

const compressor = (patch: Partial<DynamicsC1Effect>, reason: string) => ({ effect: { ...createDynamicsC1Effect(), ...patch }, reason });
const browser = (type: BrowserEffect["type"], patch: Partial<BrowserEffect>, reason: string) => ({ effect: { ...createBrowserEffect(type), ...patch }, reason });

export function fallbackFxChainPlan(intent: string, options: Omit<FxChainPlanOptions, "source">): FxChainPlan {
  const value = intent.toLowerCase();
  let summary = "Balanced, editable track polish.";
  let devices: Array<{ effect: DawTrackEffect; reason: string }>;
  if (/spacious|lead vocal/.test(value)) {
    summary = "Controlled lead presence with tempo-friendly space and a clear reverb tail.";
    devices = [
      compressor({ thresholdDb: -20, ratio: 3.2, attackMs: 18, releaseMs: 150, kneeDb: 20 }, "Controls vocal peaks while keeping the lead forward."),
      browser("delay", { mix: 0.18, timeMs: 280, feedback: 0.26 }, "Adds audible space without washing out the center."),
      browser("reverb", { mix: 0.2, decaySeconds: 2.4 }, "Creates a cohesive vocal room after the echo."),
    ];
  } else if (/subtle|polish|cleaner mix|clean mix/.test(value)) {
    summary = "Low-impact dynamics and ambience for a cleaner, finished sound.";
    devices = [
      compressor({ thresholdDb: -16, ratio: 2.2, attackMs: 24, releaseMs: 180, kneeDb: 24 }, "Smooths level changes without sounding heavily compressed."),
      browser("reverb", { mix: 0.1, decaySeconds: 1.35 }, "Adds a small shared space while preserving clarity."),
    ];
  } else if (/aggressive|electronic vocal|cyber|futuristic/.test(value)) {
    summary = "Tight dynamics, digital edge, movement, and short futuristic space.";
    devices = [
      compressor({ thresholdDb: -24, ratio: 6, attackMs: 5, releaseMs: 95, kneeDb: 8, outputGainDb: 2 }, "Makes the source dense and immediate."),
      browser("bitcrusher", { mix: 0.2, bits: 9 }, "Adds a controlled digital edge."),
      browser("flanger", { mix: 0.18, rateHz: 0.35, depth: 0.55, timeMs: 5, feedback: 0.28 }, "Introduces metallic motion without replacing the dry signal."),
      browser("delay", { mix: 0.14, timeMs: 190, feedback: 0.22 }, "Finishes the chain with a compact cyber echo."),
    ];
  } else if (/wide synth/.test(value)) {
    summary = "Stereo-style modulation followed by depth and ambience for a wider synth.";
    devices = [
      browser("chorus", { mix: 0.32, rateHz: 0.55, depth: 0.62, timeMs: 24 }, "Creates smooth width and movement."),
      browser("delay", { mix: 0.13, timeMs: 360, feedback: 0.2 }, "Adds depth behind the widened source."),
      browser("reverb", { mix: 0.18, decaySeconds: 2.8 }, "Places the synth in a coherent space."),
    ];
  } else if (/dark|atmospheric|pad/.test(value)) {
    summary = "Slow modulation and long filtered ambience for a dark atmospheric pad.";
    devices = [
      browser("phaser", { mix: 0.24, rateHz: 0.18, depth: 0.7, cutoffHz: 620 }, "Adds slow spectral movement in the darker range."),
      browser("delay", { mix: 0.16, timeMs: 480, feedback: 0.38 }, "Extends the pad without dominating it."),
      browser("reverb", { mix: 0.38, decaySeconds: 5.2 }, "Creates the long atmospheric tail."),
    ];
  } else if (/lo.?fi|distort|crush|texture/.test(value)) {
    summary = "Deliberately reduced fidelity with controlled level and a small decayed room.";
    devices = [
      compressor({ thresholdDb: -22, ratio: 4.5, attackMs: 8, releaseMs: 120 }, "Keeps the degraded texture consistently present."),
      browser("bitcrusher", { mix: 0.48, bits: 6 }, "Provides the central low-fidelity character."),
      browser("reverb", { mix: 0.12, decaySeconds: 1.1 }, "Adds a short, worn-sounding space."),
    ];
  } else if (/punch|drum/.test(value)) {
    summary = "Fast dynamics for stronger drum impact with optional subtle grit.";
    devices = [
      compressor({ thresholdDb: -18, ratio: 5, attackMs: 20, releaseMs: 80, kneeDb: 6, outputGainDb: 1.5 }, "Shapes transients and recovers quickly between hits."),
      browser("bitcrusher", { mix: 0.07, bits: 12 }, "Adds a trace of edge without overt lo-fi damage."),
    ];
  } else {
    devices = [
      compressor({}, "Provides predictable level control."),
      browser("reverb", { mix: 0.14, decaySeconds: 1.8 }, "Adds conservative depth after dynamics."),
    ];
  }
  const plan = normalizeFxChainPlan({ summary, devices }, intent, { ...options, source: "fallback" });
  if (plan.devices.length || options.browserEffectsAvailable) return plan;
  return normalizeFxChainPlan({ summary: "Native-compatible dynamics proposal.", devices: [compressor({}, "Provides editable dynamics using the effect available on this native track.")] }, intent, { ...options, source: "fallback" });
}

export function parseFxChainPlanReply(reply: string): unknown {
  const text = reply.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("YSong AI did not return an FX-chain plan.");
  return JSON.parse(text.slice(start, end + 1));
}

export function summarizeEffect(effect: DawTrackEffect): string {
  if (effect.type === "compressor") return `${effect.thresholdDb} dB · ${effect.ratio}:1 · ${effect.attackMs} ms / ${effect.releaseMs} ms`;
  if (effect.type === "bitcrusher") return `${Math.round(effect.mix * 100)}% mix · ${effect.bits} bit`;
  if (effect.type === "reverb") return `${Math.round(effect.mix * 100)}% mix · ${effect.decaySeconds} s decay`;
  if (effect.type === "delay") return `${Math.round(effect.mix * 100)}% mix · ${effect.timeMs} ms · ${Math.round(effect.feedback * 100)}% feedback`;
  return `${Math.round(effect.mix * 100)}% mix · ${effect.rateHz} Hz · ${Math.round(effect.depth * 100)}% depth`;
}
