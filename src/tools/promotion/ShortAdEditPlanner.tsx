import { useEffect, useMemo, useState } from "react";
import { planShortAdEdits, type EditTiming } from "./shortAdEditPlan";

export default function ShortAdEditPlanner({ start, duration, tempo }: {
  start: number; duration: number; tempo?: { bpm: number | null; confidence: number; onsetsSeconds?: number[] };
}) {
  const plan = useMemo(() => planShortAdEdits({ startSeconds: start, durationSeconds: duration, bpm: tempo?.bpm,
    confidence: tempo?.confidence, onsetsSeconds: tempo?.onsetsSeconds }), [start, duration, tempo]);
  const [cuts, setCuts] = useState<EditTiming[]>(plan.cuts);
  useEffect(() => setCuts(plan.cuts), [plan]);
  function update(index: number, field: "cutSeconds" | "transitionSeconds", value: number) {
    if (!Number.isFinite(value)) return;
    setCuts(previous => previous.map((cut, i) => {
      if (i !== index) return cut;
      const lower = field === "cutSeconds" ? (previous[i - 1]?.cutSeconds ?? 0) + 0.1 : 0;
      const upper = field === "cutSeconds" ? (previous[i + 1]?.cutSeconds ?? duration) - 0.1 : 0.5;
      return { ...cut, [field]: Math.round(Math.max(lower, Math.min(upper, value)) * 100) / 100 };
    }));
  }
  return <section className="mt-4 rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4 text-xs">
    <div className="font-semibold">Short-ad edit plan</div>
    <p className="mt-1 text-neutral-500">{plan.reason} Times are relative to this clip. Adjust each cut and transition before using the plan; this does not change the audio or rendered creative.</p>
    <div className="mt-2 text-neutral-500">{tempo?.bpm && plan.mode === "beat" ? `${tempo.bpm.toFixed(1)} BPM · ${Math.round(tempo.confidence * 100)}% confidence` : "Timing fallback"}</div>
    <div className="mt-3 grid gap-2 sm:grid-cols-3">{cuts.map((cut, index) => <div key={index} className="rounded-lg border border-neutral-200 bg-white/60 p-2 dark:border-neutral-700 dark:bg-neutral-900/60">
      <div className="mb-2 font-medium">Cut {index + 1} · {cut.source}</div>
      <label className="block text-neutral-500">At (seconds)<input aria-label={`Cut ${index + 1} time`} type="number" min={0} max={duration} step="0.01" value={cut.cutSeconds} onChange={event => update(index, "cutSeconds", Number(event.target.value))} className="mt-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700" /></label>
      <label className="mt-2 block text-neutral-500">Transition (seconds)<input aria-label={`Cut ${index + 1} transition`} type="number" min={0} max={0.5} step="0.01" value={cut.transitionSeconds} onChange={event => update(index, "transitionSeconds", Number(event.target.value))} className="mt-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700" /></label>
    </div>)}</div>
    <button type="button" className="mt-3 rounded-lg border border-violet-500/40 px-3 py-1.5 font-medium text-violet-600 dark:text-violet-300" onClick={() => { void navigator.clipboard.writeText(JSON.stringify({ clipStartSeconds: start, clipDurationSeconds: duration, cuts }, null, 2)); }}>Copy edit plan</button>
  </section>;
}
