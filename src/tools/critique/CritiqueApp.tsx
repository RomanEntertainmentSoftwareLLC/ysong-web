import { useEffect, useMemo, useRef, useState } from "react";
import { checkVocalHealth, VOCAL_API_BASE, type LocalJob, type UploadResult } from "../stemrestore/api";
import {
  critiqueReportUrl,
  sourceAudioUrl,
  startCritique,
  uploadForCritique,
  waitForLocalJob,
  type CritiqueFinding,
  type CritiqueReport,
} from "./api";

type Props = {
  onBack: () => void;
  onOpenStemRestore?: (asset: UploadResult) => void;
  onOpenHumanize?: (asset: UploadResult) => void;
  onOpenMastering?: (asset: UploadResult) => void;
  onOpenAudioIntelligence?: (asset: UploadResult) => void;
};

type Stage = "idle" | "uploading" | "ready" | "analyzing" | "done" | "error";
type SeverityFilter = "all" | "critical" | "warning" | "info";

function formatTime(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "Global";
  const n = Math.max(0, Number(seconds));
  const m = Math.floor(n / 60);
  const s = n - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}


function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
function fmt(value: unknown, digits = 1, suffix = "") {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}${suffix}` : "—";
}

function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === "critical"
    ? "border-rose-500/30 bg-rose-500/10 text-rose-500"
    : severity === "warning"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
      : "border-sky-500/25 bg-sky-500/10 text-sky-500";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>{severity}</span>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/65 dark:bg-neutral-950/45 p-3"><div className="text-[10px] uppercase tracking-[.14em] text-neutral-500">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>{note && <div className="mt-1 text-[10px] text-neutral-500">{note}</div>}</div>;
}

function ScoreRing({ score }: { score: number }) {
  const safe = Math.max(0, Math.min(100, Number(score) || 0));
  return <div className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(rgb(139 92 246) ${safe * 3.6}deg, rgba(115,115,115,.18) 0deg)` }}><div className="grid h-24 w-24 place-items-center rounded-full bg-neutral-50 dark:bg-neutral-950"><div className="text-center"><div className="text-3xl font-semibold tabular-nums">{Math.round(safe)}</div><div className="text-[9px] uppercase tracking-[.16em] text-neutral-500">technical</div></div></div></div>;
}

