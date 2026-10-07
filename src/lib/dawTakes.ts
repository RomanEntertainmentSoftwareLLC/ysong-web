export type DawTake = { id: string; name: string; assetId: string; sourceOffsetSec?: number; sourceDurationSec?: number };
export type DawCompRange = { startBar: number; endBar: number; takeId: string };

export const MAX_DAW_TAKES = 8;
export const MAX_DAW_COMP_RANGES = 32;

export function normalizeCompRanges(ranges: DawCompRange[] | undefined, lengthBars: number, takes: DawTake[]): DawCompRange[] {
  if (!Array.isArray(ranges) || !Number.isFinite(lengthBars) || lengthBars <= 0) return [];
  const ids = new Set(takes.map((take) => take.id));
  const result: DawCompRange[] = [];
  for (const range of ranges.slice(0, MAX_DAW_COMP_RANGES)) {
    if (!range || !ids.has(range.takeId) || !Number.isFinite(range.startBar) || !Number.isFinite(range.endBar)) continue;
    const startBar = Math.max(0, Math.min(lengthBars, range.startBar));
    const endBar = Math.max(startBar, Math.min(lengthBars, range.endBar));
    if (endBar - startBar < 0.001) continue;
    result.push({ startBar, endBar, takeId: range.takeId });
  }
  return result;
}

export function addCompRange(ranges: DawCompRange[] | undefined, next: DawCompRange, lengthBars: number, takes: DawTake[]): DawCompRange[] {
  const existing = normalizeCompRanges(ranges, lengthBars, takes);
  if (existing.length >= MAX_DAW_COMP_RANGES) return existing;
  return normalizeCompRanges([...existing, next], lengthBars, takes);
}
