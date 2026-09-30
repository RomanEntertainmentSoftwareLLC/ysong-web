import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretAdsPerformance } from "../src/tools/promotion/adsPerformanceInterpretation.ts";

function report() {
  return {
    range: { since: "2026-09-01", until: "2026-09-04" }, capturedAt: "2026-09-05T00:00:00Z", stale: false,
    adCampaign: { currency: "USD" },
    meta: { summary: { impressions: 1000, outboundClicks: 60, spend: 40 }, daily: [
      { dateStart: "2026-09-01", outboundClicks: 10 }, { dateStart: "2026-09-02", outboundClicks: 20 },
      { dateStart: "2026-09-03", outboundClicks: 30 }, { dateStart: "2026-09-04", outboundClicks: 40 },
    ], warnings: [] },
    ysong: { totals: { views: 55, clicks: 35 }, destinations: [
      { id: "a", label: "Stream A", platform: "a", clicks: 20 }, { id: "b", label: "Stream B", platform: "b", clicks: 15 },
    ] },
    derived: { currency: "USD", creatives: [
      { snippetLabel: "Chorus", backgroundName: "Live", meta: { impressions: 600, outboundClicks: 40 }, ysong: { views: 30 } },
      { snippetLabel: "Verse", backgroundName: "Studio", meta: { impressions: 400, outboundClicks: 20 }, ysong: { views: 25 } },
    ] },
    warnings: [],
  };
}

test("separates observed changes, descriptive comparisons, hypotheses, and experiments", () => {
  const reading = interpretAdsPerformance(report());
  assert.match(reading.observed.join(" "), /15 per reported day.*35.*up/);
  assert.match(reading.comparisons.join(" "), /Chorus \/ Live.*40.*600.*Verse \/ Studio.*20.*400/);
  assert.match(reading.comparisons.join(" "), /Stream A.*20.*Stream B.*15/);
  assert.ok(reading.hypotheses.every(item => /could|may/.test(item)));
  assert.ok(reading.experiments.some(item => /one changed opening hook or visual/.test(item)));
  assert.match(reading.limits.join(" "), /do not prove/);
});

test("missing and stale Meta data do not become measured zeroes or a trend", () => {
  const input = report();
  input.stale = true;
  input.meta.summary = {};
  input.meta.daily = [];
  input.derived.creatives = [];
  const reading = interpretAdsPerformance(input);
  assert.doesNotMatch(reading.observed.join(" "), /Meta reported 0/);
  assert.match(reading.limits.join(" "), /daily Meta series is unavailable/);
  assert.match(reading.limits.join(" "), /stale cached snapshot/);
  assert.match(reading.limits.join(" "), /incomplete/);
});
