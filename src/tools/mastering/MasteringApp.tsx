import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { checkVocalHealth, type LocalJob, type UploadResult } from "../stemrestore/api";
import ABMonitor from "./ABMonitor";
import {
  masteringAnalysisUrl,
  startMasteringAnalysis,
  startMasteringRender,
  uploadForMastering,
  waitForLocalJob,
  type DynamicEqCandidate,
  type MasterMetrics,
  type MasteringAnalysis,
  type MasteringReport,
  type RemasterMode,
} from "./api";

type Props = { onBack: () => void; initialUpload?: UploadResult | null };
type Stage = "idle" | "uploading" | "ready" | "analyzing" | "rendering" | "done" | "error";

function fmt(value: unknown, digits = 1, suffix = "") {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}${suffix}` : "—";
}

function formatTime(seconds: number) {
  const value = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(value / 60);
  return `${m}:${(value - m * 60).toFixed(1).padStart(4, "0")}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
}

const acceptedAudioExtensions = new Set(["wav", "flac", "mp3", "m4a", "aac", "ogg", "opus", "aiff", "aif", "wma"]);

function isFileDrag(dataTransfer: DataTransfer | null | undefined) {
  return Array.from(dataTransfer?.types || []).includes("Files");
}

function isAcceptedAudioFile(file: File | null | undefined) {
  if (!file) return false;
  if (String(file.type || "").toLowerCase().startsWith("audio/")) return true;
  const ext = String(file.name || "").split(".").pop()?.toLowerCase() || "";
  return acceptedAudioExtensions.has(ext);
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="rounded-xl border border-neutral-200 bg-white/60 p-3 dark:border-neutral-800 dark:bg-neutral-950/45">
    <div className="text-[10px] uppercase tracking-[.14em] text-neutral-500">{label}</div>
    <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    {note && <div className="mt-1 text-[10px] text-neutral-500">{note}</div>}
  </div>;
}

function Toggle({ checked, onChange, label, note }: { checked: boolean; onChange: (v: boolean) => void; label: string; note: string }) {
  return <label className="flex items-start gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-500"/>
    <span><span className="block text-sm font-medium">{label}</span><span className="mt-0.5 block text-xs text-neutral-500">{note}</span></span>
  </label>;
}

function MetricsGrid({ metrics, prefix }: { metrics: MasterMetrics; prefix?: string }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
    <Metric label={`${prefix || ""}LUFS`} value={fmt(metrics.integrated_lufs, 1, " LUFS")} note={metrics.loudness_proxy ? "RMS proxy" : "integrated"}/>
    <Metric label={`${prefix || ""}True peak`} value={fmt(metrics.true_peak_dbtp, 2, " dBTP")} note={metrics.true_peak_proxy ? "sample-peak proxy" : "measured"}/>
    <Metric label={`${prefix || ""}Peak`} value={fmt(metrics.sample_peak_dbfs, 2, " dBFS")}/>
    <Metric label={`${prefix || ""}Crest`} value={fmt(metrics.crest_factor_db, 1, " dB")}/>
    <Metric label={`${prefix || ""}Dynamics`} value={fmt(metrics.dynamic_range_proxy_db, 1, " dB")} note="50 ms proxy"/>
    <Metric label={`${prefix || ""}Width`} value={fmt(metrics.stereo?.side_to_mid_ratio, 3)} note="side / mid"/>
  </div>;
}

function Candidate({ row }: { row: DynamicEqCandidate }) {
  return <div className="rounded-xl border border-neutral-200 bg-white/55 p-3 dark:border-neutral-800 dark:bg-neutral-950/35">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="text-sm font-medium">{row.title}</div><div className="mt-1 text-xs text-neutral-500">{row.reason}</div></div>
      <div className="text-right text-[11px] text-neutral-500"><div className="font-mono">{formatTime(row.start_seconds)}–{formatTime(row.end_seconds)}</div><div>{Math.round(row.frequency_low_hz)}–{Math.round(row.frequency_high_hz)} Hz · {fmt(row.suggested_gain_db, 1, " dB")}</div></div>
    </div>
    <div className="mt-2 text-[10px] uppercase tracking-wide text-violet-500">{row.source === "critique" ? "From Critique" : "Localized mastering scan"} · {Math.round((row.confidence || 0) * 100)}% confidence</div>
  </div>;
}

