import { useEffect, useMemo, useRef, useState } from "react";
import { promotionApi, type AdCampaign, type AdCreative, type AdPlacementTarget, type AdTargeting, type MetaAdAccount, type MetaInterest, type MetaPixel, type PromotionCampaign, type PromotionCatalog, type PromotionHealth } from "./api";
import MetaPublishPanel from "./MetaPublishPanel";

const panel="rounded-2xl border border-neutral-200 bg-white/80 p-5 dark:border-neutral-800 dark:bg-neutral-900/55";
const input="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 dark:border-neutral-700 dark:bg-neutral-950";
const chip="rounded-full border border-neutral-300 px-2.5 py-1 text-xs dark:border-neutral-700";
type SetupView="audience"|"budget"|"ad"|"accounts"|"summary";

type Props={
  ad:AdCampaign;
  smartLink:PromotionCampaign|null;
  health:PromotionHealth|null;
  creatives:AdCreative[];
  creativeUrls:Record<string,{vertical?:string;feed?:string}>;
  interestSeeds?:string[];
  onSaved:(ad:AdCampaign)=>void;
  onMessage:(value:string)=>void;
};

const PLACEMENTS:Array<{id:AdPlacementTarget;label:string;platform:"facebook"|"instagram";format:"vertical"|"feed"}>=[
  {id:"facebook_feed",label:"Facebook Feed",platform:"facebook",format:"feed"},
  {id:"facebook_reels",label:"Facebook Reels",platform:"facebook",format:"vertical"},
  {id:"facebook_stories",label:"Facebook Stories",platform:"facebook",format:"vertical"},
  {id:"instagram_feed",label:"Instagram Feed",platform:"instagram",format:"feed"},
  {id:"instagram_reels",label:"Instagram Reels",platform:"instagram",format:"vertical"},
  {id:"instagram_stories",label:"Instagram Stories",platform:"instagram",format:"vertical"},
];
const LANGUAGES=[
  ["en","English"],["es","Spanish"],["pt","Portuguese"],["fr","French"],["de","German"],["it","Italian"],["nl","Dutch"],["pl","Polish"],["ro","Romanian"],["sv","Swedish"],["tr","Turkish"],["ru","Russian"],["ar","Arabic"],["hi","Hindi"],["id","Indonesian"],["th","Thai"],["vi","Vietnamese"],["ja","Japanese"],["ko","Korean"],["zh","Chinese"],
] as const;
const CURRENCIES=["USD","CAD","GBP","EUR","AUD","JPY","BRL","MXN"];

