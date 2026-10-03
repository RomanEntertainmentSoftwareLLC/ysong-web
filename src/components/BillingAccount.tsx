import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/authApi';
import { billingDestination } from '../lib/billingRedirect';
type Billing = {status:string;plan:{name:string;monthlyPriceCents:number;currency:string};periodEnd:string|null;cancellationScheduled:boolean;portalAvailable:boolean};
export default function BillingAccount() {
  const [data,setData]=useState<Billing|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const portalInFlight=useRef(false);
  const result=new URLSearchParams(window.location.search).get('billing');
  useEffect(()=>{let alive=true;const load=()=>{void apiGet<Billing>('/api/billing/account').then(d=>{if(alive)setData(d);}).catch(()=>{});};load();const timer=window.setInterval(load,5000);return()=>{alive=false;clearInterval(timer);};},[]);
  async function manage(){if(portalInFlight.current||!data?.portalAvailable)return;portalInFlight.current=true;setBusy(true);setError('');try{const r=await apiPost<{url:string}>('/api/billing/portal',{});window.location.assign(billingDestination(r.url,'billing.stripe.com'));}catch(e){portalInFlight.current=false;setBusy(false);setError(e instanceof Error?e.message:'Billing unavailable');}}
  if(!data)return null;
  return <div className="space-y-2 text-sm"><strong>Billing</strong><p>{data.plan.name} · ${(data.plan.monthlyPriceCents/100).toFixed(2)} / month · {data.status}</p>
    {result==='success'&&!['active','trialing'].includes(data.status)&&<p>Payment confirmation pending. Access updates only after the server processes Stripe confirmation.</p>}
    {result==='cancelled'&&<p>Checkout cancelled. Your existing entitlement is unchanged.</p>}
    {data.status==='past_due'&&<p>Payment needs attention. Open the billing portal to update your payment method.</p>}
    {data.status==='incomplete'&&<p>Subscription activation is pending payment confirmation.</p>}
    {data.status==='canceled'&&<p>Subscription canceled. Your current access is shown above.</p>}
    {data.cancellationScheduled&&<p>Your subscription is set to cancel at the end of the current billing period. You can resume it in the billing portal.</p>}
    {data.periodEnd&&<p>{data.cancellationScheduled?'Cancellation scheduled for':'Current billing period ends'} {new Date(data.periodEnd).toLocaleDateString()}</p>}
    {data.portalAvailable&&<button disabled={busy} onClick={()=>void manage()}>{busy?'Opening billing portal…':'Manage payment method, upgrade, downgrade, cancel or resume in Stripe'}</button>}
    {error&&<p role="alert">{error}</p>}</div>;
}
