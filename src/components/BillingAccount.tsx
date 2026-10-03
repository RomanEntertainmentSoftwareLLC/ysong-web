import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/authApi';
type Billing = {status:string;plan:{name:string;monthlyPriceCents:number;currency:string};periodEnd:string|null;cancellationScheduled:boolean;portalAvailable:boolean};
export default function BillingAccount() {
  const [data,setData]=useState<Billing|null>(null),[error,setError]=useState('');
  const result=new URLSearchParams(window.location.search).get('billing');
  useEffect(()=>{let alive=true;const load=()=>{void apiGet<Billing>('/api/billing/account').then(d=>{if(alive)setData(d);}).catch(()=>{});};load();const timer=window.setInterval(load,5000);return()=>{alive=false;clearInterval(timer);};},[]);
  async function manage(){try{const r=await apiPost<{url:string}>('/api/billing/portal',{});const url=new URL(r.url);if(url.protocol!=='https:'||url.hostname!=='billing.stripe.com')throw new Error('Invalid billing portal');window.location.assign(url.href);}catch(e){setError(e instanceof Error?e.message:'Billing unavailable');}}
  if(!data)return null;
  return <div className="space-y-2 text-sm"><strong>Billing</strong><p>{data.plan.name} · ${(data.plan.monthlyPriceCents/100).toFixed(2)} / month · {data.status}</p>
    {result==='success'&&!['active','trialing'].includes(data.status)&&<p>Payment confirmation pending. Access updates only after the server processes Stripe confirmation.</p>}
    {result==='cancelled'&&<p>Checkout cancelled. Your existing entitlement is unchanged.</p>}
    {data.periodEnd&&<p>{data.cancellationScheduled?'Cancellation scheduled for':'Current billing period ends'} {new Date(data.periodEnd).toLocaleDateString()}</p>}
    {data.portalAvailable&&<button onClick={()=>void manage()}>Manage payment method, upgrade, downgrade or cancel in Stripe</button>}
    {error&&<p role="alert">{error}</p>}</div>;
}
