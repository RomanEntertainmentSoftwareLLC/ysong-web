import assert from "node:assert/strict";
import { test } from "node:test";
import { proposeSmartCreativeVariants } from "../src/tools/promotion/smartCreativeVariants.ts";
import { validateCreativeStudioProject } from "../src/tools/promotion/creativeStudioProject.ts";

const source = {
  id: "winner", audioSnippets: [{ snippetId: "hook" }],
  backgroundMedia: [{ mediaId: "original", mediaType: "video", source: "upload" }, { mediaId: "stock", mediaType: "video", source: "stock", attribution: { provider: "stock-provider" } }],
  overlays: [],
};
const transform = { x: .5, y: .5, scale: 1, rotationDegrees: 0, opacity: 1 };
function project() { return {
  schemaVersion: 1, revision: 4, durationFrames: 300,
  timebase: { framesPerSecond: { numerator: 30, denominator: 1 } },
  tracks: [
    { id: "visual", kind: "visual", clips: [{ id: "opening", startFrame: 0, durationFrames: 300, mediaId: "original", sourceInSeconds: 0, sourceOutSeconds: 10, transform, keyframes: [] }] },
    { id: "audio", kind: "audio", clips: [{ id: "hook-clip", startFrame: 0, durationFrames: 300, snippetId: "hook", sourceInSeconds: 0, sourceOutSeconds: 10, volume: 1, keyframes: [] }] },
    { id: "headline", kind: "text", clips: [{ id: "headline-clip", startFrame: 0, durationFrames: 300, text: "Listen", source: "text", transform, style: { fontSize: 48, color: "#fff" }, keyframes: [] }] },
  ],
  render: { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", backgroundColor: "#000" },
  edit: { createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z", source: "artist" },
}; }

test("smart variants are separate, validated drafts with source and campaign provenance", () => {
  const original = project();
  const before = JSON.stringify(original);
  const drafts = proposeSmartCreativeVariants(original, source, "ad-campaign", "9:16");
  assert.ok(drafts.length >= 3);
  assert.equal(JSON.stringify(original), before);
  for (const draft of drafts) {
    assert.equal(draft.sourceCreativeId, "winner");
    assert.equal(draft.sourceCampaignId, "ad-campaign");
    assert.equal(draft.sourceRevision, 4);
    assert.equal(draft.aspectRatio, "9:16");
    assert.equal(draft.project.revision, 4);
    assert.equal("destinationUrl" in draft, false);
    validateCreativeStudioProject(draft.project, { audioSnippetIds: ["hook"], backgroundMediaIds: ["original", "stock"], overlayIds: [] });
  }
  const stock = drafts.find(draft => draft.title === "Stock B-roll opening");
  assert.equal(stock.project.tracks[0].clips[0].mediaId, "stock");
});

test("locked tracks cannot be changed by the proposer", () => {
  const original = project();
  original.tracks.forEach(track => { track.locked = true; });
  const drafts = proposeSmartCreativeVariants(original, source, "ad-campaign", "9:16");
  for (const draft of drafts) assert.deepEqual(draft.project.tracks.slice(0, original.tracks.length), original.tracks);
});
