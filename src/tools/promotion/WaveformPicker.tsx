import { useEffect, useMemo, useRef, useState } from "react";

const MIN_CLIP = 5;
const MAX_CLIP = 60;
type DragMode = "new" | "move" | "start" | "end";

function fmt(seconds: number) {
  const value = Math.max(0, seconds || 0);
  return `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, "0")}`;
}

export default function WaveformPicker({ audioUrl, durationHint = 0, start, duration, onChange }: {
  audioUrl: string; durationHint?: number; start: number; duration: number; onChange: (start: number, duration: number) => void;
}) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [decodedDuration, setDecodedDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dragRef = useRef<{ mode: DragMode; anchor: number; initialStart: number; initialDuration: number } | null>(null);
  const total = Math.max(decodedDuration || durationHint, MIN_CLIP);
  const clipLength = Math.min(MAX_CLIP, total, Math.max(MIN_CLIP, duration));
  const clipStart = Math.min(Math.max(0, start), Math.max(0, total - clipLength));
  const clipEnd = clipStart + clipLength;

  useEffect(() => {
    let cancelled = false;
    if (!audioUrl) { setPeaks([]); setDecodedDuration(0); return; }
    setLoading(true);
    void (async () => {
      let context: AudioContext | undefined;
      try {
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error("Audio waveform could not be loaded");
        const buffer = await response.arrayBuffer();
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) throw new Error("Audio decoding is unavailable");
        context = new AudioContextClass();
        const decoded = await context.decodeAudioData(buffer.slice(0));
        const samples = decoded.getChannelData(0);
        const bucketCount = 420;
        const bucketSize = Math.max(1, Math.floor(samples.length / bucketCount));
        const next = Array.from({ length: bucketCount }, (_, index) => {
          let peak = 0;
          const end = Math.min(samples.length, (index + 1) * bucketSize);
          for (let sample = index * bucketSize; sample < end; sample++) peak = Math.max(peak, Math.abs(samples[sample] || 0));
          return peak;
        });
        if (!cancelled) { setPeaks(next); setDecodedDuration(decoded.duration || 0); }
      } catch {
        if (!cancelled) setPeaks([]);
      } finally {
        await context?.close().catch(() => undefined);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [audioUrl]);

  useEffect(() => {
    if (total > 0 && (clipStart !== start || clipLength !== duration)) onChange(clipStart, clipLength);
    // Parent callback identity is not part of the normalization condition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, start, duration]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = clipStart;
    setPlayhead(clipStart);
    setPreviewing(false);
  }, [audioUrl, clipStart, clipLength]);

  const bars = useMemo(() => peaks.map((value, index) => {
    const height = Math.max(2, Math.round(value * 92));
    return <rect key={index} x={`${index / peaks.length * 100}%`} y={`${50 - height / 2}%`} width={`${100 / peaks.length * .72}%`} height={`${height}%`} rx=".15" className="fill-neutral-400/65 dark:fill-neutral-500/70" />;
  }), [peaks]);

  function xToTime(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(total, (event.clientX - rect.left) / Math.max(1, rect.width) * total));
  }
  function changeRange(nextStart: number, nextEnd: number) {
    const length = Math.max(MIN_CLIP, Math.min(MAX_CLIP, nextEnd - nextStart, total));
    const safeStart = Math.max(0, Math.min(total - length, nextStart));
    onChange(safeStart, length);
  }
  function pointerDown(event: React.PointerEvent<SVGSVGElement>) {
    const time = xToTime(event);
    const edgeTolerance = total * .025;
    const inside = time >= clipStart && time <= clipEnd;
    const mode: DragMode = Math.abs(time - clipStart) <= edgeTolerance ? "start"
      : Math.abs(time - clipEnd) <= edgeTolerance ? "end"
        : inside ? "move" : "new";
    dragRef.current = { mode, anchor: time, initialStart: clipStart, initialDuration: clipLength };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "new") changeRange(time, time + MIN_CLIP);
  }
  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const time = xToTime(event);
    if (drag.mode === "move") {
      const nextStart = Math.max(0, Math.min(total - drag.initialDuration, drag.initialStart + time - drag.anchor));
      onChange(nextStart, drag.initialDuration);
    } else if (drag.mode === "start") changeRange(Math.min(time, clipEnd - MIN_CLIP), clipEnd);
    else if (drag.mode === "end") changeRange(clipStart, Math.max(time, clipStart + MIN_CLIP));
    else changeRange(Math.min(drag.anchor, time), Math.max(drag.anchor + MIN_CLIP, time));
  }

  function preview() {
    const audio = audioRef.current;
    if (!audio) return;
    if (previewing) { audio.pause(); setPreviewing(false); return; }
    audio.currentTime = clipStart;
    void audio.play().then(() => setPreviewing(true)).catch(() => setPreviewing(false));
  }

  return <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
    <div className="flex items-center justify-between gap-3">
      <div><div className="text-sm font-semibold">Choose the song section</div><div className="text-xs text-neutral-500">Drag to choose a section, move it, or adjust either edge. Clips are 5–60 seconds.</div></div>
      <button type="button" onClick={preview} disabled={!audioUrl} className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs disabled:opacity-50 dark:border-neutral-700">{previewing ? "■ Stop preview" : "▶ Preview selection"}</button>
    </div>
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500"><span>From {fmt(clipStart)}</span><span>To {fmt(clipEnd)}</span><span>{clipLength.toFixed(1)} sec selected</span>{decodedDuration > 0 && <span>{fmt(decodedDuration)} source</span>}</div>
    <div className="relative mt-3 h-32 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      {loading && <div className="absolute inset-0 z-20 grid place-items-center text-xs text-neutral-500">Building waveform…</div>}
      {!loading && peaks.length === 0 && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center text-xs text-neutral-500">Waveform unavailable. Use the start and length controls below.</div>}
      <svg aria-label="Song waveform. Drag to select a section; drag the selected section to move it." role="application" className="h-full w-full touch-none select-none" viewBox="0 0 100 100" preserveAspectRatio="none" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
        {bars}
        <rect x={`${clipStart / total * 100}%`} y="0" width={`${clipLength / total * 100}%`} height="100" className="fill-violet-500/20 stroke-violet-500" vectorEffect="non-scaling-stroke" />
        <line x1={`${clipStart / total * 100}%`} x2={`${clipStart / total * 100}%`} y1="0" y2="100" className="stroke-violet-600" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <line x1={`${clipEnd / total * 100}%`} x2={`${clipEnd / total * 100}%`} y1="0" y2="100" className="stroke-violet-600" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {previewing && <line x1={`${playhead / total * 100}%`} x2={`${playhead / total * 100}%`} y1="0" y2="100" className="stroke-rose-500" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-[11px] text-neutral-500">Start · {fmt(clipStart)}<input aria-label="Clip start time" className="mt-1 w-full" type="range" min={0} max={Math.max(0, total - clipLength)} step={.1} value={clipStart} onChange={event => onChange(Number(event.target.value), clipLength)} /></label>
      <label className="text-[11px] text-neutral-500">Length · {clipLength.toFixed(1)} sec<input aria-label="Clip length" className="mt-1 w-full" type="range" min={Math.min(MIN_CLIP, total)} max={Math.max(Math.min(MIN_CLIP, total), Math.min(MAX_CLIP, total - clipStart))} step={.1} value={clipLength} onChange={event => onChange(clipStart, Number(event.target.value))} /></label>
    </div>
    <audio ref={audioRef} src={audioUrl} preload="metadata" onTimeUpdate={event => {
      const audio = event.currentTarget;
      setPlayhead(audio.currentTime);
      if (audio.currentTime >= clipEnd) { audio.pause(); audio.currentTime = clipEnd; setPlayhead(clipEnd); setPreviewing(false); }
    }} onPause={() => setPreviewing(false)} onEnded={() => setPreviewing(false)} className="sr-only" />
  </div>;
}
