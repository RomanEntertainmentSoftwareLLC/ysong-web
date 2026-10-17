import { useEffect, useMemo, useState } from 'react';
import { useTabManager } from '../tabs/core';
import { hydrateJobProject, jobAction, loadSessionJobs, progressOf, type SessionJob } from '../lib/sessionJobs';
export default function GenerationJobs() {
  const [jobs,setJobs]=useState<SessionJob[]>([]),[error,setError]=useState('');
  const [query,setQuery]=useState(''),[statusFilter,setStatusFilter]=useState('all'),[dateFilter,setDateFilter]=useState('all'),[sortOrder,setSortOrder]=useState('newest'),[favoritesOnly,setFavoritesOnly]=useState(false),[favorites,setFavorites]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem('ysong:generation-favorites:v1')??'[]') as string[];}catch{return [];}});
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
  function toggleFavorite(id:string) {
    setFavorites(current=>{const next=current.includes(id)?current.filter(item=>item!==id):[...current,id];localStorage.setItem('ysong:generation-favorites:v1',JSON.stringify(next));return next;});
  }
  const visibleJobs=useMemo(()=>{
    const needle=query.trim().toLocaleLowerCase();
    const now=Date.now(),cutoff=dateFilter==='7d'?now-7*86400000:dateFilter==='30d'?now-30*86400000:dateFilter==='year'?now-365*86400000:0;
    return jobs.filter(job=>{
      if(statusFilter!=='all'&&job.state!==statusFilter)return false;
      if(cutoff&&Date.parse(job.created_at)<cutoff)return false;
      if(favoritesOnly&&!favorites.includes(job.id))return false;
      if(!needle)return true;
      const searchable=[job.source.plan.projectName,job.source.prompt,job.source.lyrics,job.state,job.provider,job.model,job.model_version,job.batch_id,job.id,job.project_id,job.parent_generation_id,job.source.lineageRootId,...job.source.plan.tracks.flatMap(track=>[track.name,track.id,track.mode])].filter(Boolean).join(' ').toLocaleLowerCase();
      return searchable.includes(needle);
    }).sort((a,b)=>sortOrder==='oldest'?Date.parse(a.created_at)-Date.parse(b.created_at):sortOrder==='title'?a.source.plan.projectName.localeCompare(b.source.plan.projectName):Date.parse(b.created_at)-Date.parse(a.created_at));
  },[jobs,query,statusFilter,dateFilter,sortOrder,favoritesOnly,favorites]);
  if(!jobs.length&&!error)return null;
  return <section className="space-y-2 rounded-xl border border-white/10 p-3"><strong>Generation History</strong>
    {error&&<p role="alert" className="text-red-300 text-sm">{error}</p>}
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" role="search" aria-label="Filter generation history">
      <input type="search" aria-label="Search generations" placeholder="Search title, prompt, tags, singer, project, provider…" value={query} onChange={e=>setQuery(e.target.value)} className="rounded border border-white/15 bg-transparent px-2 py-1 sm:col-span-2"/>
      <select aria-label="Filter by status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="rounded border border-white/15 bg-transparent px-2 py-1"><option value="all">All statuses</option>{[...new Set(jobs.map(job=>job.state))].sort().map(status=><option key={status} value={status}>{status}</option>)}</select>
      <select aria-label="Filter by date" value={dateFilter} onChange={e=>setDateFilter(e.target.value)} className="rounded border border-white/15 bg-transparent px-2 py-1"><option value="all">Any date</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="year">Last year</option></select>
      <select aria-label="Sort generations" value={sortOrder} onChange={e=>setSortOrder(e.target.value)} className="rounded border border-white/15 bg-transparent px-2 py-1"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option></select>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={favoritesOnly} onChange={e=>setFavoritesOnly(e.target.checked)}/>Favorites only</label>
    </div>
    <p className="text-xs opacity-60" aria-live="polite">Showing {visibleJobs.length} of {jobs.length} generations</p>
    {!visibleJobs.length&&<p className="py-3 text-sm opacity-70">No generations match these filters.</p>}
    {visibleJobs.map(job=>{const progress=progressOf(job);return <div key={job.id} className="border-t border-white/10 py-2 text-sm space-y-2">
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
        <button aria-pressed={favorites.includes(job.id)} onClick={()=>toggleFavorite(job.id)}>{favorites.includes(job.id)?'★ Favorited':'☆ Favorite'}</button>
        <button aria-pressed={job.feedback===1} onClick={()=>void action(job,'feedback',{feedback:job.feedback===1?null:1})}>Thumbs up</button>
        <button aria-pressed={job.feedback===-1} onClick={()=>void action(job,'feedback',{feedback:job.feedback===-1?null:-1})}>Thumbs down</button>
        {job.state==='queued'&&<button onClick={()=>void action(job,'cancel')}>Cancel version</button>}
        {['failed','partially_ready'].includes(job.state)&&!progress.review&&Object.values(job.execution?.parts??{}).some(p=>p.state==='failed')&&<button onClick={()=>void action(job,'retry')}>Retry unavailable parts</button>}
        {job.state==='failed'&&!progress.review&&progress.done>0&&<button onClick={()=>void action(job,'retry-finalization')}>Retry saving project</button>}
      </div>
    </div>;})}
  </section>;
}
