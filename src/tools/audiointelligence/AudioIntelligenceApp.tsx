import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { checkVocalHealth, type LocalJob, type UploadResult } from "../stemrestore/api";
import {
  audioIntelligenceReportUrl,
  getAudioIntelligenceCapabilities,
  startAudioIntelligence,
  uploadForAudioIntelligence,
  waitForLocalJob,
  type AudioIntelligenceReport,
  type IntelligenceCapabilities,
  type RankedLabel,
} from "./api";

type Props = {
  onBack: () => void;
  initialUpload?: UploadResult | null;
  onOpenCritique?: (asset: UploadResult) => void;
  onOpenMastering?: (asset: UploadResult) => void;
  onOpenCurators?: (report: AudioIntelligenceReport) => void;
};

type Stage = "idle" | "uploading" | "ready" | "analyzing" | "done" | "error";

function percent(value: number | undefined) { return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`; }
function labelText(value: string | null | undefined) { return value ? value.replaceAll("_", " ") : "—"; }
function confidenceClass(value: string) { return value === "match" ? "text-emerald-500" : value === "mismatch" ? "text-amber-500" : "text-neutral-500"; }
function Pill({ children }: { children: ReactNode }) { return <span className="rounded-full border border-neutral-300 dark:border-neutral-700 px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-300">{children}</span>; }
function RankedPills({ rows, strength = false }: { rows: RankedLabel[]; strength?: boolean }) {
  return <div className="flex flex-wrap gap-2">{rows.map(row => <Pill key={row.label}>{labelText(row.label)} · {percent(strength ? row.relative_strength : row.relative_confidence)}</Pill>)}</div>;
}

export default function AudioIntelligenceApp({ onBack, initialUpload = null, onOpenCritique, onOpenMastering, onOpenCurators }: Props) {
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [capabilities, setCapabilities] = useState<IntelligenceCapabilities | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(initialUpload);
  const [stage, setStage] = useState<Stage>(initialUpload ? "ready" : "idle");
  const [expectedBpm, setExpectedBpm] = useState("");
  const [expectedKey, setExpectedKey] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [job, setJob] = useState<LocalJob | null>(null);
  const [report, setReport] = useState<AudioIntelligenceReport | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const busy = stage === "uploading" || stage === "analyzing";

  useEffect(() => {
    Promise.all([checkVocalHealth(), getAudioIntelligenceCapabilities()])
      .then(([status, caps]) => { setHealth(status.status === "ok" ? "online" : "offline"); setCapabilities(caps); })
      .catch((e: unknown) => { setHealth("offline"); setError(e instanceof Error ? e.message : "Local Audio Intelligence is not reachable."); });
    return () => abortRef.current?.abort();
  }, []);

  const canAnalyze = Boolean(upload && health === "online" && capabilities?.available && !busy);
  const moods = useMemo(() => report?.mood.candidates.filter(row => (row.relative_strength || 0) >= 0.45).slice(0, 5) || [], [report]);

  function resetForFile(next: File | null) {
    abortRef.current?.abort(); setFile(next); setUpload(null); setReport(null); setJob(null); setError(""); setStage("idle");
  }

  async function prepare() {
    if (!file || busy) return;
    setStage("uploading"); setError("");
    try { const result = await uploadForAudioIntelligence(file); setUpload(result); setStage("ready"); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Audio preparation failed."); setStage("error"); }
  }

  async function analyze(force = false) {
    if (!upload || busy || !capabilities?.available) return;
    setStage("analyzing"); setError(""); setReport(null);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const bpm = expectedBpm.trim() ? Number(expectedBpm) : null;
      const started = await startAudioIntelligence(upload.asset_id, { expectedBpm: Number.isFinite(bpm) ? bpm : null, expectedKey, lyrics, force });
      setJob(started);
      const finished = await waitForLocalJob(started.job_id, setJob, controller.signal);
      const next = finished.result?.report as AudioIntelligenceReport | undefined;
      if (!next?.asset_id) throw new Error("Audio Intelligence completed without a report.");
      setReport(next); setStage("done");
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Audio Intelligence failed."); setStage("error");
    }
  }

  return <div className="h-full min-h-0 overflow-y-auto bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
    <div className="mx-auto max-w-6xl px-5 py-7 md:px-8 md:py-9">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><button type="button" onClick={onBack} className="text-xs text-violet-500 hover:text-violet-400">← Tools</button><div className="mt-4 text-[11px] uppercase tracking-[.24em] text-violet-500">Analysis · Phase 22</div><h1 className="mt-1 !text-3xl !font-semibold tracking-tight">Audio Intelligence</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">One CLAP listen, reused across genre/subgenre, mood, energy, sonic cues, voice/instrument tags and experimental provenance evidence. BPM/key stay deterministic estimates.</p></div>
        <div className="text-right text-xs"><div className={health === "online" ? "text-emerald-500" : health === "offline" ? "text-rose-500" : "text-neutral-500"}>{health === "online" ? "Vocal API online" : health === "offline" ? "Vocal API offline" : "Checking API…"}</div><div className={capabilities?.available ? "mt-1 text-emerald-500" : "mt-1 text-amber-500"}>{capabilities?.available ? "YSong Ears ML backend ready" : capabilities ? "YSong Ears ML backend unavailable" : "Checking CLAP…"}</div></div>
      </div>

      {capabilities && !capabilities.available && <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/[.06] p-4 text-sm"><div className="font-medium text-amber-500">Learned backend is not installed in this Python environment.</div><div className="mt-1 text-neutral-500">{capabilities.reason}</div>{capabilities.install && <code className="mt-3 block overflow-x-auto rounded-lg bg-neutral-950 p-3 text-xs text-neutral-300">{capabilities.install}</code>}</div>}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5">
          <div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Source</div><h2 className="mt-1 text-lg font-semibold">Analyze a prepared track</h2>
          {!initialUpload && <><input type="file" accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg" disabled={busy} onChange={e => resetForFile(e.target.files?.[0] || null)} className="mt-4 block w-full text-sm"/>{file && !upload && <button type="button" onClick={prepare} disabled={busy || health !== "online"} className="mt-3 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">{stage === "uploading" ? "Preparing…" : "Prepare audio"}</button>}</>}
          {upload && <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[.05] p-3 text-xs"><div className="text-emerald-500">Prepared asset</div><div className="mt-1 font-mono text-neutral-500">{upload.asset_id}</div></div>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-500">Expected BPM (optional)<input value={expectedBpm} onChange={e => setExpectedBpm(e.target.value)} inputMode="decimal" placeholder="138" className="mt-1 w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2.5 text-sm text-neutral-900 dark:text-neutral-100"/></label><label className="text-xs text-neutral-500">Expected key (optional)<input value={expectedKey} onChange={e => setExpectedKey(e.target.value)} placeholder="D minor" className="mt-1 w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2.5 text-sm text-neutral-900 dark:text-neutral-100"/></label></div>
          <label className="mt-3 block text-xs text-neutral-500">Lyrics for explicit-content metadata (optional)<textarea value={lyrics} onChange={e => setLyrics(e.target.value)} rows={4} placeholder="Leave empty and YSong will report explicit status as unknown instead of guessing from audio." className="mt-1 w-full resize-y rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2.5 text-sm text-neutral-900 dark:text-neutral-100"/></label>
          <button type="button" onClick={() => analyze(false)} disabled={!canAnalyze} className="mt-4 min-h-11 w-full rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-40">{stage === "analyzing" ? `Listening… ${job?.progress_percent || 0}%` : report ? "Use cached analysis" : "Analyze once"}</button>
          {stage === "analyzing" && <div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-violet-500" style={{ width: `${Math.max(4, job?.progress_percent || 4)}%` }}/></div><div className="mt-1 text-[11px] text-neutral-500">{job?.stage || "loading model"}</div></div>}
        </section>

        <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Reuse policy</div><h2 className="mt-1 text-lg font-semibold">Analyze once. Feed everything.</h2><p className="mt-2 text-sm text-neutral-500">The saved metadata envelope is designed for SEO, YSong Radio, Promotion, playlist matching, curator recommendations and release metadata. Future consumers query the report instead of rerunning detectors.</p><div className="mt-4 flex flex-wrap gap-2">{["SEO","Radio","Promotion","Playlists","Curators","Release metadata"].map(x => <Pill key={x}>{x}</Pill>)}</div>{report && <div className="mt-4 text-xs text-neutral-500">CLAP audio passes: <span className="font-semibold text-neutral-800 dark:text-neutral-200">{report.analysis_policy.audio_embedding_passes}</span> · windows: {report.analysis_policy.windows_analyzed} · cache: {report.cache?.hit ? "reused" : "fresh"}</div>}</section>
      </div>

      {error && <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/[.06] p-4 text-sm text-rose-500">{error}</div>}

      {report && upload && <>
        <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[10px] uppercase tracking-[.18em] text-violet-500">Classification</div><h2 className="mt-1 text-2xl font-semibold capitalize">{report.genre.primary_subgenre || report.genre.primary_genre || "Unknown"}</h2><div className="mt-1 text-sm text-neutral-500">Broad family: <span className="capitalize">{report.genre.primary_genre || "unknown"}</span> · Energy: <span className="capitalize">{labelText(report.energy.primary?.label)}</span></div></div><div className="flex flex-wrap gap-2">{onOpenCritique && <button type="button" onClick={() => onOpenCritique(upload)} className="rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs">Open in Critique</button>}{onOpenMastering && <button type="button" onClick={() => onOpenMastering(upload)} className="rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs">Open in Mastering</button>}{onOpenCurators && <button type="button" onClick={() => onOpenCurators(report)} className="rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs">Find curator matches</button>}<a href={audioIntelligenceReportUrl(upload.asset_id)} target="_blank" rel="noreferrer" className="rounded-xl border border-violet-500/30 px-3 py-2 text-xs text-violet-500">JSON report</a></div></div><div className="mt-4 flex flex-wrap gap-2">{report.genre.candidates.slice(0, 8).map(row => <Pill key={row.genre}>{row.genre} · {percent(row.relative_confidence)}</Pill>)}</div></section>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Mood + presence</div><h3 className="mt-1 font-semibold">What it sounds like</h3><div className="mt-4"><div className="mb-2 text-xs text-neutral-500">Mood candidates</div><RankedPills rows={moods} strength/></div><div className="mt-4"><div className="mb-2 text-xs text-neutral-500">Instrument / vocal tags</div><RankedPills rows={report.presence.tags.slice(0, 8)} strength/></div><div className="mt-4 text-xs text-neutral-500">Vocal presence: <span className="text-neutral-900 dark:text-neutral-100">{percent(report.presence.vocal)}</span> · instrumental evidence {percent(report.presence.instrumental)}</div></section>

          <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Musical cross-check</div><h3 className="mt-1 font-semibold">Tempo + key</h3><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3"><div className="text-[10px] uppercase text-neutral-500">BPM</div><div className="mt-1 text-xl font-semibold">{report.tempo.estimated_bpm ?? "—"}</div><div className={`mt-1 text-xs ${confidenceClass(report.tempo.cross_check.status)}`}>{report.tempo.cross_check.status.replaceAll("_", " ")}</div></div><div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3"><div className="text-[10px] uppercase text-neutral-500">Key</div><div className="mt-1 text-xl font-semibold">{report.key.estimated_key ?? "—"}</div><div className={`mt-1 text-xs ${confidenceClass(report.key.cross_check.status)}`}>{report.key.cross_check.status.replaceAll("_", " ")}</div></div></div><p className="mt-3 text-xs text-neutral-500">These are deterministic signal estimates, not CLAP labels. Half/double-time ambiguity is considered when BPM is cross-checked.</p></section>
        </div>

        <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Sonic fingerprint</div><h3 className="mt-1 font-semibold">Recognizable production cues</h3><div className="mt-4 flex flex-wrap gap-2">{report.sonic_fingerprint.cues.slice(0, 10).map(cue => <Pill key={cue.name}>{cue.name} · {percent(cue.strength)}</Pill>)}</div></section>

        <div className="mt-5 grid gap-4 lg:grid-cols-2"><section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Explicit metadata helper</div><h3 className="mt-1 font-semibold capitalize">{labelText(report.explicit_content.status)}</h3><p className="mt-2 text-sm text-neutral-500">{report.explicit_content.reason}</p></section><section className="rounded-2xl border border-amber-500/25 bg-amber-500/[.04] p-5"><div className="text-[10px] uppercase tracking-[.18em] text-amber-500">Experimental AI-likelihood</div><h3 className="mt-1 font-semibold capitalize">{labelText(report.ai_likelihood.label)}</h3><div className="mt-2 text-sm text-neutral-500">AI-like score {percent(report.ai_likelihood.ai_like_score)} · confidence only {percent(report.ai_likelihood.confidence)} · uncertainty {percent(report.ai_likelihood.uncertainty)}</div><p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{report.ai_likelihood.warning}</p></section></div>

        <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-800 p-4 text-xs text-neutral-500">Phase 22 truth policy: learned labels are candidates, not ground truth. Explicit status is never guessed without lyrics. AI-likelihood is deliberately capped and cannot establish provenance. The canonical saved metadata can be reused without re-listening.</div>
      </>}
    </div>
  </div>;
}
