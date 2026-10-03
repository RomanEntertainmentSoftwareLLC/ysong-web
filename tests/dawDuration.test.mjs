import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { projectEndBar } from '../src/lib/dawDuration.ts';
test('E follows added, extended, trimmed and deleted audio clips rather than a fixed bar',()=>{
  const clips=[{startBar:1,lengthBars:8}];
  assert.equal(projectEndBar(clips),9);
  clips.push({startBar:12,lengthBars:5.5}); assert.equal(projectEndBar(clips),17.5);
  clips[1].lengthBars=10; assert.equal(projectEndBar(clips),22);
  clips.pop(); assert.equal(projectEndBar(clips),9);
  assert.equal(projectEndBar([]),2);
});
test('MIDI notes and automation respect trims and measured tails',()=>{
  const clip={startBar:1,lengthBars:16,midiNotes:[{startBars:2,lengthBars:4}],midiPitchBend:[{atBars:9}],midiModulation:[]};
  assert.equal(projectEndBar([clip]),10);
  assert.equal(projectEndBar([clip],{tailBars:1.25}),11.25);
  clip.lengthBars=4; assert.equal(projectEndBar([clip]),5);
  assert.equal(projectEndBar([{startBar:NaN,lengthBars:16}]),2);
});
test('visible Export and File Export share one panel owner',()=>{
  const source=fs.readFileSync(new URL('../src/tabs/DAW.tsx',import.meta.url),'utf8');
  assert.equal((source.match(/onClick=\{openExportPanel\}/g)||[]).length,2);
  assert.ok(source.includes('endMarkerMode === "manual"'));
});
