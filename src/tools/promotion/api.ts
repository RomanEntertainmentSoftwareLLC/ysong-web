import { AUTH_BASE } from "../../lib/authApi";
import type { CreativeStudioProject } from "./creativeStudioProject";
import { validateCreativeStudioProject } from "./creativeStudioProject";

export type PromotionDestination = { id?: string; platform: string; label: string; url: string; kind: "stream"|"presave"|"social"|"store"|"other"; position?: number; enabled: boolean };
export type PromotionTrack = { id:string; title:string; genre:string; tags?:unknown[]; explicit?:boolean; isrc?:string|null; trackNumber?:number; durationSeconds?:number|null; audioObjectKey?:string };
export type PromotionCampaign = {
  id:string; sourceReleaseId:string|null; kind:"smart_link"|"presave"|"release"; status:"draft"|"active"|"archived"; slug:string;
  title:string; artistName:string; description:string; genre:string; releaseDate:string|null; hasArtwork:boolean; headline:string; ctaLabel:string; accentColor:string;
  seoQuery:string; seoSnapshot:Record<string,unknown>; metadata:Record<string,unknown>; publicUrl:string; destinations:PromotionDestination[]; createdAt:string; updatedAt:string;
};
export type PromotionRelease = { id:string; artistName:string; title:string; releaseType:string; genre:string; publishedAt:string; hasArtwork:boolean; trackCount:number; tracks:PromotionTrack[] };
export type PromotionAnalytics = { totals:{views:number;clicks:number;emailCaptures:number;conversions:number;uniqueVisitors:number;clickRate:number;emailRate:number;conversionRate:number}; byType:Record<string,{count:number;visitors:number}>; destinations:Array<{id:string;label:string;platform:string;clicks:number;visitors:number}>; daily:Array<{day:string;eventType:string;count:number}> };
export type MetaConnection = { id:string; pageId:string; pageName:string; instagramUserId:string; instagramUsername:string; tasks:string[]; scopes:string[]; active:boolean; connectedAt:string; updatedAt:string };
export type PromotionHealth = { ok:boolean; meta:{configured:boolean;graphVersion:string;connected:boolean;connections:MetaConnection[]}; render:{available:boolean;version:string;h264:boolean;aac:boolean;error:string}; stock?:{providers:Record<string,{configured:boolean;label:string;attributionUrl:string;free:boolean}>}; public:{webBase:string;apiBase:string;productionReady:boolean} };
export type PromotionCatalog = { platforms:Array<{id:string;label:string}>; countries:Array<{code:string;name:string}>; countryTiers:Record<"tier1"|"tier2"|"tier3",Array<{code:string;name:string}>>; creativeLimits:{audioSnippets:number;backgroundVideosPerBatch:number;maxGeneratedPerBatch:number;maxSnippetSeconds:number;maxBackgroundSeconds:number} };
export type AdCampaign = { id:string;campaignId:string;sourceTrackId:string|null;name:string;goal:"song_growth"|"release_growth"|"fan_growth"|"presave"|"custom";status:"draft"|"rendering"|"ready"|"publishing"|"in_review"|"active"|"paused"|"completed"|"failed"|"archived";genre:string;genreSource:"ysong"|"user";dailyBudgetMinor:number;currency:string;scheduleStart:string|null;scheduleEnd:string|null;timezone:string;placements:string[];targeting:Record<string,unknown>;adText:string;adHeadline:string;language:string;coverArtObjectKey:string;metaConnectionId:string|null;metaAdAccountId:string;metaPixelId:string;dsaBeneficiary:string;dsaPayor:string;metaCampaignId:string;metaAdSetId:string;metaStatus:string;metaPublishedAt:string|null;metaPublishFingerprint:string;metaLastError:Record<string,unknown>;metadata:Record<string,unknown>;createdAt:string;updatedAt:string };
export type AudioSnippet = {id:string;adCampaignId:string;sourceTrackId:string|null;sourceObjectKey:string;label:string;startSeconds:number;durationSeconds:number;createdAt:string};
export type BackgroundVideo = {id:string;libraryId:string|null;objectKey:string;originalName:string;durationSeconds:number|null;width:number|null;height:number|null;metadata?:Record<string,unknown>;createdAt:string};
export type AdCreativeRenderStatus = "queued"|"rendering"|"ready"|"failed";
export type AdCreativeAspectRatio = "9:16"|"4:3"|"1:1"|"16:9"|"custom";
export type AdCreativeAudioSnippetRef = {snippetId:string;sourceTrackId:string|null;sourceObjectKey:string;startSeconds:number;durationSeconds:number;label?:string};
export type AdCreativeBackgroundMediaRef = {mediaId:string;objectKey:string;mediaType:"video"|"image";source:"upload"|"stock"|"generated"|"catalog";attribution?:{provider:string;assetId?:string;url?:string;creator?:string}};
export type AdCreativeOverlay = {id:string;kind:"text"|"logo"|"image"|"sticker";assetObjectKey?:string;text?:string;startSeconds:number;endSeconds:number;position?:{x:number;y:number};style?:Record<string,unknown>};
export type AdCreativeTiming = {durationSeconds:number;frameRate?:number;trimStartSeconds?:number;trimEndSeconds?:number;audioFadeInSeconds?:number;audioFadeOutSeconds?:number};
export type AdCreativeEditMetadata = {version:number;editedAt:string;editedBy?:string;editSummary?:string;settings:Record<string,unknown>};
export type AdCreativeProvenance = {createdFrom:"artist"|"stock"|"generated"|"template"|"import";createdBy?:string;sourceCreativeId?:string;sourceCampaignId?:string;sourceReleaseId?:string;sourceTrackId?:string;assets?:Array<{kind:"audio"|"background"|"overlay";assetId?:string;objectKey?:string;provider?:string;attributionUrl?:string}>};
/** Destination-independent creative source of truth. Variants reference this stable id and carry destination-specific overrides. */
export type ReusableAdCreative = {
  id:string;stableCreativeId:string;libraryId:string|null;name:string;sourceTrackId:string|null;
  audioSnippets:AdCreativeAudioSnippetRef[];backgroundMedia:AdCreativeBackgroundMediaRef[];overlays:AdCreativeOverlay[];
  cta:{label:string;destinationUrl?:string;destinationId?:string};caption:{text:string;language?:string};
  aspectRatio:AdCreativeAspectRatio;timing:AdCreativeTiming;edit:AdCreativeEditMetadata;provenance:AdCreativeProvenance;
  /** Versioned source edit. Render outputs remain derived artifacts. */
  studioProject?:CreativeStudioProject|null;
  renderStatus:AdCreativeRenderStatus;renderError:string|null;renders:Array<{aspectRatio:AdCreativeAspectRatio;objectKey:string;status:AdCreativeRenderStatus;durationSeconds:number|null}>;
  createdAt:string;updatedAt:string;
};
/** Campaign binding. Multiple destination variants can share the same reusable creative. */
export type AdCreativeDestinationVariant = {id:string;creativeId:string;adCampaignId:string;destinationId:string|null;destinationUrl:string|null;ctaLabel?:string;captionOverride?:string;aspectRatio?:AdCreativeAspectRatio;renderObjectKey?:string;renderStatus?:AdCreativeRenderStatus;metadata?:Record<string,unknown>;createdAt:string;updatedAt:string};
/** Legacy campaign-scoped render DTO; reusable fields are supplied by newer API responses when available. */
export type AdCreative = {id:string;adCampaignId:string;libraryId:string|null;audioSnippetId:string;backgroundVideoId:string;status:AdCreativeRenderStatus;selected:boolean;objectKey916:string;objectKey43:string;durationSeconds:number|null;renderError:string;metaVideoId916:string;metaVideoId43:string;metaAdIds:unknown[];metadata:Record<string,unknown>;createdAt:string;updatedAt:string;stableCreativeId?:string;sourceTrackId?:string|null;audioSnippets?:AdCreativeAudioSnippetRef[];backgroundMedia?:AdCreativeBackgroundMediaRef[];overlays?:AdCreativeOverlay[];cta?:ReusableAdCreative["cta"];caption?:ReusableAdCreative["caption"];aspectRatio?:AdCreativeAspectRatio;timing?:AdCreativeTiming;edit?:AdCreativeEditMetadata;provenance?:AdCreativeProvenance;renderStatus?:AdCreativeRenderStatus;variants?:AdCreativeDestinationVariant[]};
export type CreativeLibrary = {id:string;name:string;creativeCount:number;createdAt:string;updatedAt:string};
export type MetaAdAccount = {id:string;graphId:string;name:string;accountStatus:number;currency:string;timezone:string;disableReason:number;business:unknown;amountSpentMinor:number;balanceMinor:number;spendCapMinor:number;defaultDsaBeneficiary:string;defaultDsaPayor:string};
export type MetaPixel = {id:string;name:string;lastFiredTime:string|null};
export type MetaInterest = {id:string;name:string;audienceSizeLower:number;audienceSizeUpper:number;path:unknown[]};
export type StockVideo = {provider:string;id:string;width:number;height:number;durationSeconds:number;pageUrl:string;previewImage:string;previewVideoUrl:string;contributor:{id:string;name:string;url:string};files:Array<{id:string;quality:string;fileType:string;width:number;height:number;fps:number}>};
export type StockVideoSearch = {provider:string;page:number;perPage:number;totalResults:number;nextPage:number|null;videos:StockVideo[];attribution?:{label:string;url:string}};
export type AdPlacementTarget = "facebook_feed"|"facebook_reels"|"facebook_stories"|"instagram_feed"|"instagram_reels"|"instagram_stories";
export type AdTargeting = {countries:string[];ageMin:number;ageMax:number;gender:"all"|"male"|"female";interests:Array<{id:string;name:string;audienceSizeLower?:number;audienceSizeUpper?:number;path?:unknown[]}>;interestKeywords:string[];countryPreset:"tier1"|"tier2"|"tier3"|"custom"|"mixed";placementTargets:AdPlacementTarget[];platforms?:string[]};

