import { useEffect, useMemo, useRef, useState } from "react";
import { midiToName } from "../lib/midi";
import { YSButton } from "./YSButton";

type Props = {
  open: boolean;
  trackName?: string;
  instrumentName?: string;
  externalActiveNotes?: Set<number>;
  onNoteOn: (pitch: number, velocity: number) => void;
  onNoteOff: (pitch: number) => void;
  onPanic?: () => void;
  onClose: () => void;
};

type Mode = "mouse" | "computer";

const COMPUTER_KEYS = [
  { key: "a", semi: 0 }, { key: "w", semi: 1 }, { key: "s", semi: 2 }, { key: "e", semi: 3 },
  { key: "d", semi: 4 }, { key: "f", semi: 5 }, { key: "t", semi: 6 }, { key: "g", semi: 7 },
  { key: "y", semi: 8 }, { key: "h", semi: 9 }, { key: "u", semi: 10 }, { key: "j", semi: 11 },
  { key: "k", semi: 12 }, { key: "o", semi: 13 }, { key: "l", semi: 14 }, { key: "p", semi: 15 },
  { key: ";", semi: 16 }, { key: "'", semi: 17 },
] as const;

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);

export default function OnScreenKeyboard({ open, trackName, instrumentName, externalActiveNotes, onNoteOn, onNoteOff, onPanic, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("mouse");
  const [octave, setOctave] = useState(4);
  const [velocity, setVelocity] = useState(98);
  const [sustain, setSustain] = useState(false);
  const [hold, setHold] = useState(false);
  const [active, setActive] = useState<Set<number>>(() => new Set());
  const sustainedRef = useRef<Set<number>>(new Set());

  const baseC = 12 * (octave + 1); // MIDI C4 = 60
  const mouseNotes = useMemo(() => Array.from({ length: 25 }, (_, i) => baseC - 12 + i), [baseC]);

  const release = (pitch: number, force = false) => {
    if (!force && hold) return;
    if (!force && sustain) {
      sustainedRef.current.add(pitch);
      setActive((prev) => { const next = new Set(prev); next.delete(pitch); return next; });
      return;
    }
    sustainedRef.current.delete(pitch);
    setActive((prev) => { const next = new Set(prev); next.delete(pitch); return next; });
    onNoteOff(pitch);
  };

  const press = (pitch: number) => {
    if (active.has(pitch)) {
      if (hold) release(pitch, true);
      return;
    }
    sustainedRef.current.delete(pitch);
    setActive((prev) => new Set(prev).add(pitch));
    onNoteOn(pitch, velocity);
  };

  const panic = () => {
    const all = new Set([...active, ...sustainedRef.current]);
    for (const pitch of all) onNoteOff(pitch);
    setActive(new Set());
    sustainedRef.current.clear();
    onPanic?.();
  };

  useEffect(() => {
    if (sustain) return;
    const releaseNow = [...sustainedRef.current];
    sustainedRef.current.clear();
    releaseNow.forEach((pitch) => onNoteOff(pitch));
  }, [sustain, onNoteOff]);

  useEffect(() => {
    if (!open || mode !== "computer") return;
    const down = new Set<string>();
    const onDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === "z") { e.preventDefault(); setOctave((v) => Math.max(0, v - 1)); return; }
      if (key === "x") { e.preventDefault(); setOctave((v) => Math.min(8, v + 1)); return; }
      const mapping = COMPUTER_KEYS.find((x) => x.key === key);
      if (!mapping || down.has(key) || e.repeat) return;
      e.preventDefault();
      down.add(key);
      press(baseC + mapping.semi);
    };
    const onUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mapping = COMPUTER_KEYS.find((x) => x.key === key);
      if (!mapping) return;
      down.delete(key);
      release(baseC + mapping.semi);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      panic();
    };
    // The handlers intentionally track the currently selected octave/mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, baseC, velocity, sustain, hold]);

  useEffect(() => () => panic(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const shownActive = new Set([...active, ...(externalActiveNotes ?? [])]);
  const whiteNotes = mouseNotes.filter((n) => !BLACK_PCS.has(n % 12));
  const whiteIndex = new Map<number, number>();
  whiteNotes.forEach((n, i) => whiteIndex.set(n, i));
  const whiteW = 100 / whiteNotes.length;

  return (
    <div className="fixed z-[180] left-1/2 -translate-x-1/2 bottom-[104px] w-[min(780px,94vw)] rounded-2xl border border-white/15 bg-neutral-950/95 shadow-2xl backdrop-blur-xl overflow-hidden" onPointerDown={(e) => e.stopPropagation()}>
      <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-white/10">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">On-screen Piano Keys</div>
          <div className="text-[11px] text-neutral-400 truncate">{trackName ?? "Select an instrument track"}{instrumentName ? ` • ${instrumentName}` : ""}</div>
        </div>
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          <button type="button" onClick={() => setMode("mouse")} className={`px-3 py-1 text-xs ${mode === "mouse" ? "bg-neutral-200 text-neutral-950" : "hover:bg-white/10"}`}>Mouse</button>
          <button type="button" onClick={() => setMode("computer")} className={`px-3 py-1 text-xs ${mode === "computer" ? "bg-neutral-200 text-neutral-950" : "hover:bg-white/10"}`}>Computer keys</button>
        </div>
        <YSButton className="w-7 h-7 p-0 rounded-md justify-center" onClick={() => { panic(); onClose(); }} title="Close keyboard">✕</YSButton>
      </div>

      <div className="px-3 pt-2 flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1"><span className="text-neutral-400">Octave</span><button className="w-7 h-7 rounded border border-white/15 hover:bg-white/10" onClick={() => setOctave((v) => Math.max(0, v - 1))}>−</button><span className="w-8 text-center font-mono">C{octave}</span><button className="w-7 h-7 rounded border border-white/15 hover:bg-white/10" onClick={() => setOctave((v) => Math.min(8, v + 1))}>+</button></div>
        <label className="flex items-center gap-2"><span className="text-neutral-400">Velocity</span><input type="range" min={1} max={127} value={velocity} onChange={(e) => setVelocity(Number(e.target.value))} className="w-28 accent-cyan-300" /><span className="font-mono w-7 text-right">{velocity}</span></label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={sustain} onChange={(e) => setSustain(e.target.checked)} /> Sustain</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} /> Hold</label>
        <button type="button" className="ml-auto rounded border border-rose-300/25 px-2 py-1 text-rose-200 hover:bg-rose-300/10" onClick={panic}>Panic</button>
      </div>

      {mode === "mouse" ? (
        <div className="relative mx-3 my-3 h-28 select-none">
          {whiteNotes.map((note, index) => (
            <button key={note} type="button" className={`absolute top-0 bottom-0 border border-neutral-500/60 rounded-b bg-neutral-100 hover:bg-cyan-100 ${shownActive.has(note) ? "!bg-cyan-300" : ""}`} style={{ left: `${index * whiteW}%`, width: `${whiteW}%` }} onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); press(note); }} onPointerUp={() => release(note)} onPointerCancel={() => release(note)} title={midiToName(note)}>
              <span className="absolute bottom-1 left-0 right-0 text-[9px] text-neutral-700">{midiToName(note)}</span>
            </button>
          ))}
          {mouseNotes.filter((n) => BLACK_PCS.has(n % 12)).map((note) => {
            const previousWhite = [...whiteNotes].reverse().find((w) => w < note);
            if (previousWhite == null) return null;
            const i = whiteIndex.get(previousWhite) ?? 0;
            return <button key={note} type="button" className={`absolute z-10 top-0 h-[64%] rounded-b border border-black bg-neutral-900 hover:bg-neutral-700 ${shownActive.has(note) ? "!bg-cyan-500" : ""}`} style={{ left: `${(i + 0.68) * whiteW}%`, width: `${whiteW * 0.62}%` }} onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); press(note); }} onPointerUp={() => release(note)} onPointerCancel={() => release(note)} title={midiToName(note)} />;
          })}
        </div>
      ) : (
        <div className="px-3 pb-3 pt-2">
          <div className="text-xs text-neutral-400 mb-2">Your computer keyboard becomes a piano while this panel is open. <strong>Z/X</strong> change octave.</div>
          <div className="flex flex-wrap gap-1.5 items-end justify-center rounded-xl border border-white/10 bg-black/20 p-3">
            {COMPUTER_KEYS.map((mapping) => {
              const note = baseC + mapping.semi;
              const black = BLACK_PCS.has(note % 12);
              return <div key={mapping.key} className={`w-9 rounded-md border text-center py-1.5 ${black ? "bg-neutral-800 border-neutral-600" : "bg-neutral-100 text-neutral-900 border-neutral-300"} ${shownActive.has(note) ? "ring-2 ring-cyan-300" : ""}`}><div className="font-bold uppercase">{mapping.key === ";" ? ";" : mapping.key === "'" ? "'" : mapping.key}</div><div className="text-[8px] opacity-60">{midiToName(note)}</div></div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
