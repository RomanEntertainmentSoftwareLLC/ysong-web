import { useEffect, useMemo, useRef, useState } from 'react';
import { YSButton } from './YSButton';
import { bridgeApi, type InstrumentCatalogEntry, type InstrumentMatchResult, type InstrumentParameterEntry, type InstrumentSnapshotRecord } from '../lib/bridgeApi';
import { analyzeAuditionWave, type AuditionMetrics } from '../lib/auditionAnalysis';
import {
  getSoundDesignerStatus, planSoundDesign, proposeSoundDesignStep,
  type SoundDesignerContext, type SoundDesignerIteration, type SoundDesignerPlan, type SoundDesignerStatus,
} from '../lib/soundDesigner';

type TrackTarget={id:string;name:string;type:string;vst3PluginPath?:string;vst3PluginName?:string;vst3PluginVendor?:string};
type MidiSource={trackName:string;startBar:number;lengthBars:number;notes:Array<{pitch:number;startBars:number;lengthBars:number;velocity:number}>};
type Props={
  open:boolean; onClose:()=>void; selectedTrack:TrackTarget|null; transportPlaying:boolean; bpm:number; sigNum:number; sigDen:number;
  projectSummary:string; initialKeyLabel?:string; midiSource?:MidiSource|null;
  onAssignInstrument:(instrument:InstrumentCatalogEntry)=>Promise<string|null>;
};

const fmt=(n:number,d=2)=>Number.isFinite(n)?n.toFixed(d):'—';
const db=(n:number)=>Number.isFinite(n)?`${n.toFixed(1)} dB`:'—';
function messageOf(error:unknown,fallback:string){ return error instanceof Error && error.message ? error.message : fallback; }
function desiredTerms(value:string){ return value.split(/[\s,;/|]+/).map((x)=>x.trim()).filter((x)=>x.length>1).slice(0,32); }

