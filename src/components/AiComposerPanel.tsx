import { useEffect, useMemo, useState } from 'react';
import {
  COMPOSER_ROLES, generateComposerIdea, getComposerStatus, proposeComposerArrangement,
  type ComposerAction, type ComposerArrangement, type ComposerControls, type ComposerProjectContext,
  type ComposerProposal, type ComposerRole, type ComposerStatus,
} from '../lib/aiComposer';
import { NOTE_NAMES, SCALE_DEFINITIONS, type MidiScaleId } from '../lib/midi';

const input='w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs outline-none focus:border-fuchsia-400/50';
const button='rounded-lg border border-white/10 bg-white/[0.055] px-2.5 py-1.5 text-xs hover:bg-white/[0.09] disabled:opacity-35 disabled:hover:bg-white/[0.055]';
const accent='rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/15 px-3 py-1.5 text-xs text-fuchsia-100 hover:bg-fuchsia-500/25 disabled:opacity-35';

const ACTIONS:Array<{id:ComposerAction;label:string;requiresSource?:boolean}>=[
  {id:'regenerate',label:'Regenerate',requiresSource:true},{id:'variation',label:'Variation',requiresSource:true},
  {id:'simpler',label:'Simpler',requiresSource:true},{id:'more_melodic',label:'More melodic',requiresSource:true},
  {id:'darker',label:'Darker',requiresSource:true},{id:'more_aggressive',label:'More aggressive',requiresSource:true},
  {id:'continue_8_bars',label:'Continue 8 bars',requiresSource:true},{id:'harmony',label:'Generate harmony',requiresSource:true},
  {id:'bass_from_this',label:'Bass from this',requiresSource:true},
];

function roleLabel(role:ComposerRole){return COMPOSER_ROLES.find(r=>r.id===role)?.label||role;}
function n(v:number,d=0){return Number.isFinite(v)?Number(v.toFixed(d)):0;}

function PianoPreview({proposal}:{proposal:ComposerProposal}){
  const width=520,height=150,pad=8;
  const pitches=proposal.notes.map(x=>x.pitch);
  const lo=Math.min(...pitches,48), hi=Math.max(...pitches,72);
  const span=Math.max(12,hi-lo+1);
  return <div className="overflow-hidden rounded-xl border border-white/10 bg-black/35 p-2">
    <div className="mb-1 flex items-center justify-between text-[10px] opacity-50"><span>Structured MIDI preview</span><span>{proposal.notes.length} notes · {n(proposal.lengthBars,2)} bars</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-[150px] w-full" role="img" aria-label="Generated MIDI note preview">
      {Array.from({length:9},(_,i)=><line key={`v${i}`} x1={pad+(width-pad*2)*i/8} y1={pad} x2={pad+(width-pad*2)*i/8} y2={height-pad} stroke="currentColor" opacity="0.07" />)}
      {proposal.notes.map((note,i)=>{
        const x=pad+(note.startBars/proposal.lengthBars)*(width-pad*2);
        const w=Math.max(2,(note.lengthBars/proposal.lengthBars)*(width-pad*2));
        const y=pad+((hi-note.pitch)/span)*(height-pad*2);
        return <rect key={`${i}-${note.pitch}-${note.startBars}`} x={x} y={y} width={w} height={Math.max(3,(height-pad*2)/span*.7)} rx="2" fill="currentColor" opacity={0.35+note.velocity/127*.55}/>;
      })}
    </svg>
  </div>;
}

