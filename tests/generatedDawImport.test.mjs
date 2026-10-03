import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { parseSongGenerationResult, resultFromGeneratedSession } from "../src/lib/songGenerationContract.ts";

const source = readFileSync(new URL("../src/tabs/DAW.tsx", import.meta.url), "utf8");
const start = source.indexOf("\t\tconst manifest = generatedSessionPendingRef.current;");
const end = source.indexOf("\n\t\t// eslint-disable-next-line", start);
const code = ts.transpileModule(`function importSession() { ${source.slice(start, end)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

for (const failed of [false, true]) {
  test(`generated DAW import ${failed ? "retains failed vocal channel" : "places saved vocal on an audio channel"}`, () => {
    const manifest = { v: 1, sessionId: "session", createdAt: 1700000000000, projectName: "Song", bpm: 120, sigNum: 4, sigDen: 4,
      totalBars: 16, keyRoot: 0, scaleId: "major", structuredCaption: "Song",
      tracks: [
        { id: "keys", name: "Keys", role: "keys", mode: "midi", midiRegions: [] },
        { id: "voice", name: "Lead Vocal", role: "lead vocal", mode: "audio", objectKey: "songs/voice.wav", durationSec: 32 },
      ] };
    manifest.result = resultFromGeneratedSession(manifest, { origin: "create-song", prompt: "Song" }, { provider: "cloudflare", name: "minimax/music-2.6" },
      failed ? new Map([["voice", { code: "generation_failed", message: "Provider unavailable" }]]) : new Map());
    const values = {};
    const context = { crypto: { randomUUID }, parseSongGenerationResult, ROW_H: 120, MAX_BARS: 512, MIN_BARS: 64,
      activeProjectId: "project", stop() {}, bridgeApi: { unloadAllVst3: async () => {} },
      mkTrack: (type, _index, id) => ({ type, id }), upsertGeneration() {},
      window: { dispatchEvent() {} }, CustomEvent: class {}, clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    };
    for (const key of ["generatedSessionPendingRef", "generatedSessionTargetProjectRef", "vstMetersRef", "bpmRef", "sigNumRef", "sigDenRef", "transportPrimedRef"]) context[key] = { current: key === "generatedSessionPendingRef" ? manifest : null };
    for (const key of ["vstLoadedRef", "vstRestoredRef"]) context[key] = { current: new Map() };
    for (const key of ["VstTrackState", "Bpm", "SigNum", "SigDen", "ProjectName", "ProjectGeneration", "Tracks", "Clips", "ProjectAssets", "TrackHeights", "Bars", "EndBar", "EndMarkerMode", "LoopL", "LoopR", "LoopEnabled", "PlayheadPosBars", "SelectedTrackId", "SelectedClipId"]) context[`set${key}`] = (value) => { values[key] = value; };
    vm.runInNewContext(`${code}\nimportSession()`, context);
    assert.equal(values.EndBar, 17);
    assert.equal(values.EndMarkerMode, "auto");
    assert.equal(values.Tracks.length, 2);
    assert.equal(values.Tracks[1].type, "audio");
    assert.equal(values.Tracks[1].name, "Lead Vocal");
    assert.equal(values.Clips.length, failed ? 0 : 1);
    if (failed) assert.equal(values.Tracks[1].partGeneration.failure.message, "Provider unavailable");
    else assert.equal(values.ProjectAssets[0].objectKey, "songs/voice.wav");
  });
}

test("project reload preserves a saved end marker at bar 17", () => {
  const assignment = source.match(/setEndBar\(data\.endBar[^;]+;/)?.[0];
  let endBar;
  vm.runInNewContext(assignment, { data: { endBar: 17 }, DEFAULT_END_BAR: 65, setEndBar: (value) => { endBar = value; } });
  assert.equal(endBar, 17);
});

test("reload restores a previously omitted failed vocal channel without duplicating it", () => {
  const restoreStart = source.indexOf("\t\tconst restoredTracks = (data.tracks");
  const restoreEnd = source.indexOf("\n\t\tsetProjectGeneration", restoreStart);
  const restore = ts.transpileModule(`${source.slice(restoreStart, restoreEnd)}\nrestoredTracks`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const songResult = { v: 1, id: "saved-session", status: "partial", createdAt: 1700000000000,
    timebase: { bpm: 120, sigNum: 4, sigDen: 4, startBar: 1, totalBars: 16 },
    source: { origin: "create-song", prompt: "Song" }, model: { provider: "cloudflare", name: "minimax/music-2.6" },
    parts: [
      { id: "keys", name: "Keys", role: "keys", kind: "midi", status: "ready", midi: { regions: [] } },
      { id: "voice", name: "Lead Vocal", role: "lead vocal", kind: "audio", status: "failed", failure: { code: "generation_failed", message: "Provider unavailable" } },
    ] };
  const execute = (tracks) => vm.runInNewContext(restore, { data: { tracks, generation: { origin: "create-song", songResult } }, parseSongGenerationResult,
    crypto: { randomUUID }, clamp: (v) => v, normalizeTrackEffects: (v) => v ?? [], normalizeMixerStrip: (v) => v ?? {},
    mkTrack: (type, _index, id) => ({ type, id, level: 100 }) });
  const tracks = execute([{ id: "keys-track", type: "instrument", partGeneration: { origin: "create-song", sourceTrackId: "keys" } }]);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[1].type, "audio");
  assert.equal(tracks[1].partGeneration.failure.message, "Provider unavailable");
  assert.equal(execute(tracks).length, 2);
});
