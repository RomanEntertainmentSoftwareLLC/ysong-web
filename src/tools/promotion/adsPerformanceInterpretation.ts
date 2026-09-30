import type { PaidAdAnalytics } from "./api";

export type PerformanceInterpretation = {
  summary: string;
  observed: string[];
  hypotheses: string[];
  comparisons: string[];
  experiments: string[];
  limits: string[];
};

const count = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const format = (value: number) => new Intl.NumberFormat().format(Math.round(value));
const label = (value: string, fallback: string) => value.trim() || fallback;
const clicks = (row: { outboundClicks?: number; linkClicks?: number }) => count(row.outboundClicks) ?? count(row.linkClicks);

/** Describes the selected normalized report. No cross-platform event chain or causal lift is inferred. */
export function interpretAdsPerformance(data: PaidAdAnalytics): PerformanceInterpretation {
  const observed: string[] = [];
  const hypotheses: string[] = [];
  const comparisons: string[] = [];
  const experiments: string[] = [];
  const limits: string[] = [];
  const impressions = count(data.meta.summary.impressions);
  const outbound = clicks(data.meta.summary);
  const visits = count(data.ysong.totals.views);
  const platformClicks = count(data.ysong.totals.clicks);
  const spend = count(data.meta.summary.spend);
  const range = `${data.range.since} to ${data.range.until}`;

  observed.push(`For ${range}, YSong recorded ${format(visits ?? 0)} Smart Link visits and ${format(platformClicks ?? 0)} destination clicks.`);
  if (impressions !== null && outbound !== null) observed.push(`Meta reported ${format(impressions)} impressions and ${format(outbound)} outbound clicks in this range.`);
  if (spend !== null) observed.push(`Meta reported ${new Intl.NumberFormat(undefined, { style: "currency", currency: /^[A-Z]{3}$/.test(data.derived.currency || "") ? data.derived.currency : "USD" }).format(spend)} in spend.`);

  const daily = data.meta.daily.filter(row => typeof row.dateStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.dateStart) && clicks(row) !== null).sort((a, b) => (a.dateStart || "").localeCompare(b.dateStart || ""));
  if (daily.length >= 2) {
    const midpoint = Math.floor(daily.length / 2);
    const earlier = daily.slice(0, midpoint);
    const later = daily.slice(midpoint);
    const average = (rows: typeof daily) => rows.reduce((sum, row) => sum + (clicks(row) ?? 0), 0) / rows.length;
    const before = average(earlier);
    const after = average(later);
    observed.push(`Meta outbound clicks averaged ${format(before)} per reported day in the earlier half and ${format(after)} in the later half of this range (${after > before ? "up" : after < before ? "down" : "unchanged"}).`);
    hypotheses.push("A shift in delivery, audience response, placement mix, or creative exposure could contribute to the daily change. This report does not isolate a cause.");
    experiments.push("Compare another equal-length period using the same attribution settings, then review impressions and outbound clicks together before changing the campaign.");
  } else {
    limits.push("A daily Meta series is unavailable, so a within-range trend cannot be described.");
  }

  const creatives = data.derived.creatives.filter(row => count(row.meta.impressions) !== null && clicks(row.meta) !== null);
  if (creatives.length >= 2) {
    const ranked = [...creatives].sort((a, b) => (clicks(b.meta) ?? 0) - (clicks(a.meta) ?? 0));
    const name = (row: typeof ranked[number], index: number) => label(row.snippetLabel, `Creative ${index + 1}`) + (row.backgroundName ? ` / ${row.backgroundName}` : "");
    comparisons.push(`Creative comparison: ${name(ranked[0], 1)} had ${format(clicks(ranked[0].meta) ?? 0)} Meta outbound clicks from ${format(count(ranked[0].meta.impressions) ?? 0)} impressions; ${name(ranked[1], 2)} had ${format(clicks(ranked[1].meta) ?? 0)} from ${format(count(ranked[1].meta.impressions) ?? 0)}. These are delivered totals, not a controlled test.`);
    hypotheses.push("Different hooks, visuals, delivery volume, or audiences may explain creative differences; the available breakdown cannot separate them.");
    experiments.push(`Make a variant of ${name(ranked[0], 1)} with one changed opening hook or visual. Keep the destination and audience comparable, and review it alongside the original after both receive delivery.`);
  } else if (creatives.length === 1) {
    limits.push("Only one creative has a breakdown, so there is no creative comparison yet.");
    experiments.push("Try a second creative with one changed opening hook or visual and compare both after each receives delivery.");
  } else {
    limits.push("No creative breakdown is available for this range.");
  }

  const destinations = data.ysong.destinations.filter(row => count(row.clicks) !== null).sort((a, b) => b.clicks - a.clicks);
  if (destinations.length >= 2) {
    const first = destinations[0];
    const second = destinations[1];
    comparisons.push(`Destination choices: ${label(first.label, first.platform)} received ${format(first.clicks)} YSong clicks; ${label(second.label, second.platform)} received ${format(second.clicks)}. This shows where visitors chose to go, not which destination caused more ad response.`);
    experiments.push("If destination preference matters, test clearer Smart Link labels or ordering while keeping the ad creative stable; compare destination clicks over equal windows.");
  } else if (destinations.length === 1) {
    limits.push("Only one destination has recorded clicks, so destination preference cannot be compared.");
  } else {
    limits.push("No destination click breakdown is available for this range.");
  }

  if (data.stale) limits.push("Meta metrics are from a stale cached snapshot; refresh before treating a change as current.");
  if (data.warnings.length || data.meta.warnings.length) limits.push("The analytics service reported data warnings; review the report warnings before acting.");
  if (impressions === null || outbound === null) limits.push("Meta delivery metrics are incomplete for this range.");
  if ((outbound ?? 0) < 30 || (visits ?? 0) < 30) limits.push("Traffic is limited; small differences can move substantially with a few events.");
  limits.push("Meta and YSong measure different steps. Their totals do not prove that a specific ad or destination caused downstream activity.");

  return {
    summary: impressions === null && (visits ?? 0) === 0
      ? `There is not enough reported activity from ${range} to describe performance yet.`
      : `Here is what the selected report shows from ${range}. Treat the possible explanations as questions to test.`,
    observed, hypotheses, comparisons, experiments: experiments.slice(0, 3), limits,
  };
}