export type MetaPublishIssue = {code:string;message:string};
export type RightsCheckResult = {status?:string;decision?:string;summary?:string;message?:string;reason?:string;score?:number;confidence?:number;matches?:Array<Record<string,unknown>>;[key:string]:unknown};
export type MetaPublishPreflight = {ready:boolean;errors:MetaPublishIssue[];warnings:MetaPublishIssue[];fingerprint:string;requiresSmartLinkActivation:boolean;smartLink:{id:string;status:string;publicUrl:string;slug:string;destinationCount:number}|null;account:MetaAdAccount|null;connection:MetaConnection|null;effectiveDsa:{required:boolean;beneficiary:string;payor:string};summary:{selectedCreativeCount:number;countries:number;placements:number;dailyBudgetMinor:number;currency:string;estimatedMaxDailySpendMinor:number};creatives:Array<Record<string,unknown>>;contentRightsGate?:RightsCheckResult|null;releaseMatch?:RightsCheckResult|null;rightsVerification?:{contentRightsGate?:RightsCheckResult|null;releaseMatch?:RightsCheckResult|null;[key:string]:unknown}|null};
export type MetaRemoteStatus = {campaign:Record<string,unknown>;adSets:Array<Record<string,unknown>>;ads:Array<Record<string,unknown>>};
export type MetaInsightRow = {campaignId:string;campaignName:string;adSetId:string;adSetName:string;adId:string;adName:string;dateStart:string|null;dateStop:string|null;impressions:number;reach:number;frequency:number;clicks:number;uniqueClicks:number;linkClicks:number;outboundClicks:number;landingPageViews:number;spend:number;cpm:number;cpc:number;ctr:number;costPerLandingPageView:number;videoPlays:number;thruPlays:number;video25:number;video50:number;video75:number;video100:number;publisherPlatform:string;platformPosition:string;country:string;age:string;gender:string};
export type PaidCreativeAnalytics = {id:string;audioSnippetId:string;backgroundVideoId:string;metaAdIds:Array<Record<string,unknown>>;durationSeconds:number;snippetLabel:string;snippetStartSeconds:number;snippetDurationSeconds:number;backgroundName:string;backgroundMetadata:Record<string,unknown>;renderMetadata:Record<string,unknown>;ysong:{creativeId:string;views:number;clicks:number;emailCaptures:number;conversions:number;uniqueVisitors:number;byType:Record<string,{count:number;visitors:number}>;destinations:Array<{id:string;label:string;platform:string;creativeId:string;clicks:number;visitors:number}>};meta:Partial<MetaInsightRow>;derived:{smartLinkEngagement:number;metaToSmartLinkRate:number;costPerSmartLinkVisit:number;costPerPlatformClick:number;costPerEmailCapture:number}};
export type PaidAdAnalytics = {adCampaign:AdCampaign;range:{since:string;until:string};capturedAt:string|null;stale:boolean;meta:{summary:Partial<MetaInsightRow>;daily:MetaInsightRow[];adSets:MetaInsightRow[];ads:MetaInsightRow[];placements:MetaInsightRow[];countries:MetaInsightRow[];warnings:Array<{code:string;message:string}>};ysong:{totals:{views:number;uniqueVisitors:number;clicks:number;emailCaptures:number;conversions:number};byType:Record<string,{count:number;visitors:number}>;daily:Array<{day:string;eventType:string;count:number;visitors:number}>;destinations:Array<{id:string;label:string;platform:string;clicks:number;visitors:number}>;creatives:Array<Record<string,unknown>>};derived:{currency:string;spend:number;costPerSmartLinkVisit:number;costPerPlatformClick:number;smartLinkEngagement:number;metaToSmartLinkRate:number;destinations:Array<{id:string;label:string;platform:string;clicks:number;visitors:number;costPerClick:number;shareOfPlatformClicks:number}>;creatives:PaidCreativeAnalytics[];bestCreative:PaidCreativeAnalytics|null;bestDestination:Record<string,unknown>|null;bestPlacement:MetaInsightRow|null;bestCountry:MetaInsightRow|null};warnings:Array<{code:string;message:string}>};
export type PromotionIntelligenceEvidence = {label:string;value:number|string;unit?:string};
export type PromotionIntelligenceRecommendation = {id:string;kind:"winner"|"warning"|"watch"|"opportunity"|"learning"|"insight";priority:"high"|"medium"|"low";confidence:"high"|"medium"|"low";entityType:string;entityId:string;title:string;summary:string;action:string;evidence:PromotionIntelligenceEvidence[];why:string};
export type PromotionIntelligence = {engine:{name:string;version:string;learnedModel:boolean;description:string};range:{since:string;until:string}|null;objective:{goal:string;metric:string;label:string;fallbackUsed:boolean};evidenceState:{impressions:number;outboundClicks:number;smartLinkVisits:number;platformClicks:number;emailCaptures:number;conversions:number;spend:number;currency:string;sufficientForStrongComparisons:boolean;strongRecommendationCount:number};recommendations:PromotionIntelligenceRecommendation[];rankings:{creatives:Array<Record<string,unknown>>;snippets:Array<Record<string,unknown>>;backgrounds:Array<Record<string,unknown>>;placements:Array<Record<string,unknown>>;countries:Array<Record<string,unknown>>};guardrails:string[]};
export type PromotionIntelligenceResponse = {analytics:PaidAdAnalytics;intelligence:PromotionIntelligence};

