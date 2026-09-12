import { useEffect, useMemo, useRef, useState } from "react";
import { checkVocalHealth, VOCAL_API_BASE, type LocalJob, type UploadResult } from "../stemrestore/api";
import {
  masteringAnalysisUrl,
  masteringFileUrl,
  sourceAudioUrl,
  startMasteringAnalysis,
  startMasteringRender,
  uploadForMastering,
  waitForLocalJob,
  type DynamicEqCandidate,
  type MasterMetrics,
  type MasteringAnalysis,
  type MasteringReport,
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

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-950/45 p-3"><div className="text-[10px] uppercase tracking-[.14em] text-neutral-500">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>{note && <div className="mt-1 text-[10px] text-neutral-500">{note}</div>}</div>;
}

function Toggle({ checked, onChange, label, note }: { checked: boolean; onChange: (v: boolean) => void; label: string; note: string }) {
  return <label className="flex items-start gap-3 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-500"/><span><span className="block text-sm font-medium">{label}</span><span className="mt-0.5 block text-xs text-neutral-500">{note}</span></span></label>;
}

function MetricsGrid({ metrics, prefix }: { metrics: MasterMetrics; prefix?: string }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><Metric label={`${prefix || ""}LUFS`} value={fmt(metrics.integrated_lufs, 1, " LUFS")} note={metrics.loudness_proxy ? "RMS proxy" : "integrated"}/><Metric label={`${prefix || ""}True peak`} value={fmt(metrics.true_peak_dbtp, 2, " dBTP")} note={metrics.true_peak_proxy ? "sample-peak proxy" : "measured"}/><Metric label={`${prefix || ""}Peak`} value={fmt(metrics.sample_peak_dbfs, 2, " dBFS")}/><Metric label={`${prefix || ""}Crest`} value={fmt(metrics.crest_factor_db, 1, " dB")}/><Metric label={`${prefix || ""}Dynamics`} value={fmt(metrics.dynamic_range_proxy_db, 1, " dB")} note="50 ms proxy"/><Metric label={`${prefix || ""}Width`} value={fmt(metrics.stereo?.side_to_mid_ratio, 3)} note="side / mid"/></div>;
}

function Candidate({ row }: { row: DynamicEqCandidate }) {
  return <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/55 dark:bg-neutral-950/35 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-medium">{row.title}</div><div className="mt-1 text-xs text-neutral-500">{row.reason}</div></div><div className="text-right text-[11px] text-neutral-500"><div className="font-mono">{formatTime(row.start_seconds)}–{formatTime(row.end_seconds)}</div><div>{Math.round(row.frequency_low_hz)}–{Math.round(row.frequency_high_hz)} Hz · {fmt(row.suggested_gain_db, 1, " dB")}</div></div></div><div className="mt-2 text-[10px] uppercase tracking-wide text-violet-500">{row.source === "critique" ? "From Critique" : "Localized mastering scan"} · {Math.round((row.confidence || 0) * 100)}% confidence</div></div>;
}

function TonalBalance({ metrics }: { metrics: MasterMetrics }) {
  const labels: Array<[string, string]> = [["sub", "Sub"], ["bass", "Bass"], ["low_mid", "Low mid"], ["mid", "Mid"], ["high_mid", "High mid"], ["presence", "Presence"], ["air", "Air"]];
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">{labels.map(([key, label]) => { const value = Number(metrics.spectral_band_percent?.[key] || 0); return <div key={key} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/50 dark:bg-neutral-950/30 p-3"><div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-neutral-500"><span>{label}</span><span>{fmt(value, 1, "%")}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-violet-500" style={{ width: `${Math.max(1, Math.min(100, value))}%` }}/></div></div>; })}</div>;
}

