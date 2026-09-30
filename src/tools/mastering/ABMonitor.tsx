import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  masteringFileUrl,
  masteringPackageUrl,
  masteringSourceAudioUrl,
  originalAudioUrl,
  type MasteringReport,
} from "./api";

type Mode = "original" | "master" | "difference";
type AnalyzerSet = { original: AnalyserNode; master: AnalyserNode; difference: AnalyserNode };
type GainSet = { original: GainNode; master: GainNode; difference: GainNode };

function dbToGain(value: number) {
  return Math.pow(10, value / 20);
}

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const whole = Math.floor(seconds - minutes * 60);
  return `${minutes}:${String(whole).padStart(2, "0")}`;
}

function safeStem(filename: string | undefined) {
  const withoutExtension = String(filename || "YSong").replace(/\.[^./\\]+$/, "") || "YSong";
  const withoutControls = Array.from(withoutExtension, char => char.charCodeAt(0) < 32 ? "_" : char).join("");
  return withoutControls.replace(/[<>:"/\\|?*]/g, "_").replace(/[. ]+$/g, "").trim() || "YSong";
}

function targetToken(target: number) {
  if (!Number.isFinite(target)) return "CustomLUFS";
  const rounded = Math.abs(target - Math.round(target)) < 0.001 ? target.toFixed(0) : target.toFixed(1);
  return `${rounded}LUFS`;
}

function analyserBars(analyser: AnalyserNode, count = 56) {
  const values = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(values);
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.pow(i / count, 2.15);
    const b = Math.pow((i + 1) / count, 2.15);
    const start = Math.max(1, Math.floor(a * values.length));
    const end = Math.max(start + 1, Math.floor(b * values.length));
    let sum = 0;
    let max = 0;
    for (let j = start; j < Math.min(end, values.length); j++) {
      sum += values[j];
      max = Math.max(max, values[j]);
    }
    const average = sum / Math.max(1, Math.min(end, values.length) - start);
    bars.push(Math.min(1, (average * 0.72 + max * 0.28) / 255));
  }
  return bars;
}

function drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(10, 10, 14, 0.94)";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.10)";
  ctx.lineWidth = 1;
  for (let row = 1; row < 4; row++) {
    const y = (height * row) / 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function SpectrumCanvas({ analyser, accent, label, active }: { analyser: AnalyserNode | null; accent: string; label: string; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawBackdrop(ctx, width, height);
      if (analyser) {
        const bars = analyserBars(analyser);
        const gap = Math.max(1, width * 0.003);
        const barWidth = (width - gap * (bars.length - 1)) / bars.length;
        bars.forEach((value, index) => {
          const h = Math.max(2 * dpr, value * height * 0.88);
          const x = index * (barWidth + gap);
          const y = height - h;
          const gradient = ctx.createLinearGradient(0, height, 0, 0);
          gradient.addColorStop(0, accent);
          gradient.addColorStop(1, "rgba(255,255,255,0.92)");
          ctx.globalAlpha = active ? 0.98 : 0.58;
          ctx.fillStyle = gradient;
          ctx.fillRect(x, y, Math.max(1, barWidth), h);
        });
        ctx.globalAlpha = 1;
      }
      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [analyser, accent, active]);

  return <div className={`overflow-hidden rounded-xl border ${active ? "border-violet-500/60 shadow-[0_0_0_1px_rgba(139,92,246,.18)]" : "border-neutral-800"}`}>
    <div className="flex items-center justify-between bg-neutral-950 px-3 py-2 text-[10px] uppercase tracking-[.16em] text-neutral-400">
      <span>{label}</span><span>{active ? "Audible" : "Monitoring"}</span>
    </div>
    <canvas ref={canvasRef} className="block h-40 w-full" />
  </div>;
}

function OverlaySpectrum({ analyzers }: { analyzers: AnalyzerSet | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawBackdrop(ctx, width, height);
      if (analyzers) {
        const drawLine = (values: number[], stroke: string) => {
          ctx.beginPath();
          values.forEach((value, index) => {
            const x = (index / Math.max(1, values.length - 1)) * width;
            const y = height - Math.max(2 * dpr, value * height * 0.88);
            if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 2 * dpr;
          ctx.stroke();
        };
        drawLine(analyserBars(analyzers.original, 96), "rgba(56,189,248,.88)");
        drawLine(analyserBars(analyzers.master, 96), "rgba(167,139,250,.92)");
      }
      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [analyzers]);
  return <div className="overflow-hidden rounded-xl border border-neutral-800">
    <div className="flex flex-wrap items-center justify-between gap-2 bg-neutral-950 px-3 py-2 text-[10px] uppercase tracking-[.16em] text-neutral-400">
      <span>Overlay spectrum</span><span><span className="text-sky-400">Original</span> · <span className="text-violet-400">Remaster</span></span>
    </div>
    <canvas ref={canvasRef} className="block h-52 w-full" />
  </div>;
}

export default function ABMonitor({ assetId, originalFilename, report }: { assetId: string; originalFilename?: string; report: MasteringReport }) {
  const [mode, setMode] = useState<Mode>("master");
  const [loudnessMatch, setLoudnessMatch] = useState(true);
  const [includeOriginal, setIncludeOriginal] = useState(true);
  const [overlay, setOverlay] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [analyzers, setAnalyzers] = useState<AnalyzerSet | null>(null);
  const [mediaReady, setMediaReady] = useState<Record<Mode, boolean>>({ original: false, master: false, difference: false });
  const [mediaError, setMediaError] = useState("");
  const originalRef = useRef<HTMLAudioElement | null>(null);
  const masterRef = useRef<HTMLAudioElement | null>(null);
  const differenceRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainsRef = useRef<GainSet | null>(null);
  const syncFrameRef = useRef<number | null>(null);
  const lastUiTickRef = useRef(0);

  const match = useMemo(() => {
    const a = Number(report.before.integrated_lufs);
    const b = Number(report.after.integrated_lufs);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return { originalDb: 0, masterDb: 0, label: "Loudness data unavailable" };
    const quieter = Math.min(a, b);
    const originalDb = quieter - a;
    const masterDb = quieter - b;
    const delta = Math.abs(a - b);
    const louder = a > b ? "Original" : b > a ? "Remaster" : "Neither";
    return {
      originalDb,
      masterDb,
      label: delta < 0.05 ? "Already loudness matched" : `${louder} attenuated ${delta.toFixed(2)} dB for fair A/B`,
    };
  }, [report.before.integrated_lufs, report.after.integrated_lufs]);

  const allMediaReady = mediaReady.original && mediaReady.master && mediaReady.difference;
  const fileStem = useMemo(() => safeStem(originalFilename), [originalFilename]);
  const lufsToken = targetToken(Number(report.settings?.target_lufs));
  const downloadNames = useMemo(() => ({
    original: originalFilename || `${fileStem}_Original`,
    master: `${fileStem}_Remaster_${lufsToken}.wav`,
    difference: `${fileStem}_Difference_${lufsToken}.wav`,
    package: `${fileStem}_Remaster_${lufsToken}_Package.zip`,
  }), [fileStem, lufsToken, originalFilename]);

  const applyGains = useCallback((nextMode: Mode, matched: boolean) => {
    const gains = gainsRef.current;
    if (!gains) return;
    const now = audioContextRef.current?.currentTime || 0;
    const ramp = 0.012;
    const originalGainDb = matched ? match.originalDb : 0;
    const masterGainDb = matched ? match.masterDb : 0;
    const targets = {
      original: nextMode === "original" ? Math.min(dbToGain(originalGainDb), dbToGain(-1)) : 0,
      master: nextMode === "master" ? Math.min(dbToGain(masterGainDb), dbToGain(-1)) : 0,
      difference: nextMode === "difference" ? dbToGain(-1) : 0,
    };
    (Object.keys(targets) as Mode[]).forEach(key => {
      const node = gains[key];
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(targets[key], now + ramp);
    });
  }, [match.masterDb, match.originalDb]);

  const ensureGraph = useCallback(async () => {
    if (audioContextRef.current && gainsRef.current && analyzers) {
      if (audioContextRef.current.state === "suspended") await audioContextRef.current.resume();
      return;
    }
    const elements = { original: originalRef.current, master: masterRef.current, difference: differenceRef.current };
    if (!elements.original || !elements.master || !elements.difference) return;
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) throw new Error("Web Audio is not available in this browser.");
    const context = new AudioContextCtor();
    const nextAnalyzers = {} as AnalyzerSet;
    const nextGains = {} as GainSet;
    (Object.keys(elements) as Mode[]).forEach(key => {
      const element = elements[key]!;
      const source = context.createMediaElementSource(element);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.74;
      analyser.minDecibels = -92;
      analyser.maxDecibels = -10;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(context.destination);
      nextAnalyzers[key] = analyser;
      nextGains[key] = gain;
    });
    audioContextRef.current = context;
    gainsRef.current = nextGains;
    setAnalyzers(nextAnalyzers);
    applyGains(mode, loudnessMatch);
    if (context.state === "suspended") await context.resume();
  }, [analyzers, applyGains, loudnessMatch, mode]);

  const stopSyncLoop = useCallback(() => {
    if (syncFrameRef.current !== null) cancelAnimationFrame(syncFrameRef.current);
    syncFrameRef.current = null;
  }, []);

  useEffect(() => {
    stopSyncLoop();
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setMediaError("");
    setMediaReady({ original: false, master: false, difference: false });
    [originalRef.current, masterRef.current, differenceRef.current].forEach(element => {
      if (!element) return;
      element.pause();
      try { element.currentTime = 0; } catch { /* metadata may not be loaded yet */ }
      element.load();
    });
  }, [assetId, report.run_id, stopSyncLoop]);

  const startSyncLoop = useCallback(() => {
    stopSyncLoop();
    const tick = (stamp: number) => {
      const original = originalRef.current;
      const master = masterRef.current;
      const difference = differenceRef.current;
      if (!original || !master || !difference || original.paused) return;
      const clock = original.currentTime;
      if (master.readyState >= 2 && Math.abs(master.currentTime - clock) > 0.02) master.currentTime = clock;
      if (difference.readyState >= 2 && Math.abs(difference.currentTime - clock) > 0.02) difference.currentTime = clock;
      if (stamp - lastUiTickRef.current > 80) {
        setCurrentTime(clock);
        lastUiTickRef.current = stamp;
      }
      syncFrameRef.current = requestAnimationFrame(tick);
    };
    syncFrameRef.current = requestAnimationFrame(tick);
  }, [stopSyncLoop]);

  useEffect(() => {
    applyGains(mode, loudnessMatch);
  }, [applyGains, loudnessMatch, mode]);

  useEffect(() => () => {
    stopSyncLoop();
    const context = audioContextRef.current;
    if (context && context.state !== "closed") void context.close();
  }, [stopSyncLoop]);

  async function togglePlayback() {
    const original = originalRef.current;
    const master = masterRef.current;
    const difference = differenceRef.current;
    if (!original || !master || !difference) return;
    if (!allMediaReady) { setMediaError("A/B audio is still loading. Give the three local streams a moment to become ready."); return; }
    if (playing) {
      original.pause(); master.pause(); difference.pause();
      stopSyncLoop();
      setPlaying(false);
      return;
    }
    await ensureGraph();
    const t = Math.min(currentTime, Math.max(0, duration - 0.02));
    [original, master, difference].forEach(element => { if (Math.abs(element.currentTime - t) > 0.01) element.currentTime = t; });
    try {
      await Promise.all([original.play(), master.play(), difference.play()]);
      const startAt = original.currentTime;
      [master, difference].forEach(element => { if (Math.abs(element.currentTime - startAt) > 0.005) element.currentTime = startAt; });
      setPlaying(true);
      startSyncLoop();
    } catch {
      original.pause(); master.pause(); difference.pause();
      setPlaying(false);
    }
  }

  function seek(next: number) {
    const value = Math.max(0, Math.min(duration || next, next));
    setCurrentTime(value);
    [originalRef.current, masterRef.current, differenceRef.current].forEach(element => {
      if (element && Number.isFinite(value)) element.currentTime = value;
    });
  }

  function selectMode(next: Mode) {
    setMode(next);
    applyGains(next, loudnessMatch);
  }

  const compensation = loudnessMatch ? match.label : "Loudness Match OFF · delivered levels";

  return <section className="mt-5 rounded-2xl border border-neutral-200 bg-white/70 p-5 dark:border-neutral-800 dark:bg-neutral-900/45">
    <audio ref={originalRef} crossOrigin="anonymous" preload="auto" src={masteringSourceAudioUrl(assetId)} onLoadedMetadata={e => setDuration(e.currentTarget.duration || report.before.duration_seconds || 0)} onCanPlay={() => setMediaReady(value => ({ ...value, original: true }))} onError={() => setMediaError("Original A/B stream failed to load.")} onEnded={() => { setPlaying(false); setCurrentTime(0); stopSyncLoop(); }} />
    <audio ref={masterRef} crossOrigin="anonymous" preload="auto" src={masteringFileUrl(assetId, report.run_id, "master")} onCanPlay={() => setMediaReady(value => ({ ...value, master: true }))} onError={() => setMediaError("Remaster A/B stream failed to load.")} />
    <audio ref={differenceRef} crossOrigin="anonymous" preload="auto" src={masteringFileUrl(assetId, report.run_id, "difference")} onCanPlay={() => setMediaReady(value => ({ ...value, difference: true }))} onError={() => setMediaError("Difference A/B stream failed to load.")} />

    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Synchronized A/B verification</div>
        <h2 className="mt-1 text-lg font-semibold">Synchronized audition</h2>
        <p className="mt-1 max-w-3xl text-xs text-neutral-500">All three streams follow one transport. Original and Remaster stay closely time-aligned; decoder and browser scheduling can still introduce a small offset. Switching is gain-ramped to avoid clicks.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {([['original', 'A · Original'], ['master', 'B · Remaster'], ['difference', 'Δ · Difference']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} onClick={() => selectMode(key)} className={`rounded-lg border px-3 py-2 text-xs ${mode === key ? "border-violet-500/50 bg-violet-500/10 text-violet-500" : "border-neutral-300 dark:border-neutral-700"}`}>{label}</button>)}
      </div>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50/80 p-3 dark:border-neutral-800 dark:bg-neutral-950/45">
      <button type="button" onClick={togglePlayback} disabled={!allMediaReady} className="min-w-24 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-50">{playing ? "Pause" : allMediaReady ? "Play A/B" : "Loading A/B…"}</button>
      <span className="w-24 text-center font-mono text-xs tabular-nums">{formatClock(currentTime)} / {formatClock(duration)}</span>
      <input aria-label="A/B playback position" type="range" min="0" max={Math.max(0.01, duration)} step="0.01" value={Math.min(currentTime, Math.max(0.01, duration))} onChange={e => seek(Number(e.target.value))} className="min-w-48 flex-1 accent-violet-600" />
    </div>
    {mediaError && <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/[.05] px-3 py-2 text-xs text-amber-500">{mediaError}</div>}

    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={loudnessMatch} onChange={e => setLoudnessMatch(e.target.checked)} className="h-4 w-4 accent-violet-600"/><span>Loudness Match</span></label>
      <div className="text-xs text-neutral-500">{compensation}</div>
      <button type="button" onClick={() => setOverlay(value => !value)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700">{overlay ? "Side-by-side spectra" : "Overlay spectra"}</button>
    </div>

    <div className="mt-4">
      {overlay ? <OverlaySpectrum analyzers={analyzers}/> : <div className="grid gap-3 lg:grid-cols-2">
        <SpectrumCanvas analyser={analyzers?.original || null} accent="rgba(56,189,248,.95)" label="Original spectrum" active={mode === "original"}/>
        <SpectrumCanvas analyser={analyzers?.master || null} accent="rgba(167,139,250,.98)" label="Remaster spectrum" active={mode === "master"}/>
      </div>}
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-neutral-200 p-3 text-xs dark:border-neutral-800"><div className="text-[10px] uppercase tracking-wide text-neutral-500">Original loudness</div><div className="mt-1 text-lg font-semibold tabular-nums">{report.before.integrated_lufs.toFixed(1)} LUFS</div></div>
      <div className="rounded-xl border border-neutral-200 p-3 text-xs dark:border-neutral-800"><div className="text-[10px] uppercase tracking-wide text-neutral-500">Remaster loudness</div><div className="mt-1 text-lg font-semibold tabular-nums">{report.after.integrated_lufs.toFixed(1)} LUFS</div></div>
      <div className="rounded-xl border border-neutral-200 p-3 text-xs dark:border-neutral-800"><div className="text-[10px] uppercase tracking-wide text-neutral-500">Original true peak</div><div className="mt-1 text-lg font-semibold tabular-nums">{report.before.true_peak_dbtp.toFixed(2)} dBTP</div></div>
      <div className="rounded-xl border border-neutral-200 p-3 text-xs dark:border-neutral-800"><div className="text-[10px] uppercase tracking-wide text-neutral-500">Remaster true peak</div><div className="mt-1 text-lg font-semibold tabular-nums">{report.after.true_peak_dbtp.toFixed(2)} dBTP</div></div>
    </div>

    <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/[.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="text-[10px] uppercase tracking-[.16em] text-emerald-500">Non-destructive export</div><div className="mt-1 text-sm font-medium">Your exact upload remains available.</div><div className="mt-1 text-xs text-neutral-500">Exports are fixed files: audition selection and Loudness Match affect monitoring only. Difference WAV is the rendered difference signal. The package contains the remaster, difference signal and report, plus the exact original when selected.</div></div>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={includeOriginal} onChange={e => setIncludeOriginal(e.target.checked)} className="h-4 w-4 accent-emerald-500"/><span>Include exact original</span></label>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <a className="text-violet-500" href={originalAudioUrl(assetId)} download={downloadNames.original}>Download exact original</a>
        <a className="text-violet-500" href={masteringFileUrl(assetId, report.run_id, "master")} download={downloadNames.master}>Download remaster WAV</a>
        <a className="text-violet-500" href={masteringFileUrl(assetId, report.run_id, "difference")} download={downloadNames.difference}>Download difference WAV</a>
        <a className="font-semibold text-emerald-500" href={masteringPackageUrl(assetId, report.run_id, includeOriginal)} download={downloadNames.package}>Download Remaster Package</a>
        <a className="text-violet-500" target="_blank" rel="noreferrer" href={masteringFileUrl(assetId, report.run_id, "report")}>Open JSON report →</a>
      </div>
    </div>
  </section>;
}
