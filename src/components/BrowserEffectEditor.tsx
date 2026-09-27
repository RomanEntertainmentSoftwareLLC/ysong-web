import type { BrowserEffect } from "../lib/dawEffects";

type Parameter = { key: keyof BrowserEffect; label: string; min: number; max: number; step: number; unit: string };
const common: Parameter = { key: "mix", label: "Wet mix", min: 0, max: 1, step: 0.01, unit: "%" };
const parameters: Record<BrowserEffect["type"], Parameter[]> = {
  delay: [common, { key: "timeMs", label: "Delay", min: 1, max: 1000, step: 1, unit: "ms" }, { key: "feedback", label: "Feedback", min: 0, max: 0.85, step: 0.01, unit: "%" }],
  chorus: [common, { key: "timeMs", label: "Base delay", min: 5, max: 50, step: 1, unit: "ms" }, { key: "rateHz", label: "Rate", min: 0.05, max: 8, step: 0.05, unit: "Hz" }, { key: "depth", label: "Depth", min: 0, max: 1, step: 0.01, unit: "%" }],
  flanger: [common, { key: "timeMs", label: "Base delay", min: 1, max: 15, step: 0.5, unit: "ms" }, { key: "rateHz", label: "Rate", min: 0.05, max: 8, step: 0.05, unit: "Hz" }, { key: "depth", label: "Depth", min: 0, max: 1, step: 0.01, unit: "%" }, { key: "feedback", label: "Feedback", min: 0, max: 0.85, step: 0.01, unit: "%" }],
  phaser: [common, { key: "rateHz", label: "Rate", min: 0.05, max: 8, step: 0.05, unit: "Hz" }, { key: "depth", label: "Depth", min: 0, max: 1, step: 0.01, unit: "%" }, { key: "cutoffHz", label: "Center", min: 100, max: 5000, step: 10, unit: "Hz" }],
  bitcrusher: [common, { key: "bits", label: "Bit depth", min: 2, max: 16, step: 1, unit: "bits" }],
  reverb: [common, { key: "decaySeconds", label: "Decay", min: 0.2, max: 8, step: 0.1, unit: "s" }],
};

export default function BrowserEffectEditor({ effect, onChange, onClose }: {
  effect: BrowserEffect; onChange: (patch: Partial<BrowserEffect>) => void; onClose: () => void;
}) {
  return <div className="fixed inset-0 z-[280] flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={effect.name}>
    <button className="absolute inset-0 bg-black/70" aria-label="Close effect" onClick={onClose} />
    <section className="relative w-[min(540px,96vw)] max-h-[90vh] overflow-y-auto rounded-2xl border border-cyan-200/20 bg-neutral-950 p-5 shadow-2xl">
      <header className="flex items-center justify-between gap-4">
        <div><div className="text-xs uppercase tracking-widest text-cyan-200/60">YSong effect</div><h2 className="text-xl font-semibold">{effect.name}</h2></div>
        <button type="button" className="min-w-11 min-h-11 rounded-lg bg-white/10" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="mt-5 space-y-5">
        {parameters[effect.type].map(({ key, label, min, max, step, unit }) => {
          const value = Number(effect[key]);
          const display = unit === "%" ? `${Math.round(value * 100)}%` : `${value.toFixed(step < 1 ? 1 : 0)} ${unit}`;
          return <label key={key} className="block">
            <span className="mb-2 flex justify-between text-sm"><span>{label}</span><output className="font-mono text-cyan-100">{display}</output></span>
            <input aria-label={label} type="range" min={min} max={max} step={step} value={value}
              onChange={(event) => onChange({ [key]: Number(event.target.value) })} className="w-full h-10 accent-cyan-300 touch-pan-y" />
          </label>;
        })}
      </div>
      <button type="button" className={`mt-6 min-h-11 w-full rounded-lg border text-sm ${effect.enabled ? "border-cyan-300/40 bg-cyan-300/10" : "border-white/20 bg-white/5"}`} onClick={() => onChange({ enabled: !effect.enabled })}>
        {effect.enabled ? "Active — tap to bypass" : "Bypassed — tap to enable"}
      </button>
    </section>
  </div>;
}