export default function CritiqueApp({ onBack, onOpenStemRestore, onOpenHumanize, onOpenMastering, onOpenAudioIntelligence }: Props) {
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [healthMessage, setHealthMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [deepScan, setDeepScan] = useState(true);
  const [job, setJob] = useState<LocalJob | null>(null);
  const [report, setReport] = useState<CritiqueReport | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<SeverityFilter>("all");
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const busy = stage === "uploading" || stage === "analyzing";

  async function refreshHealth() {
    setHealth("checking"); setHealthMessage("");
    try {
      const result = await checkVocalHealth();
      setHealth(result.status === "ok" ? "online" : "offline");
      setHealthMessage(result.stage || result.service || "Ready");
    } catch (e: unknown) {
      setHealth("offline"); setHealthMessage(errorMessage(e, "Local audio engine is not reachable."));
    }
  }

  useEffect(() => {
    refreshHealth();
    return () => abortRef.current?.abort();
  }, []);

  function selectFile(next: File | null) {
    abortRef.current?.abort();
    setFile(next); setUpload(null); setJob(null); setReport(null); setError(""); setFilter("all"); setStage("idle");
  }

  async function prepare() {
    if (!file || busy) return;
    setError(""); setStage("uploading");
    try {
      const result = await uploadForCritique(file);
      setUpload(result); setStage("ready");
    } catch (e: unknown) {
      setError(errorMessage(e, "Audio preparation failed.")); setStage("error");
    }
  }

  async function analyze() {
    if (!upload || busy) return;
    setError(""); setReport(null); setStage("analyzing");
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const started = await startCritique(upload.asset_id, deepScan);
      setJob(started);
      const finished = await waitForLocalJob(started.job_id, setJob, controller.signal);
      setJob(finished);
      const next = finished.result?.report as CritiqueReport | undefined;
      if (!next?.asset_id) throw new Error("Critique completed without a report.");
      setReport(next); setStage("done");
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(errorMessage(e, "Critique failed.")); setStage("error");
    }
  }

  function jumpTo(finding: CritiqueFinding) {
    if (!audioRef.current || finding.start_seconds == null) return;
    audioRef.current.currentTime = Math.max(0, finding.start_seconds - 0.35);
    void audioRef.current.play().catch(() => {});
  }

  const visibleFindings = useMemo(() => {
    const rows = report?.findings || [];
    return filter === "all" ? rows : rows.filter(row => row.severity === filter);
  }, [report, filter]);

  const timelineFindings = useMemo(() => (report?.findings || []).filter(row => row.start_seconds != null), [report]);
  const duration = Math.max(0.001, Number(report?.duration_seconds || 0.001));

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="mx-auto max-w-6xl px-5 py-7 md:px-8 md:py-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button type="button" onClick={onBack} className="mb-4 text-xs text-violet-500 hover:text-violet-400">← YSong Tools</button>
            <div className="text-[11px] uppercase tracking-[.24em] text-violet-500">Audio Lab · YSong Ears</div>
            <h1 className="mt-1 !text-3xl md:!text-4xl !font-semibold !leading-tight tracking-tight">Critique</h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-500 dark:text-neutral-400">A technical second set of ears: detect glitches, dropouts, clipping, suspicious spectral jumps, stereo problems, chopped edges, and timing evidence without pretending to judge whether your song is artistically good.</p>
          </div>
          <div className={`rounded-full border px-3 py-1.5 text-xs ${health === "online" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : health === "checking" ? "border-amber-500/30 bg-amber-500/10 text-amber-500" : "border-rose-500/30 bg-rose-500/10 text-rose-500"}`}>{health === "online" ? "Ears online" : health === "checking" ? "Checking ears…" : "Ears offline"}</div>
        </div>

        {health !== "online" && <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/[.06] p-4 text-sm"><div className="font-medium text-amber-500">The local YSong Vocal/Audio API powers Critique.</div><div className="mt-1 text-neutral-500">{healthMessage || `Start it at ${VOCAL_API_BASE}.`}</div><button type="button" onClick={refreshHealth} className="mt-3 rounded-lg border border-amber-500/30 px-3 py-1.5 text-xs text-amber-500">Check again</button></div>}

        <div className="mt-7 grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
          <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5">
            <div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Source</div><h2 className="mt-1 text-lg font-semibold">Give YSong a finished mix</h2>
            <label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-5 hover:border-violet-500/60 transition"><input type="file" accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg" className="hidden" disabled={busy} onChange={e => { selectFile(e.target.files?.[0] || null); e.currentTarget.value = ""; }} /><div className="font-medium">{file?.name || "Drop/select an audio file"}</div><div className="mt-1 text-xs text-neutral-500">YSong prepares a local 48 kHz analysis copy. Your original upload is retained.</div></label>
            {file && !upload && <button type="button" disabled={busy || health !== "online"} onClick={prepare} className="mt-3 min-h-10 rounded-xl bg-violet-600 px-4 text-sm font-medium text-white disabled:opacity-40">{stage === "uploading" ? "Preparing…" : "Prepare audio"}</button>}
            {upload && <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-neutral-500"><span>Asset <span className="font-mono text-neutral-700 dark:text-neutral-300">{upload.asset_id}</span></span><span className="text-emerald-500">Prepared</span>{onOpenStemRestore && <button type="button" onClick={() => onOpenStemRestore(upload)} className="text-violet-500 hover:text-violet-400">Open same source in Stem Restore →</button>}{onOpenMastering && <button type="button" onClick={() => onOpenMastering(upload)} className="text-violet-500 hover:text-violet-400">Open in Master / Remaster →</button>}{onOpenAudioIntelligence && <button type="button" onClick={() => onOpenAudioIntelligence(upload)} className="text-violet-500 hover:text-violet-400">Open in Audio Intelligence →</button>}</div>}
          </section>

          <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5">
            <div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Scan</div><h2 className="mt-1 text-lg font-semibold">How hard should Ears listen?</h2>
            <label className="mt-4 flex items-start gap-3 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3"><input type="checkbox" checked={deepScan} disabled={busy} onChange={e => setDeepScan(e.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-500"/><span><span className="block text-sm font-medium">Deep spectral scan</span><span className="mt-0.5 block text-xs text-neutral-500">Adds STFT spectral discontinuity and tempo-variability evidence. Slower, but still local.</span></span></label>
            <button type="button" disabled={!upload || busy || health !== "online"} onClick={analyze} className="mt-4 min-h-11 w-full rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-40">{stage === "analyzing" ? `Listening… ${job?.progress_percent ?? 0}%` : report ? "Re-run critique" : "Analyze track"}</button>
            {stage === "analyzing" && <div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.max(3, Math.min(100, job?.progress_percent || 5))}%` }}/></div><div className="mt-1 text-[11px] text-neutral-500">{job?.stage || "listening"}</div></div>}
          </section>
        </div>

        {error && <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/[.06] p-4 text-sm text-rose-500">{error}</div>}

        {report && upload && <>
          <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5">
            <div className="flex flex-wrap items-center gap-6"><ScoreRing score={report.technical_score}/><div className="min-w-0 flex-1"><div className="text-[10px] uppercase tracking-[.18em] text-violet-500">{report.engine}</div><h2 className="mt-1 text-2xl font-semibold">{report.verdict}</h2><p className="mt-1 text-sm text-neutral-500">This is a technical-integrity score, not a songwriting score. Candidates remain audition-first.</p><div className="mt-3 flex flex-wrap gap-2"><SeverityBadge severity="critical"/><span className="text-xs tabular-nums text-neutral-500">{report.finding_counts?.critical || 0}</span><SeverityBadge severity="warning"/><span className="text-xs tabular-nums text-neutral-500">{report.finding_counts?.warning || 0}</span><SeverityBadge severity="info"/><span className="text-xs tabular-nums text-neutral-500">{report.finding_counts?.info || 0}</span></div></div><div className="flex flex-wrap gap-2">{onOpenMastering && <button type="button" onClick={() => onOpenMastering(upload)} className="rounded-xl border border-violet-500/35 bg-violet-500/[.05] px-3 py-2 text-xs text-violet-500">Send findings to Master / Remaster</button>}{onOpenAudioIntelligence && <button type="button" onClick={() => onOpenAudioIntelligence(upload)} className="rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs">Analyze musical identity</button>}<a href={critiqueReportUrl(upload.asset_id)} target="_blank" rel="noreferrer" className="rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs hover:border-violet-500/60">JSON report</a></div></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><Metric label="Peak" value={fmt(report.metrics?.peak_dbfs, 2, " dBFS")}/><Metric label="RMS" value={fmt(report.metrics?.rms_dbfs, 2, " dBFS")}/><Metric label="Crest" value={fmt(report.metrics?.crest_factor_db, 1, " dB")}/><Metric label="Dynamics" value={fmt(report.metrics?.dynamic_range_proxy_db, 1, " dB")} note="proxy"/><Metric label="Tempo" value={report.metrics?.tempo?.estimated_bpm ? fmt(report.metrics.tempo.estimated_bpm, 1, " BPM") : "—"}/><Metric label="Stereo corr." value={fmt(report.metrics?.stereo?.correlation, 2)}/></div>
          </section>

          <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Audition</div><h2 className="mt-1 text-lg font-semibold">Click a marker and listen</h2></div><div className="text-xs text-neutral-500">{formatTime(report.duration_seconds)} total</div></div>
            <audio ref={audioRef} controls preload="metadata" src={sourceAudioUrl(upload.asset_id)} className="mt-4 w-full"/>
            <div className="relative mt-4 h-10 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-950">
              <div className="absolute inset-y-0 left-1/4 border-l border-neutral-300/50 dark:border-neutral-700/50"/><div className="absolute inset-y-0 left-1/2 border-l border-neutral-300/50 dark:border-neutral-700/50"/><div className="absolute inset-y-0 left-3/4 border-l border-neutral-300/50 dark:border-neutral-700/50"/>
              {timelineFindings.map((row, index) => { const left = Math.max(0, Math.min(99.5, ((row.start_seconds || 0) / duration) * 100)); const cls = row.severity === "critical" ? "bg-rose-500" : row.severity === "warning" ? "bg-amber-500" : "bg-sky-500"; return <button key={`${row.id}-${index}`} type="button" title={`${formatTime(row.start_seconds)} · ${row.title}`} onClick={() => jumpTo(row)} className={`absolute top-1 h-8 w-1.5 rounded-full ${cls} opacity-80 hover:opacity-100`} style={{ left: `${left}%` }}/>; })}
            </div>
          </section>

          <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4"><div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Findings</div><h2 className="mt-1 text-lg font-semibold">Actionable moments</h2></div><div className="flex flex-wrap gap-1">{(["all","critical","warning","info"] as SeverityFilter[]).map(value => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-lg px-2.5 py-1.5 text-xs capitalize ${filter === value ? "bg-violet-600 text-white" : "border border-neutral-300 dark:border-neutral-700 text-neutral-500"}`}>{value}</button>)}</div></div>
            <div className="mt-4 space-y-3">
              {visibleFindings.length === 0 && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[.05] p-4 text-sm text-emerald-500">No findings in this filter.</div>}
              {visibleFindings.map((row, index) => <article key={`${row.id}-${index}`} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950/45 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={row.severity}/><span className="text-[10px] uppercase tracking-wide text-neutral-500">{row.category}</span><span className="text-[10px] text-neutral-500">confidence {Math.round((row.confidence || 0) * 100)}%</span></div><h3 className="mt-2 font-semibold">{row.title}</h3><p className="mt-1 text-sm text-neutral-500">{row.detail}</p><p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400"><span className="font-medium text-neutral-800 dark:text-neutral-200">Do:</span> {row.recommendation}</p></div><div className="shrink-0 text-right"><div className="font-mono text-xs">{formatTime(row.start_seconds)}</div>{row.frequency_low_hz != null && <div className="mt-1 text-[10px] text-neutral-500">{Math.round(row.frequency_low_hz)}–{Math.round(row.frequency_high_hz || row.frequency_low_hz)} Hz</div>}</div></div><div className="mt-3 flex flex-wrap gap-2">{row.start_seconds != null && <button type="button" onClick={() => jumpTo(row)} className="rounded-lg border border-violet-500/30 bg-violet-500/[.06] px-3 py-1.5 text-xs text-violet-500">Jump + play</button>}{row.suggested_action === "stem_restore" && onOpenStemRestore && <button type="button" onClick={() => onOpenStemRestore(upload)} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-xs">Open Stem Restore</button>}{onOpenHumanize && ["repair_click","repair_gap","repair_tail","inspect"].includes(row.suggested_action) && <button type="button" onClick={() => onOpenHumanize(upload)} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-xs">Open Humanize + Cleanse</button>}</div></article>)}
            </div>
          </section>

          <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-800 p-4 text-xs text-neutral-500">Phase 19 truth: Critique v0.2 is a deterministic local technical analyzer. The uploaded prototype's CLAP genre detector is useful and preserved as a future Audio Intelligence direction, but it does not secretly influence this score. We would rather say “candidate, listen here” than invent certainty.</div>
        </>}
      </div>
    </div>
  );
}
