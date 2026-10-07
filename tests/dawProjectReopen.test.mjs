import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { normalizeTrackEffects } from "../src/lib/dawEffects.ts";
import { normalizeAutomationLanes } from "../src/lib/dawAutomation.ts";
import { DAW_AUX_IDS, createDefaultMixerStrip, normalizeMixerStrip } from "../src/lib/dawMixer.ts";
import { validateProjectSidechains } from "../src/lib/dawSidechain.ts";

test("aux destinations have stable IDs and reject unknown outputs", () => {
  assert.deepEqual(DAW_AUX_IDS, ["AUX 1", "AUX 2", "AUX 3", "AUX 4", "AUX 5", "AUX 6", "AUX 7", "AUX 8"]);
  assert.equal(normalizeMixerStrip({ output: "AUX 4" }).output, "AUX 4");
  assert.equal(normalizeMixerStrip({ output: "BUS A" }).output, "MASTER");
  assert.equal(normalizeMixerStrip({ sends: [{ level: 150, pre: true }] }).sends[0].level, 100);
});

const source = readFileSync(new URL("../src/tabs/DAW.tsx", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `DAW persistence section changed: ${start}`);
  return source.slice(from, to);
};
const run = (code, context) => vm.runInNewContext(code
  .replace("(): DawPersistV1", "()")
  .replace("const restoredHeights: Record<string, number>", "const restoredHeights")
  .replace(" as GridValue", "")
  .replace(" as GridMode", ""), context);
const plain = (value) => JSON.parse(JSON.stringify(value));

const mixer = { ...createDefaultMixerStrip(), inputGainDb: -3.5, pan: -0.42, width: 135,
  lowMidGainDb: 2.25, sends: [{ level: 37, pre: true }, { level: 81, pre: false }] };
const effects = [
  { id: "fx-delay", type: "delay", name: "Echo Delay", enabled: true, mix: .27, rateHz: .8, depth: .5, timeMs: 321, feedback: .31, bits: 8, cutoffHz: 900, decaySeconds: 2.2 },
  { id: "fx-comp", type: "compressor", name: "YSong Dynamics C1", enabled: false, inputGainDb: 1.5, thresholdDb: -23, ratio: 3.2, attackMs: 14, releaseMs: 190, kneeDb: 12, outputGainDb: 2 },
];
const singer = { id: "singer-1", name: "Aster", avatarRef: "persona:aster" };
const generation = { origin: "create-song", sessionId: "session-1", artifactIds: ["artifact-audio-1"],
  createdAt: 1700000000000, title: "Fixture Song", singers: [singer] };
const tracks = [
  { id: "voice", type: "audio", name: "Lead Vocal", mute: false, solo: false, arm: false, level: 87,
    mixer, effects, partGeneration: { origin: "create-song", role: "lead vocal", vocalRole: "lead",
      singerId: singer.id, singerName: singer.name, singerAvatarRef: singer.avatarRef,
      sourceTrackId: "source-voice", sessionId: "session-1", createdAt: "2026-01-01T00:00:00Z" } },
  { id: "keys", type: "instrument", name: "Keys", mute: true, solo: false, arm: true, level: 103,
    gmProgram: 5, vst3PluginPath: "C:/Plugins/Fixture.vst3", vst3PluginName: "Fixture Synth",
    vst3PluginVendor: "Fixture Labs", vstPresetHint: "Warm Keys",
    vstSnapshot: { id: "snapshot-1", pluginPath: "C:/Plugins/Fixture.vst3", capturedAt: "2026-01-01T01:00:00Z", hasFullState: true, parameterCount: 42 },
    mixer: { ...createDefaultMixerStrip(), pan: .6, output: "AUX 3" }, effects: [] },
];
const clips = [
  { id: "clip-midi", trackId: "keys", name: "Verse", startBar: 5, lengthBars: 4,
    midiNotes: [{ id: "note-1", pitch: 64, startBars: .25, lengthBars: .5, velocity: 91 }],
    midiPitchBend: [{ id: "bend-1", atBars: .25, value: .3 }],
    midiModulation: [{ id: "mod-1", atBars: 1, value: .7 }], midiBendRange: 12,
    midiScales: [{ id: "scale-1", root: 2, scaleId: "dorian" }], midiScaleLock: "strict",
    composerRole: "keys", stemNodeId: "stem-1", stemVersion: 3, stemUniverseHash: "universe-1" },
  { id: "clip-voice", trackId: "voice", name: "Lead", startBar: 1, lengthBars: 8, assetId: "asset-voice",
    partGeneration: tracks[0].partGeneration },
];
const assets = [{ id: "asset-voice", kind: "audio", name: "Lead.wav", objectKey: "projects/fixture/lead.wav",
  url: "https://signed.example/temporary", sourceObjectKey: "generations/fixture/lead.wav", durationSec: 16 }];

