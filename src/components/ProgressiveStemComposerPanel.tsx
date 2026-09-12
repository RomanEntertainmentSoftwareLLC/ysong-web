import { useEffect, useState } from 'react';
import { NOTE_NAMES, SCALE_DEFINITIONS, type MidiScaleId } from '../lib/midi';
import {
  STEM_ROLES, generateAudioStem, generateMidiStem, getSignedAssetUrl, getStemComposerStatus, lockStemUniverse, staleDependents,
  type ProgressiveStemState, type StemComposerStatus, type StemDependency, type StemMode, type StemNode, type StemProposal, type StemRole, type StemSection, type StemChord,
} from '../lib/progressiveStemComposer';

type UniverseSeed={projectId:string;projectName:string;bpm:number;sigNum:number;sigDen:number;totalBars:number;keyRoot:number;scaleId:MidiScaleId;sectionMap:StemSection[];chordMap:StemChord[]};
type Props={
  open:boolean; onClose:()=>void; seed:UniverseSeed; state:ProgressiveStemState; onStateChange:(next:ProgressiveStemState)=>void;
  dependencySources:Record<string,Partial<StemDependency>>;
  onAccept:(proposal:StemProposal,previous:StemNode|null)=>Promise<{clipId:string;trackId:string;assetId?:string;stemNodeId?:string}>|{clipId:string;trackId:string;assetId?:string;stemNodeId?:string};
};
const input='w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs outline-none focus:border-fuchsia-400/40';
const button='rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] hover:bg-white/[0.08] disabled:opacity-40';
const accent='rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/15 px-3 py-2 text-xs text-fuchsia-100 hover:bg-fuchsia-500/25 disabled:opacity-40';
function roleLabel(role:StemRole){return STEM_ROLES.find(r=>r.id===role)?.label||role;}
function modeFor(role:StemRole){return STEM_ROLES.find(r=>r.id===role)?.preferred||'midi';}

