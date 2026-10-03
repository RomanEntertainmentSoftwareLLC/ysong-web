import { useEffect, useState } from 'react';
import { useTabManager } from '../tabs/core';
import { hydrateJobProject, jobAction, loadSessionJobs, progressOf, type SessionJob } from '../lib/sessionJobs';
export default function GenerationJobs() {
  const [jobs,setJobs]=useState<SessionJob[]>([]),[error,setError]=useState('');
  const {tabs,openTab,activateTab,updateTab}=useTabManager();
  useEffect(()=>{
    let alive=true;
    const refresh=()=>{void loadSessionJobs().then(j=>{if(alive){setJobs(j);setError('');}}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Could not load generation jobs');});};
    refresh();const timer=window.setInterval(refresh,5000);window.addEventListener('ysong:jobs-submitted',refresh);
    return()=>{alive=false;window.clearInterval(timer);window.removeEventListener('ysong:jobs-submitted',refresh);};
  },[]);
  async function open(job:SessionJob) {
    try {const id=await hydrateJobProject(job.id);const request={id,requestId:crypto.randomUUID()};const tab=tabs.find(t=>t.type==='daw');
      if(tab){updateTab(tab.id,{payload:{...tab.payload,localProjectOpenRequest:request}});activateTab(tab.id);}
      else openTab({type:'daw',title:'DAW',pinned:true,payload:{localProjectOpenRequest:request}});
    } catch(e){setError(e instanceof Error?e.message:'Could not open project');}
  }
  function reuse(job:SessionJob,variation:boolean) {
    const request={prompt:job.source.prompt,lyrics:job.source.lyrics,title:job.source.plan.projectName,parentId:variation?job.id:undefined,requestId:crypto.randomUUID()};
    const tab=tabs.find(t=>t.type==='createSong');
    if(tab){updateTab(tab.id,{payload:{...tab.payload,reuseGeneration:request}});activateTab(tab.id);}
    else openTab({type:'createSong',title:'Create Song',pinned:true,payload:{reuseGeneration:request}});
  }
  async function action(job:SessionJob,name:string,body:Record<string,unknown>={}) {
    try {await jobAction(job.id,name,body);setJobs(await loadSessionJobs());}catch(e){setError(e instanceof Error?e.message:'Generation action failed');}
  }
  if(!jobs.length&&!error)return null;
  return <section className="space-y-2 rounded-xl border border-white/10 p-3"><strong>Generation History</strong>
    {error&&<p role="alert" className="text-red-300 text-sm">{error}</p>}
    {jobs.map(job=>{const progress=progressOf(job);return <div key={job.id} className="border-t border-white/10 py-2 text-sm space-y-2">
      <div>{job.source.plan.projectName} · Version {job.version_index} / {job.quantity} · {job.state}</div>
      <div className="text-xs opacity-70">Batch progress: {jobs.filter(j=>j.batch_id===job.batch_id).reduce((n,j)=>n+progressOf(j).done,0)} / {jobs.filter(j=>j.batch_id===job.batch_id).reduce((n,j)=>n+progressOf(j).total,0)} saved work units</div>
      <progress value={progress.done} max={progress.total} aria-label={`Version ${job.version_index} progress`}/><span> {progress.percent}% · {job.execution?.message??'Queued'}</span>
      <div className="text-xs opacity-60">{job.provider??'Provider pending'} · {job.model??'Model pending'} · {new Date(job.created_at).toLocaleString()} · Batch {job.batch_id}</div>
      <details className="text-xs"><summary>Generation settings and provenance</summary><pre className="overflow-auto max-h-64 whitespace-pre-wrap">{JSON.stringify({generationId:job.id,batchId:job.batch_id,version:job.version_index,projectId:job.project_id,parentId:job.parent_generation_id,quantity:job.quantity,provider:job.provider,model:job.model,modelVersion:job.model_version,source:job.source,parts:job.execution?.parts},null,2)}</pre></details>
      {progress.review&&<p className="text-amber-300">A provider or storage response was interrupted. Retained parts are safe; the uncertain render needs review before another paid call.</p>}
      {Object.entries(job.execution?.parts??{}).filter(([,p])=>p.error).map(([id,p])=><p key={id} className="text-xs text-amber-300">{job.source.plan.tracks.find(t=>t.id===id)?.name??id}: {p.error}</p>)}
      <div className="flex flex-wrap gap-3">
        {job.execution?.saved&&<button onClick={()=>void open(job)}>Open Project / DAW</button>}
        <button onClick={()=>reuse(job,false)}>Reuse Prompt</button><button onClick={()=>reuse(job,true)}>Create Variation</button>
        <button aria-pressed={job.feedback===1} onClick={()=>void action(job,'feedback',{feedback:job.feedback===1?null:1})}>Thumbs up</button>
        <button aria-pressed={job.feedback===-1} onClick={()=>void action(job,'feedback',{feedback:job.feedback===-1?null:-1})}>Thumbs down</button>
        {job.state==='queued'&&<button onClick={()=>void action(job,'cancel')}>Cancel version</button>}
        {['failed','partially_ready'].includes(job.state)&&!progress.review&&Object.values(job.execution?.parts??{}).some(p=>p.state==='failed')&&<button onClick={()=>void action(job,'retry')}>Retry unavailable parts</button>}
        {job.state==='failed'&&!progress.review&&progress.done>0&&<button onClick={()=>void action(job,'retry-finalization')}>Retry saving project</button>}
      </div>
    </div>;})}
  </section>;
}
