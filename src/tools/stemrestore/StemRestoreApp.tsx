import { useEffect, useMemo, useRef, useState } from "react";
import {
  VOCAL_API_BASE,
  checkVocalHealth,
  getSpectralBalance,
  rawStemUrl,
  restoreFileUrl,
  startStemRestore,
  startStemSeparation,
  uploadForStemRestore,
  waitForLocalJob,
  type LocalJob,
  type UploadResult,
} from "./api";

type Props = { onBack: () => void; initialUpload?: UploadResult | null; onOpenHumanize?: (asset: UploadResult) => void };
type Stage = "idle" | "uploading" | "uploaded" | "separating" | "separated" | "restoring" | "done" | "error";

type RestoreReport = {
  asset_id: string;
  restore_id: string;
  metrics?: Record<string, number>;
  algorithm?: { band_count?: number; artifact_cleanser?: boolean; ml_model_used?: boolean; note?: string };
  bands_by_transfer?: Array<{ band: number; low_hz: number; high_hz: number; total_transfer_energy: number }>;
  strongest_repair_windows?: Array<{ start_seconds: number; end_seconds: number; vocal_activity: number; transfer_energy: number; reasons: string[] }>;
  safety?: Record<string, any>;
};

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/60 p-3"><div className="text-[10px] uppercase tracking-[.16em] text-neutral-500">{label}</div><div className="mt-1 text-sm font-semibold tabular-nums">{value}</div></div>;
}

function ButtonLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 text-xs font-medium hover:border-violet-500/60 hover:bg-violet-500/[.05] transition">{children}</a>;
}

