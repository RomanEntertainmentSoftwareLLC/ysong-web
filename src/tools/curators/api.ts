import { AUTH_BASE } from "../../lib/authApi";
import type { AudioIntelligenceReport } from "../audiointelligence/api";

function token(){try{return localStorage.getItem("ys_token")||localStorage.getItem("ysong_auth_token")||"";}catch{return "";}}
async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const headers=new Headers(init.headers||{});if(init.body&&!headers.has("Content-Type")&&!(init.body instanceof FormData))headers.set("Content-Type","application/json");const t=token();if(t)headers.set("Authorization",`Bearer ${t}`);
  const res=await fetch(`${AUTH_BASE}${path}`,{...init,headers,credentials:"include"});const data=await res.json().catch(()=>({}));if(!res.ok){const e=new Error(String(data?.detail||data?.error||`HTTP ${res.status}`)) as Error & {status?:number;data?:unknown};e.status=res.status;e.data=data;throw e;}return data as T;
}
const ROOT="/api/curators";
export type CuratorReleaseTrack={id:string;title:string;genre:string;tags:unknown[];explicit:boolean;durationSeconds:number|null;isrc:string|null};
export type CuratorRelease={id:string;artistName:string;title:string;releaseType:string;genre:string;publishedAt:string;hasArtwork:boolean;tracks:CuratorReleaseTrack[]};
export type CuratorProfile={id:string;displayName:string;organization:string;curatorType:"playlist"|"blog"|"radio"|"youtube"|"influencer"|"music_media";bio:string;websiteUrl:string;status:"draft"|"active"|"paused"|"suspended";editorialIndependenceAck:boolean;verified:boolean;metadata:Record<string,unknown>;createdAt:string;updatedAt:string};
export type CuratorChannel={id:string;curatorProfileId:string;name:string;platform:string;url:string;description:string;genres:string[];moods:string[];sonicTags:string[];languages:string[];countries:string[];minBpm:number|null;maxBpm:number|null;acceptsExplicit:boolean;submissionCostCredits:number;responseDays:number;audienceSize:number;active:boolean;metadata:Record<string,unknown>;createdAt:string;updatedAt:string};
export type CuratorStats={total:number;responded:number;accepted:number;responseRate:number;acceptanceRate:number;avgResponseHours:number|null;reputation:number;sampleConfidence:number};
export type CuratorMatch={score:number;eligible:boolean;reasons:string[];misses:string[];breakdown:Record<string,number>};
export type CuratorRecommendation={profile:Pick<CuratorProfile,"id"|"displayName"|"organization"|"curatorType"|"bio"|"websiteUrl"|"verified">;channel:CuratorChannel;stats:CuratorStats;match:CuratorMatch};
export type CuratorSubmission={id:string;artistUserId:string;curatorProfileId:string;curatorChannelId:string;releaseId:string;trackId:string|null;matchContextId:string|null;pitch:string;status:"pending"|"in_review"|"accepted"|"rejected"|"withdrawn"|"expired";creditsSpent:number;matchSnapshot:Record<string,unknown>;releaseSnapshot:Record<string,unknown>;feedback:Record<string,unknown>;placementStatus:"none"|"planned"|"published"|"declined";placementUrl:string;submittedAt:string;openedAt:string|null;respondedAt:string|null;expiresAt:string|null;updatedAt:string;curator?:Record<string,string>;channel?:Record<string,string>};
export type Wallet={balance:number;lifetimeGranted:number;lifetimeSpent:number;purchaseProviderConfigured:boolean};

export const curatorApi={
  health:()=>request<{ok:boolean;service:string;phase:string;placementGuarantee:boolean;credits:{mode:string;starterCredits:number;purchaseProviderConfigured:boolean}}>(`${ROOT}/health`),
  catalog:()=>request<{curatorTypes:string[];placementStatuses:string[];decisionPolicy:string}>(`${ROOT}/catalog`),
  wallet:()=>request<{wallet:Wallet;ledger:Array<Record<string,unknown>>}>(`${ROOT}/wallet`),
  releases:()=>request<{releases:CuratorRelease[]}>(`${ROOT}/releases`),
  profile:()=>request<{profile:CuratorProfile|null;channels:CuratorChannel[];stats:CuratorStats}>(`${ROOT}/profile`),
  saveProfile:(body:Record<string,unknown>)=>request<{profile:CuratorProfile}>(`${ROOT}/profile`,{method:"PUT",body:JSON.stringify(body)}),
  createChannel:(body:Record<string,unknown>)=>request<{channel:CuratorChannel}>(`${ROOT}/channels`,{method:"POST",body:JSON.stringify(body)}),
  updateChannel:(id:string,body:Record<string,unknown>)=>request<{channel:CuratorChannel}>(`${ROOT}/channels/${id}`,{method:"PATCH",body:JSON.stringify(body)}),
  removeChannel:(id:string)=>request<{ok:boolean;archived:boolean}>(`${ROOT}/channels/${id}`,{method:"DELETE"}),
  matchContext:(body:{releaseId:string;trackId?:string|null;audioIntelligence?:AudioIntelligenceReport|null;seoQuery?:string;refreshSeo?:boolean})=>request<Record<string,unknown>>(`${ROOT}/match-context`,{method:"POST",body:JSON.stringify(body)}),
  recommendations:(releaseId:string,trackId?:string|null,limit=50)=>request<{context:Record<string,unknown>;release:Record<string,unknown>;track:Record<string,unknown>|null;recommendations:CuratorRecommendation[];policy:string}>(`${ROOT}/recommendations?releaseId=${encodeURIComponent(releaseId)}${trackId?`&trackId=${encodeURIComponent(trackId)}`:""}&limit=${limit}`),
  explore:(q="")=>request<{channels:Array<{profile:CuratorRecommendation["profile"];channel:CuratorChannel;stats:CuratorStats}>}>(`${ROOT}/explore${q?`?q=${encodeURIComponent(q)}`:""}`),
  submit:(body:{channelId:string;releaseId:string;trackId?:string|null;pitch:string})=>request<{submission:CuratorSubmission;policy:string}>(`${ROOT}/submissions`,{method:"POST",body:JSON.stringify(body)}),
  submissions:()=>request<{submissions:CuratorSubmission[]}>(`${ROOT}/submissions`),
  withdraw:(id:string)=>request<{ok:boolean;refunded:number}>(`${ROOT}/submissions/${id}/withdraw`,{method:"POST",body:"{}"}),
  desk:()=>request<{profile:CuratorProfile|null;submissions:CuratorSubmission[];stats:CuratorStats}>(`${ROOT}/desk/submissions`),
  open:(id:string)=>request<{submission:CuratorSubmission}>(`${ROOT}/desk/submissions/${id}/open`,{method:"POST",body:"{}"}),
  respond:(id:string,body:Record<string,unknown>)=>request<{submission:CuratorSubmission;policy:string}>(`${ROOT}/desk/submissions/${id}/respond`,{method:"POST",body:JSON.stringify(body)}),
  placement:(id:string,body:{status:string;url?:string})=>request<{submission:CuratorSubmission}>(`${ROOT}/desk/submissions/${id}/placement`,{method:"POST",body:JSON.stringify(body)}),
  report:(body:{curatorProfileId:string;submissionId?:string|null;reason:string;detail?:string})=>request<Record<string,unknown>>(`${ROOT}/reports`,{method:"POST",body:JSON.stringify(body)}),
};
