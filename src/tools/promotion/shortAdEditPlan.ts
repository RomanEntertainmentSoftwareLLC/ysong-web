export type EditTiming = { cutSeconds: number; transitionSeconds: number; source: "onset" | "tempo" | "even" };
export type ShortAdEditPlan = { mode: "beat" | "fallback"; reason: string; cuts: EditTiming[] };

const round = (value: number) => Math.round(value * 100) / 100;
const finite = (value: number) => Number.isFinite(value);

/** Suggestions are relative to the selected clip. Nothing here edits source media or render settings. */
export function planShortAdEdits(input: {
  startSeconds: number; durationSeconds: number; bpm?: number | null; confidence?: number;
  onsetsSeconds?: number[]; cutCount?: number;
}): ShortAdEditPlan {
  const start = finite(input.startSeconds) ? Math.max(0, input.startSeconds) : 0;
  const duration = finite(input.durationSeconds) ? Math.max(0, Math.min(60, input.durationSeconds)) : 0;
  const count = Math.max(0, Math.min(5, Math.floor(input.cutCount ?? 3)));
  if (duration < 5 || !count) return { mode: "fallback", reason: "Choose a clip of at least 5 seconds.", cuts: [] };
  const bpm = input.bpm;
  const beat = bpm && finite(bpm) && bpm >= 40 && bpm <= 240 ? 60 / bpm : 0;
  const confident = beat > 0 && finite(input.confidence ?? 0) && (input.confidence ?? 0) >= 0.65;
  const onsets = confident ? [...new Set((input.onsetsSeconds ?? []).slice(0, 4096).filter(t => finite(t) && t >= start && t <= start + duration).map(round))].sort((a, b) => a - b) : [];
  const cuts: EditTiming[] = [];
  for (let index = 1; index <= count; index++) {
    const target = duration * index / (count + 1);
    const margin = Math.min(0.75, duration / (count + 1) * 0.25);
    const lower = (cuts.at(-1)?.cutSeconds ?? 0) + margin;
    const upper = duration - (count - index + 1) * margin;
    let time = target;
    let source: EditTiming["source"] = "even";
    if (confident) {
      const nearby = onsets.filter(t => t - start >= lower && t - start <= upper && Math.abs(t - start - target) <= Math.min(0.2, beat * 0.35));
      if (nearby.length) { time = nearby.sort((a, b) => Math.abs(a - start - target) - Math.abs(b - start - target) || a - b)[0] - start; source = "onset"; }
      else {
        const grid = Math.round((start + target) / beat) * beat - start;
        if (grid >= lower && grid <= upper && Math.abs(grid - target) <= Math.min(0.2, beat * 0.35)) { time = grid; source = "tempo"; }
      }
    }
    cuts.push({ cutSeconds: round(Math.max(lower, Math.min(upper, time))), transitionSeconds: 0.12, source });
  }
  const aligned = cuts.some(cut => cut.source !== "even");
  return { mode: aligned ? "beat" : "fallback", reason: !confident ? "Tempo confidence is weak or unavailable; cuts are evenly spaced." : aligned ? "Cuts follow nearby detected onsets or the tempo grid." : "No nearby beat anchors; cuts are evenly spaced.", cuts };
}
