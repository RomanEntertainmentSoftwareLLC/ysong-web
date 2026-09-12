import { useEffect, useMemo, useRef, useState } from "react";
import { checkVocalHealth, type LocalJob, type UploadResult } from "../stemrestore/api";
import {
  humanizeFileUrl,
  sourceAudioUrl,
  startHumanize,
  uploadForHumanize,
  waitForLocalJob,
  type HumanizeEvent,
  type HumanizeProfile,
  type HumanizeReport,
} from "./api";

type Props = { onBack: () => void; initialUpload?: UploadResult | null };
type Stage = "idle" | "uploading" | "ready" | "processing" | "done" | "error";

function fmtTime(value?: number) {
  const seconds = Math.max(0, Number(value) || 0);
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function fmtDb(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)} dB` : "—";
}

function fmtPct(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "—";
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/65 dark:bg-neutral-950/45 p-3"><div className="text-[10px] uppercase tracking-[.14em] text-neutral-500">{label}</div><div className="mt-1 text-sm font-semibold tabular-nums">{value}</div></div>;
}

function Toggle({ checked, onChange, label, note }: { checked: boolean; onChange: (next: boolean) => void; label: string; note: string }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-violet-600"/><span><span className="block text-sm font-medium">{label}</span><span className="mt-0.5 block text-xs text-neutral-500">{note}</span></span></label>;
}

function EventRow({ row }: { row: HumanizeEvent }) {
  const label = row.type.replaceAll("_", " ");
  return <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white/55 dark:bg-neutral-950/40 px-3 py-2 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium capitalize">{label}</span><span className="font-mono text-neutral-500">{fmtTime(row.start_seconds)} → {fmtTime(row.end_seconds)}</span></div>{row.low_hz != null && <div className="mt-1 text-neutral-500">{Math.round(row.low_hz)}–{Math.round(row.high_hz || row.low_hz)} Hz{row.changed_bins ? ` · ${row.changed_bins} bins` : ""}</div>}{row.note && <div className="mt-1 text-neutral-500">{row.note}</div>}</div>;
}

export default function HumanizeApp({ onBack, initialUpload = null }: Props) {
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(initialUpload);
  const [stage, setStage] = useState<Stage>(initialUpload ? "ready" : "idle");
  const [job, setJob] = useState<LocalJob | null>(null);
  const [report, setReport] = useState<HumanizeReport | null>(null);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<HumanizeProfile>("natural");
  const [strength, setStrength] = useState(0.55);
  const [deClick, setDeClick] = useState(true);
  const [repairMicroGaps, setRepairMicroGaps] = useState(true);
  const [spectralCleanse, setSpectralCleanse] = useState(true);
  const [softenEnd, setSoftenEnd] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const busy = stage === "uploading" || stage === "processing";

  useEffect(() => {
    void checkVocalHealth().then(h => setHealth(h.status === "ok" ? "online" : "offline")).catch(() => setHealth("offline"));
    return () => abortRef.current?.abort();
  }, []);

  function pickFile(next: File | null) {
    abortRef.current?.abort();
    setFile(next); setUpload(null); setReport(null); setJob(null); setError(""); setStage("idle");
  }

  async function prepare() {
    if (!file || busy) return;
    setStage("uploading"); setError("");
    try {
      const result = await uploadForHumanize(file);
      setUpload(result); setStage("ready");
    } catch (e: any) {
      setError(e?.message || "Audio preparation failed."); setStage("error");
    }
  }

  async function process() {
    if (!upload || busy) return;
    setStage("processing"); setError(""); setReport(null);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const started = await startHumanize(upload.asset_id, profile, strength, { deClick, repairMicroGaps, spectralCleanse, softenEnd });
      setJob(started);
      const finished = await waitForLocalJob(started.job_id, setJob, controller.signal);
      const next = finished.result?.report as HumanizeReport | undefined;
      if (!next?.run_id) throw new Error("Humanize completed without a report.");
      setReport(next); setStage("done");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e?.message || "Humanize failed."); setStage("error");
    }
  }

  const events = useMemo(() => (report?.events || []).slice(0, 24), [report]);
  const assetId = upload?.asset_id || "";
  const runId = report?.run_id || "";

  return <div className="h-full min-h-0 overflow-y-auto bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100"><div className="mx-auto max-w-6xl px-5 py-7 md:px-8 md:py-9">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><button type="button" onClick={onBack} className="mb-4 text-xs text-violet-500 hover:text-violet-400">← YSong Tools</button><div className="text-[11px] uppercase tracking-[.24em] text-violet-500">Audio Lab</div><h1 className="mt-1 !text-3xl md:!text-4xl !font-semibold !leading-tight tracking-tight">Humanize + Cleanse</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500 dark:text-neutral-400">Surgically reduce clicks, micro-gaps, chirpy musical noise, sparse spectral holes, and hard terminal clicks, then optionally add tiny mix-safe performance variation. No source file is overwritten.</p></div><div className={`rounded-full border px-3 py-1.5 text-xs ${health === "online" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : "border-amber-500/30 bg-amber-500/10 text-amber-500"}`}>{health === "online" ? "Audio Lab online" : health === "checking" ? "Checking…" : "Audio Lab offline"}</div></div>

    {health === "offline" && <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/[.06] p-4 text-sm text-neutral-500">YSong Audio Engine is offline. Restart YSong to relaunch the integrated local engine.</div>}

    <div className="mt-7 grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">1 · Source</div><h2 className="mt-1 text-lg font-semibold">Choose the track</h2><label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-5 hover:border-violet-500/60"><input type="file" accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg" className="hidden" disabled={busy} onChange={e => { pickFile(e.target.files?.[0] || null); e.currentTarget.value = ""; }}/><div className="font-medium">{file?.name || upload?.original_filename || "Drop/select audio"}</div><div className="mt-1 text-xs text-neutral-500">WAV/FLAC preferred. Existing Critique/Stem Restore assets can hand off without uploading again.</div></label>{file && !upload && <button type="button" onClick={prepare} disabled={busy || health !== "online"} className="mt-3 min-h-10 rounded-xl bg-violet-600 px-4 text-sm font-medium text-white disabled:opacity-40">{stage === "uploading" ? "Preparing…" : "Prepare audio"}</button>}{upload && <div className="mt-3 text-xs text-neutral-500">Asset <span className="font-mono">{upload.asset_id}</span></div>}</section>

      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">2 · Profile</div><h2 className="mt-1 text-lg font-semibold">How far should YSong go?</h2><div className="mt-4 grid gap-2 sm:grid-cols-3">{(["clean","natural","live"] as HumanizeProfile[]).map(p => <button type="button" key={p} onClick={() => setProfile(p)} className={`rounded-xl border p-3 text-left ${profile === p ? "border-violet-500 bg-violet-500/[.08]" : "border-neutral-200 dark:border-neutral-800"}`}><div className="text-sm font-medium capitalize">{p}</div><div className="mt-1 text-[11px] text-neutral-500">{p === "clean" ? "Artifact repair only" : p === "natural" ? "Subtle mix-safe variation" : "More audible natural variation"}</div></button>)}</div><div className="mt-4"><div className="flex justify-between text-xs"><span>Strength</span><span className="tabular-nums text-neutral-500">{Math.round(strength * 100)}%</span></div><input type="range" min="0" max="1" step="0.01" value={strength} onChange={e => setStrength(Number(e.target.value))} className="mt-2 w-full accent-violet-600"/></div></section>
    </div>

    <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">3 · Cleanser</div><h2 className="mt-1 text-lg font-semibold">Choose the surgical passes</h2><div className="mt-4 grid gap-3 md:grid-cols-2"><Toggle checked={deClick} onChange={setDeClick} label="De-click" note="Find impulse-like waveform discontinuities and repair only the micro-region."/><Toggle checked={repairMicroGaps} onChange={setRepairMicroGaps} label="Micro-gap repair" note="Interpolate very short dropouts; refuse longer gaps that need true inpainting."/><Toggle checked={spectralCleanse} onChange={setSpectralCleanse} label="Spectral cleanser" note="Suppress sparse chirps/musical-noise bins and conservatively refill isolated spectral holes."/><Toggle checked={softenEnd} onChange={setSoftenEnd} label="Terminal-click softener" note="Apply only a tiny end fade when the file ends abruptly; never invent a missing reverb tail."/></div><div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={process} disabled={!upload || busy || health !== "online"} className="min-h-10 rounded-xl bg-violet-600 px-5 text-sm font-medium text-white disabled:opacity-40">{stage === "processing" ? `Processing… ${Math.round(job?.progress_percent || 0)}%` : "Create candidate"}</button><span className="text-xs text-neutral-500">Raw source remains untouched. Every change is exported separately.</span></div>{error && <div className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/[.06] p-3 text-sm text-rose-500">{error}</div>}</section>

    {report && <>
      <section className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/[.035] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[10px] uppercase tracking-[.18em] text-emerald-500">Candidate ready</div><h2 className="mt-1 text-xl font-semibold">{runId}</h2><p className="mt-1 text-sm text-neutral-500">A/B the source, cleanser-only output, final humanized output, and the difference track.</p></div><span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-500">Non-destructive</span></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Changed vs source" value={fmtPct(report.metrics?.change_percent_of_source_rms)}/><Metric label="Difference RMS" value={fmtDb(report.metrics?.difference_rms_dbfs)}/><Metric label="Repair events" value={String(report.metrics?.event_count ?? 0)}/><Metric label="Output peak" value={fmtDb(report.metrics?.output_peak_dbfs)}/></div></section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-xs font-semibold">Original</div><audio controls preload="metadata" className="mt-3 w-full" src={sourceAudioUrl(assetId)}/><div className="mt-4 text-xs font-semibold">Cleanser only</div><audio controls preload="metadata" className="mt-3 w-full" src={humanizeFileUrl(assetId, runId, "cleaned")}/></div><div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="text-xs font-semibold">Final humanized candidate</div><audio controls preload="metadata" className="mt-3 w-full" src={humanizeFileUrl(assetId, runId, "humanized")}/><div className="mt-4 text-xs font-semibold">Difference only</div><audio controls preload="metadata" className="mt-3 w-full" src={humanizeFileUrl(assetId, runId, "difference")}/><a className="mt-4 inline-block text-xs text-violet-500" target="_blank" rel="noreferrer" href={humanizeFileUrl(assetId, runId, "report")}>Open JSON report →</a></div></section>

      <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">Repair map</div><h2 className="mt-1 text-lg font-semibold">What YSong touched</h2></div><div className="text-xs text-neutral-500">Showing {events.length} of {report.events?.length || 0}</div></div><div className="mt-4 grid gap-2 md:grid-cols-2">{events.length ? events.map((row, i) => <EventRow key={`${row.type}-${row.start_seconds}-${i}`} row={row}/>) : <div className="text-sm text-neutral-500">No surgical repair events were needed. Humanization may still have applied tiny global variation.</div>}</div></section>
    </>}

    <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-800 p-4 text-xs text-neutral-500">Technical note: this is the deterministic cleanser/humanization foundation, not a secret detector-evasion system and not fake ML. It repairs what can be repaired safely now and explicitly refuses longer missing-content problems until we add a learned local inpainting model. “Natural” and “Live” currently use mix-safe micro-dynamics/stereo breathing only; no pitch or timing warping is applied to a finished mix.</div>
  </div></div>;
}
