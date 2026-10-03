import { apiGet, apiPost } from './authApi';
import { upsertGeneration } from './generationLibrary';
export type SessionJob = {
  id:string; batch_id:string; project_id:string; version_index:number; quantity:number; state:string; feedback:number|null;
  created_at:string; updated_at:string; provider:string|null; model:string|null; model_version:string|null; parent_generation_id:string|null;
  source:{kind?:string;prompt:string;lyrics:string;lineageRootId?:string;lineageVersion?:number;plan:{projectName:string;tracks:Array<{id:string;name:string;mode:string}>}};
  execution:{saved?:boolean;message?:string;parts:Record<string,{state:string;objectKey?:string;error?:string}>}|null;
};
export function progressOf(job:SessionJob) {
  const parts=Object.values(job.execution?.parts??{});
  const total=job.source.plan.tracks.length+1;
  const done=parts.filter(p=>p.state==='ready').length+(job.execution?.saved?1:0);
  return {done,total,percent:Math.floor(100*done/total),review:parts.some(p=>p.state==='ambiguous')};
}
export async function loadSessionJobs():Promise<SessionJob[]> {
  const entitlement=await apiGet<{enabled:boolean}>('/api/account/entitlements');
  if(!entitlement.enabled)return [];
  const jobs=(await apiGet<{generations:SessionJob[]}>('/api/generations/history')).generations.filter(j=>j.source?.kind==='session');
  for(const j of jobs) upsertGeneration({id:j.id,title:`${j.source.plan.projectName} · Version ${j.version_index}`,createdAt:Date.parse(j.created_at),updatedAt:Date.parse(j.updated_at),
    status:j.state==='ready'?'succeeded':j.state==='partially_ready'?'partial':j.state==='failed'?'failed':j.state==='cancelled'?'cancelled':j.state==='queued'?'queued':'running',
    source:{prompt:j.source.prompt,lyrics:j.source.lyrics,origin:'server-session'},
    artifacts:[...(j.execution?.saved?[{id:j.project_id,kind:'project' as const,label:'Editable project',projectId:j.project_id}]:[]),
      ...Object.entries(j.execution?.parts??{}).filter(([,p])=>p.objectKey).map(([id,p])=>({id:`${j.id}-${id}`,kind:'audio' as const,label:j.source.plan.tracks.find(t=>t.id===id)?.name??id,objectKey:p.objectKey}))],
    ...(j.parent_generation_id?{lineage:{rootId:j.source.lineageRootId??j.parent_generation_id,parentId:j.parent_generation_id,version:j.source.lineageVersion??j.version_index,operation:'variation' as const,sourceReferences:{generationId:j.parent_generation_id,artifactIds:[],prompt:j.source.prompt}}}:{}),
    ...(j.state==='failed'?{error:j.execution?.message??'Generation failed'}:{})});
  return jobs;
}
export async function hydrateJobProject(id:string) {
  const data=await apiGet<{projectId:string;name:string;project:Record<string,unknown>}>(`/api/generations/${encodeURIComponent(id)}/project`);
  const key=`ysong:daw:${data.projectId}`;
  // Existing local edits take precedence; this is hydration, never a destructive import.
  if(!localStorage.getItem(key)) {
    localStorage.setItem(key,JSON.stringify(data.project));
    localStorage.setItem(`ysong:projectName:${data.projectId}`,data.name);
  }
  const catalog=JSON.parse(localStorage.getItem('ysong:projects:v1')??'[]') as Array<{id:string}>;
  if(!catalog.some(p=>p.id===data.projectId))localStorage.setItem('ysong:projects:v1',JSON.stringify([...catalog,{id:data.projectId,name:data.name,updatedAt:Date.now(),generation:data.project.generation}]));
  return data.projectId;
}
export const jobAction=(id:string,action:string,body:Record<string,unknown>={})=>apiPost(`/api/generations/${encodeURIComponent(id)}/${action}`,body);
