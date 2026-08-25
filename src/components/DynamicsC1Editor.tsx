import { useRef } from "react";
import type { DynamicsC1Effect } from "../lib/dawEffects";

type Props = {
  effect: DynamicsC1Effect;
  signal: number;
  gainReductionDb: number;
  onChange: (patch: Partial<DynamicsC1Effect>) => void;
  onClose: () => void;
};

type KnobProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  decimals?: number;
  onChange: (value: number) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function C1Knob({ label, value, min, max, step, unit = "", decimals = 1, onChange }: KnobProps) {
  const drag = useRef<{ y: number; value: number; pointerId: number } | null>(null);
  const pct = (clamp(value, min, max) - min) / Math.max(0.000001, max - min);
  const angle = -135 + pct * 270;
  const commit = (next: number) => {
    const stepped = Math.round(next / step) * step;
    onChange(clamp(Number(stepped.toFixed(6)), min, max));
  };

  return (
    <div className="flex flex-col items-center min-w-0 select-none">
      <div className="text-[10px] tracking-[0.16em] text-amber-100/80 mb-1.5">{label}</div>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        className="relative w-16 h-16 rounded-full cursor-ns-resize outline-none focus:ring-2 focus:ring-amber-300/40 shadow-[inset_0_2px_4px_rgba(255,255,255,0.12),0_5px_14px_rgba(0,0,0,0.55)]"
        style={{ background: "radial-gradient(circle at 35% 28%, #555 0%, #242424 36%, #111 70%, #070707 100%)", border: "1px solid rgba(255,214,140,.18)" }}
        onPointerDown={(e) => {
          e.preventDefault();
          drag.current = { y: e.clientY, value, pointerId: e.pointerId };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const state = drag.current;
          if (!state || state.pointerId !== e.pointerId) return;
          const delta = (state.y - e.clientY) / 120;
          commit(state.value + delta * (max - min));
        }}
        onPointerUp={(e) => {
          if (drag.current?.pointerId === e.pointerId) drag.current = null;
          try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
        }}
        onPointerCancel={() => { drag.current = null; }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); commit(value + step); }
          if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); commit(value - step); }
          if (e.key === "Home") { e.preventDefault(); commit(min); }
          if (e.key === "End") { e.preventDefault(); commit(max); }
        }}
        title="Drag up/down or use arrow keys"
      >
        <div className="absolute inset-[8px] rounded-full border border-white/5" />
        <div
          className="absolute left-1/2 top-1/2 w-[2px] h-[21px] bg-amber-100 rounded-full origin-[50%_100%] shadow-[0_0_5px_rgba(255,210,130,.6)]"
          style={{ transform: `translate(-50%, -100%) rotate(${angle}deg)` }}
        />
        <div className="absolute left-1/2 top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/80 border border-white/10" />
      </div>
      <div className="mt-1.5 text-[10px] font-mono text-amber-100/70 truncate max-w-full">
        {value.toFixed(decimals)}{unit}
      </div>
    </div>
  );
}

function AnalogMeter({ label, value, min = 0, max = 1, suffix = "" }: { label: string; value: number; min?: number; max?: number; suffix?: string }) {
  const pct = clamp((value - min) / Math.max(0.000001, max - min), 0, 1);
  const angle = -48 + pct * 96;
  return (
    <div className="rounded-lg border border-black/80 bg-[#141414] p-1 shadow-[inset_0_0_0_1px_rgba(255,220,150,.08),0_5px_20px_rgba(0,0,0,.5)]">
      <div className="relative overflow-hidden rounded-md h-[122px]" style={{ background: "linear-gradient(#e7b862,#f1cb82 58%,#c89547)", boxShadow: "inset 0 0 28px rgba(85,40,0,.32)" }}>
        <svg viewBox="0 0 300 140" className="absolute inset-0 w-full h-full" aria-label={label}>
          <path d="M38 108 A120 120 0 0 1 262 108" fill="none" stroke="rgba(54,30,12,.72)" strokeWidth="2" />
          {Array.from({ length: 11 }).map((_, i) => {
            const a = (-48 + i * 9.6) * Math.PI / 180;
            const x1 = 150 + Math.sin(a) * 102;
            const y1 = 122 - Math.cos(a) * 102;
            const x2 = 150 + Math.sin(a) * 114;
            const y2 = 122 - Math.cos(a) * 114;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(45,25,12,.8)" strokeWidth={i % 5 === 0 ? 2.2 : 1.2} />;
          })}
          <g transform={`rotate(${angle} 150 123)`}>
            <line x1="150" y1="123" x2="150" y2="29" stroke="#29170f" strokeWidth="2.2" />
          </g>
          <circle cx="150" cy="123" r="7" fill="#2b1a10" />
          <text x="150" y="28" textAnchor="middle" fontSize="13" fill="rgba(46,25,12,.75)" fontWeight="700">YSong</text>
          <text x="150" y="92" textAnchor="middle" fontSize="11" fill="rgba(46,25,12,.68)">{suffix}</text>
        </svg>
        <div className="absolute left-0 right-0 bottom-1 text-center text-[10px] tracking-[0.14em] font-semibold text-black/75">{label}</div>
      </div>
    </div>
  );
}