test("DAW save and reopen retain ordered tracks, mixer, FX, plugin, MIDI, provenance, and singer references", () => {
  const payload = run(`${section("\tconst buildDawPersistPayload =", "\n\tconst currentFingerprint =")}
    buildDawPersistPayload()`, {
    projectGeneration: generation, tracks, clips, projectAssets: assets, selectedTrackId: "keys", selectedClipId: "clip-midi",
    snapEnabled: true, gridValue: "1/16", gridMode: "absolute", zoomPct: 125, playheadPosBars: 6,
    loopL: 1, loopR: 9, endBar: 17, endMarkerMode: "manual", loopEnabled: true, bpm: 94,
    sigNum: 4, sigDen: 4, timelineMarkers: [], trackHeights: { voice: 150, keys: 170 }, masterLevel: 92,
    approvedComposerArrangement: null, progressiveStemState: { universe: null, nodes: [], activeByRole: {} },
    normalizeProjectAssetForPersist: (asset) => asset.objectKey ? { ...asset, url: undefined } : asset,
  });
  const data = JSON.parse(JSON.stringify(payload));
  assert.equal(data.v, 1);
  assert.equal(data.projectAssets[0].url, undefined);
  assert.equal(data.projectAssets[0].objectKey, assets[0].objectKey);

  const restored = {};
  const context = { data, normalizeTrackEffects, normalizeAutomationLanes, normalizeMixerStrip, validateProjectSidechains,
    normalizeProjectAssetForPersist: (asset) => asset.objectKey ? { ...asset, url: undefined } : asset,
    parseSongGenerationResult: () => null, clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
    MIN_TRACK_H: 132, ROW_H: 136, MIN_ZOOM_PCT: 25, MAX_ZOOM_PCT: 400,
    MIN_BARS: 64, MAX_BARS: 10000, DEFAULT_END_BAR: 2, activeProjectId: "project-1", storedName: "Fixture Song",
    setPersistedSnapshot() {}, setHydratedProjectId() {}, setDawHydrated() {},
  };
  for (const name of ["ProjectGeneration", "Tracks", "Clips", "ProjectAssets", "ApprovedComposerArrangement",
    "ProgressiveStemState", "TrackHeights", "SelectedTrackId", "SelectedClipId", "SnapEnabled", "GridValue",
    "GridMode", "ZoomPct", "PlayheadPosBars", "LoopL", "LoopR", "EndBar", "EndMarkerMode", "Bars",
    "LoopEnabled", "TimelineMarkers", "Bpm", "SigNum", "SigDen", "MasterLevel"]) {
    context[`set${name}`] = (value) => { restored[name] = plain(value); };
  }
  run(section("\t\tconst restoredTracks =", "\n\t\tsetPersistedSnapshot("), context);

  assert.deepEqual(restored.Tracks.map((track) => track.id), ["voice", "keys"]);
  assert.equal(restored.Tracks[0].level, 87);
  assert.deepEqual(restored.Tracks[0].mixer, plain(normalizeMixerStrip(mixer)));
  assert.deepEqual(restored.Tracks[0].effects, plain(normalizeTrackEffects(effects)));
  assert.deepEqual(restored.Tracks[0].effects.map((effect) => effect.id), ["fx-delay", "fx-comp"]);
  assert.equal(restored.Tracks[0].mixer.pan, -.42);
  assert.equal(restored.Tracks[0].mixer.inputGainDb, -3.5);
  assert.deepEqual(restored.Tracks[0].mixer.sends.slice(0, 2), mixer.sends);
  assert.equal(restored.Tracks[0].effects[0].timeMs, 321);
  assert.equal(restored.Tracks[0].effects[1].enabled, false);
  assert.equal(restored.Tracks[0].effects[1].thresholdDb, -23);
  assert.deepEqual(restored.Tracks[1].vstSnapshot, tracks[1].vstSnapshot);
  assert.equal(restored.Tracks[1].vst3PluginPath, tracks[1].vst3PluginPath);
  assert.equal(restored.Tracks[1].vstPresetHint, "Warm Keys");
  assert.equal(restored.Tracks[1].mixer.output, "AUX 3");
  assert.deepEqual(restored.Clips[0], clips[0]);
  assert.deepEqual(restored.Clips[0].midiNotes, clips[0].midiNotes);
  assert.deepEqual(restored.Clips[0].midiPitchBend, clips[0].midiPitchBend);
  assert.deepEqual(restored.Clips[0].midiModulation, clips[0].midiModulation);
  assert.equal(restored.Clips[0].stemUniverseHash, "universe-1");
  assert.deepEqual(restored.ProjectAssets, [{ ...assets[0], url: undefined }].map(({ url: _url, ...asset }) => asset));
  assert.deepEqual(restored.ProjectGeneration, generation);
  assert.deepEqual(restored.ProjectGeneration.artifactIds, ["artifact-audio-1"]);
  assert.deepEqual(restored.ProjectGeneration.singers, [singer]);
  assert.deepEqual(restored.Tracks[0].partGeneration, tracks[0].partGeneration);
  assert.deepEqual(restored.Clips[1].partGeneration, tracks[0].partGeneration);
  assert.equal(restored.SelectedTrackId, "keys");
  assert.equal(restored.EndBar, 17);
});
