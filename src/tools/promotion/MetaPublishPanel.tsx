import { useEffect, useMemo, useState } from "react";
import { promotionApi, type AdCampaign, type MetaPublishPreflight, type MetaRemoteStatus, type PromotionCampaign } from "./api";

const box="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800";
const input="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 dark:border-neutral-700 dark:bg-neutral-950";

type Props={
  ad:AdCampaign;
  smartLink:PromotionCampaign|null;
  onUpdated:(ad:AdCampaign)=>void;
  onMessage:(message:string)=>void;
};

type Acks={settingsCorrect:boolean;rightsConfirmed:boolean;metaBilling:boolean;spendAuthorized:boolean};
const EMPTY_ACKS:Acks={settingsCorrect:false,rightsConfirmed:false,metaBilling:false,spendAuthorized:false};

function money(minor:number,currency:string){try{return new Intl.NumberFormat(undefined,{style:"currency",currency}).format(minor/100);}catch{return `${currency} ${(minor/100).toFixed(2)}`;}}
function remoteState(remote:MetaRemoteStatus|null){return String(remote?.campaign?.effective_status||remote?.campaign?.status||"").toUpperCase();}
function errText(error:unknown,fallback:string){return error instanceof Error?error.message:fallback;}

export default function MetaPublishPanel({ad,smartLink,onUpdated,onMessage}:Props){
  const [preflight,setPreflight]=useState<MetaPublishPreflight|null>(null);
  const [remote,setRemote]=useState<MetaRemoteStatus|null>(null);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [dsaBeneficiary,setDsaBeneficiary]=useState(ad.dsaBeneficiary||"");
  const [dsaPayor,setDsaPayor]=useState(ad.dsaPayor||"");
  const [activateSmartLink,setActivateSmartLink]=useState(smartLink?.status==="draft");
  const [acks,setAcks]=useState<Acks>(EMPTY_ACKS);
  const [publishText,setPublishText]=useState("");
  const [resumeText,setResumeText]=useState("");
  const [deleteText,setDeleteText]=useState("");

  const hasRemote=!!ad.metaCampaignId;
  const allAcknowledged=Object.values(acks).every(Boolean);
  const lastError=useMemo(()=>{
    const v=ad.metaLastError||{};
    return typeof v.message==="string"?v.message:"";
  },[ad.metaLastError]);

  async function loadPreflight({silent=false}:{silent?:boolean}={}){
    if(hasRemote)return null;
    if(!silent)setLoading(true);
    try{
      const out=await promotionApi.metaPaidPreflight(ad.id,{dsaBeneficiary,dsaPayor});
      setPreflight(out.preflight);
      if(!dsaBeneficiary&&out.preflight.effectiveDsa.beneficiary)setDsaBeneficiary(out.preflight.effectiveDsa.beneficiary);
      if(!dsaPayor&&out.preflight.effectiveDsa.payor)setDsaPayor(out.preflight.effectiveDsa.payor);
      setActivateSmartLink(out.preflight.requiresSmartLinkActivation);
      return out.preflight;
    }catch(e){if(!silent)onMessage(errText(e,"Meta preflight failed."));return null;}
    finally{if(!silent)setLoading(false);}
  }

  async function refreshRemote({silent=false}:{silent?:boolean}={}){
    if(!hasRemote)return;
    if(!silent)setLoading(true);
    try{const out=await promotionApi.metaPaidRefresh(ad.id);setRemote(out.remote);onUpdated(out.adCampaign);if(!silent)onMessage("Meta delivery status refreshed.");}
    catch(e){if(!silent)onMessage(errText(e,"Meta status could not be refreshed."));}
    finally{if(!silent)setLoading(false);}
  }

  useEffect(()=>{
    setDsaBeneficiary(ad.dsaBeneficiary||"");
    setDsaPayor(ad.dsaPayor||"");
    setPublishText("");setResumeText("");setDeleteText("");setAcks(EMPTY_ACKS);
    if(ad.metaCampaignId)void refreshRemote({silent:true}); else void loadPreflight({silent:true});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ad.id,ad.metaCampaignId]);

  async function publish(mode:"paused"|"active"){
    if(!allAcknowledged){onMessage("Confirm all four paid-ad acknowledgements before creating the Meta campaign.");return;}
    if(mode==="active"&&publishText.trim().toUpperCase()!=="PUBLISH"){onMessage("Type PUBLISH to authorize paid delivery.");return;}
    setBusy(true);
    try{
      const fresh=(await promotionApi.metaPaidPreflight(ad.id,{dsaBeneficiary,dsaPayor})).preflight;
      setPreflight(fresh);
      if(!fresh.ready){onMessage("Meta preflight found blocking issues. Fix them before publishing.");return;}
      if(fresh.requiresSmartLinkActivation&&!activateSmartLink){onMessage("Approve Smart Link activation before publishing paid traffic to it.");return;}
      const out=await promotionApi.metaPaidPublish(ad.id,{
        fingerprint:fresh.fingerprint,mode,activateSmartLink,dsaBeneficiary,dsaPayor,
        confirmationText:mode==="active"?publishText:"",
        acknowledgements:{settingsCorrect:true,rightsConfirmed:true,metaBilling:true,spendAuthorized:true},
      });
      onUpdated(out.adCampaign);setAcks(EMPTY_ACKS);setPublishText("");
      onMessage(mode==="active"?"Meta campaign created and submitted for paid delivery/review.":"Meta campaign created PAUSED. It cannot spend until you explicitly resume it.");
    }catch(e){onMessage(errText(e,"Meta paid campaign could not be created."));}
    finally{setBusy(false);}
  }

  async function setStatus(status:"ACTIVE"|"PAUSED"){
    if(status==="ACTIVE"&&resumeText.trim().toUpperCase()!=="RESUME"){onMessage("Type RESUME to authorize paid delivery.");return;}
    setBusy(true);
    try{const out=await promotionApi.metaPaidSetStatus(ad.id,status,status==="ACTIVE"?resumeText:"");setRemote(out.remote);onUpdated(out.adCampaign);setResumeText("");onMessage(status==="ACTIVE"?"Meta campaign resumed.":"Meta campaign paused.");}
    catch(e){onMessage(errText(e,"Meta campaign status could not be changed."));}
    finally{setBusy(false);}
  }

  async function discard(){
    if(deleteText.trim().toUpperCase()!=="DELETE"){onMessage("Type DELETE before removing the remote Meta campaign draft.");return;}
    setBusy(true);
    try{const out=await promotionApi.metaPaidDiscard(ad.id);setRemote(null);setPreflight(null);onUpdated(out.adCampaign);setDeleteText("");onMessage("Remote Meta campaign removed. Your YSong campaign and creatives remain intact.");}
    catch(e){onMessage(errText(e,"Remote Meta campaign could not be removed."));}
    finally{setBusy(false);}
  }

  if(hasRemote){
    const state=remoteState(remote)||String(ad.metaStatus||"UNKNOWN").toUpperCase();
    const canDiscard=["failed","paused"].includes(ad.status)||["PAUSED","ERROR","WITH_ISSUES","DISAPPROVED"].includes(state);
    return <div className="mt-5 space-y-4">
      <div className={box}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold">Meta paid campaign</h4><p className="mt-1 text-xs text-neutral-500">This YSong campaign is already linked to a real Meta Campaign.</p></div><span className="rounded-full border border-neutral-300 px-2.5 py-1 text-xs font-semibold dark:border-neutral-700">{state||ad.status}</span></div>
        <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2"><div><span className="text-neutral-500">Meta Campaign ID</span><div className="mt-1 break-all font-mono">{ad.metaCampaignId}</div></div><div><span className="text-neutral-500">Meta Ad Set ID</span><div className="mt-1 break-all font-mono">{ad.metaAdSetId||"Pending"}</div></div><div><span className="text-neutral-500">Published</span><div className="mt-1">{ad.metaPublishedAt?new Date(ad.metaPublishedAt).toLocaleString():"Creation in progress / not finalized"}</div></div><div><span className="text-neutral-500">YSong state</span><div className="mt-1 capitalize">{ad.status.replaceAll("_"," ")}</div></div></div>
        {lastError&&<div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-300"><b>Last Meta error:</b> {lastError}</div>}
        <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy||loading} onClick={()=>void refreshRemote()} className="rounded-xl border border-neutral-300 px-3 py-2 text-xs font-semibold dark:border-neutral-700">{loading?"Refreshing…":"Refresh status"}</button><button disabled={busy} onClick={()=>void setStatus("PAUSED")} className="rounded-xl border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300">Pause delivery</button></div>
      </div>

      <div className={box}><h4 className="font-semibold">Resume paid delivery</h4><p className="mt-1 text-xs text-neutral-500">Activating a paused Meta campaign can spend from the payment method attached to the selected Meta Ad Account.</p><div className="mt-3 flex gap-2"><input className={input} value={resumeText} onChange={e=>setResumeText(e.target.value)} placeholder="Type RESUME"/><button disabled={busy||resumeText.trim().toUpperCase()!=="RESUME"} onClick={()=>void setStatus("ACTIVE")} className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Resume</button></div></div>

      {canDiscard&&<div className={`${box} border-red-500/30`}><h4 className="font-semibold text-red-600 dark:text-red-300">Discard remote Meta campaign</h4><p className="mt-1 text-xs text-neutral-500">Deletes the remote Meta Campaign but keeps the YSong Smart Link, snippets, stock footage, renders, and campaign draft so you can fix it and publish again.</p><div className="mt-3 flex gap-2"><input className={input} value={deleteText} onChange={e=>setDeleteText(e.target.value)} placeholder="Type DELETE"/><button disabled={busy||deleteText.trim().toUpperCase()!=="DELETE"} onClick={()=>void discard()} className="shrink-0 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Delete remote campaign</button></div></div>}
    </div>;
  }

  return <div className="mt-5 space-y-4">
    <div className={box}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold">Meta paid-ad preflight</h4><p className="mt-1 text-xs text-neutral-500">YSong verifies the reviewed draft before it is allowed to create anything in Meta.</p></div><button disabled={loading||busy} onClick={()=>void loadPreflight()} className="rounded-xl border border-neutral-300 px-3 py-2 text-xs font-semibold dark:border-neutral-700">{loading?"Checking…":"Run preflight"}</button></div>
      {!preflight&&<div className="mt-4 text-sm text-neutral-500">Checking campaign, Smart Link, creatives, Meta account, placements, geography, and billing currency…</div>}
      {preflight&&<>
        <div className={`mt-4 rounded-xl border p-3 text-sm ${preflight.ready?"border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300":"border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"}`}><b>{preflight.ready?"Ready for Meta creation":"Not ready to publish"}</b><div className="mt-1 text-xs opacity-80">{preflight.summary.selectedCreativeCount} creative(s) · {preflight.summary.countries} countries · {preflight.summary.placements} placements · {money(preflight.summary.dailyBudgetMinor,preflight.summary.currency)}/day</div></div>
        {!!preflight.errors.length&&<div className="mt-3 space-y-2">{preflight.errors.map(x=><div key={x.code} className="rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-xs text-red-700 dark:text-red-300"><b>{x.code.replaceAll("_"," ")}:</b> {x.message}</div>)}</div>}
        {!!preflight.warnings.length&&<div className="mt-3 space-y-2">{preflight.warnings.map(x=><div key={x.code} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs text-amber-700 dark:text-amber-300"><b>{x.code.replaceAll("_"," ")}:</b> {x.message}</div>)}</div>}
      </>}
    </div>

    {preflight?.effectiveDsa.required&&<div className={box}><h4 className="font-semibold">EU/EEA ad transparency</h4><p className="mt-1 text-xs text-neutral-500">Your selected countries require Meta's beneficiary/payor disclosure. YSong uses the ad-account defaults when Meta supplies them, but you can review or override them here.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-500">Beneficiary<input className={`${input} mt-1`} value={dsaBeneficiary} onChange={e=>setDsaBeneficiary(e.target.value)} placeholder="Who benefits from this ad?"/></label><label className="text-xs text-neutral-500">Payor<input className={`${input} mt-1`} value={dsaPayor} onChange={e=>setDsaPayor(e.target.value)} placeholder="Who pays for this ad?"/></label></div></div>}

    <div className={box}><h4 className="font-semibold">Explicit authorization</h4><p className="mt-1 text-xs text-neutral-500">YSong will never infer consent to spend. Confirm each item before creating the campaign in Meta.</p><div className="mt-3 space-y-2 text-sm">
      <Ack checked={acks.settingsCorrect} onChange={v=>setAcks(a=>({...a,settingsCorrect:v}))}>I reviewed the campaign settings, audience, placements, creatives, Smart Link, and daily budget.</Ack>
      <Ack checked={acks.rightsConfirmed} onChange={v=>setAcks(a=>({...a,rightsConfirmed:v}))}>I have the rights/permission needed to advertise the music, artwork, uploaded video, and other selected media.</Ack>
      <Ack checked={acks.metaBilling} onChange={v=>setAcks(a=>({...a,metaBilling:v}))}>I understand Meta bills the payment method attached to the selected Meta Ad Account; YSong is not the ad-billing provider.</Ack>
      <Ack checked={acks.spendAuthorized} onChange={v=>setAcks(a=>({...a,spendAuthorized:v}))}>I authorize the configured daily budget and understand an active campaign can spend until paused or its schedule ends.</Ack>
      {preflight?.requiresSmartLinkActivation&&<Ack checked={activateSmartLink} onChange={setActivateSmartLink}>Activate the currently-draft YSong Smart Link as part of publishing so the ad has a live destination.</Ack>}
    </div></div>

    <div className={box}><h4 className="font-semibold">Create campaign</h4><p className="mt-1 text-xs text-neutral-500">YSong creates Campaign → Ad Set → Creative(s) → Ad(s) in Meta <b>PAUSED first</b>. “Publish & submit” only activates them after all required objects were created successfully.</p><div className="mt-4 grid gap-3 lg:grid-cols-2"><button disabled={busy||!preflight?.ready||!allAcknowledged||(!!preflight?.requiresSmartLinkActivation&&!activateSmartLink)} onClick={()=>void publish("paused")} className="rounded-xl border border-violet-500 px-4 py-3 text-sm font-semibold text-violet-600 disabled:opacity-40 dark:text-violet-300">{busy?"Working…":"Create in Meta — PAUSED"}</button><div><input className={input} value={publishText} onChange={e=>setPublishText(e.target.value)} placeholder="Type PUBLISH"/><button disabled={busy||!preflight?.ready||!allAcknowledged||publishText.trim().toUpperCase()!=="PUBLISH"||(!!preflight?.requiresSmartLinkActivation&&!activateSmartLink)} onClick={()=>void publish("active")} className="mt-2 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy?"Publishing…":"Publish & submit for Meta review"}</button></div></div></div>
  </div>;
}

function Ack({checked,onChange,children}:{checked:boolean;onChange:(v:boolean)=>void;children:React.ReactNode}){return <label className="flex items-start gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><input className="mt-0.5" type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span>{children}</span></label>;}
