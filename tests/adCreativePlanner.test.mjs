import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCreativePlanContext, proposeCreativePlan, validateCreativePlan } from "../src/tools/promotion/adCreativePlanner.ts";

function fixture() {
  const track = { id: "track-1", title: "The Song", genre: "Pop", audioObjectKey: "private/song.wav" };
  const release = { id: "release-1", title: "The Release", genre: "Pop", hasArtwork: true, tracks: [track] };
  const ad = { id: "ad-1", sourceTrackId: track.id, genre: "Pop" };
  const snippets = [{ id: "hook-1", adCampaignId: ad.id, sourceTrackId: track.id, sourceObjectKey: "private/hook.wav", label: "Chorus", startSeconds: 23, durationSeconds: 15 }];
  const backgrounds = [{ id: "asset-1", objectKey: "private/video.mp4", originalName: "Night drive", metadata: { source: "stock", provider: "pexels", attributionUrl: "https://example.test/stock", token: "secret" } }];
  const genreResult = { primary: "Synth pop", engine: "audio-intelligence", energy: { label: "High", confidence: 0.82 } };
  return { ad, release, track, snippets, backgrounds, genreResult };
}

test("proposes editable variants with allowlisted song and asset evidence", () => {
  const context = buildCreativePlanContext(fixture());
  const plan = proposeCreativePlan(context);
  assert.deepEqual(plan.concepts.map(item => item.format), ["cinematic", "meme", "performance", "lyric", "artwork"]);
  assert.equal(plan.status, "draft");
  assert.equal(plan.concepts[0].hookId, "hook-1");
  assert.deepEqual(plan.concepts[0].assetIds, ["asset-1"]);
  assert.ok(plan.concepts[0].evidence.includes("energy"));
  assert.doesNotThrow(() => validateCreativePlan(plan, context));
  const serialized = JSON.stringify({ context, plan });
  for (const secret of ["private/", "secret", "objectKey"]) assert.equal(serialized.includes(secret), false);
});

test("rejects invented references and executable proposal fields", () => {
  const context = buildCreativePlanContext(fixture());
  const plan = proposeCreativePlan(context);
  const replace = (patch) => ({ ...plan, concepts: [{ ...plan.concepts[0], ...patch }] });
  assert.throws(() => validateCreativePlan(replace({ hookId: "invented" }), context), /unavailable hook/);
  assert.throws(() => validateCreativePlan(replace({ assetIds: ["invented"] }), context), /unavailable asset/);
  assert.throws(() => validateCreativePlan(replace({ publish: true }), context), /fields/);
  assert.throws(() => validateCreativePlan(replace({ evidence: ["hook", "artwork"], assetIds: [] }), { ...context, release: { ...context.release, hasArtwork: false } }), /Unverifiable/);
});

test("requires verified campaign audio and a saved hook", () => {
  const input = fixture();
  assert.throws(() => buildCreativePlanContext({ ...input, track: { ...input.track, id: "other" } }), /verified track/);
  const context = buildCreativePlanContext({ ...input, snippets: [] });
  assert.throws(() => proposeCreativePlan(context), /Save a hook/);
});