export default function AiComposerPanel({
  open,onClose,project,bpm,sigNum,sigDen,totalBars,playheadBar,onAccept,onArrangementApproved,
}:{
  open:boolean; onClose:()=>void; project:ComposerProjectContext; bpm:number; sigNum:number; sigDen:number; totalBars:number; playheadBar:number;
  onAccept:(proposal:ComposerProposal,targetTrackId?:string|null)=>string;
  onArrangementApproved?:(arrangement:ComposerArrangement|null)=>void;
}){
  const [status,setStatus]=useState<ComposerStatus|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [arrangement,setArrangement]=useState<ComposerArrangement|null>(null);
  const [approved,setApproved]=useState(false);
  const [proposal,setProposal]=useState<ComposerProposal|null>(null);
  const [lastAcceptedTrackId,setLastAcceptedTrackId]=useState<string|null>(null);
  const [controls,setControls]=useState<ComposerControls>(()=>({
    bpm, keyRoot:0, keyLabel:'C Natural Minor', scaleId:'natural-minor', sigNum, sigDen, totalBars:Math.max(4,totalBars), bars:8,
    startBar:Math.max(1,Math.floor(playheadBar)), complexity:.55, humanization:.2, mood:'', style:'', role:'melody',
  }));

  useEffect(()=>{if(!open)return;getComposerStatus().then(setStatus).catch(()=>setStatus(null));},[open]);
  useEffect(()=>{
    setControls(c=>({...c,bpm,sigNum,sigDen,totalBars:Math.max(4,totalBars)}));
    setArrangement(null); setApproved(false); setProposal(null); setLastAcceptedTrackId(null); onArrangementApproved?.(null);
  },[bpm,sigNum,sigDen,totalBars,onArrangementApproved]);
  useEffect(()=>{if(open)setControls(c=>({...c,startBar:Math.max(1,Math.floor(playheadBar))}));},[open,playheadBar]);

  const sourceAvailable=Boolean(proposal || project.source?.notes?.length);
  const sourceName=proposal ? `${proposal.label} proposal` : project.source?.notes?.length ? `selected MIDI: ${project.source.trackName}` : 'none';
  const scaleLabel=useMemo(()=>SCALE_DEFINITIONS.find(s=>s.id===controls.scaleId)?.friendlyLabel||SCALE_DEFINITIONS.find(s=>s.id===controls.scaleId)?.label||controls.scaleId,[controls.scaleId]);

  function patch<K extends keyof ComposerControls>(key:K,value:ComposerControls[K],invalidate=false){
    setControls(prev=>{
      const next={...prev,[key]:value};
      if(key==='keyRoot'||key==='scaleId') next.keyLabel=`${NOTE_NAMES[next.keyRoot]} ${SCALE_DEFINITIONS.find(s=>s.id===next.scaleId)?.label||next.scaleId}`;
      return next;
    });
    setProposal(null); setLastAcceptedTrackId(null);
    if(invalidate){setArrangement(null);setApproved(false);onArrangementApproved?.(null);}
  }

  async function proposePlan(){
    setBusy(true);setMessage('');setProposal(null);setApproved(false);onArrangementApproved?.(null);
    try{const result=await proposeComposerArrangement(controls,{...project,playheadBar});setArrangement(result.arrangement);setMessage('Arrangement proposed. Review it, then approve the plan before generating a part.');}
    catch(error){setMessage(error instanceof Error?error.message:'Could not propose arrangement.');}
    finally{setBusy(false);}
  }
  async function generate(action:ComposerAction='generate'){
    if(!arrangement||!approved)return;
    const src=proposal||null;
    if(action!=='generate'&&!src&&!project.source?.notes?.length){setMessage('Generate an idea or select a MIDI clip first.');return;}
    setBusy(true);setMessage('');
    try{
      const result=await generateComposerIdea({controls,arrangement,action,sourceProposal:src,project:{...project,playheadBar}});
      setProposal(result.proposal);
      if(action!=='continue_8_bars')setLastAcceptedTrackId(null);
      setMessage(`${roleLabel(result.proposal.role)} proposal ready. The DAW has not been changed.`);
    }catch(error){setMessage(error instanceof Error?error.message:'Composer generation failed.');}
    finally{setBusy(false);}
  }
  function accept(){
    if(!proposal)return;
    const target=proposal.action==='continue_8_bars'?(lastAcceptedTrackId||project.source?.trackId||null):null;
    const trackId=onAccept(proposal,target);
    setLastAcceptedTrackId(trackId);
    setMessage(target?`Accepted as a new MIDI clip on the existing ${roleLabel(proposal.role)} track. Undo remains available.`:`Accepted ${proposal.label} into the DAW as editable MIDI. Undo remains available.`);
  }

  if(!open)return null;
  return <aside className="absolute right-0 top-0 bottom-0 z-[76] w-[min(520px,96vw)] border-l border-white/10 bg-neutral-950/97 backdrop-blur-xl shadow-2xl flex flex-col">
    <div className="h-12 shrink-0 px-4 flex items-center gap-3 border-b border-white/10">
      <div className="min-w-0 flex-1"><div className="text-sm font-semibold">AI Composer</div><div className="truncate text-[10px] opacity-55">Structured musical data first · nothing enters the project until Accept</div></div>
      <button className="h-8 w-8 rounded-lg hover:bg-white/10" onClick={onClose} aria-label="Close AI Composer">×</button>
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
      <section className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
        <div className="flex items-center justify-between gap-2"><div><div className="text-xs font-semibold">Composer engine</div><div className="text-[10px] opacity-50">{status?.configured?`${status.provider} · ${status.model}`:'Server AI not configured yet'}</div></div><span className={`rounded-full px-2 py-1 text-[9px] ${status?.configured?'bg-emerald-500/15 text-emerald-200':'bg-amber-500/15 text-amber-200'}`}>{status?.configured?'READY':'NEEDS API KEY'}</span></div>
        <p className="mt-2 text-[10px] opacity-55">No deterministic fallback is mislabeled as AI. Until the server AI is configured, YSong will refuse generation rather than fake it.</p>
      </section>

      <section className="rounded-xl border border-white/10 p-3 space-y-3">
        <div className="text-[10px] uppercase tracking-[.18em] opacity-45">1 · Musical universe</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] opacity-70">Key<select className={`${input} mt-1`} value={controls.keyRoot} onChange={e=>patch('keyRoot',Number(e.target.value),true)}>{NOTE_NAMES.map((x,i)=><option value={i} key={x}>{x}</option>)}</select></label>
          <label className="text-[10px] opacity-70">Scale<select className={`${input} mt-1`} value={controls.scaleId} onChange={e=>patch('scaleId',e.target.value as MidiScaleId,true)}>{SCALE_DEFINITIONS.map(s=><option key={s.id} value={s.id}>{s.friendlyLabel||s.label}</option>)}</select></label>
          <label className="text-[10px] opacity-70">BPM<input className={`${input} mt-1`} type="number" min={20} max={400} value={controls.bpm} onChange={e=>patch('bpm',Number(e.target.value),true)}/></label>
          <label className="text-[10px] opacity-70">Meter<div className="mt-1 flex gap-1"><input className={input} type="number" min={1} max={32} value={controls.sigNum} onChange={e=>patch('sigNum',Number(e.target.value),true)}/><select className={input} value={controls.sigDen} onChange={e=>patch('sigDen',Number(e.target.value),true)}>{[1,2,4,8,16].map(v=><option key={v}>{v}</option>)}</select></div></label>
          <label className="text-[10px] opacity-70">Song bars<input className={`${input} mt-1`} type="number" min={4} max={512} value={controls.totalBars} onChange={e=>patch('totalBars',Number(e.target.value),true)}/></label>
          <label className="text-[10px] opacity-70">Generate bars<input className={`${input} mt-1`} type="number" min={1} max={64} value={controls.bars} onChange={e=>patch('bars',Number(e.target.value))}/></label>
        </div>
        <label className="block text-[10px] opacity-70">Mood<input className={`${input} mt-1`} value={controls.mood} onChange={e=>patch('mood',e.target.value,true)} placeholder="dark, euphoric, cinematic…"/></label>
        <label className="block text-[10px] opacity-70">Style / direction<textarea className={`${input} mt-1 min-h-[62px] resize-y`} value={controls.style} onChange={e=>patch('style',e.target.value,true)} placeholder="Gothic symphonic trance, staccato strings, strong kick/snare…"/></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[10px] opacity-70">Complexity · {Math.round(controls.complexity*100)}%<input className="mt-2 w-full" type="range" min={0} max={1} step={.05} value={controls.complexity} onChange={e=>patch('complexity',Number(e.target.value))}/></label>
          <label className="text-[10px] opacity-70">Humanization · {Math.round(controls.humanization*100)}%<input className="mt-2 w-full" type="range" min={0} max={1} step={.05} value={controls.humanization} onChange={e=>patch('humanization',Number(e.target.value))}/></label>
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] opacity-50"><span>{NOTE_NAMES[controls.keyRoot]} · {scaleLabel}</span><span>Selected MIDI source: {sourceName}</span></div>
        <button className={accent} disabled={busy||!status?.configured} onClick={()=>void proposePlan()}>{busy?'Working…':'Propose arrangement'}</button>
      </section>

      {arrangement&&<section className="rounded-xl border border-white/10 p-3 space-y-3">
        <div className="flex items-start justify-between gap-2"><div><div className="text-[10px] uppercase tracking-[.18em] opacity-45">2 · Arrangement proposal</div><div className="mt-1 text-sm font-semibold">{arrangement.title}</div></div><span className="rounded-full border border-white/10 px-2 py-1 text-[9px] opacity-60">{arrangement.totalBars} bars</span></div>
        <p className="text-xs opacity-65">{arrangement.summary}</p>
        <div className="flex flex-wrap gap-1">{arrangement.sections.map(s=><span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[9px]" key={`${s.name}-${s.startBar}`}>{s.name} · {n(s.startBar)}–{n(s.endBar)}</span>)}</div>
        <div className="grid grid-cols-2 gap-2">{arrangement.roles.map(r=><button key={r.role} onClick={()=>{patch('role',r.role);patch('startBar',r.entryBar);}} className={`rounded-lg border p-2 text-left ${controls.role===r.role?'border-fuchsia-400/40 bg-fuchsia-500/10':'border-white/10 hover:bg-white/[0.05]'}`}><div className="text-xs font-medium">{r.label}</div><div className="mt-1 text-[9px] opacity-50">bars {n(r.entryBar)}–{n(r.endBar)} · priority {r.priority}/5</div><div className="mt-1 text-[10px] opacity-65">{r.purpose}</div></button>)}</div>
        {!approved?<button className={accent} onClick={()=>{setApproved(true);onArrangementApproved?.(arrangement);setMessage('Plan approved. You can now generate one editable role at a time.');}}>Approve plan</button>:<div className="flex items-center gap-2 text-[10px] text-emerald-300"><span>✓</span><span>Plan approved. This still has not created any tracks.</span></div>}
      </section>}

      {arrangement&&approved&&<section className="rounded-xl border border-white/10 p-3 space-y-3">
        <div className="text-[10px] uppercase tracking-[.18em] opacity-45">3 · Generate one role</div>
        <div className="grid grid-cols-[1fr_110px_110px] gap-2">
          <select className={input} value={controls.role} onChange={e=>patch('role',e.target.value as ComposerRole)}>{COMPOSER_ROLES.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select>
          <label className="text-[9px] opacity-55">Start bar<input className={`${input} mt-1`} type="number" min={1} max={512} value={controls.startBar} onChange={e=>patch('startBar',Number(e.target.value))}/></label>
          <label className="text-[9px] opacity-55">Bars<input className={`${input} mt-1`} type="number" min={1} max={64} value={controls.bars} onChange={e=>patch('bars',Number(e.target.value))}/></label>
        </div>
        <button className={accent} disabled={busy} onClick={()=>void generate('generate')}>{busy?'Generating…':`Generate ${roleLabel(controls.role)}`}</button>
        {!proposal&&project.source?.notes?.length? <div className="rounded-lg border border-cyan-400/15 bg-cyan-500/[0.05] p-2"><div className="mb-2 text-[10px] text-cyan-100/75">Derive from selected MIDI without overwriting it</div><div className="flex flex-wrap gap-1.5"><button className={button} disabled={busy} onClick={()=>void generate('continue_8_bars')}>Continue 8 bars</button><button className={button} disabled={busy} onClick={()=>void generate('harmony')}>Generate harmony</button><button className={button} disabled={busy} onClick={()=>void generate('bass_from_this')}>Bass from this</button></div></div>:null}
        {proposal&&<>
          <PianoPreview proposal={proposal}/>
          <div className="rounded-lg bg-white/[0.035] p-2 text-xs"><div className="font-medium">{proposal.label}</div><div className="mt-1 opacity-60">{proposal.explanation||'Structured editable MIDI proposal.'}</div>{proposal.generationNotes&&<div className="mt-1 text-[10px] opacity-45">{proposal.generationNotes}</div>}{proposal.chords.length>0&&<div className="mt-2 flex flex-wrap gap-1">{proposal.chords.map((c,i)=><span key={`${c.atBars}-${i}`} className="rounded bg-black/30 px-1.5 py-0.5 text-[9px]">{c.symbol} @{n(c.atBars,2)}</span>)}</div>}</div>
          <div className="flex flex-wrap gap-1.5">{ACTIONS.map(a=><button className={button} key={a.id} disabled={busy||(a.requiresSource&&!sourceAvailable)} onClick={()=>void generate(a.id)}>{a.label}</button>)}</div>
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] p-3"><div className="text-xs font-semibold text-emerald-100">Accept is the mutation boundary</div><p className="mt-1 text-[10px] opacity-60">Until you press this button, the proposal exists only in the Composer panel. Accept adds editable MIDI and can immediately be undone with normal DAW Undo.</p><button className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-500/25" onClick={accept}>Accept into DAW</button></div>
        </>}
      </section>}
      {message&&<div className="rounded-xl border border-white/10 bg-white/[0.035] p-3 text-xs opacity-75">{message}</div>}
    </div>
  </aside>;
}