function token(){ try{return localStorage.getItem("ys_token")||localStorage.getItem("ysong_auth_token")||"";}catch{return "";} }
async function request<T>(path:string, init:RequestInit={}):Promise<T>{
  const headers=new Headers(init.headers||{}); if(!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) headers.set("Content-Type","application/json"); const t=token(); if(t)headers.set("Authorization",`Bearer ${t}`);
  const res=await fetch(`${AUTH_BASE}${path}`,{...init,headers,credentials:"include"}); const data=await res.json().catch(()=>({})); if(!res.ok) throw Object.assign(new Error(String(data?.message||data?.error||`HTTP ${res.status}`)),{status:res.status}); return data as T;
}
const ROOT="/api/tools/promotion";
export const promotionApi={
  health:()=>request<PromotionHealth>(`${ROOT}/health`),
  catalog:()=>request<PromotionCatalog>(`${ROOT}/catalog`),
  releases:()=>request<{releases:PromotionRelease[]}>(`${ROOT}/releases`),
  campaigns:()=>request<{campaigns:PromotionCampaign[]}>(`${ROOT}/campaigns`),
  campaign:(id:string)=>request<{campaign:PromotionCampaign;analytics:PromotionAnalytics}>(`${ROOT}/campaigns/${id}`),
  create:(body:Record<string,unknown>)=>request<{campaign:PromotionCampaign}>(`${ROOT}/campaigns`,{method:"POST",body:JSON.stringify(body)}),
  update:(id:string,body:Record<string,unknown>)=>request<{campaign:PromotionCampaign}>(`${ROOT}/campaigns/${id}`,{method:"PATCH",body:JSON.stringify(body)}),
  status:(id:string,status:"draft"|"active"|"archived")=>request<{campaign:PromotionCampaign}>(`${ROOT}/campaigns/${id}/status`,{method:"POST",body:JSON.stringify({status})}),
  remove:(id:string)=>request<{ok:boolean}>(`${ROOT}/campaigns/${id}`,{method:"DELETE"}),
  analytics:(id:string)=>request<PromotionAnalytics>(`${ROOT}/campaigns/${id}/analytics`),
  fans:(id:string)=>request<{fans:Array<{id:string;email:string;consent:boolean;source:string;provider:string;createdAt:string}>}>(`${ROOT}/campaigns/${id}/fans`),
  refreshSeo:(id:string,query?:string)=>request<{query:string;report:Record<string,unknown>}>(`${ROOT}/campaigns/${id}/seo-refresh`,{method:"POST",body:JSON.stringify(query?{query}:{})}),
  metaStatus:()=>request<{configured:boolean;graphVersion:string;connections:MetaConnection[]}>(`${ROOT}/meta/status`),
  metaStart:()=>request<{url:string}>(`${ROOT}/meta/oauth/start`,{method:"POST",body:"{}"}),
  metaSelect:(connectionId:string)=>request<{ok:boolean;connections:MetaConnection[]}>(`${ROOT}/meta/select`,{method:"POST",body:JSON.stringify({connectionId})}),
  metaDisconnect:(connectionId?:string)=>request<{ok:boolean;connections:MetaConnection[]}>(`${ROOT}/meta/disconnect`,{method:"POST",body:JSON.stringify(connectionId?{connectionId}:{})}),
  metaPublish:(campaignId:string,channel:"facebook"|"instagram",message:string)=>request<{ok:boolean;result:Record<string,unknown>}>(`${ROOT}/campaigns/${campaignId}/meta-publish`,{method:"POST",body:JSON.stringify({channel,message})}),

  adCampaigns:()=>request<{adCampaigns:AdCampaign[]}>(`${ROOT}/ad-campaigns`),
  adCampaign:(id:string)=>request<{adCampaign:AdCampaign;snippets:AudioSnippet[];backgroundVideos:BackgroundVideo[];creatives:AdCreative[]}>(`${ROOT}/ad-campaigns/${id}`),
  createAdCampaign:(body:Record<string,unknown>)=>request<{adCampaign:AdCampaign}>(`${ROOT}/ad-campaigns`,{method:"POST",body:JSON.stringify(body)}),
  updateAdCampaign:(id:string,body:Record<string,unknown>)=>request<{adCampaign:AdCampaign}>(`${ROOT}/ad-campaigns/${id}`,{method:"PATCH",body:JSON.stringify(body)}),
  addSnippet:(id:string,body:Record<string,unknown>)=>request<{snippet:AudioSnippet;sourceDurationSeconds:number|null}>(`${ROOT}/ad-campaigns/${id}/snippets`,{method:"POST",body:JSON.stringify(body)}),
  deleteSnippet:(id:string,snippetId:string)=>request<{ok:boolean}>(`${ROOT}/ad-campaigns/${id}/snippets/${snippetId}`,{method:"DELETE"}),
  renderBatch:(id:string,body:{snippetIds:string[];backgroundVideoIds:string[];libraryId?:string|null;backgroundFit?:"crop"|"fit"})=>request<{queued:AdCreative[]}>(`${ROOT}/ad-campaigns/${id}/render`,{method:"POST",body:JSON.stringify(body)}),
  creatives:(id:string)=>request<{creatives:AdCreative[]}>(`${ROOT}/ad-campaigns/${id}/creatives`),
  loadStudioProject:async(creative:Pick<ReusableAdCreative,"id"|"audioSnippets"|"backgroundMedia"|"overlays">)=>{
    const out=await request<{project:CreativeStudioProject|null}>(`${ROOT}/creatives/${encodeURIComponent(creative.id)}/studio-project`);
    if(out.project!==null)validateCreativeStudioProject(out.project,{audioSnippetIds:creative.audioSnippets.map(x=>x.snippetId),backgroundMediaIds:creative.backgroundMedia.map(x=>x.mediaId),overlayIds:creative.overlays.map(x=>x.id)});
    return out.project;
  },
  /** The reusable creative owns this edit; the server must compare expectedRevision atomically. */
  saveStudioProject:async(creative:Pick<ReusableAdCreative,"id"|"audioSnippets"|"backgroundMedia"|"overlays">, project:CreativeStudioProject)=>{
    validateCreativeStudioProject(project,{audioSnippetIds:creative.audioSnippets.map(x=>x.snippetId),backgroundMediaIds:creative.backgroundMedia.map(x=>x.mediaId),overlayIds:creative.overlays.map(x=>x.id)});
    if(project.edit.parentRevision!==project.revision)throw new Error("Studio edit parent revision must match the saved revision.");
    const out=await request<{creative:ReusableAdCreative}>(`${ROOT}/creatives/${encodeURIComponent(creative.id)}/studio-project`,{
      method:"PUT",body:JSON.stringify({expectedRevision:project.revision,project}),
    }).catch((error:Error&{status?:number})=>{
      if(error.status===409)throw Object.assign(new Error("This creative changed elsewhere. Reload the project before saving."),{status:409});
      throw error;
    });
    if(out.creative.id!==creative.id||!out.creative.studioProject)throw new Error("Studio save response is missing the project.");
    validateCreativeStudioProject(out.creative.studioProject,{audioSnippetIds:out.creative.audioSnippets.map(x=>x.snippetId),backgroundMediaIds:out.creative.backgroundMedia.map(x=>x.mediaId),overlayIds:out.creative.overlays.map(x=>x.id)});
    if(out.creative.studioProject.revision!==project.revision+1)throw new Error("Studio save response has an unexpected revision.");
    return out;
  },
  patchCreative:(id:string,creativeId:string,body:Record<string,unknown>)=>request<{creative:AdCreative}>(`${ROOT}/ad-campaigns/${id}/creatives/${creativeId}`,{method:"PATCH",body:JSON.stringify(body)}),
  retryCreative:(id:string,creativeId:string)=>request<{creative:AdCreative}>(`${ROOT}/ad-campaigns/${id}/creatives/${creativeId}/retry`,{method:"POST",body:"{}"}),
  backgrounds:()=>request<{backgroundVideos:BackgroundVideo[]}>(`${ROOT}/background-videos`),
  registerBackground:(objectKey:string,libraryId?:string|null)=>request<{backgroundVideo:BackgroundVideo}>(`${ROOT}/background-videos`,{method:"POST",body:JSON.stringify({objectKey,libraryId:libraryId||null})}),
  libraries:()=>request<{libraries:CreativeLibrary[]}>(`${ROOT}/creative-libraries`),
  createLibrary:(name:string)=>request<{library:CreativeLibrary}>(`${ROOT}/creative-libraries`,{method:"POST",body:JSON.stringify({name})}),
  adAccounts:(connectionId?:string)=>request<{adAccounts:MetaAdAccount[]}>(`${ROOT}/meta/ad-accounts${connectionId?`?connectionId=${encodeURIComponent(connectionId)}`:""}`),
  pixels:(adAccountId:string,connectionId?:string)=>request<{pixels:MetaPixel[]}>(`${ROOT}/meta/pixels?adAccountId=${encodeURIComponent(adAccountId)}${connectionId?`&connectionId=${encodeURIComponent(connectionId)}`:""}`),
  interests:(q:string,connectionId?:string,limit=50)=>request<{interests:MetaInterest[]}>(`${ROOT}/meta/interests?q=${encodeURIComponent(q)}&limit=${Math.max(1,Math.min(50,limit))}${connectionId?`&connectionId=${encodeURIComponent(connectionId)}`:""}`),
  metaPaidPreflight:(id:string,body:{dsaBeneficiary?:string;dsaPayor?:string}={})=>request<{preflight:MetaPublishPreflight}>(`${ROOT}/ad-campaigns/${id}/meta/preflight`,{method:"POST",body:JSON.stringify(body)}),
  metaPaidPublish:(id:string,body:{fingerprint:string;mode:"active"|"paused";activateSmartLink:boolean;dsaBeneficiary?:string;dsaPayor?:string;confirmationText:string;acknowledgements:{settingsCorrect:true;rightsConfirmed:true;metaBilling:true;spendAuthorized:true}})=>request<{adCampaign:AdCampaign;remote:{campaignId:string;adSetId:string;ads:Array<Record<string,unknown>>;status:string};preflight:MetaPublishPreflight}>(`${ROOT}/ad-campaigns/${id}/meta/publish`,{method:"POST",body:JSON.stringify(body)}),
  metaPaidRefresh:(id:string)=>request<{adCampaign:AdCampaign;remote:MetaRemoteStatus}>(`${ROOT}/ad-campaigns/${id}/meta/refresh`,{method:"POST",body:"{}"}),
  metaPaidSetStatus:(id:string,status:"ACTIVE"|"PAUSED",confirmationText="")=>request<{adCampaign:AdCampaign;remote:MetaRemoteStatus}>(`${ROOT}/ad-campaigns/${id}/meta/status`,{method:"POST",body:JSON.stringify({status,confirm:status==="ACTIVE",confirmationText})}),
  metaPaidDiscard:(id:string)=>request<{adCampaign:AdCampaign;deleted:boolean}>(`${ROOT}/ad-campaigns/${id}/meta/discard`,{method:"POST",body:JSON.stringify({confirmationText:"DELETE"})}),
  paidAnalytics:(id:string,opts:{since?:string;until?:string;refresh?:boolean}={})=>{const q=new URLSearchParams();if(opts.since)q.set("since",opts.since);if(opts.until)q.set("until",opts.until);if(opts.refresh)q.set("refresh","1");return request<PaidAdAnalytics>(`${ROOT}/ad-campaigns/${id}/analytics${q.toString()?`?${q.toString()}`:""}`);},
  promotionIntelligence:(id:string,opts:{since?:string;until?:string;refresh?:boolean}={})=>{const q=new URLSearchParams();if(opts.since)q.set("since",opts.since);if(opts.until)q.set("until",opts.until);if(opts.refresh)q.set("refresh","1");return request<PromotionIntelligenceResponse>(`${ROOT}/ad-campaigns/${id}/intelligence${q.toString()?`?${q.toString()}`:""}`);},
  stockVideos:(q:string,{provider="pexels",orientation="portrait",page=1,perPage=30,locale="en-US"}:{provider?:string;orientation?:"portrait"|"landscape"|"square";page?:number;perPage?:number;locale?:string}={})=>request<StockVideoSearch>(`${ROOT}/stock/videos?provider=${encodeURIComponent(provider)}&q=${encodeURIComponent(q)}&orientation=${encodeURIComponent(orientation)}&page=${page}&perPage=${perPage}&locale=${encodeURIComponent(locale)}`),
  importStockVideo:(body:{provider:string;id:string;fileId?:string;libraryId?:string|null})=>request<{backgroundVideo:BackgroundVideo}>(`${ROOT}/stock/videos/import`,{method:"POST",body:JSON.stringify(body)}),

  upload:async(file:File)=>{const form=new FormData();form.set("file",file);return request<{filename:string;size:number;contentType:string;objectKey:string}>("/api/uploads",{method:"POST",body:form});},
  signedUrl:(objectKey:string)=>request<{url:string;contentType:string;expiresAt:number;objectKey:string}>(`/api/uploads/signed-url?objectKey=${encodeURIComponent(objectKey)}`),
};

export function publicPromotionUrl(path:string){ return `${AUTH_BASE}${path}`; }