function AssistantPlan({ analysis }: { analysis: MasteringAnalysis }) {
  const items = analysis.suggestions || [];
  if (!items.length) return null;
  return <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Mastering Assistant plan</div><h2 className="mt-1 text-lg font-semibold">What YSong would do and why</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{items.map((item, i) => <div key={`${item.type}-${i}`} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/55 dark:bg-neutral-950/35 p-3"><div className="text-[10px] uppercase tracking-wide text-violet-500">{item.type.replaceAll("_", " ")}</div><div className="mt-1 text-sm font-medium">{item.title}</div><div className="mt-1 text-xs text-neutral-500">{item.detail}</div></div>)}</div></section>;
}

function ABMonitor({ assetId, runId }: { assetId: string; runId: string }) {
  const [mode, setMode] = useState<"original" | "master" | "difference">("master");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const handoffRef = useRef({ time: 0, resume: false });
  const src = mode === "original" ? sourceAudioUrl(assetId) : masteringFileUrl(assetId, runId, mode === "master" ? "master" : "difference");

  function switchMode(next: "original" | "master" | "difference") {
    if (next === mode) return;
    const audio = audioRef.current;
    handoffRef.current = { time: audio?.currentTime || 0, resume: Boolean(audio && !audio.paused) };
    setMode(next);
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const restore = () => {
      const target = Math.min(handoffRef.current.time, Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.05) : handoffRef.current.time);
      if (target > 0) audio.currentTime = target;
      if (handoffRef.current.resume) void audio.play().catch(() => undefined);
    };
    audio.addEventListener("loadedmetadata", restore, { once: true });
    audio.load();
    return () => audio.removeEventListener("loadedmetadata", restore);
  }, [src]);

  return <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">A/B / Difference monitor</div><h2 className="mt-1 text-lg font-semibold">Switch at the same playback position</h2><p className="mt-1 text-xs text-neutral-500">Original, mastered candidate, and the isolated change signal use one monitor so comparisons are faster.</p></div><div className="flex flex-wrap gap-2">{([['original','A · Original'],['master','B · Master'],['difference','Δ · Difference']] as const).map(([key,label]) => <button key={key} type="button" onClick={() => switchMode(key)} className={`rounded-lg border px-3 py-2 text-xs ${mode === key ? "border-violet-500/50 bg-violet-500/10 text-violet-500" : "border-neutral-300 dark:border-neutral-700"}`}>{label}</button>)}</div></div><audio ref={audioRef} controls preload="metadata" className="mt-4 w-full" src={src}/><div className="mt-3 flex flex-wrap gap-3 text-xs"><a className="text-violet-500" href={masteringFileUrl(assetId, runId, "master")} download>Download master WAV</a><a className="text-violet-500" href={masteringFileUrl(assetId, runId, "difference")} download>Download difference WAV</a><a className="text-violet-500" target="_blank" rel="noreferrer" href={masteringFileUrl(assetId, runId, "report")}>Open JSON report →</a></div></section>;
}

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
  const [targetLufs, setTargetLufs] = useState(-14);
  const [truePeak, setTruePeak] = useState(-1);
  const [strength, setStrength] = useState(0.55);
  const [stereoWidth, setStereoWidth] = useState(1);
  const [transientAmount, setTransientAmount] = useState(0);
  const [applyDynamicEq, setApplyDynamicEq] = useState(true);
  const [referenceInfluence, setReferenceInfluence] = useState(0.35);
  const abortRef = useRef<AbortController | null>(null);

  const busy = stage === "uploading" || stage === "analyzing" || stage === "rendering";
  const eqCandidates = useMemo(() => (analysis?.dynamic_eq_candidates || []).slice(0, 8), [analysis]);

  async function refreshHealth() {
    setHealth("checking");
    try {
      const result = await checkVocalHealth();
      setHealth(result.status === "ok" ? "online" : "offline");
    } catch { setHealth("offline"); }
  }

  useEffect(() => { refreshHealth(); return () => abortRef.current?.abort(); }, []);
  useEffect(() => {
    if (initialUpload) { setSource(initialUpload); setSourceFile(null); setStage("ready"); setError(""); setAnalysis(null); setReport(null); }
  }, [initialUpload]);

  function resetSource(file: File | null) {
    abortRef.current?.abort();
    setSourceFile(file); setSource(null); setAnalysis(null); setReport(null); setError(""); setStage("idle");
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
    setStage("analyzing"); setError(""); setReport(null);
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
    setStage("rendering"); setError("");
    const controller = new AbortController(); abortRef.current = controller;
    const settings = mode === "quick"
      ? { mode, targetLufs: -14, truePeak: -1, strength: 0.45, stereoWidth: 1, transientAmount: 0, applyDynamicEq: true, referenceAssetId: null, referenceInfluence: 0 }
      : { mode, targetLufs, truePeak, strength, stereoWidth, transientAmount, applyDynamicEq, referenceAssetId: reference?.asset_id || null, referenceInfluence };
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

  function applyTarget(target: "dynamic" | "balanced" | "loud") {
    const map = { dynamic: [-16, -1.5], balanced: [-14, -1], loud: [-10, -1] } as const;
    setTargetLufs(map[target][0]); setTruePeak(map[target][1]);
  }

  return <div className="h-full min-h-0 overflow-y-auto bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100"><div className="mx-auto max-w-6xl px-5 py-7 md:px-8 md:py-9">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><button type="button" onClick={onBack} className="mb-4 text-xs text-violet-500 hover:text-violet-400">← YSong Tools</button><div className="text-[11px] uppercase tracking-[.24em] text-violet-500">Audio Lab</div><h1 className="mt-1 !text-3xl md:!text-4xl !font-semibold !leading-tight tracking-tight">Master / Remaster</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500 dark:text-neutral-400">Measure first, then create a non-destructive master candidate. Critique findings can become localized corrections, Reference Match describes differences before touching anything, and every render includes before/after/difference A/B.</p></div><div className={`rounded-full border px-3 py-1.5 text-xs ${health === "online" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : "border-amber-500/30 bg-amber-500/10 text-amber-500"}`}>{health === "online" ? "Audio Lab online" : health === "checking" ? "Checking…" : "Audio Lab offline"}</div></div>

    {health === "offline" && <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/[.06] p-4 text-sm text-neutral-500">Start the local YSong Vocal/Audio API at <span className="font-mono">{VOCAL_API_BASE}</span>.</div>}

    <div className="mt-7 grid gap-5 lg:grid-cols-2">
      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">1 · Source</div><h2 className="mt-1 text-lg font-semibold">Master this track</h2><label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-5 hover:border-violet-500/60"><input type="file" accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg" className="hidden" disabled={busy} onChange={e => { resetSource(e.target.files?.[0] || null); e.currentTarget.value = ""; }}/><div className="font-medium">{sourceFile?.name || source?.original_filename || "Drop/select audio"}</div><div className="mt-1 text-xs text-neutral-500">WAV/FLAC preferred. Critique can hand the same prepared asset here without re-uploading.</div></label>{sourceFile && !source && <button type="button" onClick={prepareSource} disabled={busy || health !== "online"} className="mt-3 min-h-10 rounded-xl bg-violet-600 px-4 text-sm font-medium text-white disabled:opacity-40">Prepare source</button>}{source && <div className="mt-3 text-xs text-neutral-500">Asset <span className="font-mono">{source.asset_id}</span></div>}</section>

      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Optional · Reference Match</div><h2 className="mt-1 text-lg font-semibold">Compare, don’t clone</h2><label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-5 hover:border-violet-500/60"><input type="file" accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg" className="hidden" disabled={busy} onChange={e => { setReferenceFile(e.target.files?.[0] || null); setReference(null); setAnalysis(null); setReport(null); e.currentTarget.value = ""; }}/><div className="font-medium">{referenceFile?.name || reference?.original_filename || "Optional reference track"}</div><div className="mt-1 text-xs text-neutral-500">YSong reports brighter/darker, wider/narrower, punch/compression, bass and presence-band differences before offering capped guidance.</div></label>{referenceFile && !reference && <button type="button" onClick={prepareReference} disabled={busy || health !== "online"} className="mt-3 min-h-10 rounded-xl border border-violet-500/40 px-4 text-sm font-medium text-violet-500 disabled:opacity-40">Prepare reference</button>}{reference && <div className="mt-3 text-xs text-neutral-500">Reference <span className="font-mono">{reference.asset_id}</span></div>}</section>
    </div>

    <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">2 · Measure</div><h2 className="mt-1 text-lg font-semibold">Mastering Assistant</h2><p className="mt-1 text-xs text-neutral-500">LUFS, sample/true peak, loudness range, crest/dynamics, tonal balance, stereo image, Critique handoff, and localized correction candidates.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={analyze} disabled={!source || busy || health !== "online"} className="min-h-10 rounded-xl border border-violet-500/40 px-4 text-sm text-violet-500 disabled:opacity-40">{stage === "analyzing" ? `Analyzing… ${Math.round(job?.progress_percent || 0)}%` : analysis ? "Re-analyze" : "Analyze master"}</button><button type="button" onClick={() => render("quick")} disabled={!source || busy || health !== "online"} className="min-h-10 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-40">{stage === "rendering" ? `Rendering… ${Math.round(job?.progress_percent || 0)}%` : "Quick Remaster"}</button></div></div>{busy && <div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.max(3, Math.min(100, job?.progress_percent || 5))}%` }}/></div><div className="mt-1 text-[11px] text-neutral-500">{job?.stage || stage}</div></div>}</section>

    {error && <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/[.06] p-4 text-sm text-rose-500">{error}</div>}

    {analysis && <>
      <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[10px] uppercase tracking-[.18em] text-violet-500">Measured source</div><h2 className="mt-1 text-xl font-semibold">{analysis.engine}</h2><p className="mt-1 text-xs text-neutral-500">Critique: {analysis.critique_integration?.verdict || "available"} · {analysis.critique_integration?.finding_count || 0} finding(s) considered · {analysis.critique_integration?.frequency_time_hints_used || 0} direct time/frequency hint(s).</p></div><a href={masteringAnalysisUrl(analysis.asset_id)} target="_blank" rel="noreferrer" className="rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs">JSON analysis</a></div><div className="mt-5"><MetricsGrid metrics={analysis.analysis}/></div>{analysis.tonal_description?.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{analysis.tonal_description.map((text, i) => <span key={i} className="rounded-full border border-neutral-200 dark:border-neutral-800 px-3 py-1 text-xs text-neutral-500">{text}</span>)}</div>}<div className="mt-5"><div className="mb-2 text-[10px] uppercase tracking-[.18em] text-neutral-500">Tonal balance</div><TonalBalance metrics={analysis.analysis}/></div></section>

      <AssistantPlan analysis={analysis}/>

      {analysis.reference && <section className="mt-5 rounded-2xl border border-sky-500/20 bg-sky-500/[.035] p-5"><div className="text-[10px] uppercase tracking-[.18em] text-sky-500">Reference Match</div><h2 className="mt-1 text-lg font-semibold">Differences first</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{analysis.reference.match.descriptors.map((row, i) => <div key={`${row.dimension}-${i}`} className="rounded-xl border border-sky-500/15 bg-white/50 dark:bg-neutral-950/25 p-3"><div className="text-[10px] uppercase tracking-wide text-neutral-500">{row.dimension.replaceAll("_", " ")}</div><div className="mt-1 font-medium capitalize">{row.difference}</div><div className="mt-1 text-xs text-neutral-500">{row.detail}</div></div>)}</div><div className="mt-3 text-xs text-neutral-500">{analysis.reference.match.policy}</div></section>}

      <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Dynamic correction map</div><h2 className="mt-1 text-lg font-semibold">Fix the moment, not the whole song</h2></div><div className="text-xs text-neutral-500">{analysis.dynamic_eq_candidates?.length || 0} candidate(s)</div></div><div className="mt-4 grid gap-3 md:grid-cols-2">{eqCandidates.length ? eqCandidates.map(row => <Candidate key={row.id} row={row}/>) : <div className="text-sm text-neutral-500">No strong localized tonal outliers were found. YSong will not invent corrections just to look busy.</div>}</div></section>
    </>}

    <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">3 · Build candidate</div><h2 className="mt-1 text-lg font-semibold">Mastering controls</h2><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => applyTarget("dynamic")} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs">Dynamic · -16 LUFS / -1.5 dBTP</button><button type="button" onClick={() => applyTarget("balanced")} className="rounded-lg border border-violet-500/40 bg-violet-500/[.05] px-3 py-2 text-xs text-violet-500">Streaming balanced · -14 / -1</button><button type="button" onClick={() => applyTarget("loud")} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs">Loud · -10 / -1</button></div><div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3"><div><div className="flex justify-between text-xs"><span>Target loudness</span><span>{targetLufs.toFixed(1)} LUFS</span></div><input type="range" min="-18" max="-8" step="0.5" value={targetLufs} onChange={e => setTargetLufs(Number(e.target.value))} className="mt-2 w-full accent-violet-600"/></div><div><div className="flex justify-between text-xs"><span>True-peak ceiling</span><span>{truePeak.toFixed(1)} dBTP</span></div><input type="range" min="-3" max="-0.1" step="0.1" value={truePeak} onChange={e => setTruePeak(Number(e.target.value))} className="mt-2 w-full accent-violet-600"/></div><div><div className="flex justify-between text-xs"><span>Correction strength</span><span>{Math.round(strength * 100)}%</span></div><input type="range" min="0" max="1" step="0.01" value={strength} onChange={e => setStrength(Number(e.target.value))} className="mt-2 w-full accent-violet-600"/></div><div><div className="flex justify-between text-xs"><span>Stereo width</span><span>{Math.round(stereoWidth * 100)}%</span></div><input type="range" min="0.75" max="1.25" step="0.01" value={stereoWidth} onChange={e => setStereoWidth(Number(e.target.value))} className="mt-2 w-full accent-violet-600"/></div><div><div className="flex justify-between text-xs"><span>Transient shape</span><span>{transientAmount > 0 ? "+" : ""}{transientAmount.toFixed(2)}</span></div><input type="range" min="-0.25" max="0.25" step="0.01" value={transientAmount} onChange={e => setTransientAmount(Number(e.target.value))} className="mt-2 w-full accent-violet-600"/></div><div><div className="flex justify-between text-xs"><span>Reference influence</span><span>{Math.round(referenceInfluence * 100)}%</span></div><input type="range" min="0" max="0.6" step="0.01" value={referenceInfluence} disabled={!reference} onChange={e => setReferenceInfluence(Number(e.target.value))} className="mt-2 w-full accent-violet-600 disabled:opacity-40"/></div></div><div className="mt-5"><Toggle checked={applyDynamicEq} onChange={setApplyDynamicEq} label="Apply localized dynamic corrections" note="Only time/frequency-specific candidates are touched. Global tonal character is preserved unless you explicitly use Reference Match."/></div><div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={() => render(reference ? "reference" : "assistant")} disabled={!source || busy || health !== "online"} className="min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white disabled:opacity-40">{reference ? "Create reference-guided candidate" : "Create mastering candidate"}</button><span className="self-center text-xs text-neutral-500">Source stays untouched. Automatic loudness gain is safety-capped.</span></div></section>

    {report && source && <>
      <section className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/[.035] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[10px] uppercase tracking-[.18em] text-emerald-500">Candidate ready</div><h2 className="mt-1 text-xl font-semibold">{report.run_id}</h2><p className="mt-1 text-sm text-neutral-500">Before / after / difference are separate files. The DAW project and original source were not modified.</p></div><span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-500">Non-destructive</span></div><div className="mt-5"><MetricsGrid metrics={report.after} prefix="After "/></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="LUFS change" value={fmt(report.after.integrated_lufs - report.before.integrated_lufs, 1, " LU")}/><Metric label="True peak" value={fmt(report.after.true_peak_dbtp, 2, " dBTP")}/><Metric label="Difference RMS" value={fmt(report.difference?.rms_dbfs, 2, " dBFS")} note={`${fmt(report.difference?.change_percent_of_source_rms, 1, "%")} of source RMS`}/></div>{report.warnings?.length > 0 && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[.05] p-3 text-xs text-amber-500">{report.warnings.join(" ")}</div>}</section>

      <ABMonitor assetId={source.asset_id} runId={report.run_id}/>
    </>}

    <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-800 p-4 text-xs text-neutral-500">Phase 21 truth: Master / Remaster is deterministic DSP plus measurement and heuristics, not a learned mastering model. LUFS/true peak use FFmpeg measurement when available; fallbacks are explicitly labeled. Reference Match never promises to reproduce another master, and “presence band” is not mislabeled as vocal presence without vocal-aware analysis.</div>
  </div></div>;
}
