import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/authApi';
import { billingDestination } from '../lib/billingRedirect';
type Plan={id:string;name:string;monthlyPriceCents:number;quota:number|null;capabilities:Record<string,boolean>;available:boolean};
export default function Pricing(){
  const [plans,setPlans]=useState<Plan[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const inFlight=useRef(false);
  useEffect(()=>{let alive=true;void apiGet<{plans:Plan[]}>('/api/billing/catalog').then(r=>{if(alive)setPlans(r.plans);}).catch(()=>{if(alive)setMessage('Plan catalog is unavailable. Please try again later.');});return()=>{alive=false;};},[]);
  async function choose(id:string){if(inFlight.current)return;const plan=plans.find(p=>p.id===id);if(!plan?.available||id==='free')return;inFlight.current=true;setBusy(true);setMessage('Starting secure checkout…');try{const storageKey=`ysong:checkout:${id}`;const key=sessionStorage.getItem(storageKey)??crypto.randomUUID();sessionStorage.setItem(storageKey,key);const r=await apiPost<{url:string}>('/api/billing/checkout',{planId:id,requestKey:key});window.location.assign(billingDestination(r.url,'checkout.stripe.com'));}catch(e){inFlight.current=false;setBusy(false);setMessage(e instanceof Error?e.message:'Checkout unavailable');}}
  return <main className="mx-auto max-w-5xl p-8 space-y-6"><h1 className="text-3xl">YSong plans</h1><p>Sign in before checkout. Payment details are handled by Stripe.</p><div className="grid gap-4 md:grid-cols-4">{plans.map(p=><section key={p.id} className="rounded-xl border p-4 space-y-3"><h2>{p.name}</h2><p>${(p.monthlyPriceCents/100).toFixed(2)} / month</p><p>{p.quota===null?'Generation allowance awaiting configuration':`${p.quota} monthly generation credits`}</p>{Object.entries(p.capabilities).filter(([,enabled])=>enabled).map(([name])=><p key={name}>{name}</p>)}{p.id==='free'?<a href="/signup">Create account</a>:<button disabled={busy||!p.available} onClick={()=>void choose(p.id)}>{p.available?'Choose plan':'Not yet available'}</button>}</section>)}</div>{message&&<p role="status">{message}</p>}</main>;
}
