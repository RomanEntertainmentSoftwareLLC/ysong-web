import { useEffect, useRef, useState } from "react";
import { masteringFileUrl, startMasteringAnalysis, startMasteringRender, uploadForMastering, waitForLocalJob, type MasteringRenderSettings, type MasteringReport } from "./api";

const LIMIT = 8;
type Status = "queued" | "uploading" | "analyzing" | "rendering" | "complete" | "failed" | "cancelled";
type Entry = { id: number; file: File; settings: MasteringRenderSettings; referenceName: string; status: Status; progress: number; stage: string; error?: string; report?: MasteringReport };

function outputName(name: string, index: number) {
  const stem = name.replace(/\.[^.]+$/, "").normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "track";
  return `${String(index).padStart(2, "0")}-${stem}-remaster.wav`;
}

export default function BatchQueue({ settings, referenceName, online }: { settings: MasteringRenderSettings; referenceName: string; online: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const entriesRef = useRef<Entry[]>([]);
  const nextId = useRef(1);
  const running = useRef(false);
  const cancelled = useRef(new Set<number>());
  const controller = useRef<AbortController | null>(null);
  const activeId = useRef<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; controller.current?.abort(); }, []);

  function update(id: number, patch: Partial<Entry>) {
    if (!mounted.current || cancelled.current.has(id)) return;
    entriesRef.current = entriesRef.current.map(entry => entry.id === id ? { ...entry, ...patch } : entry);
    setEntries([...entriesRef.current]);
  }

  function add(files: FileList | null) {
    if (!files) return;
    const available = LIMIT - entriesRef.current.filter(entry => !["complete", "failed", "cancelled"].includes(entry.status)).length;
    const selected = Array.from(files).filter(file => file.type.startsWith("audio/") || /\.(wav|flac|mp3|m4a|aac|ogg|opus|aiff?|wma)$/i.test(file.name)).slice(0, Math.max(0, available));
    entriesRef.current = [...entriesRef.current, ...selected.map(file => ({ id: nextId.current++, file, settings: { ...settings }, referenceName, status: "queued" as const, progress: 0, stage: "Waiting" }))];
    setEntries([...entriesRef.current]);
  }

  function cancel(id: number) {
    cancelled.current.add(id);
    if (activeId.current === id) controller.current?.abort();
    entriesRef.current = entriesRef.current.map(entry => entry.id === id ? { ...entry, status: "cancelled", stage: "Stopped waiting for this track" } : entry);
    setEntries([...entriesRef.current]);
  }

  async function run() {
    if (running.current || !online) return;
    running.current = true;
    try {
      while (mounted.current) {
        const entry = entriesRef.current.find(item => item.status === "queued");
        if (!entry) break;
        const signal = new AbortController();
        controller.current = signal;
        activeId.current = entry.id;
        try {
          update(entry.id, { status: "uploading", stage: "Uploading", progress: 0 });
          const source = await uploadForMastering(entry.file);
          if (cancelled.current.has(entry.id)) continue;
          update(entry.id, { status: "analyzing", stage: "Analyzing", progress: 0 });
          const analysis = await startMasteringAnalysis(source.asset_id, entry.settings.referenceAssetId);
          await waitForLocalJob(analysis.job_id, job => update(entry.id, { progress: job.progress_percent, stage: job.stage }), signal.signal);
          if (cancelled.current.has(entry.id)) continue;
          update(entry.id, { status: "rendering", stage: "Rendering", progress: 0 });
          const render = await startMasteringRender(source.asset_id, entry.settings);
          const finished = await waitForLocalJob(render.job_id, job => update(entry.id, { progress: job.progress_percent, stage: job.stage }), signal.signal);
          if (cancelled.current.has(entry.id)) continue;
          const report = finished.result?.report as MasteringReport | undefined;
          if (!report?.run_id) throw new Error("Render completed without an output report.");
          update(entry.id, { status: "complete", stage: "Ready", progress: 100, report });
        } catch (error) {
          if (!cancelled.current.has(entry.id)) update(entry.id, { status: "failed", stage: "Failed", error: error instanceof Error ? error.message : "Processing failed" });
        } finally { controller.current = null; activeId.current = null; }
      }
    } finally { running.current = false; }
  }

  return <section className="mt-6 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
    <h2 className="text-lg font-semibold">Batch remaster queue</h2>
    <p className="mt-1 text-xs text-neutral-500">Add up to {LIMIT} owned or authorized tracks. Each track snapshots the current controls and reference target when added. Processing runs one track at a time; a failure does not stop the queue.</p>
    <div className="mt-4 flex flex-wrap items-center gap-3"><label className="cursor-pointer rounded-xl border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700">Add audio tracks<input type="file" multiple accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg,.opus,.aiff,.aif,.wma" className="sr-only" onChange={event => { add(event.target.files); event.target.value = ""; }}/></label><button type="button" onClick={run} disabled={!online || !entries.some(entry => entry.status === "queued")} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Start queue</button></div>
    <ol className="mt-4 space-y-3">{entries.map((entry, index) => <li key={entry.id} className="rounded-xl border border-neutral-200 p-3 text-sm dark:border-neutral-800"><div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><strong className="break-all">{entry.file.name}</strong><div className="text-xs text-neutral-500">{entry.settings.remasterMode} · {entry.settings.targetLufs} LUFS · reference: {entry.referenceName || "none"}</div></div><span className="capitalize">{entry.status}</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-violet-500" style={{ width: `${entry.progress}%` }}/></div><div className="mt-1 text-xs text-neutral-500">{entry.stage} · {Math.round(entry.progress)}%</div>
      {entry.error && <div role="alert" className="mt-2 text-xs text-red-500">{entry.error}</div>}
      {entry.status === "queued" && <div className="mt-2 flex flex-wrap gap-3 text-xs"><label>Mode <select value={entry.settings.remasterMode} onChange={event => update(entry.id, { settings: { ...entry.settings, remasterMode: event.target.value as MasteringRenderSettings["remasterMode"] } })} className="ml-1 rounded border bg-transparent p-1"><option value="preserve">Preserve</option><option value="balanced">Balanced</option><option value="aggressive">Loud</option><option value="custom">Custom</option></select></label><label>LUFS <input type="number" min="-24" max="-7" step="0.5" value={entry.settings.targetLufs} onChange={event => update(entry.id, { settings: { ...entry.settings, targetLufs: Number(event.target.value) } })} className="ml-1 w-16 rounded border bg-transparent p-1"/></label><button type="button" className="text-violet-500 underline" onClick={() => update(entry.id, { settings: { ...settings }, referenceName })}>Use current settings and reference</button></div>}
      {entry.report && <a className="mt-2 inline-block text-xs text-violet-500 underline" href={masteringFileUrl(entry.report.asset_id, entry.report.run_id, "master")} download={outputName(entry.file.name, index + 1)}>Download {outputName(entry.file.name, index + 1)}</a>}
      {["queued", "uploading", "analyzing", "rendering"].includes(entry.status) && <button type="button" className="ml-3 text-xs text-neutral-500 underline" onClick={() => cancel(entry.id)}>Cancel</button>}
    </li>)}</ol>
    <p className="mt-3 text-xs text-neutral-500">Cancelling an active track stops waiting for it; an engine job already submitted may still finish on the server.</p>
  </section>;
}
