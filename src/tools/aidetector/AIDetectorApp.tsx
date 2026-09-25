import { useEffect, useMemo, useRef, useState } from "react";
import {
  aiDetectorReportUrl,
  analyzeAiOrigin,
  checkAiDetectorHealth,
  type DetectorReport,
} from "./api";

type Props = { onBack: () => void };
type ScanMode = "fast" | "deep";

const ACCEPT = ".wav,.flac,.mp3,.m4a,.aac,.ogg,.opus,.aiff,.aif,audio/*";

const metricLabels: Record<string, string> = {
  crest_db: "Crest factor",
  dynamic_spread_db: "Dynamic spread",
  macro_loudness_std_db: "Macro loudness variation",
  onset_grid_precision: "Onset grid precision",
  inter_onset_cv: "Inter-onset variation",
  spectral_stationarity: "Spectral stationarity",
  spectral_stationarity_variation: "Stationarity variation",
  spectral_flatness: "Spectral flatness",
  spectral_entropy_variation: "Spectral entropy variation",
  high_frequency_ratio: "High-frequency ratio",
  stereo_correlation: "Stereo correlation",
  stereo_width_ratio: "Stereo width ratio",
  stereo_width_variation: "Stereo width variation",
  cross_section_spectral_consistency: "Cross-section consistency",
  vocoder_comb_strength: "Vocoder comb strength",
  vocoder_comb_peak_ratio: "Vocoder comb peak ratio",
  vocoder_comb_spacing_hz: "Dominant comb spacing",
  generic_ai_support: "Generic AI-style support",
  human_counterevidence: "Human-like counterevidence",
  directional_coherence: "Layer directional coherence",
  evidence_quality: "Evidence magnitude",
  score_margin: "Distance from neutral",
};

function formatMetric(key: string, value: number) {
  if (key.includes("_db")) return `${value.toFixed(2)} dB`;
  if (key === "vocoder_comb_spacing_hz") return `${value.toFixed(1)} Hz`;
  if (key === "vocoder_comb_peak_ratio") return `${value.toFixed(2)}×`;
  if (key === "vocoder_comb_strength") return value.toFixed(3);
  if (key.includes("ratio") || key.includes("precision") || key.includes("stationarity") || key.includes("consistency") || key.includes("correlation") || key.includes("_cv") || key.includes("flatness") || ["generic_ai_support", "human_counterevidence", "directional_coherence", "evidence_quality", "score_margin"].includes(key)) return value.toFixed(3);
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function humanSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function verdictNote(report: DetectorReport) {
  if (report.strong_provenance) return "Explicit generator/provenance evidence found in the file. Structured provenance is interpreted locally; signatures are not cryptographically verified yet.";
  if (report.verdict === "uncertain") return "Signal evidence is mixed or too weak to separate cleanly.";
  return "Signal-evidence assessment · not provenance-confirmed.";
}

function verdictExplanation(report: DetectorReport) {
  if (report.strong_provenance) return "Explicit provenance plus signal evidence supports AI origin.";
  if (report.strong_signal_fingerprint) return "A persistent decoder-style spectral comb supplies strong architecture-level evidence even though explicit provenance is absent.";
  if (report.verdict === "likely_human") return "The measured behavior leans human-produced, but absence of AI evidence is not proof of human authorship.";
  if (report.verdict === "ai_like") return "Several signal traits lean AI-like, but generic waveform heuristics alone cannot confirm origin.";
  return "The evidence does not separate cleanly. YSong leaves the result indeterminate when cues disagree or remain weak.";
}

function SignalCanvas({ values, kind }: { values: number[]; kind: "spectrum" | "fakeprint" | "energy" }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !values.length) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, rect.width);
    const height = kind === "spectrum" ? 170 : kind === "fakeprint" ? 92 : 76;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(148,163,184,.18)";
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach(q => {
      const y = height * q;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    });
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    if (kind === "fakeprint") {
      gradient.addColorStop(0, "#f59e0b"); gradient.addColorStop(.55, "#fb7185"); gradient.addColorStop(1, "#8b5cf6");
    } else {
      gradient.addColorStop(0, "#8b5cf6"); gradient.addColorStop(.55, "#38bdf8"); gradient.addColorStop(1, "#2dd4bf");
    }
    ctx.strokeStyle = gradient;
    ctx.lineWidth = kind === "spectrum" ? 2 : 1.7;
    ctx.beginPath();
    values.forEach((raw, i) => {
      let normalized = 0;
      if (kind === "spectrum") normalized = Math.max(0, Math.min(1, (raw + 72) / 72));
      else if (kind === "energy") normalized = Math.max(0, Math.min(1, (raw + 60) / 57));
      else normalized = Math.max(0, Math.min(1, raw));
      const x = values.length <= 1 ? 0 : i / (values.length - 1) * width;
      const y = (1 - normalized) * (height - 12) + 6;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [values, kind]);
  return <canvas ref={ref} className="block w-full" style={{ height: kind === "spectrum" ? 170 : kind === "fakeprint" ? 92 : 76 }} />;
}