function TonalBalance({ metrics }: { metrics: MasterMetrics }) {
  const labels: Array<[string, string]> = [["sub", "Sub"], ["bass", "Bass"], ["low_mid", "Low mid"], ["mid", "Mid"], ["high_mid", "High mid"], ["presence", "Presence"], ["air", "Air"]];
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">{labels.map(([key, label]) => {
    const value = Number(metrics.spectral_band_percent?.[key] || 0);
    return <div key={key} className="rounded-xl border border-neutral-200 bg-white/50 p-3 dark:border-neutral-800 dark:bg-neutral-950/30">
      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-neutral-500"><span>{label}</span><span>{fmt(value, 1, "%")}</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-violet-500" style={{ width: `${Math.max(1, Math.min(100, value))}%` }}/></div>
    </div>;
  })}</div>;
}

function AssistantPlan({ analysis }: { analysis: MasteringAnalysis }) {
  const items = analysis.suggestions || [];
  if (!items.length) return null;
  return <section className="mt-5 rounded-2xl border border-neutral-200 bg-white/70 p-5 dark:border-neutral-800 dark:bg-neutral-900/45">
    <div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Mastering Assistant plan</div>
    <h2 className="mt-1 text-lg font-semibold">What YSong would do and why</h2>
    <div className="mt-4 grid gap-3 md:grid-cols-2">{items.map((item, i) => <div key={`${item.type}-${i}`} className="rounded-xl border border-neutral-200 bg-white/55 p-3 dark:border-neutral-800 dark:bg-neutral-950/35">
      <div className="text-[10px] uppercase tracking-wide text-violet-500">{item.type.replaceAll("_", " ")}</div><div className="mt-1 text-sm font-medium">{item.title}</div><div className="mt-1 text-xs text-neutral-500">{item.detail}</div>
    </div>)}</div>
  </section>;
}

function ProcessingDecisions({ report }: { report: MasteringReport }) {
  const rows = report.decisions || [];
  if (!rows.length) return null;
  return <section className="mt-5 rounded-2xl border border-neutral-200 bg-white/70 p-5 dark:border-neutral-800 dark:bg-neutral-900/45">
    <div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Processing decisions</div>
    <h2 className="mt-1 text-lg font-semibold">YSong has to show its work</h2>
    <div className="mt-4 grid gap-3 md:grid-cols-2">{rows.map((row, index) => <div key={`${row.type}-${index}`} className="rounded-xl border border-neutral-200 bg-white/50 p-3 dark:border-neutral-800 dark:bg-neutral-950/30">
      <div className="text-[10px] uppercase tracking-wide text-violet-500">{row.type.replaceAll("_", " ")}</div>
      <div className="mt-1 text-sm font-medium">{row.title}</div>
      <div className="mt-1 text-xs text-neutral-500">{row.detail}</div>
    </div>)}</div>
  </section>;
}

function SpectralDelta({ report }: { report: MasteringReport }) {
  const delta = report.comparison?.spectral_band_delta_percent;
  if (!delta) return null;
  const labels: Array<[string, string]> = [["sub", "Sub"], ["bass", "Bass"], ["low_mid", "Low mid"], ["mid", "Mid"], ["high_mid", "High mid"], ["presence", "Presence"], ["air", "Air"]];
  return <div className="mt-4">
    <div className="mb-2 text-[10px] uppercase tracking-[.18em] text-neutral-500">Tonal share change · after minus before</div>
    <div className="flex flex-wrap gap-2">{labels.map(([key, label]) => {
      const value = Number(delta[key] || 0);
      return <span key={key} className={`rounded-full border px-3 py-1 text-xs ${Math.abs(value) < 0.15 ? "border-neutral-300 text-neutral-500 dark:border-neutral-700" : "border-violet-500/30 text-violet-500"}`}>{label} {value >= 0 ? "+" : ""}{value.toFixed(2)}%</span>;
    })}</div>
  </div>;
}

const modeCards: Array<{ key: RemasterMode; title: string; note: string }> = [
  { key: "preserve", title: "Preserve Mix", note: "Safest. High confidence only; strict limiter and width guards." },
  { key: "balanced", title: "Balanced", note: "More corrective freedom while protecting dynamics and mono compatibility." },
  { key: "aggressive", title: "Aggressive", note: "Allows stronger correction and louder limiting when you explicitly want it." },
  { key: "custom", title: "Custom / Advanced", note: "Your controls drive the chain with the widest safety envelope." },
];