export default function DynamicsC1Editor({ effect, signal, gainReductionDb, onChange, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[280] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="YSong Dynamics C1 compressor">
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Close compressor" />
      <div className="relative w-[min(940px,96vw)] max-h-[94vh] overflow-auto rounded-2xl border border-amber-100/15 shadow-2xl" style={{ background: "linear-gradient(180deg,#252525,#111 78%)", boxShadow: "0 30px 90px rgba(0,0,0,.72), inset 0 0 0 1px rgba(255,210,140,.04)" }}>
        <div className="h-10 px-3 flex items-center justify-between border-b border-amber-100/10 bg-black/30">
          <div className="text-xs tracking-[0.16em] text-amber-100/80">YSong Dynamics C•1</div>
          <button type="button" className="w-8 h-8 rounded-md hover:bg-white/10" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="p-4 sm:p-6">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_230px_1fr] gap-4 items-center">
            <AnalogMeter label="INPUT / OUTPUT" value={signal} suffix="VU" />
            <div className="flex flex-col items-center justify-center min-h-[105px]">
              <img src="/ysong-logo-with-title-darkmode.png" className="w-[190px] max-w-full opacity-90" alt="YSong" />
              <div className="mt-2 text-[10px] tracking-[0.38em] text-amber-100/65">DYNAMICS C•1</div>
              <div className={`mt-3 w-2.5 h-2.5 rounded-full ${effect.enabled ? "bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,.8)]" : "bg-neutral-700"}`} />
            </div>
            <AnalogMeter label="GAIN REDUCTION" value={Math.min(20, Math.max(0, gainReductionDb))} min={0} max={20} suffix={`${gainReductionDb.toFixed(1)} dB`} />
          </div>

          <div className="mt-5 border-t border-amber-100/10 pt-5 grid grid-cols-3 sm:grid-cols-6 gap-4 sm:gap-5">
            <C1Knob label="INPUT" value={effect.inputGainDb} min={-24} max={24} step={0.5} unit=" dB" onChange={(inputGainDb) => onChange({ inputGainDb })} />
            <C1Knob label="THRESHOLD" value={effect.thresholdDb} min={-60} max={0} step={0.5} unit=" dB" onChange={(thresholdDb) => onChange({ thresholdDb })} />
            <C1Knob label="RATIO" value={effect.ratio} min={1} max={20} step={0.1} unit=":1" onChange={(ratio) => onChange({ ratio })} />
            <C1Knob label="ATTACK" value={effect.attackMs} min={0.1} max={200} step={0.1} unit=" ms" onChange={(attackMs) => onChange({ attackMs })} />
            <C1Knob label="RELEASE" value={effect.releaseMs} min={10} max={2000} step={5} unit=" ms" decimals={0} onChange={(releaseMs) => onChange({ releaseMs })} />
            <C1Knob label="OUTPUT" value={effect.outputGainDb} min={-24} max={24} step={0.5} unit=" dB" onChange={(outputGainDb) => onChange({ outputGainDb })} />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 border-t border-amber-100/10 pt-4">
            <button
              type="button"
              className={`min-h-10 px-4 rounded-lg border text-xs tracking-[0.12em] ${effect.enabled ? "border-amber-300/45 bg-amber-300/10 text-amber-100" : "border-white/15 bg-white/5 text-white/55"}`}
              onClick={() => onChange({ enabled: !effect.enabled })}
            >
              {effect.enabled ? "ACTIVE" : "BYPASSED"}
            </button>
            <label className="flex items-center gap-2 min-h-10 px-3 rounded-lg border border-white/10 bg-black/20 text-xs text-white/70">
              <span>KNEE</span>
              <input type="range" min={0} max={40} step={1} value={effect.kneeDb} onChange={(e) => onChange({ kneeDb: Number(e.target.value) })} className="accent-amber-300" />
              <span className="w-10 text-right font-mono">{effect.kneeDb.toFixed(0)} dB</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
