import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TabRendererProps } from "./core";
import { useTabManager } from "./core";
import { YSButton } from "../components/YSButton";
import {
  getLatestDawSessionSnapshot,
  sendDawSessionCommand,
  subscribeDawSessionSnapshot,
  type DawSessionSnapshot,
  type DawSessionTrackSnapshot,
} from "../lib/dawSessionBus";
import type { DawMixerStripState } from "../lib/dawMixer";

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function MiniKnob({ label, value, min, max, step, onChange, display }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  display?: (value: number) => string;
}) {
  const drag = useRef<{ y: number; value: number; pointerId: number } | null>(null);
  const pct = (clamp(value, min, max) - min) / Math.max(0.00001, max - min);
  const angle = -135 + pct * 270;
  const commit = (raw: number) => {
    const stepped = Math.round(raw / step) * step;
    onChange(clamp(Number(stepped.toFixed(6)), min, max));
  };
  return (
    <div className="flex flex-col items-center min-w-0 select-none">
      <div className="text-[8px] uppercase tracking-[0.08em] opacity-65 truncate max-w-[54px]" title={label}>{label}</div>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        className="relative mt-1 h-8 w-8 rounded-full border border-white/10 bg-[radial-gradient(circle_at_34%_28%,#555,#222_38%,#0c0c0c_72%)] shadow-[inset_0_1px_2px_rgba(255,255,255,.12),0_3px_8px_rgba(0,0,0,.45)] cursor-ns-resize outline-none focus:ring-1 focus:ring-cyan-300/60"
        onPointerDown={(e) => {
          e.preventDefault();
          drag.current = { y: e.clientY, value, pointerId: e.pointerId };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const state = drag.current;
          if (!state || state.pointerId !== e.pointerId) return;
          commit(state.value + ((state.y - e.clientY) / 90) * (max - min));
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
      >
        <span className="absolute left-1/2 top-1/2 h-[11px] w-[2px] rounded-full bg-cyan-100 origin-[50%_100%]" style={{ transform: `translate(-50%,-100%) rotate(${angle}deg)` }} />
        <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black border border-white/15" />
      </div>
      <div className="mt-0.5 max-w-[58px] truncate text-[8px] font-mono opacity-75" title={display ? display(value) : String(value)}>{display ? display(value) : String(value)}</div>
    </div>
  );
}

function Toggle({ active, label, onClick, tone = "cyan" }: { active: boolean; label: string; onClick: () => void; tone?: "cyan" | "amber" | "rose" }) {
  const activeClass = tone === "amber" ? "bg-amber-300 text-black border-amber-100" : tone === "rose" ? "bg-rose-400 text-black border-rose-200" : "bg-cyan-300 text-black border-cyan-100";
  return <button type="button" onClick={onClick} className={`h-5 min-w-7 px-1 rounded border text-[8px] font-semibold ${active ? activeClass : "border-white/10 bg-black/20 opacity-65 hover:opacity-100"}`}>{label}</button>;
}

function Section({ title, accent, children }: { title: string; accent: string; children: ReactNode }) {
  return (
    <section className="border-b border-black/60 bg-[#23272a]">
      <div className="h-4 px-1.5 flex items-center text-[8px] font-bold tracking-[0.12em] text-black" style={{ background: accent }}>{title}</div>
      <div className="p-1.5">{children}</div>
    </section>
  );
}

function trackAccent(track: DawSessionTrackSnapshot) {
  if (track.type === "audio") return "linear-gradient(90deg,#67e8f9,#3b82f6)";
  return "linear-gradient(90deg,#fbbf24,#f97316)";
}

function ChannelStrip({ track, onOpenFx }: { track: DawSessionTrackSnapshot; onOpenFx: () => void }) {
  const m = track.mixer;
  const patch = (next: Partial<DawMixerStripState>) => sendDawSessionCommand({ type: "set-mixer", trackId: track.id, patch: next });
  const patchSend = (index: number, update: { level?: number; pre?: boolean }) => sendDawSessionCommand({ type: "set-send", trackId: track.id, index, ...update });
  const meterPct = clamp(track.meter, 0, 1) * 100;
  return (
    <div className="w-[184px] shrink-0 border-r border-black/80 bg-[#171a1c] text-neutral-100 shadow-[inset_-1px_0_rgba(255,255,255,.03)]">
      <div className="h-9 px-2 flex items-center gap-2 border-b border-black" style={{ background: trackAccent(track) }}>
        <div className="min-w-0 flex-1 text-black">
          <div className="truncate text-[11px] font-bold" title={track.name}>{track.name}</div>
          <div className="truncate text-[8px] opacity-70">{track.instrumentLabel || (track.type === "audio" ? "AUDIO" : "INSTRUMENT")}</div>
        </div>
        {track.desktopVstUnavailable && <span className="rounded bg-black/75 px-1 py-0.5 text-[7px] font-bold text-amber-200" title="Desktop VST3 unavailable on this device; previewing with Acoustic Grand Piano">PREVIEW</span>}
      </div>

      <Section title="INPUT" accent="#d8b54c">
        <div className="grid grid-cols-3 gap-1 items-center">
          <MiniKnob label="GAIN" value={m.inputGainDb} min={-24} max={24} step={0.5} onChange={(inputGainDb) => patch({ inputGainDb })} display={(v) => `${v.toFixed(1)}dB`} />
          <div className="flex flex-col items-center gap-1"><span className="text-[8px] opacity-60">POLARITY</span><Toggle active={m.phaseInvert} label="INV" onClick={() => patch({ phaseInvert: !m.phaseInvert })} tone="amber" /></div>
          <div className="flex flex-col items-center gap-1"><span className="text-[8px] opacity-60">OUT</span><span className="text-[8px] font-mono opacity-80">{m.output}</span></div>
        </div>
      </Section>

      <Section title="DYNAMICS" accent="#48b86b">
        <div className="flex items-center justify-between mb-1"><span className="text-[8px] font-semibold">COMP</span><Toggle active={m.compressorEnabled} label="ON" onClick={() => patch({ compressorEnabled: !m.compressorEnabled })} /></div>
        <div className="grid grid-cols-4 gap-1">
          <MiniKnob label="THRES" value={m.compressorThresholdDb} min={-60} max={0} step={1} onChange={(compressorThresholdDb) => patch({ compressorThresholdDb })} display={(v) => `${v.toFixed(0)}`} />
          <MiniKnob label="RATIO" value={m.compressorRatio} min={1} max={20} step={0.5} onChange={(compressorRatio) => patch({ compressorRatio })} display={(v) => `${v.toFixed(1)}:1`} />
          <MiniKnob label="ATK" value={m.compressorAttackMs} min={0.1} max={200} step={1} onChange={(compressorAttackMs) => patch({ compressorAttackMs })} display={(v) => `${v.toFixed(0)}ms`} />
          <MiniKnob label="REL" value={m.compressorReleaseMs} min={10} max={2000} step={10} onChange={(compressorReleaseMs) => patch({ compressorReleaseMs })} display={(v) => `${v.toFixed(0)}ms`} />
        </div>
        <div className="mt-2 flex items-center justify-between"><span className="text-[8px] font-semibold">GATE</span><Toggle active={m.gateEnabled} label="ON" onClick={() => patch({ gateEnabled: !m.gateEnabled })} tone="rose" /></div>
        <div className="grid grid-cols-5 gap-1 mt-1">
          <MiniKnob label="THRES" value={m.gateThresholdDb} min={-80} max={0} step={1} onChange={(gateThresholdDb) => patch({ gateThresholdDb })} display={(v) => `${v.toFixed(0)}`} />
          <MiniKnob label="RANGE" value={m.gateRangeDb} min={-80} max={0} step={1} onChange={(gateRangeDb) => patch({ gateRangeDb })} display={(v) => `${v.toFixed(0)}`} />
          <MiniKnob label="ATK" value={m.gateAttackMs} min={0.1} max={200} step={1} onChange={(gateAttackMs) => patch({ gateAttackMs })} display={(v) => `${v.toFixed(0)}`} />
          <MiniKnob label="REL" value={m.gateReleaseMs} min={5} max={2000} step={10} onChange={(gateReleaseMs) => patch({ gateReleaseMs })} display={(v) => `${v.toFixed(0)}`} />
          <MiniKnob label="HOLD" value={m.gateHoldMs} min={0} max={1000} step={5} onChange={(gateHoldMs) => patch({ gateHoldMs })} display={(v) => `${v.toFixed(0)}`} />
        </div>
      </Section>

      <Section title="EQ" accent="#e8972f">
        <div className="flex items-center justify-between mb-1"><Toggle active={m.eqEnabled} label="EQ" onClick={() => patch({ eqEnabled: !m.eqEnabled })} tone="amber" /><span className="text-[7px] opacity-45">4-BAND + FILTERS</span></div>
        <div className="grid grid-cols-4 gap-1 mb-2">
          <div className="flex flex-col items-center gap-1"><Toggle active={m.hpfEnabled} label="HPF" onClick={() => patch({ hpfEnabled: !m.hpfEnabled })} tone="amber" /><MiniKnob label="Hz" value={m.hpfHz} min={20} max={2000} step={5} onChange={(hpfHz) => patch({ hpfHz })} display={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : `${v.toFixed(0)}`} /></div>
          <div className="flex flex-col items-center gap-1"><Toggle active={m.lpfEnabled} label="LPF" onClick={() => patch({ lpfEnabled: !m.lpfEnabled })} tone="amber" /><MiniKnob label="Hz" value={m.lpfHz} min={1000} max={22000} step={100} onChange={(lpfHz) => patch({ lpfHz })} display={(v) => `${(v/1000).toFixed(1)}k`} /></div>
          <MiniKnob label="LMF Q" value={m.lowMidQ} min={0.2} max={8} step={0.1} onChange={(lowMidQ) => patch({ lowMidQ })} display={(v) => v.toFixed(1)} />
          <MiniKnob label="HMF Q" value={m.highMidQ} min={0.2} max={8} step={0.1} onChange={(highMidQ) => patch({ highMidQ })} display={(v) => v.toFixed(1)} />
        </div>
        <div className="grid grid-cols-4 gap-1">
          <MiniKnob label="LOW dB" value={m.lowGainDb} min={-18} max={18} step={0.5} onChange={(lowGainDb) => patch({ lowGainDb })} display={(v) => `${v.toFixed(1)}`} />
          <MiniKnob label="LMF dB" value={m.lowMidGainDb} min={-18} max={18} step={0.5} onChange={(lowMidGainDb) => patch({ lowMidGainDb })} display={(v) => `${v.toFixed(1)}`} />
          <MiniKnob label="HMF dB" value={m.highMidGainDb} min={-18} max={18} step={0.5} onChange={(highMidGainDb) => patch({ highMidGainDb })} display={(v) => `${v.toFixed(1)}`} />
          <MiniKnob label="HIGH dB" value={m.highGainDb} min={-18} max={18} step={0.5} onChange={(highGainDb) => patch({ highGainDb })} display={(v) => `${v.toFixed(1)}`} />
        </div>
        <div className="grid grid-cols-4 gap-1 mt-1">
          <MiniKnob label="LOW Hz" value={m.lowFreqHz} min={30} max={500} step={5} onChange={(lowFreqHz) => patch({ lowFreqHz })} display={(v) => `${v.toFixed(0)}`} />
          <MiniKnob label="LMF Hz" value={m.lowMidFreqHz} min={80} max={4000} step={20} onChange={(lowMidFreqHz) => patch({ lowMidFreqHz })} display={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : `${v.toFixed(0)}`} />
          <MiniKnob label="HMF Hz" value={m.highMidFreqHz} min={500} max={12000} step={50} onChange={(highMidFreqHz) => patch({ highMidFreqHz })} display={(v) => `${(v/1000).toFixed(1)}k`} />
          <MiniKnob label="HIGH Hz" value={m.highFreqHz} min={3000} max={20000} step={100} onChange={(highFreqHz) => patch({ highFreqHz })} display={(v) => `${(v/1000).toFixed(1)}k`} />
        </div>
      </Section>

      <Section title="INSERTS" accent="#f0a62a">
        <div className="space-y-1">
          {track.effects.length ? track.effects.map((effect, index) => <div key={effect.id} className="h-5 px-1.5 rounded border border-white/10 bg-black/25 flex items-center gap-1 text-[8px]"><span className="opacity-45">{index + 1}</span><span className="truncate flex-1">{effect.name}</span><span className={effect.enabled ? "text-emerald-300" : "opacity-35"}>●</span></div>) : <div className="h-5 px-1.5 rounded border border-dashed border-white/10 flex items-center text-[8px] opacity-40">No inserts</div>}
          <button type="button" onClick={onOpenFx} className="w-full h-5 rounded border border-white/10 bg-black/20 text-[8px] hover:bg-white/10">EDIT INSERTS</button>
        </div>
      </Section>

      <Section title="SENDS" accent="#52c66d">
        <div className="grid grid-cols-4 gap-x-1 gap-y-1.5">
          {m.sends.map((send, index) => <div key={index} className="flex flex-col items-center">
            <div className="text-[8px] font-bold">{index + 1}</div>
            <MiniKnob label="LEVEL" value={send.level} min={0} max={100} step={1} onChange={(level) => patchSend(index, { level })} display={(v) => `${v.toFixed(0)}`} />
            <button type="button" onClick={() => patchSend(index, { pre: !send.pre })} className={`mt-0.5 h-4 px-1 rounded text-[7px] border ${send.pre ? "bg-cyan-300 text-black border-cyan-100" : "border-white/10 opacity-55"}`}>{send.pre ? "PRE" : "POST"}</button>
          </div>)}
        </div>
      </Section>

      <Section title="FADER" accent="#d29a35">
        <div className="grid grid-cols-[1fr_1fr] gap-2 items-start">
          <MiniKnob label="WIDTH" value={m.width} min={0} max={200} step={1} onChange={(width) => patch({ width })} display={(v) => `${v.toFixed(0)}%`} />
          <MiniKnob label="PAN" value={m.pan} min={-1} max={1} step={0.01} onChange={(pan) => patch({ pan })} display={(v) => Math.abs(v) < .01 ? "C" : v < 0 ? `L${Math.round(-v*100)}` : `R${Math.round(v*100)}`} />
        </div>
        <div className="mt-1 flex justify-center gap-1"><Toggle active={track.mute} label="MUTE" onClick={() => sendDawSessionCommand({ type: "set-mute", trackId: track.id, value: !track.mute })} tone="amber" /><Toggle active={track.solo} label="SOLO" onClick={() => sendDawSessionCommand({ type: "set-solo", trackId: track.id, value: !track.solo })} /></div>
        <div className="mt-2 grid grid-cols-[22px_1fr_28px] gap-2 h-[145px] items-stretch">
          <div className="relative rounded bg-black/70 border border-white/5 overflow-hidden"><div className="absolute left-0 right-0 bottom-0 bg-gradient-to-t from-emerald-500 via-yellow-300 to-rose-400 transition-[height] duration-75" style={{ height: `${meterPct}%` }} /></div>
          <input aria-label={`${track.name} volume`} type="range" min={0} max={127} step={1} value={track.level} onChange={(e) => sendDawSessionCommand({ type: "set-level", trackId: track.id, value: Number(e.target.value) })} className="m-auto h-[138px] accent-cyan-300" style={{ writingMode: "vertical-lr", direction: "rtl" }} />
          <div className="flex flex-col justify-between text-[8px] font-mono opacity-55 py-1"><span>+2</span><span>0</span><span>-12</span><span>-24</span><span>-∞</span></div>
        </div>
        <div className="mt-1 text-center text-[9px] font-mono">{track.level}</div>
      </Section>

      <div className="h-10 px-2 flex items-center bg-[#1f2428] border-t border-black text-[9px]"><span className="truncate flex-1">{track.name}</span><span className="opacity-40">{track.type === "audio" ? "A" : "I"}</span></div>
    </div>
  );
}

function FxMasterPanel({ snapshot }: { snapshot: DawSessionSnapshot }) {
  const sends = ["Plate / Hall", "Ping Pong", "Chorus", "Parallel", "Send 5", "Send 6", "Send 7", "Send 8"];
  const meter = clamp(snapshot.masterMeter, 0, 1) * 100;
  return (
    <div className="w-[246px] shrink-0 bg-[#15181a] border-l-2 border-amber-300/20 text-neutral-100 sticky right-0 z-20 shadow-[-18px_0_30px_rgba(0,0,0,.3)]">
      <div className="h-9 px-2 flex items-center justify-between bg-gradient-to-r from-neutral-700 to-neutral-900 border-b border-black"><div><div className="text-[10px] font-bold tracking-[0.16em] text-amber-100">YC-9000</div><div className="text-[8px] opacity-55">FX / MASTER SECTION</div></div><img src="/ysong-logo-darkmode.png" className="w-6 h-6 object-contain" alt="YSong" /></div>
      <Section title="MASTER COMPRESSOR" accent="#765e44">
        <div className="rounded border border-black bg-[#111] p-1.5">
          <div className="h-[72px] rounded bg-[linear-gradient(#e9bd6a,#c99449)] relative overflow-hidden border border-black/70">
            <svg viewBox="0 0 180 75" className="absolute inset-0 h-full w-full"><path d="M25 60 A70 70 0 0 1 155 60" fill="none" stroke="#3e2817" strokeWidth="1.5"/><line x1="90" y1="61" x2="55" y2="25" stroke="#2b1b10" strokeWidth="2"/><text x="90" y="20" textAnchor="middle" fontSize="8" fill="#3e2817">GAIN REDUCTION</text></svg>
          </div>
          <div className="grid grid-cols-3 gap-1 mt-2"><MiniKnob label="THRESH" value={-18} min={-60} max={0} step={1} onChange={() => {}} display={(v) => `${v}`} /><MiniKnob label="RATIO" value={4} min={1} max={20} step={1} onChange={() => {}} display={(v) => `${v}:1`} /><MiniKnob label="MAKEUP" value={0} min={-12} max={12} step={1} onChange={() => {}} display={(v) => `${v}dB`} /></div>
        </div>
      </Section>
      <Section title="FX SEND / RETURN" accent="#4db364">
        <div className="space-y-1">
          {sends.map((name, index) => <div key={index} className="grid grid-cols-[18px_1fr_34px] gap-1 items-center"><div className="h-5 rounded bg-black/35 grid place-items-center text-[8px] font-bold">{index+1}</div><div className="h-5 rounded border border-white/10 bg-black/20 px-1.5 flex items-center text-[8px] truncate">{name}</div><div className="text-[8px] text-right opacity-55">RETURN</div></div>)}
        </div>
      </Section>
      <Section title="MASTER" accent="#c19a45">
        <div className="flex gap-3 items-stretch h-[260px]">
          <div className="flex-1 rounded border border-black bg-black/50 p-1 flex gap-1 items-end"><div className="relative flex-1 h-full rounded bg-neutral-950 overflow-hidden"><div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-emerald-500 via-yellow-300 to-rose-400 transition-[height] duration-75" style={{ height: `${meter}%` }} /></div><div className="relative flex-1 h-full rounded bg-neutral-950 overflow-hidden"><div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-emerald-500 via-yellow-300 to-rose-400 transition-[height] duration-75" style={{ height: `${meter*.92}%` }} /></div></div>
          <input aria-label="Master volume" type="range" min={0} max={127} step={1} value={snapshot.masterLevel} onChange={(e) => sendDawSessionCommand({ type: "set-master-level", value: Number(e.target.value) })} className="h-full accent-amber-300" style={{ writingMode: "vertical-lr", direction: "rtl" }} />
        </div>
        <div className="mt-2 flex justify-between text-[8px]"><button className="h-6 px-2 rounded border border-white/10 bg-black/20">DIM</button><button className="h-6 px-2 rounded border border-white/10 bg-black/20">MONO</button><div className="font-mono self-center">{snapshot.masterLevel}</div></div>
      </Section>
    </div>
  );
}

export default function MixerPane(_props: TabRendererProps) {
  const { tabs, activateTab } = useTabManager();
  const [snapshot, setSnapshot] = useState<DawSessionSnapshot | null>(() => getLatestDawSessionSnapshot());
  useEffect(() => subscribeDawSessionSnapshot(setSnapshot), []);

  const openTrackFx = (trackId: string) => {
    const daw = tabs.find((tab) => tab.type === "daw");
    if (daw) activateTab(daw.id);
    window.setTimeout(() => sendDawSessionCommand({ type: "open-track-fx", trackId }), 0);
  };

  if (!snapshot) {
    return <div className="h-full bg-[#111416] text-neutral-100 grid place-items-center"><div className="max-w-md text-center"><div className="text-xl font-semibold">YSong YC-9000 Mixer</div><p className="mt-2 text-sm opacity-60">Waiting for the DAW session. Open the DAW once and the console will mirror the project automatically.</p></div></div>;
  }

  return (
    <div className="h-full min-h-0 bg-[#0e1113] text-neutral-100 flex flex-col overflow-hidden">
      <div className="h-10 shrink-0 px-3 flex items-center gap-3 border-b border-black bg-[linear-gradient(180deg,#272c2f,#15181a)] shadow-lg">
        <div className="min-w-0"><div className="text-[11px] font-bold tracking-[0.18em] text-amber-100">YSong YC-9000 DIGITAL MIXING CONSOLE</div><div className="text-[9px] opacity-45 truncate">{snapshot.projectName}</div></div>
        <div className="ml-auto flex items-center gap-2 text-[9px]"><span className={`h-2 w-2 rounded-full ${snapshot.bridgeAvailable === false ? "bg-amber-400" : "bg-emerald-400"}`} /><span className="opacity-60">{snapshot.bridgeAvailable === false ? "PREVIEW MODE · BRIDGE OFFLINE" : "STUDIO SESSION"}</span><span className="opacity-35">{snapshot.bpm} BPM · {snapshot.sigNum}/{snapshot.sigDen}</span><YSButton className="h-7 px-2 rounded-md text-[10px]" onClick={() => sendDawSessionCommand({ type: "transport-toggle" })}>{snapshot.playing ? "❚❚ Pause" : "▶ Play"}</YSButton><YSButton className="h-7 px-2 rounded-md text-[10px]" onClick={() => sendDawSessionCommand({ type: "transport-stop" })}>■ Stop</YSButton></div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="min-w-max flex items-start">
          {snapshot.tracks.map((track) => <ChannelStrip key={track.id} track={track} onOpenFx={() => openTrackFx(track.id)} />)}
          <FxMasterPanel snapshot={snapshot} />
        </div>
      </div>
      <div className="h-8 shrink-0 px-3 flex items-center border-t border-black bg-[#15181a] text-[9px] opacity-70"><span>Signal flow: Input → Channel Strip → Inserts → Sends → Pan / Width → Fader → Master</span><span className="ml-auto font-mono">Bar {snapshot.playheadBar.toFixed(2)}</span></div>
    </div>
  );
}