export default function MasteringApp({ onBack, initialUpload = null }: Props) {
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [source, setSource] = useState<UploadResult | null>(initialUpload);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [reference, setReference] = useState<UploadResult | null>(null);
  const [analysis, setAnalysis] = useState<MasteringAnalysis | null>(null);
  const [report, setReport] = useState<MasteringReport | null>(null);
  const [stage, setStage] = useState<Stage>(initialUpload ? "ready" : "idle");
  const [job, setJob] = useState<LocalJob | null>(null);
  const [error, setError] = useState("");
  const [remasterMode, setRemasterMode] = useState<RemasterMode>("preserve");
  const [targetLufs, setTargetLufs] = useState(-16);
  const [truePeak, setTruePeak] = useState(-1);
  const [strength, setStrength] = useState(0.35);
  const [stereoWidth, setStereoWidth] = useState(1);
  const [transientAmount, setTransientAmount] = useState(0);
  const [applyDynamicEq, setApplyDynamicEq] = useState(true);
  const [referenceInfluence, setReferenceInfluence] = useState(0.2);
  const [dragTarget, setDragTarget] = useState<"source" | "reference" | null>(null);
  const [displayProgress, setDisplayProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const busy = stage === "uploading" || stage === "analyzing" || stage === "rendering";
  const trackedProgress = stage === "analyzing" || stage === "rendering";
  const eqCandidates = useMemo(() => (analysis?.dynamic_eq_candidates || []).slice(0, 8), [analysis]);

  async function refreshHealth() {
    setHealth("checking");
    try { const result = await checkVocalHealth(); setHealth(result.status === "ok" ? "online" : "offline"); }
    catch { setHealth("offline"); }
  }

  useEffect(() => { refreshHealth(); return () => abortRef.current?.abort(); }, []);
  useEffect(() => {
    if (initialUpload) { setSource(initialUpload); setSourceFile(null); setStage("ready"); setError(""); setAnalysis(null); setReport(null); }
  }, [initialUpload]);

  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (isFileDrag(event.dataTransfer)) event.preventDefault();
    };
    window.addEventListener("dragenter", preventFileNavigation, true);
    window.addEventListener("dragover", preventFileNavigation, true);
    window.addEventListener("drop", preventFileNavigation, true);
    return () => {
      window.removeEventListener("dragenter", preventFileNavigation, true);
      window.removeEventListener("dragover", preventFileNavigation, true);
      window.removeEventListener("drop", preventFileNavigation, true);
    };
  }, []);

  useEffect(() => {
    if (!trackedProgress) {
      setDisplayProgress(0);
      return;
    }
    const actual = Math.max(4, Math.min(100, Number(job?.progress_percent || 0)));
    setDisplayProgress(previous => Math.max(previous || 0, actual));
    if (actual >= 100) return;
    const ceiling = stage === "rendering" ? 94 : 92;
    const timer = window.setInterval(() => {
      setDisplayProgress(previous => {
        const floor = Math.max(previous, actual);
        if (floor >= ceiling) return floor;
        const gap = ceiling - floor;
        const step = Math.max(0.35, Math.min(2.4, gap * 0.045));
        return Math.min(ceiling, floor + step);
      });
    }, 650);
    return () => window.clearInterval(timer);
  }, [job?.progress_percent, stage, trackedProgress]);

  function resetSource(file: File | null) {
    abortRef.current?.abort();
    setSourceFile(file); setSource(null); setAnalysis(null); setReport(null); setError(""); setStage("idle");
  }

  function resetReference(file: File | null) {
    setReferenceFile(file); setReference(null); setAnalysis(null); setReport(null); setError("");
    if (stage === "error") setStage(source ? "ready" : "idle");
  }

  function acceptDroppedFile(kind: "source" | "reference", event: ReactDragEvent<HTMLLabelElement>) {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setDragTarget(null);
    const files = Array.from(event.dataTransfer.files || []);
    const file = files.find(isAcceptedAudioFile);
    if (!file) {
      setError("That drop did not contain a supported audio file.");
      return;
    }
    if (kind === "source") resetSource(file);
    else resetReference(file);
  }

  function handleDragOver(kind: "source" | "reference", event: ReactDragEvent<HTMLLabelElement>) {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDragTarget(kind);
  }

  async function prepareSource() {
    if (!sourceFile || busy) return;
    setStage("uploading"); setError("");
    try { const next = await uploadForMastering(sourceFile); setSource(next); setStage("ready"); }
    catch (e: unknown) { setError(errorMessage(e, "Source preparation failed.")); setStage("error"); }
  }

  async function prepareReference() {
    if (!referenceFile || busy) return;
    setStage("uploading"); setError("");
    try { const next = await uploadForMastering(referenceFile); setReference(next); setAnalysis(null); setReport(null); setStage("ready"); }
    catch (e: unknown) { setError(errorMessage(e, "Reference preparation failed.")); setStage("error"); }
  }

  async function analyze() {
    if (!source || busy) return;
    setStage("analyzing"); setError(""); setReport(null); setJob(null); setDisplayProgress(4);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const started = await startMasteringAnalysis(source.asset_id, reference?.asset_id);
      setJob(started);
      const finished = await waitForLocalJob(started.job_id, setJob, controller.signal);
      const next = finished.result?.report as MasteringAnalysis | undefined;
      if (!next?.analysis) throw new Error("Mastering analysis completed without a report.");
      setAnalysis(next); setStage("done");
    } catch (e: unknown) {
      if (isAbortError(e)) return;
      setError(errorMessage(e, "Mastering analysis failed.")); setStage("error");
    }
  }

  async function render(mode: "quick" | "assistant" | "reference") {
    if (!source || busy) return;
    if (mode === "reference" && !reference) { setError("Prepare a reference track first."); return; }
    setStage("rendering"); setError(""); setJob(null); setDisplayProgress(4);
    const controller = new AbortController(); abortRef.current = controller;
    const quick = mode === "quick";
    const settings = {
      mode,
      remasterMode: quick ? "preserve" as RemasterMode : remasterMode,
      targetLufs,
      truePeak,
      strength: quick ? Math.min(strength, 0.35) : strength,
      stereoWidth: quick ? 1 : stereoWidth,
      transientAmount: quick ? 0 : transientAmount,
      applyDynamicEq,
      referenceAssetId: quick ? null : reference?.asset_id || null,
      referenceInfluence: quick ? 0 : referenceInfluence,
    };
    try {
      const started = await startMasteringRender(source.asset_id, settings);
      setJob(started);
      const finished = await waitForLocalJob(started.job_id, setJob, controller.signal);
      const next = finished.result?.report as MasteringReport | undefined;
      if (!next?.run_id) throw new Error("Mastering completed without an output report.");
      setReport(next); setAnalysis(next.analysis); setStage("done");
    } catch (e: unknown) {
      if (isAbortError(e)) return;
      setError(errorMessage(e, "Mastering failed.")); setStage("error");
    }
  }

  function applyTarget(target: "dynamic" | "spotify" | "apple" | "youtube" | "balanced" | "loud") {
    const map = {
      dynamic: [-16, -1.5], spotify: [-14, -1], apple: [-16, -1], youtube: [-14, -1], balanced: [-14, -1], loud: [-10, -1],
    } as const;
    setTargetLufs(map[target][0]); setTruePeak(map[target][1]);
  }

  function applyMode(next: RemasterMode) {
    setRemasterMode(next);
    if (next === "preserve") { setStrength(0.35); setStereoWidth(1); setTransientAmount(0); setReferenceInfluence(0.2); }
    if (next === "balanced") { setStrength(0.58); setStereoWidth(1); setTransientAmount(0); setReferenceInfluence(0.35); }
    if (next === "aggressive") { setStrength(0.82); setStereoWidth(1); setTransientAmount(0); setReferenceInfluence(0.5); }
  }

  return <div className="h-full min-h-0 overflow-y-auto bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"><div className="mx-auto max-w-6xl px-5 py-7 md:px-8 md:py-9">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><button type="button" onClick={onBack} className="mb-4 text-xs text-violet-500 hover:text-violet-400">← YSong Tools</button><div className="text-[11px] uppercase tracking-[.24em] text-violet-500">Audio Lab</div><h1 className="mt-1 !text-3xl !font-semibold !leading-tight tracking-tight md:!text-4xl">Master / Remaster</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500 dark:text-neutral-400">Analyze first. Fix only what earns the correction. Preserve the mix, hit the loudness you requested when it can be done safely, then prove every change with synchronized A/B, dual live spectra, measurements and a difference signal.</p></div>
      <div className={`rounded-full border px-3 py-1.5 text-xs ${health === "online" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : "border-amber-500/30 bg-amber-500/10 text-amber-500"}`}>{health === "online" ? "Audio Lab online" : health === "checking" ? "Checking…" : "Audio Lab offline"}</div>
    </div>

    {health === "offline" && <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/[.06] p-4 text-sm text-neutral-500">YSong Audio Engine is offline. Restart YSong to relaunch the integrated local engine.</div>}

    {trackedProgress && <div className="fixed bottom-5 left-1/2 z-[1000] w-[min(680px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-violet-500/45 bg-neutral-950/95 p-3.5 text-neutral-100 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium">{stage === "rendering" ? "Building remaster candidate" : "Analyzing master"}</span><span className="font-mono tabular-nums text-violet-300">{Math.round(displayProgress)}%</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800"><div className="h-full rounded-full bg-violet-500 transition-[width] duration-500" style={{ width: `${Math.max(3, Math.min(100, displayProgress))}%` }}/></div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-400"><span>{job?.stage || (stage === "rendering" ? "processing audio" : "measuring source")}</span><span>Progress between engine checkpoints is estimated so the UI never looks frozen.</span></div>
    </div>}

    <div className="mt-7 grid gap-5 lg:grid-cols-2">
      <section className="rounded-2xl border border-neutral-200 bg-white/70 p-5 dark:border-neutral-800 dark:bg-neutral-900/45">
        <div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">1 · Source</div><h2 className="mt-1 text-lg font-semibold">Master this track</h2>
        <label onDragEnter={e => handleDragOver("source", e)} onDragOver={e => handleDragOver("source", e)} onDragLeave={e => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragTarget(null); }} onDrop={e => acceptDroppedFile("source", e)} className={`mt-4 block cursor-pointer rounded-xl border border-dashed p-5 transition ${dragTarget === "source" ? "border-violet-400 bg-violet-500/10 shadow-[inset_0_0_0_1px_rgba(139,92,246,.18)]" : "border-neutral-300 hover:border-violet-500/60 dark:border-neutral-700"}`}><input type="file" accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg,.opus,.aiff,.aif,.wma" className="hidden" disabled={busy} onChange={e => { resetSource(e.target.files?.[0] || null); e.currentTarget.value = ""; }}/><div className="font-medium">{sourceFile?.name || source?.original_filename || "Drop/select audio"}</div><div className="mt-1 text-xs text-neutral-500">Your exact upload is retained separately. YSong creates a mastering PCM source without overwriting it.</div></label>
        {sourceFile && !source && <button type="button" onClick={prepareSource} disabled={busy || health !== "online"} className="mt-3 min-h-10 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-40">Prepare source</button>}
        {source && <div className="mt-3 text-xs text-neutral-500">Prepared asset <span className="font-mono">{source.asset_id}</span> · original retained</div>}
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white/70 p-5 dark:border-neutral-800 dark:bg-neutral-900/45">
        <div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Optional · Reference Match</div><h2 className="mt-1 text-lg font-semibold">Compare, don’t clone</h2>
        <label onDragEnter={e => handleDragOver("reference", e)} onDragOver={e => handleDragOver("reference", e)} onDragLeave={e => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragTarget(null); }} onDrop={e => acceptDroppedFile("reference", e)} className={`mt-4 block cursor-pointer rounded-xl border border-dashed p-5 transition ${dragTarget === "reference" ? "border-violet-400 bg-violet-500/10 shadow-[inset_0_0_0_1px_rgba(139,92,246,.18)]" : "border-neutral-300 hover:border-violet-500/60 dark:border-neutral-700"}`}><input type="file" accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg,.opus,.aiff,.aif,.wma" className="hidden" disabled={busy} onChange={e => { resetReference(e.target.files?.[0] || null); e.currentTarget.value = ""; }}/><div className="font-medium">{referenceFile?.name || reference?.original_filename || "Optional reference track"}</div><div className="mt-1 text-xs text-neutral-500">YSong reports brighter/darker, wider/narrower, punch/compression, bass and presence-band differences before offering capped guidance.</div></label>
        {referenceFile && !reference && <button type="button" onClick={prepareReference} disabled={busy || health !== "online"} className="mt-3 min-h-10 rounded-xl border border-violet-500/40 px-4 text-sm font-medium text-violet-500 disabled:opacity-40">Prepare reference</button>}
        {reference && <div className="mt-3 text-xs text-neutral-500">Reference <span className="font-mono">{reference.asset_id}</span></div>}
      </section>
    </div>

    <section className="mt-5 rounded-2xl border border-neutral-200 bg-white/70 p-5 dark:border-neutral-800 dark:bg-neutral-900/45">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">2 · Measure</div><h2 className="mt-1 text-lg font-semibold">Mastering Assistant</h2><p className="mt-1 text-xs text-neutral-500">LUFS, true peak, crest/dynamics, tonal balance, stereo image, Critique handoff and localized correction candidates.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={analyze} disabled={!source || busy || health !== "online"} className="min-h-10 rounded-xl border border-violet-500/40 px-4 text-sm text-violet-500 disabled:opacity-40">{stage === "analyzing" ? `Analyzing… ${Math.round(displayProgress)}%` : analysis ? "Re-analyze" : "Analyze master"}</button><button type="button" onClick={() => render("quick")} disabled={!source || busy || health !== "online"} className="min-h-10 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-40">{stage === "rendering" ? `Rendering… ${Math.round(displayProgress)}%` : "Quick Preserve Remaster"}</button></div></div>
      {busy && <div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-violet-500 transition-[width] duration-500" style={{ width: `${trackedProgress ? Math.max(3, Math.min(100, displayProgress)) : 8}%` }}/></div><div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500"><span>{job?.stage || stage}</span>{trackedProgress && <span>{Math.round(displayProgress)}% · estimated between engine checkpoints</span>}</div></div>}
    </section>

    {error && <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/[.06] p-4 text-sm text-rose-500">{error}</div>}

    {analysis && <>
      <section className="mt-5 rounded-2xl border border-neutral-200 bg-white/70 p-5 dark:border-neutral-800 dark:bg-neutral-900/45"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[10px] uppercase tracking-[.18em] text-violet-500">Measured source</div><h2 className="mt-1 text-xl font-semibold">{analysis.engine}</h2><p className="mt-1 text-xs text-neutral-500">Critique: {analysis.critique_integration?.verdict || "available"} · {analysis.critique_integration?.finding_count || 0} finding(s) considered · {analysis.critique_integration?.frequency_time_hints_used || 0} direct time/frequency hint(s).</p></div><a href={masteringAnalysisUrl(analysis.asset_id)} target="_blank" rel="noreferrer" className="rounded-xl border border-neutral-300 px-3 py-2 text-xs dark:border-neutral-700">JSON analysis</a></div><div className="mt-5"><MetricsGrid metrics={analysis.analysis}/></div>{analysis.tonal_description?.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{analysis.tonal_description.map((text, i) => <span key={i} className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-500 dark:border-neutral-800">{text}</span>)}</div>}<div className="mt-5"><div className="mb-2 text-[10px] uppercase tracking-[.18em] text-neutral-500">Tonal balance</div><TonalBalance metrics={analysis.analysis}/></div></section>
      <AssistantPlan analysis={analysis}/>
      {analysis.reference && <section className="mt-5 rounded-2xl border border-sky-500/20 bg-sky-500/[.035] p-5"><div className="text-[10px] uppercase tracking-[.18em] text-sky-500">Reference Match</div><h2 className="mt-1 text-lg font-semibold">Differences first</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{analysis.reference.match.descriptors.map((row, i) => <div key={`${row.dimension}-${i}`} className="rounded-xl border border-sky-500/15 bg-white/50 p-3 dark:bg-neutral-950/25"><div className="text-[10px] uppercase tracking-wide text-neutral-500">{row.dimension.replaceAll("_", " ")}</div><div className="mt-1 font-medium capitalize">{row.difference}</div><div className="mt-1 text-xs text-neutral-500">{row.detail}</div></div>)}</div><div className="mt-3 text-xs text-neutral-500">{analysis.reference.match.policy}</div></section>}
      <section className="mt-5 rounded-2xl border border-neutral-200 bg-white/70 p-5 dark:border-neutral-800 dark:bg-neutral-900/45"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Dynamic correction map</div><h2 className="mt-1 text-lg font-semibold">Fix the moment, not the whole song</h2></div><div className="text-xs text-neutral-500">{analysis.dynamic_eq_candidates?.length || 0} candidate(s)</div></div><div className="mt-4 grid gap-3 md:grid-cols-2">{eqCandidates.length ? eqCandidates.map(row => <Candidate key={row.id} row={row}/>) : <div className="text-sm text-neutral-500">No strong localized tonal outliers were found. YSong will not invent corrections just to look busy.</div>}</div></section>
    </>}

    <section className="mt-5 rounded-2xl border border-neutral-200 bg-white/70 p-5 dark:border-neutral-800 dark:bg-neutral-900/45">
      <div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">3 · Build candidate</div><h2 className="mt-1 text-lg font-semibold">Remaster philosophy</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{modeCards.map(card => <button key={card.key} type="button" onClick={() => applyMode(card.key)} className={`rounded-xl border p-3 text-left ${remasterMode === card.key ? "border-violet-500/50 bg-violet-500/[.06]" : "border-neutral-200 dark:border-neutral-800"}`}><div className={`text-sm font-semibold ${remasterMode === card.key ? "text-violet-500" : ""}`}>{card.title}</div><div className="mt-1 text-xs text-neutral-500">{card.note}</div></button>)}</div>

      <div className="mt-6 text-[10px] uppercase tracking-[.18em] text-neutral-500">Convenience loudness targets · always editable</div>
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => applyTarget("dynamic")} className="rounded-lg border border-neutral-300 px-3 py-2 text-xs dark:border-neutral-700">Dynamic · -16 / -1.5</button><button type="button" onClick={() => applyTarget("spotify")} className="rounded-lg border border-neutral-300 px-3 py-2 text-xs dark:border-neutral-700">Spotify-friendly · -14 / -1</button><button type="button" onClick={() => applyTarget("apple")} className="rounded-lg border border-neutral-300 px-3 py-2 text-xs dark:border-neutral-700">Apple Music-friendly · -16 / -1</button><button type="button" onClick={() => applyTarget("youtube")} className="rounded-lg border border-neutral-300 px-3 py-2 text-xs dark:border-neutral-700">YouTube-friendly · -14 / -1</button><button type="button" onClick={() => applyTarget("balanced")} className="rounded-lg border border-violet-500/40 bg-violet-500/[.05] px-3 py-2 text-xs text-violet-500">Streaming balanced · -14 / -1</button><button type="button" onClick={() => applyTarget("loud")} className="rounded-lg border border-neutral-300 px-3 py-2 text-xs dark:border-neutral-700">Club / Loud · -10 / -1</button></div>
      <p className="mt-2 text-[11px] text-neutral-500">These are workflow presets, not claims that any platform requires one exact LUFS master.</p>

      <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <div><div className="flex justify-between text-xs"><span>Target loudness</span><input aria-label="Target loudness numeric" type="number" min="-24" max="-7" step="0.1" value={targetLufs} onChange={e => setTargetLufs(Math.max(-24, Math.min(-7, Number(e.target.value))))} className="w-24 rounded border border-neutral-300 bg-transparent px-2 py-1 text-right tabular-nums dark:border-neutral-700"/></div><input type="range" min="-24" max="-7" step="0.1" value={targetLufs} onChange={e => setTargetLufs(Number(e.target.value))} className="mt-2 w-full accent-violet-600"/><div className="mt-1 text-[10px] text-neutral-500">{targetLufs.toFixed(1)} LUFS integrated</div></div>
        <div><div className="flex justify-between text-xs"><span>True-peak ceiling</span><input aria-label="True peak numeric" type="number" min="-6" max="-0.1" step="0.1" value={truePeak} onChange={e => setTruePeak(Math.max(-6, Math.min(-0.1, Number(e.target.value))))} className="w-24 rounded border border-neutral-300 bg-transparent px-2 py-1 text-right tabular-nums dark:border-neutral-700"/></div><input type="range" min="-6" max="-0.1" step="0.1" value={truePeak} onChange={e => setTruePeak(Number(e.target.value))} className="mt-2 w-full accent-violet-600"/><div className="mt-1 text-[10px] text-neutral-500">{truePeak.toFixed(1)} dBTP</div></div>
        <div><div className="flex justify-between text-xs"><span>Correction strength</span><span>{Math.round(strength * 100)}%</span></div><input type="range" min="0" max="1" step="0.01" value={strength} onChange={e => { setStrength(Number(e.target.value)); setRemasterMode("custom"); }} className="mt-2 w-full accent-violet-600"/></div>
        <div><div className="flex justify-between text-xs"><span>Stereo width</span><span>{Math.round(stereoWidth * 100)}%</span></div><input type="range" min="0.5" max="1.5" step="0.01" value={stereoWidth} onChange={e => { setStereoWidth(Number(e.target.value)); setRemasterMode("custom"); }} className="mt-2 w-full accent-violet-600"/></div>
        <div><div className="flex justify-between text-xs"><span>Transient shape</span><span>{transientAmount > 0 ? "+" : ""}{transientAmount.toFixed(2)}</span></div><input type="range" min="-0.35" max="0.35" step="0.01" value={transientAmount} onChange={e => { setTransientAmount(Number(e.target.value)); setRemasterMode("custom"); }} className="mt-2 w-full accent-violet-600"/></div>
        <div><div className="flex justify-between text-xs"><span>Reference influence</span><span>{Math.round(referenceInfluence * 100)}%</span></div><input type="range" min="0" max="0.6" step="0.01" value={referenceInfluence} disabled={!reference} onChange={e => setReferenceInfluence(Number(e.target.value))} className="mt-2 w-full accent-violet-600 disabled:opacity-40"/></div>
      </div>
      <div className="mt-5"><Toggle checked={applyDynamicEq} onChange={setApplyDynamicEq} label="Apply localized dynamic corrections" note="Only time/frequency-specific candidates are touched. Preserve Mix raises the confidence threshold and caps correction strength automatically."/></div>
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={() => render(reference ? "reference" : "assistant")} disabled={!source || busy || health !== "online"} className="min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white disabled:opacity-40">{stage === "rendering" ? `Rendering remaster… ${Math.round(displayProgress)}%` : reference ? "Create reference-guided remaster" : "Create remaster candidate"}</button><span className="self-center text-xs text-neutral-500">Source stays untouched. Preserve Mix stops short rather than crushing a target that exceeds its limiter guard.</span></div>
    </section>

    {report && source && <>
      <section className={`mt-5 rounded-2xl border p-5 ${report.loudness_target?.target_met === false ? "border-amber-500/25 bg-amber-500/[.035]" : "border-emerald-500/20 bg-emerald-500/[.035]"}`}>
        <div className="flex flex-wrap items-start justify-between gap-4"><div><div className={`text-[10px] uppercase tracking-[.18em] ${report.loudness_target?.target_met === false ? "text-amber-500" : "text-emerald-500"}`}>Candidate ready</div><h2 className="mt-1 text-xl font-semibold">{report.remaster_mode_label || report.run_id}</h2><p className="mt-1 text-sm text-neutral-500">Run {report.run_id}. Original, mastering source, remaster and difference are separate. Nothing overwrote your upload.</p></div><span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-500">Non-destructive</span></div>
        {report.loudness_target && <div className="mt-4 rounded-xl border border-neutral-200 bg-white/50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-950/25"><div className="flex flex-wrap items-center justify-between gap-3"><span className="font-medium">Requested {report.loudness_target.requested_lufs.toFixed(1)} LUFS</span><span className={report.loudness_target.target_met ? "text-emerald-500" : "text-amber-500"}>{report.loudness_target.target_met ? `Hit target · ${report.loudness_target.achieved_lufs.toFixed(2)} LUFS` : `Safety guard stopped at ${report.loudness_target.achieved_lufs.toFixed(2)} LUFS`}</span></div></div>}
        <div className="mt-5 grid gap-5 xl:grid-cols-2"><div><div className="mb-2 text-[10px] uppercase tracking-[.18em] text-neutral-500">Before</div><MetricsGrid metrics={report.before}/></div><div><div className="mb-2 text-[10px] uppercase tracking-[.18em] text-neutral-500">After</div><MetricsGrid metrics={report.after}/></div></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="LUFS change" value={fmt(report.comparison?.integrated_lufs_delta ?? report.after.integrated_lufs - report.before.integrated_lufs, 2, " LU")}/><Metric label="Crest change" value={fmt(report.comparison?.crest_delta_db, 2, " dB")}/><Metric label="Dynamics change" value={fmt(report.comparison?.dynamic_range_delta_db, 2, " dB")}/><Metric label="Width change" value={fmt(report.comparison?.width_delta, 3)}/><Metric label="Difference RMS" value={fmt(report.difference?.rms_dbfs, 2, " dBFS")} note={`${fmt(report.difference?.change_percent_of_source_rms, 1, "%")} of source RMS`}/></div>
        <SpectralDelta report={report}/>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-neutral-500"><span className="rounded-full border border-neutral-300 px-2.5 py-1 dark:border-neutral-700">{report.outputs?.sample_rate ? `${Number(report.outputs.sample_rate).toLocaleString()} Hz` : `${report.after.sample_rate.toLocaleString()} Hz`}</span><span className="rounded-full border border-neutral-300 px-2.5 py-1 dark:border-neutral-700">{report.outputs?.bit_depth || 24}-bit PCM WAV</span><span className="rounded-full border border-neutral-300 px-2.5 py-1 dark:border-neutral-700">True peak ceiling {report.settings.true_peak_dbtp.toFixed(1)} dBTP</span></div>
        {report.warnings?.length > 0 && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[.05] p-3 text-xs text-amber-500">{report.warnings.join(" ")}</div>}
      </section>
      <ProcessingDecisions report={report}/>
      <ABMonitor assetId={source.asset_id} originalFilename={source.original_filename} report={report}/>
    </>}

    <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-800">Technical note: Master / Remaster v0.2 is deterministic DSP plus measurement and heuristics, not a learned black-box mastering model. LUFS/true peak use FFmpeg measurement when available; fallbacks are explicitly labeled. The mastering source preserves the uploaded sample rate when FFmpeg can decode it, final output is 24-bit PCM, Reference Match is capped, and Preserve Mix deliberately prefers doing nothing over low-confidence processing.</div>
  </div></div>;
}