function formatDb(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)} dB` : "—";
}

function formatPct(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "—";
}

function formatTime(seconds: number) {
  const n = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(n / 60);
  const s = n - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

export default function StemRestoreApp({ onBack, initialUpload = null, onOpenHumanize }: Props) {
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [healthMessage, setHealthMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(initialUpload);
  const [stage, setStage] = useState<Stage>(initialUpload ? "uploaded" : "idle");
  const [job, setJob] = useState<LocalJob | null>(null);
  const [balance, setBalance] = useState<any>(null);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [error, setError] = useState("");
  const [bandCount, setBandCount] = useState<10 | 15 | 24>(24);
  const [strength, setStrength] = useState(0.72);
  const [cleanse, setCleanse] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const busy = stage === "uploading" || stage === "separating" || stage === "restoring";

  async function refreshHealth() {
    setHealth("checking");
    setHealthMessage("");
    try {
      const h = await checkVocalHealth();
      setHealth(h.status === "ok" ? "online" : "offline");
      setHealthMessage(h.stage || h.service || "Ready");
    } catch (e: any) {
      setHealth("offline");
      setHealthMessage(e?.message || "Local Vocal API is not reachable.");
    }
  }

  useEffect(() => {
    refreshHealth();
    return () => abortRef.current?.abort();
  }, []);

  function resetForFile(next: File | null) {
    abortRef.current?.abort();
    setFile(next);
    setUpload(null);
    setJob(null);
    setBalance(null);
    setReport(null);
    setError("");
    setStage("idle");
  }

  async function uploadAudio() {
    if (!file || busy) return;
    setError("");
    setStage("uploading");
    try {
      const result = await uploadForStemRestore(file);
      setUpload(result);
      setStage("uploaded");
    } catch (e: any) {
      setError(e?.message || "Upload failed.");
      setStage("error");
    }
  }

  async function separate() {
    if (!upload || busy) return;
    setError("");
    setStage("separating");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const started = await startStemSeparation(upload.asset_id);
      setJob(started);
      const finished = await waitForLocalJob(started.job_id, setJob, controller.signal);
      setJob(finished);
      try { setBalance(await getSpectralBalance(upload.asset_id)); } catch { setBalance(null); }
      setStage("separated");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e?.message || "Stem separation failed.");
      setStage("error");
    }
  }

  async function restore() {
    if (!upload || busy) return;
    setError("");
    setStage("restoring");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const started = await startStemRestore(upload.asset_id, bandCount, strength, cleanse);
      setJob(started);
      const finished = await waitForLocalJob(started.job_id, setJob, controller.signal);
      setJob(finished);
      const nextReport = finished.result?.report as RestoreReport | undefined;
      if (!nextReport?.restore_id) throw new Error("Stem Restore completed without a report id.");
      setReport(nextReport);
      setStage("done");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e?.message || "Stem Restore failed.");
      setStage("error");
    }
  }

  const topBands = useMemo(() => (report?.bands_by_transfer || []).filter(x => Number(x.total_transfer_energy) > 0).slice(0, 6), [report]);
  const topWindows = useMemo(() => (report?.strongest_repair_windows || []).slice(0, 8), [report]);
  const restoreId = report?.restore_id || "";
  const assetId = upload?.asset_id || "";

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="mx-auto max-w-6xl px-5 py-7 md:px-8 md:py-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button type="button" onClick={onBack} className="mb-4 text-xs text-violet-500 hover:text-violet-400">← YSong Tools</button>
            <div className="text-[11px] uppercase tracking-[.24em] text-violet-500">Audio Lab</div>
            <h1 className="mt-1 !text-3xl md:!text-4xl !font-semibold !leading-tight tracking-tight">Stem Restore</h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-500 dark:text-neutral-400">Separate first, then repair cross-stem spectral holes without duplicating energy. Raw separator stems remain untouched.</p>
          </div>
          <div className={`rounded-full border px-3 py-1.5 text-xs ${health === "online" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : health === "checking" ? "border-amber-500/30 bg-amber-500/10 text-amber-500" : "border-rose-500/30 bg-rose-500/10 text-rose-500"}`}>
            {health === "online" ? "Local engine online" : health === "checking" ? "Checking local engine…" : "Local engine offline"}
          </div>
        </div>

        {health !== "online" && (
          <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/[.06] p-4 text-sm">
            <div className="font-medium text-amber-500">YSong Vocal API is required for local stem processing.</div>
            <div className="mt-1 text-neutral-500 dark:text-neutral-400">{healthMessage || `Start the Vocal API at ${VOCAL_API_BASE}.`}</div>
            <button type="button" onClick={refreshHealth} className="mt-3 rounded-lg border border-amber-500/30 px-3 py-1.5 text-xs text-amber-500">Check again</button>
          </div>
        )}

        <div className="mt-7 grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
          <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5">
            <div className="flex items-center justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">1 · Source</div><h2 className="mt-1 text-lg font-semibold">Choose a finished mix</h2></div>{upload && <span className="text-xs text-emerald-500">Prepared</span>}</div>
            <label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-5 hover:border-violet-500/60 transition">
              <input type="file" accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg" className="hidden" disabled={busy} onChange={e => { resetForFile(e.target.files?.[0] || null); e.currentTarget.value = ""; }} />
              <div className="font-medium">{file?.name || upload?.original_filename || "Drop/select an audio file"}</div>
              <div className="mt-1 text-xs text-neutral-500">WAV/FLAC preferred. YSong prepares its own working WAV.</div>
            </label>
            {file && !upload && <button type="button" disabled={busy || health !== "online"} onClick={uploadAudio} className="mt-3 min-h-10 rounded-xl bg-violet-600 px-4 text-sm font-medium text-white disabled:opacity-40">{stage === "uploading" ? "Preparing…" : "Prepare audio"}</button>}
            {upload && <div className="mt-3 text-xs text-neutral-500">Asset <span className="font-mono text-neutral-700 dark:text-neutral-300">{upload.asset_id}</span>{upload.warnings?.length ? ` · ${upload.warnings.join(" · ")}` : ""}</div>}
          </section>

          <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5">
            <div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">2 · Separate</div><h2 className="mt-1 text-lg font-semibold">Create raw evidence stems</h2>
            <p className="mt-2 text-sm text-neutral-500">The existing YSong splitter creates vocals + instrumental and runs Stem Integrity and Spectral Balance analysis.</p>
            <button type="button" disabled={!upload || busy || health !== "online"} onClick={separate} className="mt-4 min-h-10 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 text-sm font-medium text-violet-500 disabled:opacity-40">{stage === "separating" ? `Separating ${job?.progress_percent ?? 0}%…` : stage === "separated" || stage === "done" ? "Re-run separation" : "Separate stems"}</button>
            {job && (stage === "separating" || stage === "restoring") && <div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.max(2, Math.min(100, job.progress_percent || 0))}%` }} /></div><div className="mt-1 text-[11px] text-neutral-500">{job.stage}</div></div>}
            {balance && <div className="mt-3 rounded-xl bg-neutral-100 dark:bg-neutral-950/70 p-3 text-xs"><div className="font-medium">Spectral Balance: <span className={balance.decision === "NEEDS_REPAIR" ? "text-amber-500" : "text-emerald-500"}>{balance.decision || "Analyzed"}</span></div>{balance.plain_english_summary?.[0] && <div className="mt-1 text-neutral-500">{balance.plain_english_summary[0]}</div>}</div>}
          </section>
        </div>

        <section className="mt-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/45 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[10px] uppercase tracking-[.18em] text-neutral-500">3 · Reconstruct + cleanse</div><h2 className="mt-1 text-lg font-semibold">Repair the split</h2><p className="mt-2 max-w-3xl text-sm text-neutral-500">When an instrumental band collapses while the vocal stem gains energy in the same region, YSong moves a conservative portion back. It moves energy between stems instead of EQ-boosting or copying it.</p></div><span className="rounded-full border border-neutral-300 dark:border-neutral-700 px-2.5 py-1 text-[10px] uppercase tracking-wide text-neutral-500">Non-destructive</span></div>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="block"><span className="text-xs font-medium">Spectral resolution</span><select value={bandCount} onChange={e => setBandCount(Number(e.target.value) as 10 | 15 | 24)} disabled={busy} className="mt-2 w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2.5 text-sm"><option value={10}>10 bands · Fast</option><option value={15}>15 bands · Detailed</option><option value={24}>24 bands · Precision</option></select></label>
            <label className="block"><span className="flex justify-between text-xs font-medium"><span>Repair strength</span><span className="tabular-nums text-neutral-500">{Math.round(strength * 100)}%</span></span><input type="range" min={0.2} max={1} step={0.01} value={strength} disabled={busy} onChange={e => setStrength(Number(e.target.value))} className="mt-4 w-full accent-violet-500" /><div className="mt-1 text-[11px] text-neutral-500">Conservative by design; raw stems stay available.</div></label>
            <label className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3"><span className="flex items-center gap-3"><input type="checkbox" checked={cleanse} disabled={busy} onChange={e => setCleanse(e.target.checked)} className="h-4 w-4 accent-violet-500" /><span><span className="block text-xs font-medium">Fine Cleanser v0.1</span><span className="block text-[11px] text-neutral-500">Redistribute isolated separation spikes while protecting source transients.</span></span></span><div className="mt-2 text-[10px] uppercase tracking-wide text-neutral-500">DSP foundation · ML later</div></label>
          </div>
          <button type="button" disabled={!(stage === "separated" || stage === "done" || (upload && balance)) || busy || health !== "online"} onClick={restore} className="mt-5 min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white disabled:opacity-40">{stage === "restoring" ? "Restoring…" : report ? "Create another restore candidate" : "Run Stem Restore"}</button>
        </section>

        {error && <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/[.06] p-4 text-sm text-rose-500">{error}</div>}

        {report && assetId && restoreId && (
          <section className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/[.035] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[10px] uppercase tracking-[.18em] text-emerald-500">Restore candidate ready</div><h2 className="mt-1 text-xl font-semibold">{restoreId}</h2><p className="mt-1 text-sm text-neutral-500">A/B the raw and restored stems. The difference tracks let you hear only what YSong moved.</p></div><span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-500">Mixture consistent</span></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Input sum error" value={formatDb(report.metrics?.input_reconstruction_error_rms_db)} />
              <Metric label="Final sum error" value={formatDb(report.metrics?.post_projection_error_rms_db)} />
              <Metric label="Vocal changed" value={formatPct(report.metrics?.vocal_change_percent_of_raw_rms)} />
              <Metric label="Instrumental changed" value={formatPct(report.metrics?.instrumental_change_percent_of_raw_rms)} />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <ButtonLink href={rawStemUrl(assetId, "vocals")}>Raw vocals</ButtonLink><ButtonLink href={restoreFileUrl(assetId, restoreId, "vocals")}>Restored vocals</ButtonLink><ButtonLink href={restoreFileUrl(assetId, restoreId, "vocals-difference")}>Vocal difference</ButtonLink>
              <ButtonLink href={rawStemUrl(assetId, "instrumental")}>Raw instrumental</ButtonLink><ButtonLink href={restoreFileUrl(assetId, restoreId, "instrumental")}>Restored instrumental</ButtonLink><ButtonLink href={restoreFileUrl(assetId, restoreId, "instrumental-difference")}>Instrumental difference</ButtonLink>
              <ButtonLink href={restoreFileUrl(assetId, restoreId, "mix")}>Restored reconstruction</ButtonLink><ButtonLink href={restoreFileUrl(assetId, restoreId, "report")}>JSON report</ButtonLink>{onOpenHumanize && upload && <button type="button" onClick={() => onOpenHumanize(upload)} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/[.06] px-3 text-xs font-medium text-violet-500">Open Humanize + Cleanse</button>}
            </div>
            {(topBands.length > 0 || topWindows.length > 0) && <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <div><div className="text-xs font-semibold">Most-touched frequency regions</div><div className="mt-2 space-y-2">{topBands.map(row => <div key={row.band} className="flex items-center justify-between gap-3 rounded-lg bg-white/60 dark:bg-neutral-950/50 px-3 py-2 text-xs"><span>Band {row.band}</span><span className="tabular-nums text-neutral-500">{Math.round(row.low_hz)}–{Math.round(row.high_hz)} Hz</span></div>)}</div></div>
              <div><div className="text-xs font-semibold">Strongest repair windows</div><div className="mt-2 space-y-2">{topWindows.map((row, index) => <div key={`${row.start_seconds}-${index}`} className="rounded-lg bg-white/60 dark:bg-neutral-950/50 px-3 py-2 text-xs"><div className="flex justify-between gap-3"><span className="tabular-nums">{formatTime(row.start_seconds)} → {formatTime(row.end_seconds)}</span><span className="text-neutral-500">vocal {Math.round((row.vocal_activity || 0) * 100)}%</span></div><div className="mt-1 text-[10px] uppercase tracking-wide text-neutral-500">{row.reasons?.join(" · ") || "spectral repair"}</div></div>)}</div></div>
            </div>}
          </section>
        )}

        <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-800 p-4 text-xs text-neutral-500">
          Phase 18 truth: Stem Restore v0.1 is deterministic multi-band DSP plus mixture-consistency projection. The cleanser is intentionally not advertised as ML yet; the file/report contract is designed so a learned local inpainting model can replace or augment it later.
        </div>
      </div>
    </div>
  );
}
