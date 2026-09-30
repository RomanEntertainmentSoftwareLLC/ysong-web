import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAdsAssistantContext, validateAdsAssistantResponse } from "../src/tools/promotion/adsSmartAssistantContract.ts";

function fixture() {
  const track = { id: "track-1", title: "Song", audioObjectKey: "private/master.wav", durationSeconds: 180, genre: "Pop" };
  const release = { id: "release-1", title: "Release", artistName: "Artist", releaseType: "single", publishedAt: "2026-01-01", genre: "Pop", tracks: [track] };
  const smartLink = { id: "link-1", sourceReleaseId: release.id, status: "active", publicUrl: "https://example.test/p/song", destinations: [{ id: "dest-1", label: "Listen", platform: "stream", kind: "stream", url: "https://private.test/song", enabled: true }] };
  const ad = { id: "ad-1", campaignId: smartLink.id, sourceTrackId: track.id, genre: "Pop", genreSource: "ysong", goal: "song_growth", status: "draft", metaStatus: "", dailyBudgetMinor: 1000, currency: "USD", scheduleStart: null, scheduleEnd: null, targeting: { countries: ["US"], interests: [{ id: "interest-1", name: "Pop", secret: "omit" }], adOverlay: { headline: "Listen", caption: "New song", cta: "Play", position: "bottom" }, metaToken: "omit" }, placements: ["instagram"] };
  const snippets = [{ id: "snippet-1", adCampaignId: ad.id, sourceTrackId: track.id, sourceObjectKey: "private/clip.wav", label: "Hook", startSeconds: 30, durationSeconds: 15 }];
  const creatives = [{ id: "creative-1", adCampaignId: ad.id, selected: true, status: "ready", durationSeconds: 15, objectKey916: "private/render.mp4" }];
  return { ad, smartLink, release, track, snippets, creatives };
}

test("builds an allowlisted snapshot and marks absent evidence", () => {
  const context = buildAdsAssistantContext(fixture());
  assert.deepEqual(context.unavailable, ["genre_analysis", "studio_timeline", "analytics"]);
  assert.equal(context.evidence.audio.verified, true);
  assert.equal(context.evidence.hooks[0].snippetId, "snippet-1");
  assert.equal(context.evidence.destination.enabled[0].label, "Listen");
  const json = JSON.stringify(context);
  for (const secret of ["private/", "private.test", "metaToken", "secret", "objectKey"]) assert.equal(json.includes(secret), false);
});

test("refuses a release or analytics from another campaign", () => {
  const input = fixture();
  assert.throws(() => buildAdsAssistantContext({ ...input, track: { ...input.track, id: "other" } }), /selected release and verified audio/);
  assert.throws(() => buildAdsAssistantContext({ ...input, analytics: { adCampaign: { id: "other" } } }), /analytics campaign mismatch/);
  assert.throws(() => buildAdsAssistantContext({ ...input, creatives: [{ ...input.creatives[0], sourceTrackId: "other" }] }), /creative source track mismatch/);
  assert.throws(() => buildAdsAssistantContext({ ...input, genreEvidence: { trackId: "other", result: {} } }), /genre analysis source track mismatch/);
});

test("response accepts grounded advice and rejects actions and invented facts", () => {
  const context = buildAdsAssistantContext(fixture());
  const response = { schemaVersion: 1, summary: "Try the hook.", suggestions: [{ kind: "creative", title: "Test the hook", rationale: "The selected clip starts at 30 seconds.", evidencePaths: ["evidence.audio.snippets.0.startSeconds"], confidence: "medium" }] };
  assert.doesNotThrow(() => validateAdsAssistantResponse(response, context));
  assert.throws(() => validateAdsAssistantResponse({ ...response, execute: { action: "publish" } }, context), /fields/);
  assert.throws(() => validateAdsAssistantResponse({ ...response, suggestions: [{ ...response.suggestions[0], evidencePaths: ["evidence.analytics.impressions"] }] }, context), /Unverifiable/);
});
