import { useEffect, useMemo, useRef, useState } from "react";
import { promotionApi, type AdCampaign, type AdCreative, type AdPlacementTarget, type AdTargeting, type MetaAdAccount, type MetaInterest, type MetaPixel, type PromotionCampaign, type PromotionCatalog, type PromotionHealth } from "./api";
import MetaPublishPanel from "./MetaPublishPanel";
import AdOverlayEditor, { type AdOverlaySettings } from "./AdOverlayEditor";

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
  assistantInterest?:MetaInterest|null;
  onAssistantInterestConsumed?:()=>void;
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
function overlaySettings(value:unknown):AdOverlaySettings{if(!value||typeof value!=="object")return {headline:"",caption:"",cta:"Listen now",position:"bottom"};const v=value as Partial<AdOverlaySettings>;return {headline:typeof v.headline==="string"?v.headline:"",caption:typeof v.caption==="string"?v.caption:"",cta:typeof v.cta==="string"?v.cta:"Listen now",position:v.position==="top"||v.position==="center"?v.position:"bottom"};}
function formatAudienceNumber(n:number|undefined){return Number(n||0).toLocaleString();}
function formatAudienceRange(item:{audienceSizeLower?:number;audienceSizeUpper?:number}){const low=Number(item.audienceSizeLower||0),high=Number(item.audienceSizeUpper||0);if(!low&&!high)return "Meta sizing unavailable";return `${formatAudienceNumber(low)}-${formatAudienceNumber(high||low)}`;}

