import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSidechainRoute, normalizeSidechainSource, sidechainRouteError, sidechainSupport, validateProjectSidechains } from "../src/lib/dawSidechain.ts";
import { normalizeTrackEffects } from "../src/lib/dawEffects.ts";

const tracks = [
  { id: "kick", mixer: { output: "MASTER" } },
  { id: "bass", mixer: { output: "AUX 2", sends: [{ level: 40 }] } },
];
const route = (source, targetTrackId = "bass") => ({ source, targetTrackId, deviceId: "compressor-1" });

test("sidechain sources use existing track and aux IDs", () => {
  assert.deepEqual(normalizeSidechainSource({ kind: "track", id: "kick" }), { kind: "track", id: "kick" });
  assert.equal(normalizeSidechainSource({ kind: "aux", id: "AUX 9" }), null);
  assert.equal(normalizeSidechainSource({ kind: "track", id: "" }), null);
  assert.deepEqual(normalizeSidechainRoute({ source: { kind: "track", id: "kick" }, targetTrackId: "forged" }, "bass", "compressor-1", tracks), route({ kind: "track", id: "kick" }));
});

test("missing, self, and feedback routes are rejected", () => {
  assert.match(sidechainRouteError(route({ kind: "track", id: "bass" }), tracks), /own track/);
  assert.match(sidechainRouteError(route({ kind: "track", id: "gone" }), tracks), /Missing/);
  assert.match(sidechainRouteError(route({ kind: "aux", id: "AUX 2" }), tracks), /feeds/);
  assert.match(sidechainRouteError(route({ kind: "aux", id: "AUX 1" }), tracks), /feeds/);
  assert.equal(sidechainRouteError(route({ kind: "track", id: "kick" }), tracks), null);
  assert.equal(sidechainRouteError(route({ kind: "aux", id: "AUX 3" }), tracks), null);
  assert.equal(normalizeSidechainRoute({ source: { kind: "aux", id: "AUX 2" } }, "bass", "compressor-1", tracks), null);
});

test("compressor route persists but current device remains explicitly unsupported", () => {
  const [effect] = normalizeTrackEffects([{ id: "compressor-1", type: "compressor", sidechainSource: { kind: "track", id: "kick" } }]);
  assert.deepEqual(effect.sidechainSource, { kind: "track", id: "kick" });
  assert.equal(sidechainSupport(effect.type), "unsupported");
});

test("project hydration removes stale or feedback routes", () => {
  const project = [
    { ...tracks[0], effects: [{ id: "a", sidechainSource: { kind: "aux", id: "AUX 3" } }] },
    { ...tracks[1], effects: [
      { id: "b", sidechainSource: { kind: "aux", id: "AUX 2" } },
      { id: "c", sidechainSource: { kind: "track", id: "deleted" } },
      { id: "d", sidechainSource: { kind: "track", id: "kick" } },
    ] },
  ];
  const restored = validateProjectSidechains(project);
  assert.deepEqual(restored[0].effects[0].sidechainSource, { kind: "aux", id: "AUX 3" });
  assert.equal(restored[1].effects[0].sidechainSource, undefined);
  assert.equal(restored[1].effects[1].sidechainSource, undefined);
  assert.deepEqual(restored[1].effects[2].sidechainSource, { kind: "track", id: "kick" });
});