export default function AIDetectorApp({ onBack }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<ScanMode>("fast");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<DetectorReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [version, setVersion] = useState("0.6.0");

  useEffect(() => {
    let cancelled = false;
    checkAiDetectorHealth().then(value => {
      if (cancelled) return;
      setHealth("online"); setVersion(value.version || "0.6.0");
    }).catch(() => { if (!cancelled) setHealth("offline"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!busy) return;
    setProgress(7);
    const timer = window.setInterval(() => setProgress(p => p >= 91 ? p : Math.min(91, p + Math.max(1, Math.round((94 - p) * .065)))), 420);
    return () => window.clearInterval(timer);
  }, [busy]);

  const scoreAccent = useMemo(() => {
    if (!report) return "#8b5cf6";
    if (report.verdict === "likely_human") return "#2dd4bf";
    if (report.verdict === "uncertain") return "#f59e0b";
    return "#fb7185";
  }, [report]);

  const pick = (candidate?: File | null) => {
    if (!candidate) return;
    setFile(candidate); setReport(null); setError("");
  };

  const analyze = async () => {
    if (!file || busy) return;
    setBusy(true); setError(""); setReport(null);
    try {
      const next = await analyzeAiOrigin(file, mode);
      setProgress(100); setReport(next); setHealth("online");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setHealth("offline");
    } finally {
      window.setTimeout(() => setBusy(false), 250);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-7xl px-5 py-6 md:px-8 md:py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button type="button" onClick={onBack} className="mb-4 text-xs text-neutral-500 transition hover:text-violet-500">← Back to Tools</button>
            <div className="text-[11px] uppercase tracking-[.24em] text-violet-500">Origin Lens · local evidence scan</div>
            <h1 className="mt-1 !text-3xl md:!text-4xl !font-semibold tracking-tight">AI Music Detector</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">YSong v{version} combines provenance with spectral, timing, dynamics, stereo and cross-section evidence. It estimates origin without pretending waveform evidence is legal proof.</p>
          </div>
          <div className={`rounded-full border px-3 py-1.5 text-xs ${health === "online" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : health === "offline" ? "border-rose-500/30 bg-rose-500/10 text-rose-500" : "border-neutral-300 dark:border-neutral-700 text-neutral-500"}`}>
            {health === "online" ? "● Local detector online" : health === "offline" ? "● Local detector offline" : "● Starting local detector…"}
          </div>
        </div>

        <section className="mt-7 rounded-3xl border border-neutral-200 bg-white/80 p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/55 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><div className="text-[10px] uppercase tracking-[.2em] text-violet-500">1 · Source</div><h2 className="mt-1 text-xl font-semibold">Drop a track</h2></div>
            <div className="flex rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-950">
              {(["fast", "deep"] as ScanMode[]).map(item => <button key={item} type="button" disabled={busy} onClick={() => setMode(item)} className={`rounded-lg px-4 py-2 text-xs font-medium transition ${mode === item ? "bg-violet-600 text-white shadow" : "text-neutral-500 hover:text-neutral-900 dark:hover:text-white"}`}>{item === "fast" ? "Fast Scan" : "Deep Scan"}</button>)}
            </div>
          </div>
          <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={e => pick(e.target.files?.[0])} />
          <button type="button" onClick={() => inputRef.current?.click()} onDragEnter={e => { e.preventDefault(); }} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }} className="mt-5 flex w-full items-center gap-4 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50/70 p-6 text-left transition hover:border-violet-500/60 hover:bg-violet-500/[.035] dark:border-neutral-700 dark:bg-neutral-950/60">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-violet-500/25 bg-violet-500/10 text-2xl text-violet-500">⌁</div>
            <div className="min-w-0"><div className="truncate font-medium">{file ? file.name : "Drop audio here or click to select"}</div><div className="mt-1 text-xs text-neutral-500">{file ? `${humanSize(file.size)} · ready for ${mode} scan` : "WAV · FLAC · MP3 · M4A · AAC · OGG · OPUS · AIFF"}</div></div>
          </button>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" disabled={!file || busy || health !== "online"} onClick={analyze} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-45">{busy ? "Analyzing…" : "Analyze origin"}</button>
            <span className="text-xs text-neutral-500">{mode === "fast" ? "3 strategic windows at reduced decode rate." : "Up to 9 longer windows at 44.1 kHz with a larger FFT."}</span>
          </div>
          {busy && <div className="mt-4"><div className="flex justify-between text-[11px] text-neutral-500"><span>Building six-layer evidence report…</span><span>{progress}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${progress}%` }} /></div></div>}
          {error && <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-500">{error}</div>}
        </section>

        {report && <>
          <div className="mt-5 grid gap-5 xl:grid-cols-[.82fr_1.18fr]">
            <section className="rounded-3xl border border-neutral-200 bg-white/80 p-5 dark:border-neutral-800 dark:bg-neutral-900/55 md:p-6">
              <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.2em] text-violet-500">2 · Verdict</div><h2 className="mt-1 text-xl font-semibold">Origin assessment</h2></div><span className="text-[11px] text-neutral-500">{report.mode} · {report.analysis_profile.sampled_windows} windows · {report.elapsed_seconds.toFixed(2)}s</span></div>
              <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
                <div className="grid h-36 w-36 shrink-0 place-items-center rounded-full p-[10px]" style={{ background: `conic-gradient(${scoreAccent} ${report.ai_evidence_score}%, rgba(148,163,184,.16) 0)` }}><div className="grid h-full w-full place-items-center rounded-full bg-white text-center dark:bg-neutral-900"><div><div className="text-4xl font-semibold tabular-nums">{report.ai_evidence_score.toFixed(1)}</div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">AI evidence</div></div></div></div>
                <div><div className="text-2xl font-semibold">{report.verdict_label}</div><div className="mt-2 text-sm text-neutral-500">Evidence strength <strong className="text-neutral-800 dark:text-neutral-200">{report.evidence_agreement.toFixed(1)}%</strong></div><p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{verdictExplanation(report)}</p><div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/70">{verdictNote(report)}</div></div>
              </div>
              <div className="mt-6 grid grid-cols-3 text-[10px] uppercase tracking-wide text-neutral-500"><span>Human-leaning</span><span className="text-center">Indeterminate</span><span className="text-right">AI-leaning</span></div>
            </section>

            <section className="rounded-3xl border border-neutral-200 bg-white/80 p-5 dark:border-neutral-800 dark:bg-neutral-900/55 md:p-6">
              <div className="text-[10px] uppercase tracking-[.2em] text-violet-500">3 · Signal view</div><h2 className="mt-1 text-xl font-semibold">Spectrum + fingerprint + energy</h2>
              <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-950 p-2 dark:border-neutral-800"><SignalCanvas values={report.visuals.spectrum_db} kind="spectrum" /><SignalCanvas values={report.visuals.fakeprint || []} kind="fakeprint" /><SignalCanvas values={report.visuals.energy_db} kind="energy" /></div>
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-neutral-500"><span>Smoothed spectrum · decoder residue · loudness envelope</span><span>Fingerprint view emphasizes narrow comb structure</span></div>
            </section>
          </div>

          <section className="mt-5 rounded-3xl border border-neutral-200 bg-white/80 p-5 dark:border-neutral-800 dark:bg-neutral-900/55 md:p-6">
            <div className="text-[10px] uppercase tracking-[.2em] text-violet-500">4 · Six-layer evidence</div><h2 className="mt-1 text-xl font-semibold">Why YSong leaned this way</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{report.layers.map(layer => <div key={layer.id} className="rounded-2xl border border-neutral-200 bg-neutral-50/75 p-4 dark:border-neutral-800 dark:bg-neutral-950/60"><div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-neutral-500"><span>Layer 0{layer.id}</span><span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{layer.score.toFixed(1)}</span></div><div className="mt-2 font-semibold">{layer.name}</div><p className="mt-2 min-h-16 text-xs leading-5 text-neutral-500">{layer.detail}</p><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(0, Math.min(100, layer.score))}%` }} /></div></div>)}</div>
          </section>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <section className="rounded-3xl border border-neutral-200 bg-white/80 p-5 dark:border-neutral-800 dark:bg-neutral-900/55 md:p-6"><div className="text-[10px] uppercase tracking-[.2em] text-violet-500">5 · Measurements</div><h2 className="mt-1 text-xl font-semibold">Signal metrics</h2><div className="mt-4 grid gap-2 sm:grid-cols-2">{Object.entries(report.measurements).map(([key, value]) => <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-950/60"><span className="text-neutral-500">{metricLabels[key] || key}</span><strong className="tabular-nums">{formatMetric(key, value)}</strong></div>)}</div></section>
            <section className="rounded-3xl border border-neutral-200 bg-white/80 p-5 dark:border-neutral-800 dark:bg-neutral-900/55 md:p-6"><div className="text-[10px] uppercase tracking-[.2em] text-violet-500">6 · Provenance</div><h2 className="mt-1 text-xl font-semibold">Container clues</h2><div className="mt-4 space-y-3 text-xs leading-5">
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/60"><strong>Structured AI provenance</strong><div className="mt-1 text-neutral-500">{report.provenance.explicit_ai_manifest ? "Explicit generated / algorithmic-media declaration found." : report.provenance.manifest_generator_hits.length ? "Manifest clues found, but no explicit AI declaration." : "None found."}</div></div>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/60"><strong>Generator metadata</strong><div className="mt-1 text-neutral-500">{report.provenance.generator_metadata_hits.length ? report.provenance.generator_metadata_hits.join(", ") : "None found."}</div></div>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/60"><strong>C2PA / JUMBF structure</strong><div className="mt-1 text-neutral-500">{report.provenance.c2pa_markers.length ? report.provenance.c2pa_markers.join(", ") : "None found."}</div></div>
              {(report.provenance.claim_generator || report.provenance.digital_source_types.length > 0) && <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/60"><strong>Manifest details</strong><div className="mt-1 text-neutral-500">{report.provenance.claim_generator ? `Generator: ${report.provenance.claim_generator}` : ""}{report.provenance.claim_generator && report.provenance.digital_source_types.length ? " · " : ""}{report.provenance.digital_source_types.length ? `Source type: ${report.provenance.digital_source_types.join(", ")}` : ""}</div></div>}
            </div></section>
          </div>

          <section className="mt-5 flex flex-col gap-4 rounded-3xl border border-neutral-200 bg-white/80 p-5 dark:border-neutral-800 dark:bg-neutral-900/55 md:flex-row md:items-center md:justify-between md:p-6"><div><div className="text-[10px] uppercase tracking-[.2em] text-violet-500">Report</div><h2 className="mt-1 text-xl font-semibold">Keep the evidence, not just the verdict.</h2><p className="mt-1 text-sm text-neutral-500">JSON includes all six layers, measurements, sampled windows, provenance clues and calibration diagnostics.</p></div><a href={aiDetectorReportUrl(report.analysis_id)} download className="shrink-0 rounded-xl border border-violet-500/35 bg-violet-500/10 px-4 py-2.5 text-sm font-medium text-violet-500 hover:bg-violet-500/15">Download JSON report</a></section>

          <section className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/[.07] px-4 py-3 text-xs leading-5 text-amber-700 dark:text-amber-300"><strong>Experimental evidence ensemble:</strong> Evidence strength is not the probability a track is AI-generated. Human DAW productions can be quantized, compressed and looped; AI audio can be edited, remastered or combined with human material. Missing metadata never proves human authorship, and this build does not claim to decode proprietary watermarks such as Google SynthID.</section>
        </>}
      </div>
    </div>
  );
}