export default function ProgressiveStemComposerPanel({open,onClose,seed,state,onStateChange,dependencySources,onAccept}:Props){
  const [status,setStatus]=useState<StemComposerStatus|null>(null); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  const [keyRoot,setKeyRoot]=useState(seed.keyRoot); const [scaleId,setScaleId]=useState<MidiScaleId>(seed.scaleId); const [sampleRate,setSampleRate]=useState(48000);
  const [family,setFamily]=useState(()=>`family_${crypto.randomUUID().slice(0,8)}`); const [seedText,setSeedText]=useState(()=>crypto.randomUUID().replace(/-/g,'').slice(0,16));
  const [role,setRole]=useState<StemRole>('drums'); const [mode,setMode]=useState<StemMode>('midi'); const [desired,setDesired]=useState(''); const [negative,setNegative]=useState('');
  const [selectedDeps,setSelectedDeps]=useState<Set<string>>(new Set()); const [proposal,setProposal]=useState<StemProposal|null>(null);

  useEffect(()=>{if(open)getStemComposerStatus().then(setStatus).catch(()=>setStatus(null));},[open]);
  useEffect(()=>{if(!state.universe){setKeyRoot(seed.keyRoot);setScaleId(seed.scaleId);} },[seed.keyRoot,seed.scaleId,state.universe]);
  useEffect(()=>{const existing=state.nodes.find(n=>n.role===role);setMode(existing?.mode??modeFor(role));setProposal(null);setSelectedDeps(new Set(state.nodes.filter(n=>n.role!==role&&n.status==='active').map(n=>n.nodeId)));},[role,state.nodes]);

  const activeForRole=state.nodes.find(n=>n.role===role)??null;
  const nextVersion=(activeForRole?.version??0)+1;
  const generationSeed=`${state.universe?.generationSeed||seedText}:${role}:${nextVersion}`;
  const durationText=state.universe?`${state.universe.exactDurationSec.toFixed(2)} sec · ${state.universe.totalBars} bars`:'';
  const stale=state.nodes.filter(n=>n.status==='stale');
  const universeDrift=Boolean(state.universe&&(state.universe.songId!==seed.projectId||Math.abs(state.universe.bpm-seed.bpm)>1e-9||state.universe.sigNum!==seed.sigNum||state.universe.sigDen!==seed.sigDen||state.universe.totalBars!==seed.totalBars));

  async function lockUniverse(){
    setBusy(true);setMessage('');try{
      const keyLabel=`${NOTE_NAMES[keyRoot]} ${SCALE_DEFINITIONS.find(s=>s.id===scaleId)?.friendlyLabel||scaleId}`;
      const {universe}=await lockStemUniverse({songId:seed.projectId,generationFamily:family,generationSeed:seedText,bpm:seed.bpm,keyRoot,keyLabel,scaleId,sigNum:seed.sigNum,sigDen:seed.sigDen,totalBars:seed.totalBars,sampleRate,sectionMap:seed.sectionMap,chordMap:seed.chordMap});
      onStateChange({universe,nodes:[],activeByRole:{}});setMessage('Song universe locked. BPM, key, meter, duration, sample rate, sections, chords, family, and seed are now immutable for this stem family.');
    }catch(e){setMessage(e instanceof Error?e.message:'Could not lock song universe.');}finally{setBusy(false);}
  }
  async function dependencyPayload(){
    const deps:StemDependency[]=[];
    for(const node of state.nodes){if(!selectedDeps.has(node.nodeId)||node.role===role)continue;const src=dependencySources[node.nodeId]||{};let audioUrl=src.audioUrl;
      if(node.mode==='audio'&&src.assetId&&!audioUrl){try{audioUrl=(await getSignedAssetUrl(src.assetId)).url;}catch{/* provider may still work from MIDI/text deps */}}
      deps.push({nodeId:node.nodeId,role:node.role,mode:node.mode,version:node.version,universeHash:node.universeHash,label:node.label,notes:src.notes||[],assetId:src.assetId,audioUrl,summary:node.summary});
    }
    return deps;
  }
  async function generate(){
    if(!state.universe)return;setBusy(true);setMessage('');setProposal(null);try{
      const dependencies=await dependencyPayload();const negativeList=negative.split(',').map(x=>x.trim()).filter(Boolean);
      if(mode==='midi'){
        if(!status?.structuredMidiConfigured)throw new Error('Server AI is not configured yet for structured MIDI stem generation.');
        const r=await generateMidiStem({universe:state.universe,targetRole:role,mode:'midi',desired,negative:negativeList,dependencies,version:nextVersion,generationSeed});setProposal(r.proposal);
      }else{
        if(!status?.audioProviderConfigured)throw new Error('No target-stem audio generation provider is configured yet. The contract is ready, but YSong will not fake an audio stem.');
        const r=await generateAudioStem({universe:state.universe,targetRole:role,mode:'audio',desired,negative:negativeList,dependencies,version:nextVersion,generationSeed});setProposal(r.proposal);
      }
    }catch(e){setMessage(e instanceof Error?e.message:'Stem generation failed.');}finally{setBusy(false);}
  }
  async function accept(){
    if(!proposal||!state.universe)return;setBusy(true);setMessage('');try{
      const previous=activeForRole;const refs=await onAccept(proposal,previous);const stableNodeId=refs.stemNodeId||previous?.nodeId||crypto.randomUUID();
      const nextNode:StemNode={nodeId:stableNodeId,role:proposal.role,mode:proposal.mode,version:proposal.version,label:proposal.label,universeHash:proposal.universeHash,generationFamily:proposal.generationFamily,generationSeed:proposal.generationSeed,dependsOn:proposal.dependsOn,clipId:refs.clipId,trackId:refs.trackId,assetId:refs.assetId,status:'active',createdAt:new Date().toISOString(),summary:proposal.mode==='midi'?proposal.explanation:`Generated ${proposal.role} target-only audio stem`};
      let nodes=state.nodes.filter(n=>n.role!==proposal.role).concat(nextNode);
      if(previous){const staleIds=staleDependents(nodes,stableNodeId,nextNode.version);nodes=nodes.map(n=>staleIds.has(n.nodeId)?{...n,status:'stale'}:n);}
      const activeByRole={...state.activeByRole,[proposal.role]:stableNodeId};onStateChange({universe:state.universe,nodes,activeByRole});setProposal(null);
      const affected=nodes.filter(n=>n.status==='stale');setMessage(affected.length?`${roleLabel(proposal.role)} v${proposal.version} accepted. ${affected.map(n=>roleLabel(n.role)).join(', ')} were generated from an older dependency. Regenerate them?`:`${roleLabel(proposal.role)} v${proposal.version} accepted into the DAW.`);
    }catch(e){setMessage(e instanceof Error?e.message:'Could not accept stem.');}finally{setBusy(false);}
  }
  function resetFamily(){if(!window.confirm('Start a new stem-generation family? Existing DAW clips remain, but the Progressive Stem dependency graph will be reset.'))return;onStateChange({universe:null,nodes:[],activeByRole:{}});setProposal(null);setFamily(`family_${crypto.randomUUID().slice(0,8)}`);setSeedText(crypto.randomUUID().replace(/-/g,'').slice(0,16));setMessage('Stem family reset. Existing project audio/MIDI was not deleted.');}

  if(!open)return null;
  return <aside className="absolute right-0 top-0 bottom-0 z-[79] w-[min(560px,97vw)] border-l border-white/10 bg-neutral-950/97 backdrop-blur-xl shadow-2xl flex flex-col">
    <div className="h-12 shrink-0 px-4 flex items-center gap-3 border-b border-white/10"><div className="min-w-0 flex-1"><div className="text-sm font-semibold">Progressive AI Stem Composer</div><div className="truncate text-[10px] opacity-55">One target stem at a time · approved dependencies · absolute timeline sync</div></div><button className="h-8 w-8 rounded-lg hover:bg-white/10" onClick={onClose}>×</button></div>
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
      <section className="rounded-xl border border-white/10 bg-white/[0.035] p-3"><div className="flex items-center justify-between"><div><div className="text-xs font-semibold">Generation capability</div><div className="mt-1 text-[10px] opacity-55">MIDI AI: {status?.structuredMidiConfigured?'ready':'needs API key'} · Audio target-stem model: {status?.audioProviderConfigured?status.audioProviderName:'not configured'}</div></div><span className="rounded-full bg-cyan-500/10 px-2 py-1 text-[9px] text-cyan-200">TARGET ONLY</span></div><p className="mt-2 text-[10px] opacity-55">YSong never generates a full mix and stem-splits it afterward. Audio generation remains disabled until a real target-stem provider exists.</p></section>

      {!state.universe?<section className="rounded-xl border border-white/10 p-3 space-y-3"><div className="text-[10px] uppercase tracking-[.18em] opacity-45">1 · Lock immutable song universe</div>
        <div className="grid grid-cols-2 gap-2"><label className="text-[10px] opacity-70">Key<select className={`${input} mt-1`} value={keyRoot} onChange={e=>setKeyRoot(Number(e.target.value))}>{NOTE_NAMES.map((x,i)=><option key={x} value={i}>{x}</option>)}</select></label><label className="text-[10px] opacity-70">Scale<select className={`${input} mt-1`} value={scaleId} onChange={e=>setScaleId(e.target.value as MidiScaleId)}>{SCALE_DEFINITIONS.map(s=><option key={s.id} value={s.id}>{s.friendlyLabel||s.label}</option>)}</select></label><label className="text-[10px] opacity-70">Sample rate<select className={`${input} mt-1`} value={sampleRate} onChange={e=>setSampleRate(Number(e.target.value))}>{[44100,48000,88200,96000].map(v=><option key={v} value={v}>{v.toLocaleString()} Hz</option>)}</select></label><label className="text-[10px] opacity-70">Timeline<div className="mt-1 rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-xs">{seed.bpm} BPM · {seed.sigNum}/{seed.sigDen} · {seed.totalBars} bars</div></label></div>
        <label className="block text-[10px] opacity-70">Generation family<input className={`${input} mt-1`} value={family} onChange={e=>setFamily(e.target.value)}/></label><label className="block text-[10px] opacity-70">Family seed<input className={`${input} mt-1 font-mono`} value={seedText} onChange={e=>setSeedText(e.target.value)}/></label>
        <div className="rounded-lg bg-white/[0.035] p-2 text-[10px] opacity-60">Section map: {seed.sectionMap.length?`${seed.sectionMap.length} approved sections`:'empty'} · Chord map: {seed.chordMap.length?`${seed.chordMap.length} events`:'empty'}. Empty maps remain immutably empty for this family; YSong does not invent them.</div>
        <button className={accent} disabled={busy} onClick={()=>void lockUniverse()}>{busy?'Locking…':'Lock song universe'}</button></section>:
      <>
        <section className="rounded-xl border border-emerald-400/15 bg-emerald-500/[0.04] p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-[10px] uppercase tracking-[.18em] text-emerald-200/70">Locked universe</div><div className="mt-1 text-xs font-semibold">{state.universe.keyLabel} · {state.universe.bpm} BPM · {state.universe.sigNum}/{state.universe.sigDen}</div><div className="mt-1 text-[10px] opacity-55">{durationText} · {(state.universe.sampleRate/1000).toFixed(state.universe.sampleRate%1000?1:0)} kHz · family {state.universe.generationFamily}</div><div className="mt-1 truncate font-mono text-[9px] opacity-35">{state.universe.universeHash}</div></div><button className={button} onClick={resetFamily}>New family</button></div></section>

        <section className="rounded-xl border border-white/10 p-3 space-y-3"><div className="text-[10px] uppercase tracking-[.18em] opacity-45">2 · Choose ONE target stem</div>
          <div className="grid grid-cols-2 gap-2"><label className="text-[10px] opacity-70">Target<select className={`${input} mt-1`} value={role} onChange={e=>setRole(e.target.value as StemRole)}>{STEM_ROLES.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label><label className="text-[10px] opacity-70">Output<select className={`${input} mt-1`} value={mode} onChange={e=>setMode(e.target.value as StemMode)}><option value="midi">Editable MIDI + instrument</option><option value="audio">Generated audio stem</option></select></label></div>
          <label className="block text-[10px] opacity-70">Direction<textarea className={`${input} mt-1 min-h-[64px] resize-y`} value={desired} onChange={e=>setDesired(e.target.value)} placeholder="Driving bass that locks to the approved drums; leave space for the vocal…"/></label><label className="block text-[10px] opacity-70">Avoid (comma separated)<input className={`${input} mt-1`} value={negative} onChange={e=>setNegative(e.target.value)} placeholder="muddy, busy midrange, duplicate lead melody"/></label>
          <div><div className="mb-2 flex items-center justify-between text-[10px]"><span className="opacity-70">Condition on approved stems</span><button className="opacity-55 hover:opacity-100" onClick={()=>setSelectedDeps(new Set(state.nodes.filter(n=>n.role!==role&&n.status==='active').map(n=>n.nodeId)))}>Select all</button></div>{state.nodes.filter(n=>n.role!==role).length===0?<div className="rounded-lg border border-dashed border-white/10 p-3 text-[10px] opacity-45">No approved stems yet. This can be the first generation in the family.</div>:<div className="space-y-1">{state.nodes.filter(n=>n.role!==role).map(n=><label key={n.nodeId} className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-[10px] ${n.status==='stale'?'border-amber-400/25 bg-amber-500/[0.05]':'border-white/10'}`}><input type="checkbox" checked={selectedDeps.has(n.nodeId)} onChange={e=>setSelectedDeps(prev=>{const next=new Set(prev);if(e.target.checked)next.add(n.nodeId);else next.delete(n.nodeId);return next;})}/><span className="flex-1">{roleLabel(n.role)} v{n.version}</span><span className="opacity-45">{n.mode}</span>{n.status==='stale'&&<span className="text-amber-300">STALE</span>}</label>)}</div>}</div>
          {universeDrift&&<div className="rounded-lg border border-red-400/25 bg-red-500/[0.06] p-2 text-[10px] text-red-100">The DAW timeline no longer matches this locked universe (tempo, meter, duration, or project ID changed). Restore the locked timeline or start a new generation family before creating another stem.</div>}
          <div className="flex items-center justify-between text-[10px] opacity-55"><span>{roleLabel(role)} v{nextVersion}</span><span className="font-mono">seed {generationSeed.slice(-28)}</span></div><button className={accent} disabled={busy||universeDrift||(mode==='midi'?!status?.structuredMidiConfigured:!status?.audioProviderConfigured)} onClick={()=>void generate()}>{busy?'Generating…':`Generate ${roleLabel(role)} ONLY`}</button>
        </section>

        {proposal&&<section className="rounded-xl border border-fuchsia-400/20 bg-fuchsia-500/[0.045] p-3 space-y-3"><div className="flex items-center justify-between"><div><div className="text-[10px] uppercase tracking-[.18em] opacity-45">3 · Target-stem proposal</div><div className="mt-1 text-sm font-semibold">{proposal.label} · v{proposal.version}</div></div><span className="rounded-full border border-fuchsia-400/25 px-2 py-1 text-[9px]">{proposal.mode.toUpperCase()}</span></div><div className="grid grid-cols-3 gap-2 text-center text-[10px]"><div className="rounded-lg bg-black/20 p-2"><div className="opacity-45">Start</div><div>0.000 sec / bar 1</div></div><div className="rounded-lg bg-black/20 p-2"><div className="opacity-45">Length</div><div>{proposal.exactDurationSec.toFixed(3)} sec</div></div><div className="rounded-lg bg-black/20 p-2"><div className="opacity-45">Dependencies</div><div>{proposal.dependsOn.length}</div></div></div>{proposal.mode==='midi'?<><div className="text-[10px] opacity-65">{proposal.notes.length} editable MIDI notes · full {proposal.lengthBars}-bar clip with silence preserved where no notes exist.</div><p className="text-xs opacity-65">{proposal.explanation}</p></>:<div className="text-[10px] opacity-65">Target-only normalized WAV · {proposal.sampleRate.toLocaleString()} Hz · stereo · exact timeline duration.</div>}<div className="rounded-lg border border-emerald-400/20 bg-emerald-500/[0.06] p-3"><div className="text-xs font-semibold text-emerald-100">Accept is the mutation boundary</div><p className="mt-1 text-[10px] opacity-60">A replacement updates only this generated stem. Any dependent stems generated from the previous version will be marked stale, not silently regenerated.</p><button className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-500/25" disabled={busy} onClick={()=>void accept()}>Accept {roleLabel(proposal.role)} v{proposal.version}</button></div></section>}

        <section className="rounded-xl border border-white/10 p-3"><div className="flex items-center justify-between"><div className="text-[10px] uppercase tracking-[.18em] opacity-45">Dependency graph</div><span className="text-[9px] opacity-45">{state.nodes.length} approved stems</span></div>{state.nodes.length===0?<div className="mt-3 text-[10px] opacity-45">No approved generated stems yet.</div>:<div className="mt-2 space-y-2">{state.nodes.map(n=><div key={n.nodeId} className={`rounded-lg border p-2 ${n.status==='stale'?'border-amber-400/25 bg-amber-500/[0.05]':'border-white/10 bg-white/[0.025]'}`}><div className="flex items-center gap-2 text-xs"><span className="font-medium">{roleLabel(n.role)} v{n.version}</span><span className="text-[9px] opacity-45">{n.mode}</span><span className="ml-auto text-[9px]">{n.status==='stale'?<span className="text-amber-300">REGENERATE?</span>:<span className="text-emerald-300">APPROVED</span>}</span></div><div className="mt-1 text-[9px] opacity-45">depends on {n.dependsOn.length?n.dependsOn.map(d=>`${roleLabel(d.role)} v${d.version}`).join(' + '):'song universe only'}</div>{n.status==='stale'&&<button className={`${button} mt-2`} onClick={()=>{setRole(n.role);setMode(n.mode);setSelectedDeps(new Set(state.nodes.filter(x=>x.nodeId!==n.nodeId&&x.status==='active').map(x=>x.nodeId)));setMessage(`${roleLabel(n.role)} was generated from an older dependency. Review dependencies and regenerate when ready.`);}}>Prepare regeneration</button>}</div>)}</div>}</section>
      </>}
      {stale.length>0&&<div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.06] p-3 text-[10px] text-amber-100">Dependent stems from older versions: {stale.map(n=>`${roleLabel(n.role)} v${n.version}`).join(', ')}. YSong will never regenerate these automatically.</div>}
      {message&&<div className="rounded-xl border border-white/10 bg-white/[0.035] p-3 text-xs opacity-75">{message}</div>}
    </div>
  </aside>;
}
