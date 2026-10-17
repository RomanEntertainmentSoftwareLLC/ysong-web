import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalJob, UploadResult } from "../stemrestore/api";
import { humanizeFileUrl, startHumanize, waitForLocalJob, type HumanizeReport } from "../humanize/api";
import { sourceAudioUrl, type CritiqueFinding } from "./api";
import { critiqueRepairPass } from "./repairAudition";
import { syncABStreams } from "../mastering/abSync";

type Props = { asset: UploadResult; finding: CritiqueFinding };
type Mode = "before" | "after";
const clock = (value: number) => { const n = Math.max(0, Number.isFinite(value) ? value : 0); return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}.${String(Math.floor((n % 1) * 100)).padStart(2, "0")}`; };

export default function CritiqueRepairAudition({ asset, finding }: Props) {
  const pass = critiqueRepairPass(finding);
  const [stage, setStage] = useState<"ready" | "processing" | "done" | "error">("ready");
  const [job, setJob] = useState<LocalJob | null>(null);
  const [report, setReport] = useState<HumanizeReport | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("before");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(Math.max(0, (finding.start_seconds || 0) - 0.35));
  const [duration, setDuration] = useState(0);
  const beforeRef = useRef<HTMLAudioElement | null>(null), afterRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef<number | null>(null), abortRef = useRef<AbortController | null>(null);
  const stop = useCallback(() => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); frameRef.current = null; beforeRef.current?.pause(); afterRef.current?.pause(); setPlaying(false); }, []);
  useEffect(() => () => { stop(); abortRef.current?.abort(); }, [stop]);

  async function createCandidate() {
    if (!pass || stage === "processing") return;
    setStage("processing"); setError(""); const controller = new AbortController(); abortRef.current = controller;
    try {
      const started = await startHumanize(asset.asset_id, "clean", 0, { deClick: pass === "deClick", repairMicroGaps: pass === "repairMicroGaps", spectralCleanse: false, softenEnd: pass === "softenEnd" });
      setJob(started); const finished = await waitForLocalJob(started.job_id, setJob, controller.signal);
      const candidate = finished.result?.report as HumanizeReport | undefined;
      if (!candidate?.run_id || candidate.asset_id !== asset.asset_id) throw new Error("Repair completed without a matching candidate report.");
      if (candidate.critique_hints_seen?.length && !candidate.critique_hints_seen.some(h => h.type === finding.type && h.start_seconds != null && finding.start_seconds != null && Math.abs(h.start_seconds - finding.start_seconds) < 0.1)) throw new Error("The repair candidate did not include this measured finding.");
      setReport(candidate); setStage("done"); const start = Math.max(0, (finding.start_seconds || 0) - 0.35); setPosition(start); setMode("before");
      if (beforeRef.current) beforeRef.current.currentTime = start; if (afterRef.current) afterRef.current.currentTime = start;
    } catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : "Could not create a repair candidate."); setStage("error"); }
  }
  function syncPosition(value: number) { const next = Math.max(0, Math.min(duration || value, value)); setPosition(next); [beforeRef.current, afterRef.current].forEach(a => { if (a && a.readyState >= 1 && Math.abs(a.currentTime - next) > 0.02) a.currentTime = next; }); }
  async function togglePlayback() {
    const before = beforeRef.current, after = afterRef.current; if (!before || !after || !report) return;
    if (playing) { stop(); return; }
    const start = Math.min(position, Math.max(0, duration - 0.02)); syncPosition(start);
    try {
      const active = mode === "before" ? before : after, follower = mode === "before" ? after : before; follower.pause(); await active.play(); setPlaying(true);
      const tick = () => { if (active.paused) { setPlaying(false); frameRef.current = null; return; } syncABStreams(active, [follower]); setPosition(active.currentTime); frameRef.current = requestAnimationFrame(tick); };
      frameRef.current = requestAnimationFrame(tick);
    } catch { stop(); setError("The source or candidate stream could not play."); }
  }
  if (!pass) return <section className="mt-5 rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-500">This measured finding has no matching surgical repair pass yet. Keep it as a critique suggestion and audition the marked source moment.</section>;
  return <section className="mt-5 rounded-2xl border border-emerald-500/25 bg-emerald-500/[.035] p-5">
    <div className="text-[10px] uppercase tracking-[.18em] text-emerald-600">Measured repair audition</div><h3 className="mt-1 text-lg font-semibold">{finding.title}</h3>
    <p className="mt-1 text-xs text-neutral-500">Candidate is linked to this measured {finding.type.replaceAll("_", " ")} finding at {clock(finding.start_seconds || 0)}. It uses only the matching repair pass; the source remains unchanged. AI critique suggestions never start processing.</p>
    {!report ? <button type="button" disabled={stage === "processing"} onClick={() => void createCandidate()} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{stage === "processing" ? `Creating candidate… ${Math.round(job?.progress_percent || 0)}%` : "Create repair candidate"}</button> : <>
      <audio ref={beforeRef} preload="auto" src={sourceAudioUrl(asset.asset_id)} onLoadedMetadata={e => { setDuration(e.currentTarget.duration || 0); syncPosition(Math.max(0, (finding.start_seconds || 0) - 0.35)); }} onEnded={stop}/><audio ref={afterRef} preload="auto" src={humanizeFileUrl(asset.asset_id, report.run_id, "cleaned")} onEnded={stop}/>
      <div className="mt-4 flex flex-wrap items-center gap-2">{([ ["before", "A · Before"], ["after", "B · Candidate"] ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { stop(); syncPosition(position); setMode(value); }} className={`rounded-lg border px-3 py-2 text-xs ${mode === value ? "border-emerald-600 bg-emerald-600/10 text-emerald-700" : "border-neutral-300 dark:border-neutral-700"}`}>{label}</button>)}<button type="button" onClick={() => void togglePlayback()} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white">{playing ? "Pause" : `Play ${mode === "before" ? "before" : "candidate"}`}</button><span className="font-mono text-xs tabular-nums text-neutral-500">{clock(position)} / {clock(duration)}</span></div>
      <input aria-label="Finding audition position" type="range" min="0" max={Math.max(0.01, duration)} step="0.01" value={Math.min(position, Math.max(0.01, duration))} onChange={e => syncPosition(Number(e.target.value))} className="mt-3 w-full accent-emerald-600"/><p className="mt-2 text-[11px] text-neutral-500">Before and candidate share one position. Switch A/B while paused; the selected stream plays from the measured moment.</p>
    </>}{error && <p role="alert" className="mt-3 text-xs text-rose-500">{error}</p>}
  </section>;
}
