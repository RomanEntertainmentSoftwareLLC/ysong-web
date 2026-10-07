/** Bar positions are one-based, as in the DAW. Events take effect at a bar boundary. */
export type DawTempoEvent = { id: string; bar: number; bpm: number; sigNum: number; sigDen: number };
export type DawTempoMap = DawTempoEvent[];

const MAX_EVENTS = 256;
const MAX_BAR = 100_000;
const DENOMINATORS = new Set([1, 2, 4, 8, 16, 32]);

export function normalizeTempoMap(raw: unknown, fallback: { bpm: number; sigNum: number; sigDen: number }): DawTempoMap {
  const base = {
    id: "tempo:1", bar: 1,
    bpm: Number.isFinite(fallback.bpm) && fallback.bpm >= 20 && fallback.bpm <= 400 ? fallback.bpm : 120,
    sigNum: Number.isInteger(fallback.sigNum) && fallback.sigNum >= 1 && fallback.sigNum <= 32 ? fallback.sigNum : 4,
    sigDen: DENOMINATORS.has(fallback.sigDen) ? fallback.sigDen : 4,
  };
  if (!Array.isArray(raw)) return [base];
  const seenBars = new Set<number>();
  const seenIds = new Set<string>();
  const events: DawTempoMap = [];
  for (const item of raw.slice(0, MAX_EVENTS)) {
    if (!item || typeof item !== "object") continue;
    const event = item as Partial<DawTempoEvent>;
    if (typeof event.id !== "string" || !event.id.trim() || event.id.length > 100 || seenIds.has(event.id) ||
        !Number.isInteger(event.bar) || event.bar! < 1 || event.bar! > MAX_BAR || seenBars.has(event.bar!) ||
        typeof event.bpm !== "number" || !Number.isFinite(event.bpm) || event.bpm < 20 || event.bpm > 400 ||
        !Number.isInteger(event.sigNum) || event.sigNum! < 1 || event.sigNum! > 32 || !DENOMINATORS.has(event.sigDen!)) continue;
    events.push({ id: event.id, bar: event.bar!, bpm: event.bpm, sigNum: event.sigNum!, sigDen: event.sigDen! });
    seenBars.add(event.bar!); seenIds.add(event.id);
  }
  events.sort((a, b) => a.bar - b.bar);
  if (events[0]?.bar !== 1) events.unshift(base);
  return events.slice(0, MAX_EVENTS);
}

export function barToQuarterBeats(bar: number, map: DawTempoMap): number {
  if (!Number.isFinite(bar) || bar < 1) throw new RangeError("Invalid bar position");
  let beats = 0;
  for (let i = 0; i < map.length; i++) {
    const event = map[i];
    if (bar <= event.bar) break;
    beats += (Math.min(bar, map[i + 1]?.bar ?? bar) - event.bar) * event.sigNum * 4 / event.sigDen;
    if (!map[i + 1] || bar < map[i + 1].bar) break;
  }
  return beats;
}

export function barToSeconds(bar: number, map: DawTempoMap): number {
  if (!Number.isFinite(bar) || bar < 1) throw new RangeError("Invalid bar position");
  let seconds = 0;
  for (let i = 0; i < map.length; i++) {
    const event = map[i];
    if (bar <= event.bar) break;
    seconds += (Math.min(bar, map[i + 1]?.bar ?? bar) - event.bar) * event.sigNum * 4 / event.sigDen * 60 / event.bpm;
    if (!map[i + 1] || bar < map[i + 1].bar) break;
  }
  return seconds;
}

export function secondsToBar(seconds: number, map: DawTempoMap): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("Invalid timeline time");
  let remaining = seconds;
  for (let i = 0; i < map.length; i++) {
    const event = map[i];
    const secondsPerBar = event.sigNum * 4 / event.sigDen * 60 / event.bpm;
    const span = (map[i + 1]?.bar ?? Infinity) - event.bar;
    if (remaining <= span * secondsPerBar) return event.bar + remaining / secondsPerBar;
    remaining -= span * secondsPerBar;
  }
  throw new RangeError("Invalid tempo map");
}