function asTargeting(value:Record<string,unknown>):AdTargeting{
  const v=value||{};
  const placements=Array.isArray(v.placementTargets)?v.placementTargets.filter((x):x is AdPlacementTarget=>typeof x==="string"&&PLACEMENTS.some(p=>p.id===x)):PLACEMENTS.map(p=>p.id);
  const interests=Array.isArray(v.interests)?v.interests.filter((x):x is {id:string;name:string}=>!!x&&typeof x==="object"&&typeof (x as {id?:unknown}).id==="string"&&typeof (x as {name?:unknown}).name==="string"):[];
  return {
    countries:Array.isArray(v.countries)?v.countries.filter((x):x is string=>typeof x==="string"):[],
    ageMin:Math.max(18,Math.min(65,Number(v.ageMin||18))),
    ageMax:Math.max(18,Math.min(65,Number(v.ageMax||65))),
    gender:v.gender==="male"||v.gender==="female"?v.gender:"all",
    interests,
    interestKeywords:Array.isArray(v.interestKeywords)?v.interestKeywords.filter((x):x is string=>typeof x==="string"):[],
    countryPreset:v.countryPreset==="tier1"||v.countryPreset==="tier2"||v.countryPreset==="tier3"||v.countryPreset==="mixed"?v.countryPreset:"custom",
    placementTargets:placements.length?placements:PLACEMENTS.map(p=>p.id),
    platforms:Array.isArray(v.platforms)?v.platforms.filter((x):x is string=>typeof x==="string"):undefined,
  };
}
function money(minor:number,currency:string){try{return new Intl.NumberFormat(undefined,{style:"currency",currency}).format(minor/100);}catch{return `${currency} ${(minor/100).toFixed(2)}`;}}
function localParts(iso:string|null,timeZone:string){
  if(!iso)return "";
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(iso));
  const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}`;
}
function zonedLocalToIso(value:string,timeZone:string){
  if(!value)return null;
  const m=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);if(!m)return new Date(value).toISOString();
  const target=Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]));let guess=target;
  for(let i=0;i<3;i++){
    const parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess));
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    const shown=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute));
    guess+=target-shown;
  }
  return new Date(guess).toISOString();
}
function supportedTimezones(){
  try{return (Intl as typeof Intl & {supportedValuesOf?:(key:string)=>string[]}).supportedValuesOf?.("timeZone")||[Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC","UTC"];}
  catch{return [Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC","UTC"];}
}
function unique<T>(v:T[]){return [...new Set(v)];}
function formatAudienceNumber(n:number|undefined){return Number(n||0).toLocaleString();}
function formatAudienceRange(item:{audienceSizeLower?:number;audienceSizeUpper?:number}){const low=Number(item.audienceSizeLower||0),high=Number(item.audienceSizeUpper||0);if(!low&&!high)return "Audience estimate unavailable";return `Audience Between: ${formatAudienceNumber(low)} - ${formatAudienceNumber(high||low)}`;}

export default function AudienceCampaignSetup({ad,smartLink,health,creatives,creativeUrls,interestSeeds=[],onSaved,onMessage}:Props){
  const [view,setView]=useState<SetupView>("audience");
  const [catalog,setCatalog]=useState<PromotionCatalog|null>(null);
  const [targeting,setTargeting]=useState<AdTargeting>(()=>asTargeting(ad.targeting));
  const [campaignName,setCampaignName]=useState(ad.name||"");
  const [goal,setGoal]=useState<AdCampaign["goal"]>(ad.goal);
  const [genre,setGenre]=useState(ad.genre||"");
  const [genreSource,setGenreSource]=useState<"ysong"|"user">(ad.genreSource||"ysong");
  const [dailyBudget,setDailyBudget]=useState((ad.dailyBudgetMinor/100).toFixed(2));
  const [currency,setCurrency]=useState(ad.currency||"USD");
  const [scheduleMode,setScheduleMode]=useState<"always"|"scheduled">(ad.scheduleStart?"scheduled":"always");
  const [timezone,setTimezone]=useState(ad.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC");
  const [startLocal,setStartLocal]=useState(()=>localParts(ad.scheduleStart,ad.timezone||"UTC"));
  const [endLocal,setEndLocal]=useState(()=>localParts(ad.scheduleEnd,ad.timezone||"UTC"));
  const [adText,setAdText]=useState(ad.adText||"");
  const [headline,setHeadline]=useState(ad.adHeadline||"Listen now");
  const [language,setLanguage]=useState(ad.language||"en");
  const [coverArtObjectKey,setCoverArtObjectKey]=useState(ad.coverArtObjectKey||"");
  const [coverUrl,setCoverUrl]=useState("");
  const [connectionId,setConnectionId]=useState(ad.metaConnectionId||health?.meta.connections.find(c=>c.active)?.id||health?.meta.connections[0]?.id||"");
  const [adAccounts,setAdAccounts]=useState<MetaAdAccount[]>([]);
  const [adAccountId,setAdAccountId]=useState(ad.metaAdAccountId||"");
  const [pixels,setPixels]=useState<MetaPixel[]>([]);
  const [pixelId,setPixelId]=useState(ad.metaPixelId||"");
  const [interestQuery,setInterestQuery]=useState("");
  const [interestResults,setInterestResults]=useState<MetaInterest[]>([]);
  const [interestPickerOpen,setInterestPickerOpen]=useState(targeting.interests.length===0);
  const [interestBusy,setInterestBusy]=useState(false);
  const [interestError,setInterestError]=useState("");
  const interestRequestSeq=useRef(0);
  const [countryQuery,setCountryQuery]=useState("");
  const [previewPlacement,setPreviewPlacement]=useState<AdPlacementTarget>(targeting.placementTargets[0]||"instagram_reels");
  const [busy,setBusy]=useState(false);
  const [accountBusy,setAccountBusy]=useState(false);

  useEffect(()=>{void promotionApi.catalog().then(setCatalog).catch(()=>{});},[]);
  useEffect(()=>{
    const nextTargeting=asTargeting(ad.targeting);setTargeting(nextTargeting);setInterestPickerOpen(nextTargeting.interests.length===0);setInterestQuery("");setInterestResults([]);setCampaignName(ad.name||"");setGoal(ad.goal);setGenre(ad.genre||"");setGenreSource(ad.genreSource||"ysong");setDailyBudget((ad.dailyBudgetMinor/100).toFixed(2));setCurrency(ad.currency||"USD");setScheduleMode(ad.scheduleStart?"scheduled":"always");setTimezone(ad.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC");setStartLocal(localParts(ad.scheduleStart,ad.timezone||"UTC"));setEndLocal(localParts(ad.scheduleEnd,ad.timezone||"UTC"));setAdText(ad.adText||"");setHeadline(ad.adHeadline||"Listen now");setLanguage(ad.language||"en");setCoverArtObjectKey(ad.coverArtObjectKey||"");setConnectionId(ad.metaConnectionId||health?.meta.connections.find(c=>c.active)?.id||health?.meta.connections[0]?.id||"");setAdAccountId(ad.metaAdAccountId||"");setPixelId(ad.metaPixelId||"");
  },[ad.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!coverArtObjectKey){setCoverUrl("");return;}let stop=false;void promotionApi.signedUrl(coverArtObjectKey).then(r=>{if(!stop)setCoverUrl(r.url);}).catch(()=>{if(!stop)setCoverUrl("");});return()=>{stop=true;};},[coverArtObjectKey]);
  useEffect(()=>{
    if(!connectionId){setAdAccounts([]);return;}let stop=false;setAccountBusy(true);void promotionApi.adAccounts(connectionId).then(out=>{if(stop)return;setAdAccounts(out.adAccounts);if(!adAccountId&&out.adAccounts[0])setAdAccountId(out.adAccounts[0].id);}).catch(e=>{if(!stop)onMessage(e instanceof Error?e.message:"Meta ad accounts could not load.");}).finally(()=>{if(!stop)setAccountBusy(false);});return()=>{stop=true;};
  },[connectionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    if(!adAccountId||!connectionId){setPixels([]);return;}let stop=false;void promotionApi.pixels(adAccountId,connectionId).then(out=>{if(stop)return;setPixels(out.pixels);if(pixelId&&!out.pixels.some(p=>p.id===pixelId))setPixelId("");}).catch(()=>{if(!stop)setPixels([]);});return()=>{stop=true;};
  },[adAccountId,connectionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    const q=interestQuery.trim();
    const seq=++interestRequestSeq.current;
    if(!connectionId||q.length<2){setInterestResults([]);setInterestBusy(false);setInterestError("");return;}
    setInterestBusy(true);setInterestError("");
    const timer=window.setTimeout(()=>{
      void promotionApi.interests(q,connectionId,50).then(out=>{if(seq!==interestRequestSeq.current)return;setInterestResults(out.interests);}).catch(e=>{if(seq!==interestRequestSeq.current)return;setInterestResults([]);setInterestError(e instanceof Error?e.message:"Meta interest search failed.");}).finally(()=>{if(seq===interestRequestSeq.current)setInterestBusy(false);});
    },300);
    return()=>window.clearTimeout(timer);
  },[interestQuery,connectionId]);

  const countryMatches=useMemo(()=>{const q=countryQuery.trim().toLowerCase();if(!catalog)return[];return catalog.countries.filter(c=>!q||c.name.toLowerCase().includes(q)||c.code.toLowerCase()===q).slice(0,80);},[catalog,countryQuery]);
  const selectedCreative=creatives.find(c=>c.selected&&c.status==="ready")||creatives.find(c=>c.status==="ready")||null;
  const preview=selectedCreative?creativeUrls[selectedCreative.id]||{}:{};
  const previewDef=PLACEMENTS.find(p=>p.id===previewPlacement)||PLACEMENTS[0];
  const previewUrl=previewDef.format==="vertical"?preview.vertical:preview.feed;
  const placementsForPlatform=(platform:"facebook"|"instagram")=>PLACEMENTS.filter(p=>p.platform===platform&&targeting.placementTargets.includes(p.id));
  const connections=health?.meta.connections||[];
  const chosenConnection=connections.find(c=>c.id===connectionId)||null;
  const chosenAdAccount=adAccounts.find(a=>a.id===adAccountId)||null;
  const chosenPixel=pixels.find(p=>p.id===pixelId)||null;
  const chosenCountries=catalog?.countries.filter(c=>targeting.countries.includes(c.code))||targeting.countries.map(code=>({code,name:code}));
  const timezones=useMemo(()=>supportedTimezones(),[]);
  const estimateDays=useMemo(()=>{if(scheduleMode!=="scheduled"||!startLocal||!endLocal)return null;try{return Math.max(0,(new Date(zonedLocalToIso(endLocal,timezone)!).getTime()-new Date(zonedLocalToIso(startLocal,timezone)!).getTime())/86400000);}catch{return null;}},[scheduleMode,startLocal,endLocal,timezone]);
  const estimatedSpend=estimateDays==null?null:Math.max(0,Number(dailyBudget)||0)*estimateDays;

  function setTier(tier:"tier1"|"tier2"|"tier3",mode:"replace"|"add"="replace"){
    if(!catalog)return;const codes=catalog.countryTiers[tier].map(c=>c.code);setTargeting(v=>({...v,countries:mode==="replace"?codes:unique([...v.countries,...codes]),countryPreset:mode==="replace"?tier:"mixed"}));
  }
  function toggleCountry(code:string){setTargeting(v=>({...v,countries:v.countries.includes(code)?v.countries.filter(x=>x!==code):[...v.countries,code],countryPreset:"custom"}));}
  function togglePlacement(id:AdPlacementTarget){setTargeting(v=>{const next=v.placementTargets.includes(id)?v.placementTargets.filter(x=>x!==id):[...v.placementTargets,id];return {...v,placementTargets:next};});}
  function addResolvedInterest(item:MetaInterest){setTargeting(v=>({...v,interests:[...v.interests.filter(x=>x.id!==item.id),{id:item.id,name:item.name,audienceSizeLower:item.audienceSizeLower,audienceSizeUpper:item.audienceSizeUpper,path:item.path}].slice(0,200),interestKeywords:v.interestKeywords.filter(k=>k.toLowerCase()!==item.name.toLowerCase())}));setInterestQuery("");setInterestResults([]);}
  function searchSuggestion(seed:string){setInterestPickerOpen(true);setInterestQuery(seed);}
  async function uploadCover(files:FileList|null){const file=files?.[0];if(!file)return;setBusy(true);try{const out=await promotionApi.upload(file);setCoverArtObjectKey(out.objectKey);onMessage("Custom campaign cover art uploaded. Save settings to attach it to this draft.");}catch(e){onMessage(e instanceof Error?e.message:"Cover art upload failed.");}finally{setBusy(false);}}
  async function save(){
    if(!targeting.placementTargets.length){onMessage("Choose at least one Facebook or Instagram placement.");return;}
    if(!targeting.countries.length){onMessage("Choose at least one target country before saving the audience.");return;}
    if(targeting.ageMin>targeting.ageMax){onMessage("Minimum age cannot be greater than maximum age.");return;}
    if(scheduleMode==="scheduled"&&(!startLocal||!endLocal)){onMessage("Scheduled campaigns need both a start and end time.");return;}
    const platforms=unique(targeting.placementTargets.map(id=>PLACEMENTS.find(p=>p.id===id)?.platform).filter((x):x is "facebook"|"instagram"=>!!x));
    setBusy(true);
    try{
      const out=await promotionApi.updateAdCampaign(ad.id,{
        name:campaignName.trim()||ad.name,goal,genre,genreSource,dailyBudgetMinor:Math.max(100,Math.round((Number(dailyBudget)||0)*100)),currency,
        scheduleStart:scheduleMode==="scheduled"?zonedLocalToIso(startLocal,timezone):null,
        scheduleEnd:scheduleMode==="scheduled"?zonedLocalToIso(endLocal,timezone):null,
        timezone,placements:platforms,targeting:{...targeting,platforms},adText,adHeadline:headline,language,
        coverArtObjectKey:coverArtObjectKey||null,metaConnectionId:connectionId||null,metaAdAccountId:adAccountId,metaPixelId:pixelId,
      });
      onSaved(out.adCampaign);onMessage("Audience, budget, creative copy, and Meta account settings saved. This is still a draft; nothing was published or charged.");
    }catch(e){onMessage(e instanceof Error?e.message:"Campaign settings could not be saved.");}finally{setBusy(false);}
  }

  const complete={
    countries:targeting.countries.length>0,
    placements:targeting.placementTargets.length>0,
    creative:!!selectedCreative,
    smartLink:!!smartLink?.publicUrl,
    account:!!connectionId&&!!adAccountId,
    copy:!!headline.trim(),
    schedule:scheduleMode==="always"||!!startLocal&&!!endLocal,
  };
  const readiness=Object.values(complete).filter(Boolean).length;

  return <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
    <div>
      <div className="mb-4 flex flex-wrap gap-2">{(["audience","budget","ad","accounts","summary"] as SetupView[]).map(k=><button key={k} onClick={()=>setView(k)} className={`${chip} ${view===k?"border-violet-500 bg-violet-500/10 text-violet-500":""}`}>{({audience:"Audience",budget:"Budget & Schedule",ad:"Ad Settings",accounts:"Accounts",summary:"Confirmation"} as Record<SetupView,string>)[k]}</button>)}</div>

      {view==="audience"&&<div className="space-y-4">
        <section className={panel}><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Countries</h3><p className="text-xs text-neutral-500">Tier presets are shortcuts, not restrictions. Add or remove any country afterward.</p></div><span className={chip}>{targeting.countries.length} selected</span></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">{(["tier1","tier2","tier3"] as const).map(t=><div key={t} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><div className="text-sm font-semibold">{t.replace("tier","Tier ")}</div><div className="mt-1 text-xs text-neutral-500">{catalog?.countryTiers[t].length||0} countries</div><div className="mt-3 flex gap-2"><button onClick={()=>setTier(t,"replace")} className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white">Use</button><button onClick={()=>setTier(t,"add")} className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs dark:border-neutral-700">Add</button></div></div>)}</div>
          <input className={`${input} mt-4`} value={countryQuery} onChange={e=>setCountryQuery(e.target.value)} placeholder="Search any country…"/>
          <div className="mt-3 max-h-52 overflow-auto rounded-xl border border-neutral-200 p-2 dark:border-neutral-800"><div className="grid gap-1 sm:grid-cols-2">{countryMatches.map(c=><label key={c.code} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"><input type="checkbox" checked={targeting.countries.includes(c.code)} onChange={()=>toggleCountry(c.code)}/><span>{c.name}</span><span className="ml-auto text-neutral-400">{c.code}</span></label>)}</div></div>
          <div className="mt-3 flex flex-wrap gap-1.5">{chosenCountries.slice(0,36).map(c=><button key={c.code} onClick={()=>toggleCountry(c.code)} className={chip}>{c.name} ×</button>)}{chosenCountries.length>36&&<span className={chip}>+{chosenCountries.length-36} more</span>}</div>
        </section>

        <section className={panel}><h3 className="text-lg font-semibold">Demographics & placements</h3><div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-xs text-neutral-500">Minimum age<select className={`${input} mt-1`} value={targeting.ageMin} onChange={e=>setTargeting(v=>({...v,ageMin:Number(e.target.value)}))}>{Array.from({length:48},(_,i)=>i+18).map(n=><option key={n} value={n}>{n===65?"65+":n}</option>)}</select></label><label className="text-xs text-neutral-500">Maximum age<select className={`${input} mt-1`} value={targeting.ageMax} onChange={e=>setTargeting(v=>({...v,ageMax:Number(e.target.value)}))}>{Array.from({length:48},(_,i)=>i+18).map(n=><option key={n} value={n}>{n===65?"65+":n}</option>)}</select></label><label className="text-xs text-neutral-500">Gender<select className={`${input} mt-1`} value={targeting.gender} onChange={e=>setTargeting(v=>({...v,gender:e.target.value as AdTargeting["gender"]}))}><option value="all">All</option><option value="female">Women</option><option value="male">Men</option></select></label></div>
          <div className="mt-5 text-sm font-semibold">Ad placements</div><p className="mt-1 text-xs text-neutral-500">Choose exactly where creatives are eligible to run. Feed placements use the 4:3 render; Reels/Stories use 9:16.</p><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{PLACEMENTS.map(p=><label key={p.id} className={`rounded-xl border p-3 text-sm ${targeting.placementTargets.includes(p.id)?"border-violet-500 bg-violet-500/5":"border-neutral-200 dark:border-neutral-800"}`}><input className="mr-2" type="checkbox" checked={targeting.placementTargets.includes(p.id)} onChange={()=>togglePlacement(p.id)}/>{p.label}<div className="ml-5 mt-1 text-[10px] uppercase text-neutral-400">{p.format==="vertical"?"9:16":"4:3"}</div></label>)}</div>
        </section>

        <section className={panel}><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Interests</h3><p className="text-xs text-neutral-500">Find your people. Type a couple characters and YSong searches Meta's real ad-interest catalog with the audience range Meta returns.</p></div><span className={chip}>{targeting.interests.length} selected</span></div>
          {!!interestSeeds.length&&<div className="mt-3"><div className="text-[11px] uppercase tracking-wider text-neutral-400">Suggested searches from YSong</div><div className="mt-2 flex flex-wrap gap-1.5">{unique(interestSeeds.filter(Boolean)).slice(0,30).map(seed=><button key={seed} onClick={()=>searchSuggestion(seed)} className={chip}>{seed}</button>)}</div><div className="mt-1 text-[10px] text-neutral-400">Suggestions are search terms only. They become ad targeting only after you choose a verified Meta interest below.</div></div>}
          <div className="mt-4 space-y-2">{targeting.interests.map(x=><div key={x.id} className="flex items-center gap-3 rounded-xl bg-neutral-100 px-3 py-3 text-sm dark:bg-neutral-800/70"><div className="min-w-0 flex-1"><div className="font-medium">{x.name}</div><div className="mt-0.5 text-[11px] text-neutral-500">{formatAudienceRange(x)}</div></div><button aria-label={`Remove ${x.name}`} onClick={()=>setTargeting(v=>({...v,interests:v.interests.filter(i=>i.id!==x.id)}))} className="rounded-lg px-2 py-1 text-neutral-400 hover:bg-red-500/10 hover:text-red-500">✕</button></div>)}</div>
          {!connectionId?<div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">Connect/select a Meta business account in Accounts & Profile before resolving interests.</div>:interestPickerOpen?<div className="relative mt-4"><div className="relative"><input autoFocus className={`${input} pr-10`} value={interestQuery} onChange={e=>setInterestQuery(e.target.value)} placeholder="Search interests…"/><div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">{interestBusy?"◌":""}</div></div>
            {interestQuery.trim().length>=2&&<div className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-950">{interestError?<div className="p-3 text-xs text-red-500">{interestError}</div>:interestResults.length?interestResults.map(r=>{const selected=targeting.interests.some(x=>x.id===r.id);return <button key={r.id} disabled={selected} onClick={()=>addResolvedInterest(r)} className="block w-full border-b border-neutral-100 px-3 py-2.5 text-left text-xs last:border-b-0 hover:bg-neutral-50 disabled:opacity-45 dark:border-neutral-900 dark:hover:bg-neutral-900"><div className="font-medium">{r.name}{selected?" · selected":""}</div><div className="mt-0.5 text-neutral-500">{formatAudienceRange(r)}</div>{Array.isArray(r.path)&&r.path.length>0&&<div className="mt-0.5 truncate text-[10px] text-neutral-400">{r.path.map(String).join(" › ")}</div>}</button>}):!interestBusy?<div className="p-3 text-xs text-neutral-500">No matching Meta interests.</div>:<div className="p-3 text-xs text-neutral-500">Searching Meta interests…</div>}</div>}
            <div className="mt-2 flex items-center justify-between gap-2"><div className="text-[10px] text-neutral-400">Live search starts after 2 characters. Results refresh automatically.</div>{targeting.interests.length>0&&<button onClick={()=>{setInterestPickerOpen(false);setInterestQuery("");setInterestResults([]);}} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700">Done adding interests</button>}</div>
          </div>:<button onClick={()=>setInterestPickerOpen(true)} className="mt-3 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700">Add interests</button>}
        </section>
      </div>}

      {view==="budget"&&<section className={panel}><h3 className="text-lg font-semibold">Budget & schedule</h3><p className="mt-1 text-xs text-neutral-500">This only saves the plan. Meta is not charged until paid-ad publishing and explicit approval.</p><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_130px]"><label className="text-xs text-neutral-500">Daily budget<input className={`${input} mt-1`} type="number" min="1" step="0.01" value={dailyBudget} onChange={e=>setDailyBudget(e.target.value)}/></label><label className="text-xs text-neutral-500">Currency<select className={`${input} mt-1`} value={currency} onChange={e=>setCurrency(e.target.value)}>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></label></div>
        <div className="mt-5 flex gap-2"><button onClick={()=>setScheduleMode("always")} className={`${chip} ${scheduleMode==="always"?"border-violet-500 bg-violet-500/10 text-violet-500":""}`}>Always active</button><button onClick={()=>setScheduleMode("scheduled")} className={`${chip} ${scheduleMode==="scheduled"?"border-violet-500 bg-violet-500/10 text-violet-500":""}`}>Scheduled</button></div>
        {scheduleMode==="scheduled"&&<div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-xs text-neutral-500 md:col-span-2">Timezone<select className={`${input} mt-1`} value={timezone} onChange={e=>setTimezone(e.target.value)}>{timezones.map(t=><option key={t}>{t}</option>)}</select></label><label className="text-xs text-neutral-500">Start<input className={`${input} mt-1`} type="datetime-local" value={startLocal} onChange={e=>setStartLocal(e.target.value)}/></label><label className="text-xs text-neutral-500">End<input className={`${input} mt-1`} type="datetime-local" value={endLocal} onChange={e=>setEndLocal(e.target.value)}/></label></div>}
        <div className="mt-5 rounded-xl border border-neutral-200 p-4 text-sm dark:border-neutral-800"><div className="flex justify-between"><span>Daily</span><b>{money(Math.max(0,Math.round((Number(dailyBudget)||0)*100)),currency)}</b></div>{estimatedSpend!=null&&<><div className="mt-2 flex justify-between"><span>Approx. duration</span><b>{estimateDays?.toFixed(1)} days</b></div><div className="mt-2 flex justify-between"><span>Planned maximum spend</span><b>{new Intl.NumberFormat(undefined,{style:"currency",currency}).format(estimatedSpend)}</b></div></>}<p className="mt-3 text-xs text-neutral-500">Actual Meta delivery/spend can vary. YSong will show the final settings again before any later publish action.</p></div>
      </section>}

      {view==="ad"&&<section className={panel}><h3 className="text-lg font-semibold">Ad settings</h3><div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-xs text-neutral-500 md:col-span-2">Campaign name<input className={`${input} mt-1`} value={campaignName} maxLength={180} onChange={e=>setCampaignName(e.target.value)}/></label><label className="text-xs text-neutral-500">Objective<select className={`${input} mt-1`} value={goal} onChange={e=>setGoal(e.target.value as AdCampaign["goal"])}><option value="song_growth">Promote a song</option><option value="release_growth">Promote a release</option><option value="fan_growth">Grow fan audience</option><option value="presave">Pre-save campaign</option><option value="custom">Custom funnel</option></select></label><label className="text-xs text-neutral-500">Genre<input className={`${input} mt-1`} value={genre} maxLength={160} onChange={e=>{setGenre(e.target.value);setGenreSource("user");}} placeholder="YSong Audio Intelligence suggestion or your own"/><div className="mt-1 text-[10px] text-neutral-400">Source: {genreSource}{genreSource==="user"?" · manually overridden":" · YSong"}</div></label></div><div className="mt-4 space-y-3"><label className="block text-xs text-neutral-500">Primary ad text<textarea className={`${input} mt-1 min-h-28`} value={adText} maxLength={2200} onChange={e=>setAdText(e.target.value)} placeholder="Tell listeners what they're hearing…"/></label><label className="block text-xs text-neutral-500">Headline<input className={`${input} mt-1`} value={headline} maxLength={255} onChange={e=>setHeadline(e.target.value)} placeholder="Listen to the new release"/></label><label className="block text-xs text-neutral-500">Text language<select className={`${input} mt-1`} value={language} onChange={e=>setLanguage(e.target.value)}>{LANGUAGES.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label></div>
        <div className="mt-5"><div className="text-sm font-semibold">Cover art</div><p className="mt-1 text-xs text-neutral-500">Leave blank to use the Smart Link/release artwork later. Uploading here creates a campaign-specific override.</p><div className="mt-3 flex items-center gap-3">{coverUrl?<img className="h-20 w-20 rounded-xl object-cover" src={coverUrl}/>:<div className="grid h-20 w-20 place-items-center rounded-xl border border-dashed border-neutral-300 text-[10px] text-neutral-400 dark:border-neutral-700">Inherited</div>}<label className="cursor-pointer rounded-xl border border-neutral-300 px-3 py-2 text-xs dark:border-neutral-700">Upload override<input className="hidden" type="file" accept="image/*" onChange={e=>void uploadCover(e.target.files)}/></label>{coverArtObjectKey&&<button onClick={()=>{setCoverArtObjectKey("");setCoverUrl("");}} className="text-xs text-red-500">Use inherited art</button>}</div></div>
      </section>}

      {view==="accounts"&&<section className={panel}><h3 className="text-lg font-semibold">Meta accounts & profile</h3><p className="mt-1 text-xs text-neutral-500">Credentials stay server-side. Selecting these only binds the draft; it does not create an ad.</p>{!connections.length?<div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">No Meta business connection is available yet. Connect Meta from Promotion Center first.</div>:<div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-xs text-neutral-500">Facebook Page / Instagram profile<select className={`${input} mt-1`} value={connectionId} onChange={e=>{setConnectionId(e.target.value);setAdAccountId("");setPixelId("");}}>{connections.map(c=><option key={c.id} value={c.id}>{c.pageName}{c.instagramUsername?` · @${c.instagramUsername}`:""}</option>)}</select></label><label className="text-xs text-neutral-500">Meta Ad Account<select disabled={accountBusy} className={`${input} mt-1`} value={adAccountId} onChange={e=>{setAdAccountId(e.target.value);setPixelId("");}}><option value="">Select ad account</option>{adAccounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.currency}{a.accountStatus!==1?` · status ${a.accountStatus}`:""}</option>)}</select></label><label className="text-xs text-neutral-500 md:col-span-2">Pixel / dataset (optional)<select className={`${input} mt-1`} value={pixelId} onChange={e=>setPixelId(e.target.value)}><option value="">No pixel selected</option>{pixels.map(p=><option key={p.id} value={p.id}>{p.name}{p.lastFiredTime?` · last fired ${new Date(p.lastFiredTime).toLocaleDateString()}`:""}</option>)}</select></label></div>}
        {chosenConnection&&<div className="mt-4 rounded-xl border border-neutral-200 p-3 text-xs dark:border-neutral-800"><div><b>Page:</b> {chosenConnection.pageName}</div><div className="mt-1"><b>Instagram:</b> {chosenConnection.instagramUsername?`@${chosenConnection.instagramUsername}`:"Not linked"}</div><div className="mt-1"><b>Ad account:</b> {chosenAdAccount?.name||"Not selected"}</div><div className="mt-1"><b>Pixel:</b> {chosenPixel?.name||"None"}</div></div>}
      </section>}

      {view==="summary"&&<section className={panel}><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Confirmation summary</h3><p className="mt-1 text-xs text-neutral-500">Review the entire draft, then run Meta preflight before authorizing any paid delivery.</p></div><span className={chip}>{readiness}/7 ready</span></div>
        <div className="mt-5 divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
          <SummaryRow label="Campaign" value={campaignName||ad.name}/><SummaryRow label="Objective" value={goal.replaceAll("_"," ")}/><SummaryRow label="Genre" value={`${genre||"Unset"} · ${genreSource}`}/><SummaryRow label="Smart Link" value={smartLink?.publicUrl||"Missing"}/><SummaryRow label="Countries" value={chosenCountries.length?`${chosenCountries.slice(0,8).map(c=>c.name).join(", ")}${chosenCountries.length>8?` +${chosenCountries.length-8} more`:""}`:"None"}/><SummaryRow label="Interests" value={targeting.interests.map(i=>i.name).slice(0,12).join(", ")||"None"}/><SummaryRow label="Age / gender" value={`${targeting.ageMin}–${targeting.ageMax} · ${targeting.gender}`}/><SummaryRow label="Placements" value={targeting.placementTargets.map(id=>PLACEMENTS.find(p=>p.id===id)?.label).filter(Boolean).join(", ")||"None"}/><SummaryRow label="Budget" value={`${money(Math.max(0,Math.round((Number(dailyBudget)||0)*100)),currency)} / day`}/><SummaryRow label="Schedule" value={scheduleMode==="always"?"Always active":`${startLocal||"?"} → ${endLocal||"?"} · ${timezone}`}/><SummaryRow label="Meta Page" value={chosenConnection?.pageName||"Not selected"}/><SummaryRow label="Instagram" value={chosenConnection?.instagramUsername?`@${chosenConnection.instagramUsername}`:"Not linked"}/><SummaryRow label="Ad account" value={chosenAdAccount?.name||"Not selected"}/><SummaryRow label="Pixel" value={chosenPixel?.name||"None"}/><SummaryRow label="Selected creatives" value={`${creatives.filter(c=>c.selected&&c.status==="ready").length} ready`}/><SummaryRow label="Headline" value={headline||"None"}/>
        </div>
        <MetaPublishPanel ad={ad} smartLink={smartLink} onUpdated={onSaved} onMessage={onMessage}/>
      </section>}

      <div className="mt-4 flex items-center justify-between gap-3"><div className="text-xs text-neutral-500">Save draft changes before running paid-ad preflight so Meta receives exactly what you reviewed.</div><button disabled={busy} onClick={()=>void save()} className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy?"Saving…":"Save Draft Settings"}</button></div>
    </div>

    <aside className="xl:sticky xl:top-4 xl:self-start"><div className={panel}><div className="flex items-center justify-between gap-2"><div><div className="text-sm font-semibold">Live placement preview</div><div className="text-xs text-neutral-500">Uses the first selected rendered creative.</div></div><span className={chip}>{previewDef.format==="vertical"?"9:16":"4:3"}</span></div>
      <div className="mt-3 flex flex-wrap gap-1.5">{targeting.placementTargets.map(id=><button key={id} onClick={()=>setPreviewPlacement(id)} className={`${chip} ${previewPlacement===id?"border-violet-500 text-violet-500":""}`}>{PLACEMENTS.find(p=>p.id===id)?.label}</button>)}</div>
      <div className={`mx-auto mt-4 overflow-hidden bg-black ${previewDef.format==="vertical"?"aspect-[9/16] max-w-[260px] rounded-[32px]":"aspect-[4/3] w-full rounded-2xl"}`}>
        {previewUrl?<video className="h-full w-full object-cover" src={previewUrl} muted controls={false} loop autoPlay playsInline/>:<div className="grid h-full place-items-center px-6 text-center text-xs text-neutral-500">Generate and select an ad creative to preview this placement.</div>}
      </div>
      <div className="mt-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><div className="text-[10px] uppercase tracking-wider text-neutral-400">Sponsored · {previewDef.platform}</div><div className="mt-1 text-sm">{adText||"Your primary ad text will appear here."}</div><div className="mt-3 flex items-center justify-between gap-3"><div><div className="text-sm font-semibold">{headline||"Listen now"}</div><div className="text-xs text-neutral-500">{smartLink?.title||"YSong Smart Link"}</div></div><div className="rounded-lg bg-neutral-100 px-3 py-2 text-xs font-semibold text-neutral-900">Listen Now</div></div></div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><div className="text-neutral-500">Facebook</div><div className="mt-1 font-semibold">{placementsForPlatform("facebook").length} placements</div></div><div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><div className="text-neutral-500">Instagram</div><div className="mt-1 font-semibold">{placementsForPlatform("instagram").length} placements</div></div></div>
    </div></aside>
  </div>;
}

function SummaryRow({label,value}:{label:string;value:string}){return <div className="grid gap-1 py-3 sm:grid-cols-[170px_1fr]"><div className="text-neutral-500">{label}</div><div className="font-medium capitalize">{value}</div></div>;}
