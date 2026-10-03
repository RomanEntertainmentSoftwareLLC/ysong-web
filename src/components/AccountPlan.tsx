import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/authApi';
import { billingDestination } from '../lib/billingRedirect';
import BillingAccount from './BillingAccount';
import PolicyAcceptance from './PolicyAcceptance';
import GovernanceAdmin from './GovernanceAdmin';
import RightsAndCases from './RightsAndCases';
import RecoveryAdmin from './RecoveryAdmin';
type Entitlement = { enabled: boolean; name: string; planId: string; superadmin: boolean; admin: boolean; quota: number | null; used: number; reserved: number; remaining: number | null; resetAt: string | null };
type Account = { id: string; email: string; display_name: string; account_status: string; plan_id: string; subscription_status: string; override_plan_id: string | null };
const button = 'rounded-lg border border-white/15 px-3 py-1.5 text-xs disabled:opacity-40';
export default function AccountPlan({ administration = false, quantity }: { administration?: boolean; quantity?:number }) {
  const [entitlement,setEntitlement]=useState<Entitlement|null>(null);
  const [plans,setPlans]=useState<Array<{id:string;name:string;available:boolean}>>([]);
  const checkoutInFlight=useRef(false);
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [query,setQuery]=useState(''); const [reason,setReason]=useState('');
  const [selected,setSelected]=useState(''); const [action,setAction]=useState('note');
  const [usage,setUsage]=useState<{periods:Array<{starts_at:string;ends_at:string;used:number;reserved:number}>;events:Array<{id:string;capability:string;provider:string;state:string;units:number}>}|null>(null);
  const [compPlan,setCompPlan]=useState('pro'); const [quota,setQuota]=useState('');
  const [expires,setExpires]=useState(''); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  async function refresh() {
    const data=await apiGet<Entitlement>('/api/account/entitlements');setEntitlement(data);
    if(data.enabled)setPlans((await apiGet<{plans:Array<{id:string;name:string;available:boolean}>}>('/api/billing/catalog')).plans);
  }
  useEffect(()=>{let alive=true;void apiGet<Entitlement>('/api/account/entitlements').then(data=>{
    if(!alive)return;setEntitlement(data);
    if(data.enabled)void apiGet<{plans:Array<{id:string;name:string;available:boolean}>}>('/api/billing/catalog').then(result=>{if(alive)setPlans(result.plans);}).catch(()=>{});
  }).catch(()=>{});return()=>{alive=false;};},[]);
  async function lookup(){setBusy(true);setMessage('');try{setAccounts((await apiGet<{accounts:Account[]}>(`/api/admin/accounts?q=${encodeURIComponent(query)}`)).accounts);}catch(e){setMessage(e instanceof Error?e.message:'Account lookup failed.');}finally{setBusy(false);}}
  async function act(){setBusy(true);setMessage('');try{
    const value=action==='override'?{planId:compPlan||null,quota:quota===''?null:Number(quota),expiresAt:expires?new Date(expires).toISOString():null}:action==='generation'||action==='uploads'?true:action==='enable_generation'||action==='enable_uploads'?false:null;
    await apiPost(`/api/admin/accounts/${selected}/actions`,{action:action.replace('enable_',''),value,reason});setMessage('Action saved in the admin audit log.');await refresh();
  }catch(e){setMessage(e instanceof Error?e.message:'Admin action failed.');}finally{setBusy(false);}}
  async function checkout(planId:string){if(checkoutInFlight.current||!plans.some(p=>p.id===planId&&p.available))return;checkoutInFlight.current=true;setBusy(true);setMessage('Starting secure checkout…');try{
    const keyName=`ysong:checkout:${planId}`;const requestKey=sessionStorage.getItem(keyName)||crypto.randomUUID();sessionStorage.setItem(keyName,requestKey);
    const result=await apiPost<{url:string}>('/api/billing/checkout',{planId,requestKey});
    window.location.assign(billingDestination(result.url,'checkout.stripe.com'));
  }catch(e){checkoutInFlight.current=false;setMessage(e instanceof Error?e.message:'Checkout unavailable.');setBusy(false);}}
  if(!entitlement?.enabled)return null;
  return <section className="rounded-xl border border-white/10 p-3 space-y-3">
    <BillingAccount />
    {administration&&<PolicyAcceptance />}
    {administration&&<RightsAndCases />}
    {administration&&entitlement.admin&&<GovernanceAdmin />}
    {administration&&entitlement.admin&&<RecoveryAdmin />}
    <div className="flex flex-wrap items-center gap-3"><strong className="text-sm">{entitlement.name}</strong><span className="text-xs opacity-70">{entitlement.superadmin?'Full access · generation quota bypass':entitlement.quota===null?'Generation quota awaiting configuration':`${entitlement.remaining} / ${entitlement.quota} generation units remaining${entitlement.reserved?` · ${entitlement.reserved} reserved`:''}`}</span><button className={button} disabled={busy} onClick={()=>void refresh().catch(()=>setMessage('Could not refresh account.'))}>Refresh</button></div>
    {!entitlement.superadmin&&plans.filter(p=>p.id!==entitlement.planId&&p.id!=='free').map(plan=><button key={plan.id} className={`${button} mr-2`} disabled={busy||!plan.available} onClick={()=>void checkout(plan.id)}>{plan.available?`Choose ${plan.name}`:`${plan.name} unavailable`}</button>)}
    {entitlement.resetAt&&!entitlement.superadmin&&<p className="text-xs opacity-60">Quota period ends {new Date(entitlement.resetAt).toLocaleDateString()}.</p>}
    {!entitlement.superadmin&&<p className="text-xs">{entitlement.used} used · {entitlement.reserved} reserved · {entitlement.remaining??0} remaining{quantity?` · This request requires ${quantity} credits`:''}{quantity&&entitlement.remaining!==null&&quantity>entitlement.remaining?' · Insufficient quota':''}</p>}
    {administration&&entitlement.admin&&<div className="border-t border-white/10 pt-3 space-y-2"><strong className="text-sm">Account administration</strong>
      <div className="flex gap-2"><input className="input min-w-0 flex-1" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find email or display name"/><button className={button} disabled={busy} onClick={()=>void lookup()}>Search</button></div>
      <select className="input" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select an account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.display_name||a.email} · {a.account_status} · {a.override_plan_id||a.plan_id} · {a.subscription_status}</option>)}</select>
      <button className={button} disabled={!selected||busy} onClick={()=>{setUsage(null);void apiGet<typeof usage>(`/api/admin/accounts/${selected}/usage`).then(setUsage).catch(()=>setMessage('Usage lookup failed.'));}}>Inspect selected account usage</button>
      {usage&&<div className="text-xs space-y-1">{usage.periods.map(p=><p key={p.starts_at}>{new Date(p.starts_at).toLocaleDateString()} – {new Date(p.ends_at).toLocaleDateString()}: {p.used} used · {p.reserved} reserved</p>)}{usage.events.map(e=><p key={e.id}>{e.capability} · {e.provider} · {e.units} unit(s) · {e.state}</p>)}{!usage.periods.length&&!usage.events.length&&<p>No recorded usage.</p>}</div>}
      <select className="input" value={action} onChange={e=>setAction(e.target.value)}>{[['note','Admin note'],['override','Comp / entitlement override'],['suspend','Suspend account'],['ban','Ban account'],['unban','Restore account access'],['generation','Disable generation'],['enable_generation','Enable generation'],['uploads','Disable uploads'],['enable_uploads','Enable uploads'],['revoke_sessions','Revoke existing sessions']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      {action==='override'&&<div className="grid grid-cols-1 sm:grid-cols-3 gap-2"><select className="input" value={compPlan} onChange={e=>setCompPlan(e.target.value)}><option value="">Remove override</option>{['free','basic','pro','premium'].map(p=><option key={p} value={p}>{p}</option>)}</select><input className="input" type="number" min="0" step="1" value={quota} onChange={e=>setQuota(e.target.value)} placeholder="Quota (blank = plan)"/><input className="input" type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)} aria-label="Override expiry (blank = permanent)"/></div>}
      <textarea className="input" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason / note (required)" maxLength={2000}/><button className={button} disabled={busy||!selected||reason.trim().length<3} onClick={()=>void act()}>Apply recorded action</button>
    </div>}
    {message&&<p className="text-xs" role="status">{message}</p>}
  </section>;
}
