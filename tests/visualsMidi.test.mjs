import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const context={exports:{},require:()=>({}),Map,Set,Date};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/visualsMidi.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
const {acceptVisualMidiEvent,visualMidiDeltas}=context.exports;

test('MIDI intents map only matching events and clear without a connected device',()=>{
  const scene={midiModulation:{enabled:true,bindings:[
    {id:'gate',enabled:true,device:'keys',channel:1,intent:'note',number:60,target:'stage.bloomStrength',amount:2},
    {id:'velocity',enabled:true,device:'keys',channel:1,intent:'velocity',number:60,target:'stage.bloomStrength',amount:1},
    {id:'cc',enabled:true,device:'keys',channel:1,intent:'cc',number:7,target:'stage.exposure',amount:-2},
  ]}};
  const runtime=new Map();
  const event={device:'keys',channel:1,kind:'noteon',note:60,velocity:64};
  acceptVisualMidiEvent(scene,runtime,{...event,device:'other'},100);
  assert.equal(runtime.size,0);
  acceptVisualMidiEvent(scene,runtime,event,100);
  assert.ok(Math.abs(visualMidiDeltas(scene,runtime,true,100).get('stage.bloomStrength')-(2+64/127))<1e-9);
  acceptVisualMidiEvent(scene,runtime,{device:'keys',channel:1,kind:'cc',controller:7,value:127},100);
  assert.equal(visualMidiDeltas(scene,runtime,true,100).get('stage.exposure'),-2);
  acceptVisualMidiEvent(scene,runtime,{...event,kind:'noteoff'},101);
  assert.equal(visualMidiDeltas(scene,runtime,true,101).get('stage.bloomStrength'),undefined);
  assert.equal(visualMidiDeltas(scene,runtime,false,101).size,0);
  assert.equal(runtime.size,0);
});

test('stale hardware values and disabled mappings have no effect',()=>{
  const scene={midiModulation:{enabled:true,bindings:[{id:'cc',enabled:true,device:'',channel:0,intent:'cc',number:1,target:'x',amount:3}]}};
  const runtime=new Map();
  acceptVisualMidiEvent(scene,runtime,{device:'pad',channel:4,kind:'cc',controller:1,value:127},100);
  assert.equal(visualMidiDeltas(scene,runtime,true,1101).size,0);
  scene.midiModulation.bindings[0].enabled=false;
  assert.equal(visualMidiDeltas(scene,runtime,true,101).size,0);
});
