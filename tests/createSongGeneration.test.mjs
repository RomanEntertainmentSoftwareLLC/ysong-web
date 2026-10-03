import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { resultFromGeneratedSession } from "../src/lib/songGenerationContract.ts";

const source = readFileSync(new URL("../src/tabs/CreateSong.tsx", import.meta.url), "utf8");
const handler = source.slice(source.indexOf("  async function generateSession()"), source.indexOf("  function sendToAgent()"));
const javascript = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const midi = { id: "pad", name: "Pad", role: "pad", mode: "midi", midiRegions: [] };
const vocal = { id: "vocal", name: "Vocal", role: "lead vocal", mode: "audio", useLyrics: true };
const plan = { projectName: "Regression", bpm: 120, sigNum: 4, sigDen: 4, totalBars: 8, structuredCaption: "A song", tracks: [midi, vocal] };

async function run(recovery = null, generationFails = false) {
  let staged;
  let error;
  let calls = 0;
  const saved = new Map();
  const context = vm.createContext({
    generating: false, recovery, plan, planApproved: true, entitlement: { enabled: false },
    draft: { instrumental: false, lyrics: "User lyrics" },
    crypto: { randomUUID }, resultFromGeneratedSession, Error,
    BLUEPRINT_KEY: "blueprint", RECOVERY_KEY: "recovery",
    localStorage: { setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) },
    setGenerating() {}, setError(value) { error = value; }, setProgress() {}, setEngine() {}, setRecovery() {},
    getMusicEngineStatus: async () => ({ reachable: true, provider: "cloudflare", model: "minimax/music-2.6" }),
    buildMiniMaxTrackInstructions: () => "Isolated vocal",
    generateMiniMaxTrack: async () => { calls++; if (generationFails) throw new Error("Provider unavailable"); return {}; },
    decodeAudioDuration: async () => 16,
    uploadGeneratedAudio: async () => ({ objectKey: "user-uploads/test/vocal.wav" }),
    stageGeneratedSession(value) {
      assert.ok(saved.has("blueprint"), "Blueprint must be saved before navigation");
      if (generationFails) assert.ok(saved.has("recovery"), "Part failure must be saved before navigation");
      staged = value;
    },
    upsertGeneration() { assert.fail("Successful parts should stage a project"); },
    tabs: [], openTab: () => "daw", activateTab() {}, window: { setTimeout() {} },
  });
  await vm.runInContext(`${javascript}\ngenerateSession()`, context);
  assert.equal(error, "");
  assert.ok(staged);
  assert.deepEqual(Array.from(staged.tracks, (track) => track.id), ["pad", "vocal"]);
  assert.equal(staged.result.status, generationFails ? "partial" : "complete");
  assert.equal(staged.result.parts.length, 2);
  assert.equal(calls, 1);
  return { staged, saved };
}

test("Create Song stages each MIDI/audio part once after generation", async () => {
  await run();
});

test('SaaS Create Song persists one batch and recovers ambiguous HTTP submission without per-stem paid calls',async()=>{
  const saved=new Map(),requests=[];let fail=true,error='';
  const token=`x.${Buffer.from(JSON.stringify({uid:'fixture-owner'})).toString('base64url')}.x`;
  const context=vm.createContext({generating:false,recovery:null,plan,planApproved:true,entitlement:{enabled:true},quantity:4,parentId:undefined,
    draft:{style:'original',lyrics:'user lyrics',instrumental:false},crypto:{randomUUID},atob,Error,
    localStorage:{getItem:key=>key==='ys_token'?token:saved.get(key)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
    setGenerating(){},setProgress(){},setError:value=>{error=value;},setEntitlement(){},buildMiniMaxTrackInstructions:()=> 'Isolated part',
    apiGet:async()=>({enabled:true,remaining:20,superadmin:false}),apiPost:async(_path,request)=>{requests.push(request);if(fail)throw new Error('Connection interrupted');},
    generateMiniMaxTrack:()=>assert.fail('Paid execution belongs to server'),window:{dispatchEvent(){}},CustomEvent:class {},
  });
  await vm.runInContext(`${javascript}\ngenerateSession()`,context);assert.equal(error,'Connection interrupted');assert.equal(saved.size,1);
  fail=false;await vm.runInContext('generateSession()',context);assert.equal(error,'');assert.equal(saved.size,0);
  assert.equal(requests.length,2);assert.equal(requests[0].requestKey,requests[1].requestKey);assert.equal(requests[1].quantity,4);assert.equal(requests[1].plan.tracks.length,2);
});

test("Create Song retries only failed parts and retains the prior session identity", async () => {
  const prior = { ...plan, v: 1, sessionId: "existing-session", createdAt: 1700000000000 };
  prior.result = resultFromGeneratedSession(prior, { origin: "create-song", prompt: "A song", seed: 7 },
    { provider: "cloudflare", name: "minimax/music-2.6" },
    new Map([["vocal", { code: "generation_failed", message: "Temporary failure" }]]));
  const { staged } = await run({ plan, manifest: prior });
  assert.equal(staged.sessionId, prior.sessionId);
  assert.equal(staged.createdAt, prior.createdAt);
  assert.equal(staged.result.source.seed, 7);
});

test("failed vocal recovery and approved blueprint are saved before opening the DAW", async () => {
  const { staged, saved } = await run(null, true);
  const restored = JSON.parse(saved.get("recovery"));
  assert.equal(restored.manifest.result.parts[1].failure.message, "Provider unavailable");
  assert.equal(restored.manifest.sessionId, staged.sessionId);
  assert.deepEqual(restored.plan, plan);
  assert.deepEqual(JSON.parse(saved.get("blueprint")), { plan, approved: true });
});