export default function AudienceCampaignSetup({ad,smartLink,health,creatives,creativeUrls,interestSeeds=[],assistantInterest,onAssistantInterestConsumed,onSaved,onMessage}:Props){
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
  const [overlay,setOverlay]=useState(()=>overlaySettings(ad.targeting?.adOverlay));
  const [language,setLanguage]=useState(ad.language||"en");
  const [coverArtObjectKey,setCoverArtObjectKey]=useState(ad.coverArtObjectKey||"");
  const [coverUrl,setCoverUrl]=useState("");
  const [connectionId,setConnectionId]=useState(ad.metaConnectionId||health?.meta.connections.find(c=>c.active)?.id||health?.meta.connections[0]?.id||"");
  const [adAccounts,setAdAccounts]=useState<MetaAdAccount[]>([]);
  const [adAccountId,setAdAccountId]=useState(ad.metaAdAccountId||"");
  const [pixels,setPixels]=useState<MetaPixel[]>([]);
  const [pixelId,setPixelId]=useState(ad.metaPixelId||"");
  const [accountError,setAccountError]=useState("");
  const [pixelError,setPixelError]=useState("");
  const [pixelBusy,setPixelBusy]=useState(false);
  const [interestQuery,setInterestQuery]=useState("");
  const [interestResults,setInterestResults]=useState<MetaInterest[]>([]);
  const [interestBusy,setInterestBusy]=useState(false);
  const [interestError,setInterestError]=useState("");
  const interestRequestSeq=useRef(0);
  const [countryQuery,setCountryQuery]=useState("");
  const [previewPlacement,setPreviewPlacement]=useState<AdPlacementTarget>(targeting.placementTargets[0]||"instagram_reels");
  const [busy,setBusy]=useState(false);
  const [accountBusy,setAccountBusy]=useState(false);

  useEffect(()=>{void promotionApi.catalog().then(setCatalog).catch(()=>{});},[]);
  useEffect(()=>{
    const nextTargeting=asTargeting(ad.targeting);setTargeting(nextTargeting);setOverlay(overlaySettings(ad.targeting?.adOverlay));setInterestQuery("");setInterestResults([]);setCampaignName(ad.name||"");setGoal(ad.goal);setGenre(ad.genre||"");setGenreSource(ad.genreSource||"ysong");setDailyBudget((ad.dailyBudgetMinor/100).toFixed(2));setCurrency(ad.currency||"USD");setScheduleMode(ad.scheduleStart?"scheduled":"always");setTimezone(ad.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC");setStartLocal(localParts(ad.scheduleStart,ad.timezone||"UTC"));setEndLocal(localParts(ad.scheduleEnd,ad.timezone||"UTC"));setAdText(ad.adText||"");setHeadline(ad.adHeadline||"Listen now");setLanguage(ad.language||"en");setCoverArtObjectKey(ad.coverArtObjectKey||"");setConnectionId(ad.metaConnectionId||health?.meta.connections.find(c=>c.active)?.id||health?.meta.connections[0]?.id||"");setAdAccountId(ad.metaAdAccountId||"");setPixelId(ad.metaPixelId||"");
  },[ad.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!coverArtObjectKey){setCoverUrl("");return;}let stop=false;void promotionApi.signedUrl(coverArtObjectKey).then(r=>{if(!stop)setCoverUrl(r.url);}).catch(()=>{if(!stop)setCoverUrl("");});return()=>{stop=true;};},[coverArtObjectKey]);
  useEffect(()=>{
    if(!connectionId){setAdAccounts([]);setAccountError("");return;}let stop=false;setAdAccounts([]);setAccountError("");setAccountBusy(true);void promotionApi.adAccounts(connectionId).then(out=>{if(stop)return;setAdAccounts(out.adAccounts);setAdAccountId(current=>out.adAccounts.some(a=>a.id===current)?current:out.adAccounts[0]?.id||"");}).catch(()=>{if(!stop){setAdAccounts([]);setAccountError("Meta did not return ad accounts for this connection. Check asset access and try reconnecting.");}}).finally(()=>{if(!stop)setAccountBusy(false);});return()=>{stop=true;};
  },[connectionId]);
  useEffect(()=>{
    if(!adAccountId||!connectionId){setPixels([]);setPixelError("");setPixelBusy(false);return;}let stop=false;setPixels([]);setPixelError("");setPixelBusy(true);void promotionApi.pixels(adAccountId,connectionId).then(out=>{if(stop)return;setPixels(out.pixels);setPixelId(current=>out.pixels.some(p=>p.id===current)?current:"");}).catch(()=>{if(!stop){setPixels([]);setPixelId("");setPixelError("Meta could not return Pixel or dataset assets. Check asset permissions; selecting one is optional.");}}).finally(()=>{if(!stop)setPixelBusy(false);});return()=>{stop=true;};
  },[adAccountId,connectionId]);
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
  const supportsFacebook=!!chosenConnection?.pageId;
  const supportsInstagram=!!chosenConnection?.instagramUserId;
  const chosenAdAccount=adAccounts.find(a=>a.id===adAccountId)||null;
  const chosenPixel=pixels.find(p=>p.id===pixelId)||null;
  const chosenCountries=catalog?.countries.filter(c=>targeting.countries.includes(c.code))||targeting.countries.map(code=>({code,name:code}));
  const timezones=useMemo(()=>supportedTimezones(),[]);
  const estimateDays=useMemo(()=>{if(scheduleMode!=="scheduled"||!startLocal||!endLocal)return null;try{return Math.max(0,(new Date(zonedLocalToIso(endLocal,timezone)!).getTime()-new Date(zonedLocalToIso(startLocal,timezone)!).getTime())/86400000);}catch{return null;}},[scheduleMode,startLocal,endLocal,timezone]);
  const estimatedSpend=estimateDays==null?null:Math.max(0,Number(dailyBudget)||0)*estimateDays;
  const audienceEstimate=useMemo(()=>{
    if(targeting.interests.length===0)return {value:"Unavailable",detail:"Add a Meta interest to see its sizing signal. Meta does not provide a combined estimate here."};
    if(targeting.interests.length>1)return {value:"Unavailable",detail:"Meta provides sizing for each interest separately. Combined reach is unavailable, so these ranges are not added together."};
    const interest=targeting.interests[0];
    const low=Number(interest.audienceSizeLower||0),high=Number(interest.audienceSizeUpper||0);
    if(!low&&!high)return {value:"Unavailable",detail:"Meta did not return a sizing range for this interest."};
    return {value:formatAudienceRange(interest),detail:"Limited Meta sizing signal for this interest only. It is not the campaign's combined audience or expected reach; location, age, gender, and placements are not reflected."};
  },[targeting.interests]);

  function toggleCountry(code:string){setTargeting(v=>({...v,countries:v.countries.includes(code)?v.countries.filter(x=>x!==code):[...v.countries,code],countryPreset:"custom"}));}
  function togglePlacement(id:AdPlacementTarget){setTargeting(v=>{const next=v.placementTargets.includes(id)?v.placementTargets.filter(x=>x!==id):[...v.placementTargets,id];return {...v,placementTargets:next};});}
  function togglePlatform(platform:"facebook"|"instagram"){
    const supported=platform==="facebook"?supportsFacebook:supportsInstagram;
    setTargeting(v=>{
      const platformPlacements=PLACEMENTS.filter(p=>p.platform===platform).map(p=>p.id);
      const enabled=platformPlacements.some(id=>v.placementTargets.includes(id));
      if(!supported&&!enabled)return v;
      const placementTargets=enabled?v.placementTargets.filter(id=>!platformPlacements.includes(id)):[...v.placementTargets,...platformPlacements];
      return {...v,placementTargets};
    });
  }
  function addResolvedInterest(item:MetaInterest){setTargeting(v=>({...v,interests:[...v.interests.filter(x=>x.id!==item.id),{id:item.id,name:item.name,audienceSizeLower:item.audienceSizeLower,audienceSizeUpper:item.audienceSizeUpper,path:item.path}].slice(0,200),interestKeywords:v.interestKeywords.filter(k=>k.toLowerCase()!==item.name.toLowerCase())}));setInterestQuery("");setInterestResults([]);}
  useEffect(()=>{if(!assistantInterest)return;addResolvedInterest(assistantInterest);onAssistantInterestConsumed?.();},[assistantInterest]); // eslint-disable-line react-hooks/exhaustive-deps
  function searchSuggestion(seed:string){setInterestQuery(seed);}
  async function uploadCover(files:FileList|null){const file=files?.[0];if(!file)return;setBusy(true);try{const out=await promotionApi.upload(file);setCoverArtObjectKey(out.objectKey);onMessage("Custom campaign cover art uploaded. Save settings to attach it to this draft.");}catch(e){onMessage(e instanceof Error?e.message:"Cover art upload failed.");}finally{setBusy(false);}}
  async function save(){
    if(!targeting.placementTargets.length){onMessage("Choose at least one Facebook or Instagram placement.");return;}
    const selectedPlatforms=unique(targeting.placementTargets.map(id=>PLACEMENTS.find(p=>p.id===id)?.platform).filter((x):x is "facebook"|"instagram"=>!!x));
    if(selectedPlatforms.includes("facebook")&&!supportsFacebook){onMessage("Facebook placements need a connected Facebook Page. Choose a connection with a Page or remove Facebook placements.");return;}
    if(selectedPlatforms.includes("instagram")&&!supportsInstagram){onMessage("Instagram placements need a connected Instagram account. Choose a connection with an Instagram account or remove Instagram placements.");return;}
    if(!targeting.countries.length){onMessage("Choose at least one target country before saving the audience.");return;}
    if(targeting.ageMin>targeting.ageMax){onMessage("Minimum age cannot be greater than maximum age.");return;}
    if(!Number.isFinite(Number(dailyBudget))||Number(dailyBudget)<1){onMessage("Set a daily budget of at least 1 in the selected currency.");return;} if(scheduleMode==="scheduled"&&(!startLocal||!endLocal)){onMessage("Scheduled campaigns need both a start and end time.");return;}
    const platforms=unique(targeting.placementTargets.map(id=>PLACEMENTS.find(p=>p.id===id)?.platform).filter((x):x is "facebook"|"instagram"=>!!x));
    setBusy(true);
    try{
      const out=await promotionApi.updateAdCampaign(ad.id,{
        name:campaignName.trim()||ad.name,goal,genre,genreSource,dailyBudgetMinor:Math.max(100,Math.round((Number(dailyBudget)||0)*100)),currency,
        scheduleStart:scheduleMode==="scheduled"?zonedLocalToIso(startLocal,timezone):null,
        scheduleEnd:scheduleMode==="scheduled"?zonedLocalToIso(endLocal,timezone):null,
        timezone,placements:platforms,targeting:{...targeting,platforms,adOverlay:overlay},adText,adHeadline:headline,language,
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
      <div className="mb-4 flex flex-wrap gap-2">{(["audience","budget","ad","accounts","summary"] as SetupView[]).map(k=><button key={k} onClick={()=>setView(k)} className={`${chip} ${view===k?"border-violet-500 bg-violet-500/10 text-violet-500":""}`}>{({audience:"Audience",budget:"Budget & Schedule",ad:"Ad Settings",accounts:"Connected assets",summary:"Confirmation"} as Record<SetupView,string>)[k]}</button>)}</div>

      {view==="audience"&&<div className="space-y-4">
        <section className={panel}><h3 className="text-lg font-semibold">Where your ad appears</h3><p className="mt-1 text-xs text-neutral-500">Choose Facebook, Instagram, or both. Both are selected by default.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{(["facebook","instagram"] as const).map(platform=>{const supported=platform==="facebook"?supportsFacebook:supportsInstagram;const selected=PLACEMENTS.some(p=>p.platform===platform&&targeting.placementTargets.includes(p.id));return <label key={platform} className={`flex items-center gap-3 rounded-xl border p-3 ${selected?"border-violet-500 bg-violet-500/5":"border-neutral-200 dark:border-neutral-800"} ${!supported?"opacity-60":""}`}><input type="checkbox" checked={selected} disabled={!supported&&!selected} onChange={()=>togglePlatform(platform)}/><span><span className="block text-sm font-medium">{platform==="facebook"?"Facebook":"Instagram"}</span><span className="block text-xs text-neutral-500">{supported?"Available for this connected account":"Not available with this connection"}</span></span></label>;})}</div></section>

        <section className={panel}><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Location</h3><p className="text-xs text-neutral-500">Choose the countries where you want this ad to reach people.</p></div><span className={chip}>{targeting.countries.length} selected</span></div>
          <input className={`${input} mt-4`} value={countryQuery} onChange={e=>setCountryQuery(e.target.value)} placeholder="Search any country…"/>
          <div className="mt-3 max-h-52 overflow-auto rounded-xl border border-neutral-200 p-2 dark:border-neutral-800"><div className="grid gap-1 sm:grid-cols-2">{countryMatches.map(c=><label key={c.code} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"><input type="checkbox" checked={targeting.countries.includes(c.code)} onChange={()=>toggleCountry(c.code)}/><span>{c.name}</span><span className="ml-auto text-neutral-400">{c.code}</span></label>)}</div></div>
          <div className="mt-3 flex flex-wrap gap-1.5">{chosenCountries.slice(0,36).map(c=><button key={c.code} onClick={()=>toggleCountry(c.code)} className={chip}>{c.name} ×</button>)}{chosenCountries.length>36&&<span className={chip}>+{chosenCountries.length-36} more</span>}</div>
        </section>

        <section className={panel}><h3 className="text-lg font-semibold">Age & gender</h3><p className="mt-1 text-xs text-neutral-500">Set an age range and who should see your ad.</p><div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-xs text-neutral-500">From<select className={`${input} mt-1`} value={targeting.ageMin} onChange={e=>setTargeting(v=>({...v,ageMin:Number(e.target.value)}))}>{Array.from({length:48},(_,i)=>i+18).map(n=><option key={n} value={n}>{n===65?"65+":n}</option>)}</select></label><label className="text-xs text-neutral-500">To<select className={`${input} mt-1`} value={targeting.ageMax} onChange={e=>setTargeting(v=>({...v,ageMax:Number(e.target.value)}))}>{Array.from({length:48},(_,i)=>i+18).map(n=><option key={n} value={n}>{n===65?"65+":n}</option>)}</select></label><label className="text-xs text-neutral-500">Gender<select className={`${input} mt-1`} value={targeting.gender} onChange={e=>setTargeting(v=>({...v,gender:e.target.value as AdTargeting["gender"]}))}><option value="all">All</option><option value="female">Women</option><option value="male">Men</option></select></label></div>
        </section>

        <details className="group"><summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/5 px-4 py-3 text-sm font-semibold text-violet-700 hover:bg-violet-500/10 dark:text-violet-300">Advanced settings <span className="text-xs font-normal text-neutral-500">Optional ? interests and placements</span></summary><button type="button" className="fixed inset-0 z-50 hidden bg-black/40 group-open:block" aria-label="Close advanced settings" onClick={e=>e.currentTarget.closest("details")?.removeAttribute("open")}/><div className="fixed inset-y-0 right-0 z-50 hidden w-full max-w-xl overflow-y-auto border-l border-neutral-200 bg-white p-5 shadow-2xl group-open:block dark:border-neutral-800 dark:bg-neutral-950"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Advanced campaign settings</h2><p className="mt-1 text-xs text-neutral-500">Optional controls supported by this campaign. Detailed exclusions and custom audiences are managed in Meta.</p></div><button type="button" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700" onClick={e=>e.currentTarget.closest("details")?.removeAttribute("open")}>Close</button></div>
          <div className="mt-5 text-sm font-semibold">Ad placements</div><p className="mt-1 text-xs text-neutral-500">Choose exactly where creatives are eligible to run. Feed placements use the 4:3 render; Reels/Stories use 9:16.</p><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{PLACEMENTS.map(p=><label key={p.id} className={`rounded-xl border p-3 text-sm ${targeting.placementTargets.includes(p.id)?"border-violet-500 bg-violet-500/5":"border-neutral-200 dark:border-neutral-800"}`}><input className="mr-2" type="checkbox" checked={targeting.placementTargets.includes(p.id)} onChange={()=>togglePlacement(p.id)}/>{p.label}<div className="ml-5 mt-1 text-[10px] uppercase text-neutral-400">{p.format==="vertical"?"9:16":"4:3"}</div></label>)}</div>

        <section className="rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800" aria-live="polite"><div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h3 className="text-sm font-semibold">Estimated audience</h3><span className="text-sm font-semibold tabular-nums">{audienceEstimate.value}</span></div><p className="mt-1 text-xs text-neutral-500">{audienceEstimate.detail}</p></section>

        <section className={panel}><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Interests</h3><p className="text-xs text-neutral-500">Find your people. Type a couple characters and YSong searches Meta's real ad-interest catalog with the audience range Meta returns.</p></div><span className={chip}>{targeting.interests.length} selected</span></div>
          {!!interestSeeds.length&&<div className="mt-3"><div className="text-[11px] uppercase tracking-wider text-neutral-400">Suggested searches from YSong</div><div className="mt-2 flex flex-wrap gap-1.5">{unique(interestSeeds.filter(Boolean)).slice(0,30).map(seed=><button key={seed} onClick={()=>searchSuggestion(seed)} className={chip}>{seed}</button>)}</div><div className="mt-1 text-[10px] text-neutral-400">Suggestions are search terms only. They become ad targeting only after you choose a verified Meta interest below.</div></div>}
          <div className="mt-4 flex flex-wrap gap-2">{targeting.interests.map(x=><span key={x.id} className="inline-flex max-w-full items-center gap-2 rounded-full border border-violet-300 bg-violet-500/5 py-1.5 pl-3 pr-1.5 text-xs dark:border-violet-800"><span className="min-w-0"><span className="font-medium">{x.name}</span><span className="ml-1.5 text-[10px] text-neutral-500">Meta range: {formatAudienceRange(x)}</span></span><button aria-label={`Remove ${x.name}`} onClick={()=>setTargeting(v=>({...v,interests:v.interests.filter(i=>i.id!==x.id)}))} className="rounded-full px-1.5 py-0.5 text-neutral-400 hover:bg-red-500/10 hover:text-red-500">�</button></span>)}</div>
          {!connectionId?<div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">Connect/select a Meta business account in Accounts & Profile before resolving interests.</div>:<div className="relative mt-4"><label htmlFor="meta-interest-search" className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-neutral-300">Search Meta interests</label><div className="relative"><input id="meta-interest-search" className={`${input} pr-10`} value={interestQuery} onChange={e=>setInterestQuery(e.target.value)} placeholder="Type a genre, artist, or interest" aria-describedby="meta-interest-search-help" autoComplete="off"/><div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">{interestBusy?"...":""}</div></div>
            {interestQuery.trim().length>=2&&<div className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-950" role="listbox" aria-label="Meta interest search results">{interestError?<div className="p-3 text-xs text-red-500">{interestError}</div>:interestResults.length?interestResults.map(r=>{const selected=targeting.interests.some(x=>x.id===r.id);return <button key={r.id} type="button" role="option" aria-selected={selected} disabled={selected} onClick={()=>addResolvedInterest(r)} className="block w-full border-b border-neutral-100 px-3 py-2.5 text-left text-xs last:border-b-0 hover:bg-neutral-50 disabled:opacity-45 dark:border-neutral-900 dark:hover:bg-neutral-900"><div className="font-medium">{r.name}{selected?" � added":""}</div><div className="mt-0.5 text-neutral-500">{formatAudienceRange(r)}</div>{Array.isArray(r.path)&&r.path.length>0&&<div className="mt-0.5 truncate text-[10px] text-neutral-400">{r.path.map(String).join(" � ")}</div>}</button>}):!interestBusy?<div className="p-3 text-xs text-neutral-500">No matching Meta interests.</div>:<div className="p-3 text-xs text-neutral-500">Searching Meta interests�</div>}</div>}
            <div id="meta-interest-search-help" className="mt-2 text-[10px] text-neutral-400">Searches Meta live after 2 characters. Select any result to add it; genre suggestions above only fill this search.</div>
          </div>}
        </section></div></details>
      </div>}

      {view==="budget"&&<section className={panel}><h3 className="text-lg font-semibold">Budget & schedule</h3><p className="mt-1 text-xs text-neutral-500">Set at least 1 unit per day in the selected currency. Meta may require a higher minimum for this account, currency, or objective. Meta bills your connected Meta payment method; YSong does not hold ad-spend funds.</p><div className="mt-4 flex flex-wrap gap-2">{[1,2,5,10].map(amount=><button key={amount} type="button" aria-pressed={dailyBudget===String(amount)} onClick={()=>setDailyBudget(String(amount))} className={`${chip} ${dailyBudget===String(amount)?"border-violet-500 bg-violet-500/10 text-violet-500":""}`}>{amount} {currency}/day</button>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_130px]"><label className="text-xs text-neutral-500">Custom daily budget<input className={`${input} mt-1`} type="number" min="1" step="0.01" value={dailyBudget} onChange={e=>setDailyBudget(e.target.value)}/></label><label className="text-xs text-neutral-500">Currency<select className={`${input} mt-1`} value={currency} onChange={e=>setCurrency(e.target.value)}>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></label></div>
        <div className="mt-5 flex gap-2"><button onClick={()=>setScheduleMode("always")} className={`${chip} ${scheduleMode==="always"?"border-violet-500 bg-violet-500/10 text-violet-500":""}`}>Always active</button><button onClick={()=>setScheduleMode("scheduled")} className={`${chip} ${scheduleMode==="scheduled"?"border-violet-500 bg-violet-500/10 text-violet-500":""}`}>Scheduled</button></div>
        {scheduleMode==="scheduled"&&<div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-xs text-neutral-500 md:col-span-2">Timezone<select className={`${input} mt-1`} value={timezone} onChange={e=>setTimezone(e.target.value)}>{timezones.map(t=><option key={t}>{t}</option>)}</select></label><label className="text-xs text-neutral-500">Start<input className={`${input} mt-1`} type="datetime-local" value={startLocal} onChange={e=>setStartLocal(e.target.value)}/></label><label className="text-xs text-neutral-500">End<input className={`${input} mt-1`} type="datetime-local" value={endLocal} onChange={e=>setEndLocal(e.target.value)}/></label></div>}
        <div className="mt-5 rounded-xl border border-neutral-200 p-4 text-sm dark:border-neutral-800"><div className="flex justify-between"><span>Daily</span><b>{money(Math.max(0,Math.round((Number(dailyBudget)||0)*100)),currency)}</b></div>{estimatedSpend!=null&&<><div className="mt-2 flex justify-between"><span>Approx. duration</span><b>{estimateDays?.toFixed(1)} days</b></div><div className="mt-2 flex justify-between"><span>Planned maximum spend</span><b>{new Intl.NumberFormat(undefined,{style:"currency",currency}).format(estimatedSpend)}</b></div></>}<p className="mt-3 text-xs text-neutral-500">Actual Meta delivery/spend can vary. YSong will show the final settings again before any later publish action.</p></div>
      </section>}

      {view==="ad"&&<section className={panel}><h3 className="text-lg font-semibold">Ad settings</h3><div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-xs text-neutral-500 md:col-span-2">Campaign name<input className={`${input} mt-1`} value={campaignName} maxLength={180} onChange={e=>setCampaignName(e.target.value)}/></label><label className="text-xs text-neutral-500">Objective<select className={`${input} mt-1`} value={goal} onChange={e=>setGoal(e.target.value as AdCampaign["goal"])}><option value="song_growth">Promote a song</option><option value="release_growth">Promote a release</option><option value="fan_growth">Grow fan audience</option><option value="presave">Pre-save campaign</option><option value="custom">Custom funnel</option></select></label><label className="text-xs text-neutral-500">Genre<input className={`${input} mt-1`} value={genre} maxLength={160} onChange={e=>{setGenre(e.target.value);setGenreSource("user");}} placeholder="YSong Audio Intelligence suggestion or your own"/><div className="mt-1 text-[10px] text-neutral-400">Source: {genreSource}{genreSource==="user"?" · manually overridden":" · YSong"}</div></label></div><div className="mt-4 space-y-3"><label className="block text-xs text-neutral-500">Primary ad text<textarea className={`${input} mt-1 min-h-28`} value={adText} maxLength={2200} onChange={e=>setAdText(e.target.value)} placeholder="Tell listeners what they're hearing…"/></label><label className="block text-xs text-neutral-500">Platform headline<input className={`${input} mt-1`} value={headline} maxLength={255} onChange={e=>setHeadline(e.target.value)} placeholder="Listen to the new release"/></label><label className="block text-xs text-neutral-500">Text language<select className={`${input} mt-1`} value={language} onChange={e=>setLanguage(e.target.value)}>{LANGUAGES.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label></div>
        <AdOverlayEditor value={overlay} onChange={setOverlay}/>
        <div className="mt-5"><div className="text-sm font-semibold">Cover art</div><p className="mt-1 text-xs text-neutral-500">Leave blank to use the Smart Link/release artwork later. Uploading here creates a campaign-specific override.</p><div className="mt-3 flex items-center gap-3">{coverUrl?<img className="h-20 w-20 rounded-xl object-cover" src={coverUrl}/>:<div className="grid h-20 w-20 place-items-center rounded-xl border border-dashed border-neutral-300 text-[10px] text-neutral-400 dark:border-neutral-700">Inherited</div>}<label className="cursor-pointer rounded-xl border border-neutral-300 px-3 py-2 text-xs dark:border-neutral-700">Upload override<input className="hidden" type="file" accept="image/*" onChange={e=>void uploadCover(e.target.files)}/></label>{coverArtObjectKey&&<button onClick={()=>{setCoverArtObjectKey("");setCoverUrl("");}} className="text-xs text-red-500">Use inherited art</button>}</div></div>
      </section>}

      {view==="accounts"&&<section className={panel}><h3 className="text-lg font-semibold">Connected Meta assets</h3><p className="mt-1 text-xs text-neutral-500">Choose the Page and Instagram identity you connected, then an ad account. A Pixel or dataset is optional. These choices stay on this draft; YSong has not created or published an ad.</p>{!connections.length?<div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300"><div className="font-semibold">No Meta connection available</div><p className="mt-1">Connect a Facebook Page in Promotion Center, then return here. No Meta assets have been selected.</p></div>:<>
        <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-xs text-neutral-500">Facebook Page and Instagram identity<select className={`${input} mt-1`} value={connectionId} onChange={e=>{setConnectionId(e.target.value);setAdAccountId("");setPixelId("");}}><option value="">Choose a connected identity</option>{connections.map(c=><option key={c.id} value={c.id}>{c.pageName||"Facebook Page"}{c.instagramUsername?` · @${c.instagramUsername}`:" · Instagram not linked"}</option>)}</select><span className="mt-1 block text-[10px]">The Page and linked Instagram identity are provided together by Meta.</span></label><label className="text-xs text-neutral-500">Meta ad account<select disabled={!connectionId||accountBusy||!!accountError} className={`${input} mt-1`} value={adAccountId} onChange={e=>{setAdAccountId(e.target.value);setPixelId("");}}><option value="">{accountBusy?"Loading ad accounts…":accountError?"Ad accounts unavailable":"Choose an ad account"}</option>{adAccounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.currency}{a.accountStatus!==1?" · needs attention":""}</option>)}</select></label></div>
        {!accountBusy&&accountError&&<div role="alert" className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300"><b>Ad accounts could not be loaded.</b> {accountError} Confirm the Meta connection has permission to access an ad account.</div>}
        {!accountBusy&&connectionId&&!accountError&&adAccounts.length===0&&<div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">No ad accounts were shared with this connection. In Meta, grant access to an ad account and reconnect if needed.</div>}
        {!!chosenConnection&&!chosenConnection.instagramUsername&&<div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">This Page has no Instagram identity linked in the Meta connection. Facebook is available; Instagram placements may need a linked identity.</div>}
        <label className="mt-4 block text-xs text-neutral-500">Pixel / dataset <span className="font-normal">(optional)</span><select disabled={!adAccountId||pixelBusy||!!pixelError} className={`${input} mt-1`} value={pixelId} onChange={e=>setPixelId(e.target.value)}><option value="">{!adAccountId?"Choose an ad account first":pixelBusy?"Loading Pixels and datasets…":pixelError?"Pixels and datasets unavailable":"No Pixel selected"}</option>{pixels.map(p=><option key={p.id} value={p.id}>{p.name}{p.lastFiredTime?` · recently active ${new Date(p.lastFiredTime).toLocaleDateString()}`:""}</option>)}</select></label>
        {pixelError&&<div role="alert" className="mt-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300"><b>Pixels and datasets could not be loaded.</b> {pixelError} You can continue without one, or review asset permissions in Meta.</div>}
        {!pixelBusy&&!pixelError&&adAccountId&&pixels.length===0&&<p className="mt-2 text-xs text-neutral-500">No Pixel or dataset was shared for this ad account. You can continue without one.</p>}
      </>}
        {chosenConnection&&<div className="mt-4 rounded-xl border border-neutral-200 p-3 text-xs dark:border-neutral-800"><div><b>Page:</b> {chosenConnection.pageName}</div><div className="mt-1"><b>Instagram:</b> {chosenConnection.instagramUsername?`@${chosenConnection.instagramUsername}`:"Not linked"}</div><div className="mt-1"><b>Ad account:</b> {chosenAdAccount?.name||"Not selected"}</div><div className="mt-1"><b>Pixel:</b> {chosenPixel?.name||"None"}</div></div>}
      </section>}

      {view==="summary"&&<section className={panel}><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Confirmation summary</h3><p className="mt-1 text-xs text-neutral-500">Review the entire draft, then run Meta preflight before authorizing any paid delivery.</p></div><span className={chip}>{readiness}/7 ready</span></div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            <SummaryRow label="Song / release" value={`${smartLink?.artistName||"Artist not set"} - ${smartLink?.title||"Release not linked"}`} />
            <SummaryRow label="Genre hints" value={`${genre||"None"} (${genreSource})${interestSeeds.length?` - Ideas: ${unique(interestSeeds).slice(0,5).join(", ")}`:""}`} />
            <SummaryRow label="Destination" value={smartLink?.publicUrl||"Smart Link URL unavailable"} />
            <SummaryRow label="Location" value={chosenCountries.map(c=>c.name).join(", ")||"None selected"} />
            <SummaryRow label="Age / gender" value={`${targeting.ageMin}-${targeting.ageMax===65?"65+":targeting.ageMax} - ${targeting.gender}`} />
            <SummaryRow label="Interests" value={targeting.interests.map(i=>`${i.name} (${formatAudienceRange(i)})`).join(", ")||"None selected"} />
            <SummaryRow label="Estimated audience" value={`${audienceEstimate.value}. ${audienceEstimate.detail}`} />
            <SummaryRow label="Facebook placements" value={placementsForPlatform("facebook").map(p=>p.label).join(", ")||"None"} />
            <SummaryRow label="Instagram placements" value={placementsForPlatform("instagram").map(p=>p.label).join(", ")||"None"} />
            <SummaryRow label="Schedule" value={scheduleMode==="always"?"Always active":`${startLocal||"Start not set"} to ${endLocal||"End not set"} - ${timezone}`} />
            <SummaryRow label="Budget" value={`${money(Math.max(0,Math.round((Number(dailyBudget)||0)*100)),currency)} per day${estimatedSpend!=null?` - planned max ${new Intl.NumberFormat(undefined,{style:"currency",currency}).format(estimatedSpend)}`:" - total unavailable until an end date is set"}`} />
            <SummaryRow label="Facebook Page" value={chosenConnection?.pageName||"Not selected"} />
            <SummaryRow label="Instagram identity" value={chosenConnection?.instagramUsername?`@${chosenConnection.instagramUsername}`:"Not linked"} />
            <SummaryRow label="Ad account" value={chosenAdAccount?`${chosenAdAccount.name} - ${chosenAdAccount.currency}`:"Not selected"} />
            <SummaryRow label="Pixel / dataset" value={chosenPixel?.name||"None selected"} />
            <SummaryRow label="Creative" value={`${creatives.filter(c=>c.selected&&c.status==="ready").length} ready creative(s) - ${headline||"No headline"}`} />
          </div>
          <div><div className="mb-2 text-xs font-semibold text-neutral-500">Creative preview - {previewDef.label}</div><div className={`relative overflow-hidden bg-black ${previewDef.format==="vertical"?"aspect-[9/16] rounded-2xl":"aspect-[4/3] rounded-xl"}`}>
            {previewUrl?<video className="absolute inset-0 h-full w-full object-cover" src={previewUrl} controls playsInline preload="metadata"/>:<div className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-neutral-400">No rendered creative is ready for this placement.</div>}
          </div><p className="mt-2 text-xs text-neutral-500">{adText||"No primary text added."}</p></div>
        </div>
        <details className="mt-4 rounded-xl border border-neutral-200 px-4 py-3 text-xs dark:border-neutral-800"><summary className="cursor-pointer font-medium">Show provider reference IDs</summary><dl className="mt-3 space-y-2 text-neutral-500"><SummaryRow label="YSong campaign" value={ad.id}/><SummaryRow label="Source track" value={ad.sourceTrackId||"Not linked"}/><SummaryRow label="Meta connection" value={connectionId||"Not selected"}/><SummaryRow label="Meta ad account" value={adAccountId||"Not selected"}/><SummaryRow label="Meta Page" value={chosenConnection?.pageId||"Not available"}/><SummaryRow label="Instagram account" value={chosenConnection?.instagramUserId||"Not available"}/><SummaryRow label="Pixel / dataset" value={pixelId||"Not selected"}/></dl></details>
        <MetaPublishPanel ad={ad} smartLink={smartLink} onUpdated={onSaved} onMessage={onMessage}/>
      </section>}

      <div className="mt-4 flex items-center justify-between gap-3"><div className="text-xs text-neutral-500">Save draft changes before running paid-ad preflight so Meta receives exactly what you reviewed.</div><button disabled={busy} onClick={()=>void save()} className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy?"Saving…":"Save Draft Settings"}</button></div>
    </div>

    <aside className="xl:sticky xl:top-4 xl:self-start"><div className={panel}><div className="flex items-center justify-between gap-2"><div><div className="text-sm font-semibold">Live placement preview</div><div className="text-xs text-neutral-500">Uses the first selected rendered creative.</div></div><span className={chip}>{previewDef.format==="vertical"?"9:16":"4:3"}</span></div>
      <div className="mt-3 flex flex-wrap gap-1.5">{targeting.placementTargets.map(id=><button key={id} onClick={()=>setPreviewPlacement(id)} className={`${chip} ${previewPlacement===id?"border-violet-500 text-violet-500":""}`}>{PLACEMENTS.find(p=>p.id===id)?.label}</button>)}</div>
      <div className={`relative mx-auto mt-4 overflow-hidden bg-black ${previewDef.format==="vertical"?"aspect-[9/16] max-w-[260px] rounded-[32px]":"aspect-[4/3] w-full rounded-2xl"}`}>
        {previewUrl?<video className="absolute inset-0 h-full w-full object-cover" src={previewUrl} muted controls={false} loop autoPlay playsInline/>:<div className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-neutral-500">Generate and select an ad creative to preview this placement.</div>}
      </div>
      <div className="mt-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><div className="text-[10px] uppercase tracking-wider text-neutral-400">Sponsored · {previewDef.platform}</div><div className="mt-1 text-sm">{adText||"Your primary ad text will appear here."}</div><div className="mt-3 flex items-center justify-between gap-3"><div><div className="text-sm font-semibold">{headline||"Listen now"}</div><div className="text-xs text-neutral-500">{smartLink?.title||"YSong Smart Link"}</div></div><div className="rounded-lg bg-neutral-100 px-3 py-2 text-xs font-semibold text-neutral-900">Listen Now</div></div></div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><div className="text-neutral-500">Facebook</div><div className="mt-1 font-semibold">{placementsForPlatform("facebook").length} placements</div></div><div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><div className="text-neutral-500">Instagram</div><div className="mt-1 font-semibold">{placementsForPlatform("instagram").length} placements</div></div></div>
    </div></aside>
  </div>;
}

function SummaryRow({label,value}:{label:string;value:string}){return <div className="grid gap-1 py-3 sm:grid-cols-[170px_1fr]"><div className="text-neutral-500">{label}</div><div className="font-medium capitalize">{value}</div></div>;}
