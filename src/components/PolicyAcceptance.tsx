import {useEffect,useState} from 'react';
import {apiGet,apiPost} from '../lib/authApi';
type Policy={policy_id:string;version:string;url:string;approved:boolean;accepted_at:string|null};
export default function PolicyAcceptance(){
 const [policies,setPolicies]=useState<Policy[]>([]),[message,setMessage]=useState('');
 useEffect(()=>{void apiGet<{policies:Policy[];configured:boolean}>('/api/account/policies').then(r=>{setPolicies(r.policies);if(!r.configured)setMessage('ATTORNEY REVIEW REQUIRED. Current launch policy versions are not yet configured.');}).catch(()=>{});},[]);
 async function accept(p:Policy){try{await apiPost('/api/account/policies/accept',{policyId:p.policy_id,version:p.version,accepted:true});setPolicies(old=>old.map(x=>x.policy_id===p.policy_id?{...x,accepted_at:new Date().toISOString()}:x));}catch(e){setMessage(e instanceof Error?e.message:'Acceptance failed');}}
 return <section className="space-y-2 text-sm"><strong>Policy acceptance</strong>{message&&<p>{message}</p>}{policies.map(p=><div key={p.policy_id}><a href={p.url}>{p.policy_id} · {p.version}</a>{p.accepted_at?<span> · Accepted {new Date(p.accepted_at).toLocaleDateString()}</span>:<button disabled={!p.approved} onClick={()=>void accept(p)}>I have read and accept this version</button>}</div>)}</section>;
}
