import {useEffect,useState} from 'react';
import {apiGet,apiPost} from '../lib/authApi';
type Generation={id:string;state:string;source_kind:string|null;execution:{parts:Record<string,{state:string}>;message?:string}|null};
type Failure={event_id:string;event_type:string;error_code:string;live:boolean};
export default function RecoveryAdmin(){
  const [data,setData]=useState<{generations:Generation[];billingFailures:Failure[]}|null>(null);
  const [reason,setReason]=useState(''),[accountId,setAccountId]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [customerId,setCustomerId]=useState(''),[subscriptionId,setSubscriptionId]=useState('');
  async function load(){setData(await apiGet('/api/admin/recovery'));}
  useEffect(()=>{void load().catch(()=>setMessage('Recovery data unavailable.'));},[]);
  async function act(path:string,body:Record<string,unknown>={}){setBusy(true);setMessage('');const storageKey=`ysong:recovery:${path}`;const requestKey=sessionStorage.getItem(storageKey)||crypto.randomUUID();sessionStorage.setItem(storageKey,requestKey);
    try{await apiPost(path,{...body,reason,requestKey});sessionStorage.removeItem(storageKey);await load();setMessage('Recovery action recorded. Review the current state before taking another action.');}
    catch(e){setMessage(e instanceof Error?e.message:'Recovery unavailable');}finally{setBusy(false);}}
  const disabled=busy||reason.trim().length<10;
  return <section className="space-y-2 text-sm"><strong>Operator recovery</strong><p>These actions retain artifacts and never start a paid render. An active executor prevents review or cancellation. Review evidence before resolving an uncertain outcome.</p>
    <textarea className="input" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} placeholder="Evidence / recovery reason (at least 10 characters)"/>
    <button disabled={busy} onClick={()=>void load().catch(()=>setMessage('Recovery refresh failed.'))}>Refresh recovery state</button>
    {data?.generations.map(v=><div key={v.id} className="border-t border-white/10 py-2">{v.id} · {v.state}{v.execution?.message&&<p>{v.execution.message}</p>}
      {['generating','processing'].includes(v.state)&&<button disabled={disabled} onClick={()=>void act(`/api/admin/recovery/generations/${v.id}/review-submission`)}>Mark stopped submission for review</button>}
      {v.state==='queued'&&<button disabled={disabled} onClick={()=>void act(`/api/admin/recovery/generations/${v.id}/cancel-queued`)}>Cancel unsubmitted queued version</button>}
      {v.state==='failed'&&v.source_kind==='session'&&Object.values(v.execution?.parts??{}).some(p=>p.state==='ready')&&<button disabled={disabled} onClick={()=>void act(`/api/admin/recovery/generations/${v.id}/finalize`)}>Retry project save only</button>}
    </div>)}
    <p>Reconcile a linked account from Stripe’s current subscription. This does not create or charge a subscription.</p><input className="input" value={accountId} onChange={e=>setAccountId(e.target.value)} placeholder="Account UUID"/><button disabled={disabled||!accountId} onClick={()=>void act(`/api/admin/recovery/billing/${accountId}/reconcile`)}>Reconcile billing entitlement</button>
    <details><summary>Recover an incomplete Stripe profile</summary><p>The server checks the Stripe customer’s YSong account metadata and subscription ownership. Linking does not grant a paid plan.</p><input className="input" value={customerId} onChange={e=>setCustomerId(e.target.value)} placeholder="Verified Stripe customer ID"/><input className="input" value={subscriptionId} onChange={e=>setSubscriptionId(e.target.value)} placeholder="Existing Stripe subscription ID"/><button disabled={disabled||!accountId||!customerId||!subscriptionId} onClick={()=>void act(`/api/admin/recovery/billing/${accountId}/link-profile`,{customerId,subscriptionId})}>Verify and link existing profile</button></details>
    {data?.billingFailures.map(f=><div key={`${f.live}:${f.event_id}`}>{f.live?'Live':'Test'} · {f.event_id} · {f.error_code}<button disabled={disabled} onClick={()=>void act(`/api/admin/recovery/billing-events/${encodeURIComponent(f.event_id)}/replay`)}>Replay verified Stripe event</button></div>)}
    {message&&<p role="status">{message}</p>}
  </section>;
}
