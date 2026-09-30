import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDawAgentContext, parseDawAgentReply } from "../src/lib/dawAgentContract.ts";

const track = (id, type = "audio", nativeVst = false) => ({
  id, name: `Track ${id}`, type, mute: false, solo: false, arm: false, level: 100, meter: 0,
  nativeVst, clipCount: 2, effects: [{ id: `${id}-fx`, name: "Dynamics", type: "compressor", enabled: true, parameters: { ratio: 4 } }],
  mixer: { pan: 0, sends: [] },
});
const snapshot = {
  projectId: "draft-id", projectName: "Draft", playing: false, playheadBar: 9, endBar: 65, bpm: 120, sigNum: 4, sigDen: 4,
  bridgeAvailable: true, selectedTrackId: "selected", tracks: [...Array.from({ length: 20 }, (_, index) => track(String(index))), track("selected", "instrument", true)],
  masterLevel: 100, masterMeter: 0,
};

test("context selects the focused track and bounds tracks and devices", () => {
  const context = buildDawAgentContext(snapshot);
  assert.equal(context.tracks.length, 16);
  assert.equal(context.tracks[0].id, "selected");
  assert.equal(context.tracks[0].browserEffectsAvailable, false);
  assert.deepEqual(context.tracks[0].devices[0].parameters, { ratio: 4 });
  assert.equal(context.trackCount, 21);
});

test("proposal parser validates track references, device types and native compatibility", () => {
  const result = parseDawAgentReply(JSON.stringify({ message: "Review these", proposals: [
    { kind: "fx-plan", trackId: "selected", plan: { intent: "control", devices: [{ type: "reverb" }, { type: "compressor", ratio: 999, code: "run()" }] } },
    { kind: "fx-plan", trackId: "missing", plan: { intent: "bad", devices: [{ type: "compressor" }] } },
    { kind: "sound-design", trackId: "selected", intent: " icy   pluck " },
    { kind: "arrangement", summary: "Build", suggestion: "Add a quieter bridge" },
    { kind: "arrangement", summary: "ignored", suggestion: "over limit" },
  ] }), snapshot);
  assert.equal(result.proposals.length, 3);
  assert.deepEqual(result.proposals[0].plan.devices.map((device) => device.effect.type), ["compressor"]);
  assert.equal(result.proposals[0].plan.devices[0].effect.ratio, 20);
  assert.equal("code" in result.proposals[0].plan.devices[0].effect, false);
  assert.equal(result.proposals[1].intent, "icy pluck");
});

test("malformed and sessionless replies cannot create proposals", () => {
  assert.deepEqual(parseDawAgentReply("not JSON", snapshot).proposals, []);
  assert.deepEqual(parseDawAgentReply('{"proposals":[{"kind":"arrangement","summary":"A","suggestion":"B"}]}', null).proposals, []);
});