export default function AiSoundDesignerPanel({open,onClose,selectedTrack,transportPlaying,bpm,sigNum,sigDen,projectSummary,initialKeyLabel='',midiSource=null,onAssignInstrument}:Props){
  const [status,setStatus]=useState<SoundDesignerStatus|null>(null);
  const [desired,setDesired]=useState('icy demonic pluck that does not interfere with the vocal');
  const [role,setRole]=useState('lead / pluck');
  const [keyLabel,setKeyLabel]=useState(initialKeyLabel);
  const [arrangement,setArrangement]=useState('');
  const [vocalLow,setVocalLow]=useState('180');
  const [vocalHigh,setVocalHigh]=useState('4200');
  const [notes,setNotes]=useState('Short, articulate, wide enough to feel exciting without masking the lead vocal.');
  const [matches,setMatches]=useState<InstrumentMatchResult[]>([]);
  const [plan,setPlan]=useState<SoundDesignerPlan|null>(null);
  const [instrument,setInstrument]=useState<InstrumentCatalogEntry|null>(null);
  const [parameters,setParameters]=useState<InstrumentParameterEntry[]>([]);
  const [baselineSnapshot,setBaselineSnapshot]=useState<InstrumentSnapshotRecord|null>(null);
  const [iterations,setIterations]=useState<SoundDesignerIteration[]>([]);
  const [latestMetrics,setLatestMetrics]=useState<AuditionMetrics|null>(null);
  const [baselineAudioUrl,setBaselineAudioUrl]=useState<string>('');
  const [currentAudioUrl,setCurrentAudioUrl]=useState<string>('');
  const [maxAutoIterations,setMaxAutoIterations]=useState(3);
  const [busy,setBusy]=useState('');
  const [notice,setNotice]=useState('');
  const cancelRef=useRef(false);
  const iterationsRef=useRef<SoundDesignerIteration[]>([]);
  const metricsRef=useRef<AuditionMetrics|null>(null);

  const target=selectedTrack?.type==='instrument'?selectedTrack:null;
  const context:SoundDesignerContext=useMemo(()=>({
    desired:desired.trim(),role:role.trim(),keyLabel:keyLabel.trim(),bpm,
    arrangement:[projectSummary.trim(),arrangement.trim()].filter(Boolean).join('\nUser context: '),notes:notes.trim(),
    vocalLowHz:Number(vocalLow)>0?Number(vocalLow):null,vocalHighHz:Number(vocalHigh)>0?Number(vocalHigh):null,
    midiPart:midiSource,
  }),[desired,role,keyLabel,bpm,projectSummary,arrangement,notes,vocalLow,vocalHigh,midiSource]);

  const midiAudition=useMemo(()=>{
    if(!midiSource?.notes.length)return null;
    const barSeconds=(60/Math.max(1,bpm))*(4/Math.max(1,sigDen))*Math.max(1,sigNum);
    const sorted=[...midiSource.notes].sort((a,b)=>a.startBars-b.startBars||a.pitch-b.pitch);
    const first=sorted[0]?.startBars??0;
    const notesOut=sorted.map((note)=>({
      note:Math.max(0,Math.min(127,Math.round(note.pitch))),velocity:Math.max(1,Math.min(127,Math.round(note.velocity))),
      startSeconds:Math.max(0,(note.startBars-first)*barSeconds),durationSeconds:Math.max(.03,Math.min(4.8,note.lengthBars*barSeconds)),channel:0,
    })).filter((note)=>note.startSeconds<4.85).slice(0,32);
    if(!notesOut.length)return null;
    const end=Math.max(...notesOut.map((note)=>note.startSeconds+(note.durationSeconds||.2)));
    return {durationSeconds:Math.max(.5,Math.min(5,end+.1)),notes:notesOut};
  },[midiSource,bpm,sigNum,sigDen]);

  useEffect(()=>{ if(initialKeyLabel)setKeyLabel(initialKeyLabel); },[initialKeyLabel,selectedTrack?.id]);

  useEffect(()=>{
    if(!open)return;
    cancelRef.current=false;
    void getSoundDesignerStatus().then(setStatus).catch((error)=>setNotice(messageOf(error,'Could not read Sound Designer status.')));
    return()=>{cancelRef.current=true;};
  },[open]);
  useEffect(()=>()=>{ if(baselineAudioUrl)URL.revokeObjectURL(baselineAudioUrl); if(currentAudioUrl)URL.revokeObjectURL(currentAudioUrl); },[baselineAudioUrl,currentAudioUrl]);
  useEffect(()=>{
    setPlan(null); setInstrument(null); setParameters([]); setBaselineSnapshot(null); setIterations([]); setLatestMetrics(null); iterationsRef.current=[]; metricsRef.current=null;
    setBaselineAudioUrl((old)=>{if(old)URL.revokeObjectURL(old);return '';});
    setCurrentAudioUrl((old)=>{if(old)URL.revokeObjectURL(old);return '';});
  },[selectedTrack?.id]);

  if(!open)return null;

  const renderAndAnalyze=async(audition:{durationSeconds:number;notes:Array<{note:number;velocity?:number;startSeconds?:number;durationSeconds?:number;channel?:number}>})=>{
    if(!target)throw new Error('Select an instrument track first.');
    const wav=await bridgeApi.renderInstrumentAudition(target.id,audition.durationSeconds,audition.notes);
    const metrics=analyzeAuditionWave(wav,{vocalLowHz:context.vocalLowHz,vocalHighHz:context.vocalHighHz});
    const blobUrl=URL.createObjectURL(new Blob([wav],{type:'audio/wav'}));
    return {metrics,blobUrl,wav};
  };

  const createPlan=async()=>{
    if(!target){setNotice('Select an instrument track first.');return;}
    if(!context.desired){setNotice('Describe the sound you want first.');return;}
    if(!status?.configured){setNotice('Server AI is not configured yet. Phase 27 is wired, but it will not fake a sound-design model.');return;}
    setBusy('plan'); setNotice('Matching installed instruments…');
    try{
      const result=await bridgeApi.matchInstruments(desiredTerms(context.desired),10);
      if(!result.matches.length)throw new Error('No installed instruments matched. Scan VST3 instruments in Bridge Settings first.');
      setMatches(result.matches);
      const response=await planSoundDesign(context,result.matches);
      const selected=result.matches.find((row)=>row.instrument.id===response.plan.instrumentId)?.instrument;
      if(!selected)throw new Error('The Sound Designer selected an instrument that is no longer available.');
      setPlan(response.plan); setInstrument(selected); setParameters([]); setBaselineSnapshot(null); setIterations([]); setLatestMetrics(null); iterationsRef.current=[]; metricsRef.current=null;
      setNotice('Plan ready. Review the chosen installed instrument, then explicitly load it and capture the mandatory baseline snapshot.');
    }catch(error){setNotice(messageOf(error,'Could not plan the sound.'));}
    finally{setBusy('');}
  };

  const prepareInstrument=async()=>{
    if(!target||!instrument||!plan)return;
    if(transportPlaying){setNotice('Stop transport before loading/capturing instrument state.');return;}
    setBusy('prepare'); setNotice(`Loading ${instrument.name}…`);
    try{
      const trackId=await onAssignInstrument(instrument);
      if(!trackId)throw new Error('Could not load the chosen instrument on the selected track.');
      const paramResponse=await bridgeApi.getInstrumentParameters(instrument.id,target.id);
      if(!paramResponse.parameters.length)throw new Error('This instrument exposed no automatable parameter surface to Bridge.');
      setParameters(paramResponse.parameters);
      const snapshotResponse=await bridgeApi.captureInstrumentSnapshot(target.id,`Phase 27 Baseline · ${instrument.name}`,["phase27","baseline",...plan.targetTraits.slice(0,6)]);
      setBaselineSnapshot(snapshotResponse.snapshot);
      const audition=await renderAndAnalyze(midiAudition??plan.audition);
      metricsRef.current=audition.metrics; setLatestMetrics(audition.metrics);
      URL.revokeObjectURL(audition.blobUrl);
      setBaselineAudioUrl((old)=>{if(old)URL.revokeObjectURL(old);return URL.createObjectURL(new Blob([audition.wav],{type:'audio/wav'}));});
      setCurrentAudioUrl((old)=>{if(old)URL.revokeObjectURL(old);return URL.createObjectURL(new Blob([audition.wav],{type:'audio/wav'}));});
      setNotice('Baseline captured before any AI knob control. Ready for a conservative iteration.');
    }catch(error){setNotice(messageOf(error,'Could not prepare the instrument safely.'));}
    finally{setBusy('');}
  };

  const oneIteration=async(iterationNumber:number):Promise<boolean>=>{
    if(!target||!instrument||!baselineSnapshot)throw new Error('Load the planned instrument and capture the baseline first.');
    const refreshed=await bridgeApi.getInstrumentParameters(instrument.id,target.id);
    setParameters(refreshed.parameters);
    const response=await proposeSoundDesignStep({context,instrument,parameters:refreshed.parameters,audition:metricsRef.current,history:iterationsRef.current,snapshotConfirmed:true});
    const step=response.step;
    if(cancelRef.current)return false;
    for(const change of step.changes){
      await bridgeApi.setInstrumentParameter(target.id,change.parameterId,change.targetValue);
      if(cancelRef.current)return false;
    }
    const audition=await renderAndAnalyze(midiAudition??step.nextAudition);
    if(cancelRef.current){URL.revokeObjectURL(audition.blobUrl);return false;}
    const snapshot=step.changes.length?await bridgeApi.captureInstrumentSnapshot(target.id,`Phase 27 Iteration ${iterationNumber} · ${instrument.name}`,["phase27",`iteration-${iterationNumber}`]):null;
    const record:SoundDesignerIteration={iteration:iterationNumber,score:step.score,evaluation:step.evaluation,changes:step.changes,audition:audition.metrics,snapshotId:snapshot?.snapshot.id??null,createdAt:Date.now()};
    const nextIterations=[...iterationsRef.current,record]; iterationsRef.current=nextIterations; setIterations(nextIterations);
    metricsRef.current=audition.metrics; setLatestMetrics(audition.metrics);
    setCurrentAudioUrl((old)=>{if(old)URL.revokeObjectURL(old);return audition.blobUrl;});
    const refreshedAfter=await bridgeApi.getInstrumentParameters(instrument.id,target.id); setParameters(refreshedAfter.parameters);
    setNotice(step.done?`Designer considers the target complete (${step.score.toFixed(0)}/100 model evaluation). You still decide whether to keep it.`:`Iteration ${iterationNumber}: ${step.nextFocus||step.evaluation}`);
    return !step.done && step.changes.length>0;
  };

  const runOne=async()=>{
    if(transportPlaying){setNotice('Stop transport before autonomous knob changes.');return;}
    setBusy('iterate');
    try{await oneIteration(iterationsRef.current.length+1);}catch(error){setNotice(messageOf(error,'Sound-design iteration failed.'));}finally{setBusy('');}
  };
  const runAuto=async()=>{
    if(transportPlaying){setNotice('Stop transport before autonomous knob changes.');return;}
    setBusy('auto'); cancelRef.current=false;
    try{
      let keepGoing=true;
      for(let i=0;i<maxAutoIterations&&keepGoing&&!cancelRef.current;i++) keepGoing=await oneIteration(iterationsRef.current.length+1);
    }catch(error){setNotice(messageOf(error,'Automatic sound-design loop failed.'));}finally{setBusy('');}
  };
  const restoreBaseline=async()=>{
    if(!target||!baselineSnapshot)return; if(transportPlaying){setNotice('Stop transport before restoring whole plug-in state.');return;}
    setBusy('restore');
    try{
      await bridgeApi.restoreInstrumentSnapshot(target.id,baselineSnapshot.id);
      const p=await bridgeApi.getInstrumentParameters(instrument!.id,target.id);setParameters(p.parameters);
      iterationsRef.current=[]; setIterations([]);
      const audition=await renderAndAnalyze(midiAudition??plan?.audition??{durationSeconds:3,notes:[]});metricsRef.current=audition.metrics;setLatestMetrics(audition.metrics);
      setCurrentAudioUrl((old)=>{if(old)URL.revokeObjectURL(old);return audition.blobUrl;});
      setNotice('Restored the mandatory pre-design baseline snapshot.');
    }catch(error){setNotice(messageOf(error,'Could not restore baseline.'));}finally{setBusy('');}
  };
  const restoreIteration=async(item:SoundDesignerIteration)=>{
    if(!target||!item.snapshotId||!instrument)return; if(transportPlaying){setNotice('Stop transport before restoring whole plug-in state.');return;}
    setBusy(`restore:${item.iteration}`);
    try{
      await bridgeApi.restoreInstrumentSnapshot(target.id,item.snapshotId);
      const p=await bridgeApi.getInstrumentParameters(instrument.id,target.id);setParameters(p.parameters);
      const truncated=iterationsRef.current.filter((x)=>x.iteration<=item.iteration); iterationsRef.current=truncated; setIterations(truncated);
      metricsRef.current=item.audition; setLatestMetrics(item.audition);
      setNotice(`Restored Phase 27 iteration ${item.iteration}. Render a new audition before asking for another iteration if needed.`);
    }catch(error){setNotice(messageOf(error,'Could not restore that iteration.'));}finally{setBusy('');}
  };

  const metricCards=latestMetrics?[['RMS',db(latestMetrics.rmsDbfs)],['Peak',db(latestMetrics.peakDbfs)],['Crest',db(latestMetrics.crestDb)],['Centroid',`${fmt(latestMetrics.spectralCentroidHz,0)} Hz`],['High energy',`${fmt(latestMetrics.highEnergyRatio*100,1)}%`],['Width',fmt(latestMetrics.stereoWidth,2)],['Attack',`${fmt(latestMetrics.attackMs,0)} ms`],['Vocal-band',latestMetrics.vocalBandEnergyRatio==null?'—':`${fmt(latestMetrics.vocalBandEnergyRatio*100,1)}%`]]:[];

  return <div className="absolute inset-0 z-[88] bg-black/50 backdrop-blur-[2px] flex justify-end" onPointerDown={(event)=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="h-full w-full max-w-[1220px] bg-neutral-950 border-l border-white/10 shadow-2xl flex flex-col text-neutral-100">
      <header className="shrink-0 px-4 py-3 border-b border-white/10 flex items-start gap-3">
        <div className="min-w-0 flex-1"><div className="text-base font-semibold">AI Sound Designer</div><div className="text-[11px] text-neutral-400">Phase 27 · AI brain outside Bridge · snapshot-first knob control · iterative audition loop</div></div>
        <div className="text-[10px] text-neutral-500 text-right">{status?.configured?`${status.provider} · ${status.model}`:'AI provider not configured'}<br/>{target?`Target: ${target.name}`:'Select an instrument track'}</div>
        <YSButton className="h-8 px-3 rounded-lg" onClick={onClose}>Close</YSButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
        <section className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
          <div className="text-sm font-medium">1 · Describe the timbre</div>
          <textarea value={desired} onChange={(e)=>setDesired(e.target.value)} className="mt-2 w-full min-h-20 rounded-lg border border-white/10 bg-black/25 p-2 text-sm" placeholder="Make an icy demonic pluck that does not interfere with the vocal."/>
          <div className="mt-2 grid grid-cols-2 lg:grid-cols-6 gap-2">
            <input value={role} onChange={(e)=>setRole(e.target.value)} className="h-8 rounded border border-white/10 bg-black/25 px-2 text-xs" placeholder="Role"/>
            <input value={keyLabel} onChange={(e)=>setKeyLabel(e.target.value)} className="h-8 rounded border border-white/10 bg-black/25 px-2 text-xs" placeholder="Key / scale"/>
            <div className="h-8 rounded border border-white/10 bg-black/20 px-2 text-xs flex items-center">{bpm} BPM</div>
            <input value={vocalLow} onChange={(e)=>setVocalLow(e.target.value)} className="h-8 rounded border border-white/10 bg-black/25 px-2 text-xs" placeholder="Vocal low Hz"/>
            <input value={vocalHigh} onChange={(e)=>setVocalHigh(e.target.value)} className="h-8 rounded border border-white/10 bg-black/25 px-2 text-xs" placeholder="Vocal high Hz"/>
            <YSButton disabled={!target||busy!==''||!status?.configured} className="h-8 px-2 rounded-md text-[10px]" onClick={()=>void createPlan()}>{busy==='plan'?'Planning…':'Plan from installed synths'}</YSButton>
          </div>
          <input value={arrangement} onChange={(e)=>setArrangement(e.target.value)} className="mt-2 w-full h-8 rounded border border-white/10 bg-black/25 px-2 text-xs" placeholder="Arrangement context, e.g. dense female-vocal chorus"/>
          <input value={notes} onChange={(e)=>setNotes(e.target.value)} className="mt-2 w-full h-8 rounded border border-white/10 bg-black/25 px-2 text-xs" placeholder="Additional constraints"/>
          <div className="mt-2 text-[10px] text-neutral-500">Context: {projectSummary || 'current DAW project'}{midiSource ? ` · selected MIDI ${midiSource.trackName} (${midiSource.notes.length} notes)` : ' · no selected MIDI clip'}{initialKeyLabel ? ` · scale ${initialKeyLabel}` : ''}. Selected MIDI is used as the audition phrase when available.</div>
          {!status?.configured&&<div className="mt-2 text-[10px] text-amber-300">No fake fallback: configure the server AI provider after Phase 28 to activate autonomous design. Manual Bridge instrument controls remain available in Instruments.</div>}
        </section>

        {plan&&instrument&&<section className="rounded-xl border border-cyan-300/20 bg-cyan-500/[0.04] p-3">
          <div className="flex flex-wrap gap-3 items-start"><div className="min-w-0 flex-1"><div className="text-sm font-semibold">2 · Review instrument plan</div><div className="mt-1 text-base">{instrument.name} <span className="text-xs text-neutral-500">{instrument.vendor||''}</span></div><div className="mt-1 text-xs text-neutral-300">{plan.reason}</div><div className="mt-2 flex flex-wrap gap-1">{plan.targetTraits.map((x)=><span key={x} className="rounded border border-cyan-300/20 px-1.5 py-0.5 text-[9px] text-cyan-200">{x}</span>)}{plan.avoidTraits.map((x)=><span key={x} className="rounded border border-amber-300/20 px-1.5 py-0.5 text-[9px] text-amber-200">avoid {x}</span>)}</div></div>
          <YSButton disabled={transportPlaying||busy!==''||!!baselineSnapshot} className="h-9 px-3 rounded-lg" onClick={()=>void prepareInstrument()}>{busy==='prepare'?'Preparing…':baselineSnapshot?'Baseline captured':'Load + capture baseline'}</YSButton></div>
          {matches.length>1&&<div className="mt-2 text-[10px] text-neutral-500">AI chose from {matches.length} installed Bridge candidates. It did not invent a synth that is not installed.</div>}
        </section>}

        {baselineSnapshot&&<section className="rounded-xl border border-fuchsia-300/20 bg-fuchsia-500/[0.035] p-3">
          <div className="flex flex-wrap items-center gap-2"><div className="min-w-0 flex-1"><div className="text-sm font-semibold">3 · Iterate safely</div><div className="text-[10px] text-neutral-400">Mandatory baseline: {baselineSnapshot.name} · {baselineSnapshot.hasFullState?'native plug-in state + parameter fallback':'parameter fallback'}</div></div>
            <YSButton disabled={transportPlaying||busy!==''} className="h-8 px-2 rounded-md text-[10px]" onClick={()=>void runOne()}>{busy==='iterate'?'Thinking…':'Run 1 iteration'}</YSButton>
            <select value={maxAutoIterations} onChange={(e)=>setMaxAutoIterations(Number(e.target.value))} className="h-8 rounded border border-white/10 bg-black/40 px-2 text-xs">{[2,3,4,5,6].map((n)=><option key={n} value={n}>{n} iterations max</option>)}</select>
            <YSButton disabled={transportPlaying||busy!==''} className="h-8 px-2 rounded-md text-[10px]" onClick={()=>void runAuto()}>{busy==='auto'?'Iterating…':'Auto iterate'}</YSButton>
            {busy==='auto'&&<YSButton className="h-8 px-2 rounded-md text-[10px]" onClick={()=>{cancelRef.current=true;setNotice('Stopping after the current safe operation…');}}>Stop</YSButton>}
            <YSButton disabled={transportPlaying||busy!==''} className="h-8 px-2 rounded-md text-[10px]" onClick={()=>void restoreBaseline()}>{busy==='restore'?'Restoring…':'Restore baseline'}</YSButton>
          </div>

          {latestMetrics&&<div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">{metricCards.map(([label,value])=><div key={label} className="rounded-lg border border-white/8 bg-black/20 p-2"><div className="text-[9px] text-neutral-500">{label}</div><div className="text-xs font-mono">{value}</div></div>)}</div>}

          <div className="mt-3 grid md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/8 p-2"><div className="text-[10px] text-neutral-500">A · Baseline audition</div>{baselineAudioUrl?<audio controls src={baselineAudioUrl} className="mt-1 w-full h-8"/>:<div className="text-xs text-neutral-600">No baseline audio.</div>}</div>
            <div className="rounded-lg border border-white/8 p-2"><div className="text-[10px] text-neutral-500">B · Current audition</div>{currentAudioUrl?<audio controls src={currentAudioUrl} className="mt-1 w-full h-8"/>:<div className="text-xs text-neutral-600">No current audio.</div>}</div>
          </div>

          <div className="mt-3 space-y-2">{iterations.map((item)=><div key={`${item.iteration}-${item.createdAt}`} className="rounded-lg border border-white/8 bg-black/20 p-2">
            <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="text-xs font-medium">Iteration {item.iteration} · model evaluation {item.score.toFixed(0)}/100</div><div className="text-[10px] text-neutral-400 mt-0.5">{item.evaluation}</div></div>{item.snapshotId&&<YSButton disabled={transportPlaying||busy!==''} className="h-6 px-2 rounded text-[9px]" onClick={()=>void restoreIteration(item)}>Restore</YSButton>}</div>
            {item.changes.length>0&&<div className="mt-1 text-[9px] text-neutral-500">{item.changes.map((c)=>`${c.parameterName}: ${fmt(c.fromValue,3)} → ${fmt(c.targetValue,3)}`).join(' · ')}</div>}
          </div>)}</div>

          <div className="mt-3 rounded-lg border border-white/8 bg-black/15 p-2 text-[10px] text-neutral-400">The numeric score is the server model’s heuristic judgment from deterministic audition measurements and parameter context. It is <b>not</b> an objective audio-quality score and the model is not directly hearing the WAV in Phase 27.</div>
        </section>}

        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3"><div className="text-sm font-medium">Live parameter surface</div><div className="mt-2 max-h-56 overflow-y-auto grid md:grid-cols-2 gap-1.5">{parameters.slice(0,120).map((p)=><div key={p.id} className="rounded border border-white/8 bg-black/15 px-2 py-1 text-[9px] flex gap-2"><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-neutral-500">{p.group}</span><span className="font-mono text-cyan-200">{fmt(p.currentValue,3)}</span></div>)}{parameters.length===0&&<div className="text-xs text-neutral-500">Load the planned instrument to expose parameters.</div>}</div></section>
      </div>

      <footer className="shrink-0 min-h-11 border-t border-white/10 px-4 py-2 text-[10px] text-neutral-400 flex items-center gap-3"><span className="min-w-0 flex-1">{notice||'Plan → explicit load → mandatory baseline snapshot → bounded knob changes → Bridge audition → deterministic DSP → model evaluation → repeat.'}</span><span className="text-neutral-600">No silent project edits · restore points every changed iteration</span></footer>
    </section>
  </div>;
}
