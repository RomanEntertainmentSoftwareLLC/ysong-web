import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function harness() {
 let contexts=0,resumes=0;
 const timers=new Map();let timerId=0;
 const node={connect(){},disconnect(){}};
 class AudioContext {
  constructor(){contexts++;this.state='suspended';this.destination={};}
  createMediaElementSource(){return node;}
  createAnalyser(){return {...node,fftSize:2048,frequencyBinCount:1024};}
  async resume(){resumes++;this.state='running';}
 }
 const context={exports:{},require:()=>({}),window:{AudioContext,setInterval:fn=>{timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id)},Float32Array,Date};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/browserVisualAudio.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
 const media=()=>{const listeners=new Map();return{paused:true,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name),play(){this.paused=false;listeners.get('play')?.();},listeners};};
 return {start:context.exports.startVisualAnalysisForMediaElement,media,contexts:()=>contexts,resumes:()=>resumes,timers};
}
test('idle World decks and ad audio create no AudioContext before playback',()=>{
 const h=harness(),elements=[h.media(),h.media(),h.media()];const stops=elements.map(h.start);
 assert.equal(h.contexts(),0);assert.equal(h.resumes(),0);for(const tick of h.timers.values())tick();assert.equal(h.contexts(),0);
 elements[0].play();assert.equal(h.contexts(),1);assert.equal(h.resumes(),1);
 elements[0].play();assert.equal(h.contexts(),1);assert.equal(h.resumes(),1);
 stops.forEach(stop=>stop());assert.equal(h.timers.size,0);elements[1].play();assert.equal(h.contexts(),1);
});
test('an already playing deck initializes analysis and remount reuses its existing tap',()=>{
 const h=harness(),element=h.media();element.paused=false;
 h.start(element)();assert.equal(h.contexts(),1);assert.equal(h.resumes(),1);
 h.start(element)();assert.equal(h.contexts(),1);assert.equal(h.resumes(),1);
});
