import {useEffect,useState} from 'react';
import {apiGet,apiPost} from '../lib/authApi';
type Content={object_key:string;state:string;owner_user_id:string};
type Uncertain={id:string;execution:{parts:Record<string,{state:string}>}};
type Case={id:string;object_key:string;state:string;prior_removals:number;updated_at:string;notification_state:string};
export default function GovernanceAdmin(){
 const [content,setContent]=useState<Content[]>([]),[uncertain,setUncertain]=useState<Uncertain[]>([]),[cases,setCases]=useState<Case[]>([]),[audit,setAudit]=useState<unknown[]>([]),[reason,setReason]=useState(''),[message,setMessage]=useState('');
 async function load(){const [c,u,t,a]=await Promise.all([apiGet<{content:Content[]}>('/api/admin/content'),apiGet<{generations:Uncertain[]}>('/api/admin/generations/uncertain'),apiGet<{cases:Case[]}>('/api/admin/takedowns'),apiGet<{actions:unknown[]}>('/api/admin/audit')]);setContent(c.content);setUncertain(u.generations);setCases(t.cases);setAudit(a.actions);}
 useEffect(()=>{void load().catch(()=>setMessage('Admin review data unavailable'));},[]);
 async function act(path:string,body:Record<string,unknown>){try{await apiPost(path,{...body,reason});await load();setMessage('Decision recorded in audit history');}catch(e){setMessage(e instanceof Error?e.message:'Decision failed');}}
 return <section className="space-y-3 text-sm"><strong>Moderation and render reconciliation</strong><textarea className="input" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} placeholder="Evidence and decision reason (at least 10 characters)"/>{message&&<p>{message}</p>}
  <p>Artwork requires review for visible nipples/areola, genitalia, exposed pubic hair or explicit sexual content. Cleavage, swimwear, lingerie, shirtless people and non-explicit partial nudity are allowed.</p>
  {content.map(c=><div key={c.object_key}>{c.object_key} · {c.state}{['clear','hidden','removed','restored'].map(state=><button className="mx-2" disabled={reason.trim().length<10} key={state} onClick={()=>void act('/api/admin/content/review',{objectKey:c.object_key,state})}>{state}</button>)}<button disabled={reason.trim().length<10} onClick={()=>void act('/api/admin/content/review',{objectKey:c.object_key,state:'clear',approveRights:true})}>Approve reviewed rights evidence</button></div>)}
  {uncertain.map(v=><div key={v.id}>Generation {v.id}{Object.entries(v.execution.parts).filter(([,p])=>p.state==='ambiguous').map(([part])=><RenderResolution key={part} generationId={v.id} part={part} disabled={reason.trim().length<10} act={act}/>)}</div>)}
  {cases.map(c=><div key={c.id}>Case {c.id} · {c.state} · {c.prior_removals} prior removal decisions{['needs_review','removed','restored','rejected'].map(state=><button key={state} disabled={reason.trim().length<10} onClick={()=>void act(`/api/admin/takedowns/${c.id}/decision`,{state})}>{state}</button>)}<NoticeRecord caseRecord={c} disabled={reason.trim().length<10} act={act}/></div>)}
  <details><summary>Audit history</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(audit,null,2)}</pre></details>
 </section>;
}
function NoticeRecord({caseRecord,disabled,act}:{caseRecord:Case;disabled:boolean;act:(path:string,body:Record<string,unknown>)=>Promise<void>}){
 const [reference,setReference]=useState('');return <div>Formal notice: {caseRecord.notification_state}<input className="input" value={reference} onChange={e=>setReference(e.target.value)} placeholder="Manual delivery receipt / failure reference"/>{['delivered','failed'].map(status=><button key={status} disabled={disabled||reference.trim().length<3} onClick={()=>void act(`/api/admin/recovery/takedowns/${caseRecord.id}/notification`,{status,reference,expectedUpdatedAt:caseRecord.updated_at})}>Record {status}</button>)}</div>;
}
function RenderResolution({generationId,part,disabled,act}:{generationId:string;part:string;disabled:boolean;act:(path:string,body:Record<string,unknown>)=>Promise<void>}){
 const [key,setKey]=useState(''),[reference,setReference]=useState('');const path=`/api/admin/generations/${generationId}/parts/${encodeURIComponent(part)}/resolve`;
 return <div>{part}<input className="input" value={reference} onChange={e=>setReference(e.target.value)} placeholder="Provider/inspection evidence reference"/><input className="input" value={key} onChange={e=>setKey(e.target.value)} placeholder="Exact stored artifact key for recovered success"/><button disabled={disabled||!key} onClick={()=>void act(path,{outcome:'confirmed_success',objectKey:key,providerReference:reference})}>Verify recovered artifact</button><button disabled={disabled||!reference} onClick={()=>void act(path,{outcome:'confirmed_failure',providerReference:reference})}>Confirm evidenced failure</button></div>;
}
