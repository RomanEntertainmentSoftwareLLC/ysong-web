import type { AdCampaign, AdCreative, AudioSnippet, PaidAdAnalytics, PromotionCampaign, PromotionRelease, PromotionTrack } from "./api";
import type { AdsGenreResult } from "./adsGenreResult";
import type { CreativeStudioProject } from "./creativeStudioProject";
import type { EditTiming } from "./shortAdEditPlan";
import { validateCreativeStudioProject } from "./creativeStudioProject.ts";

/** Version 1 is a data-only snapshot. Every field is allowlisted; never spread API DTOs into a model request. */
export type AdsAssistantContext = {
  schemaVersion: 1;
  evidence: {
    release: { id: string; title: string; artistName: string; releaseType: string; publishedAt: string; genre: string };
    audio: { trackId: string; title: string; durationSeconds: number | null; verified: true; snippets: Array<{ id: string; label: string; startSeconds: number; durationSeconds: number }> };
    genre: { campaignGenre: string; source: "ysong" | "user"; analysis: null | { engine: string; primary: string; secondary: string | null; related: string[]; family: string | null; bpm: number | null; confidence: number; onsetsSeconds: number[] } };
    hooks: Array<{ snippetId: string; startSeconds: number; durationSeconds: number; beatCuts: Array<{ seconds: number; source: EditTiming["source"] }> }>;
    creative: { selected: Array<{ id: string; status: AdCreative["status"]; durationSeconds: number | null; studio: null | { revision: number; durationFrames: number; fps: number; tracks: Array<{ kind: "visual" | "audio" | "text"; clips: Array<{ startFrame: number; durationFrames: number; sourceId: string | null; text?: string }> }> } }>; overlay: { headline: string; caption: string; cta: string; position: "top" | "center" | "bottom" } };
    destination: { smartLinkId: string; status: PromotionCampaign["status"]; publicUrl: string; enabled: Array<{ id: string | null; label: string; platform: string; kind: string }> };
    campaign: { id: string; goal: AdCampaign["goal"]; status: AdCampaign["status"]; metaStatus: string; dailyBudgetMinor: number; currency: string; scheduleStart: string | null; scheduleEnd: string | null; audienceDraft: { countries: string[]; ageMin: number | null; ageMax: number | null; gender: string | null; interests: Array<{ id: string; name: string }>; placementTargets: string[] }; placements: string[] };
    analytics: null | { capturedAt: string | null; stale: boolean; since: string; until: string; impressions: number | null; outboundClicks: number | null; spend: number | null; smartLinkVisits: number; platformClicks: number; emailCaptures: number; conversions: number; warnings: string[] };
  };
  unavailable: Array<"genre_analysis" | "hooks" | "studio_timeline" | "analytics">;
};

export type AdsAssistantSuggestion = { kind: "creative" | "audience" | "budget" | "destination" | "measurement"; title: string; rationale: string; evidencePaths: string[]; confidence: "low" | "medium" | "high" };
export type AdsAssistantResponse = { schemaVersion: 1; summary: string; suggestions: AdsAssistantSuggestion[] };

type Input = { ad: AdCampaign; smartLink: PromotionCampaign; release: PromotionRelease; track: PromotionTrack; snippets: AudioSnippet[]; creatives: AdCreative[]; genreEvidence?: { trackId: string; result: AdsGenreResult } | null; cutsBySnippet?: Record<string, EditTiming[]>; studioProjects?: Record<string, CreativeStudioProject | null>; analytics?: PaidAdAnalytics | null };
const fail = (reason: string): never => { throw new Error(`Invalid Ads Smart Assistant context: ${reason}`); };
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown) => typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function buildAdsAssistantContext(input: Input): AdsAssistantContext {
  const { ad, smartLink, release, track } = input;
  if (!ad.id || !ad.sourceTrackId || ad.sourceTrackId !== track.id || !track.audioObjectKey || !release.tracks.some(item => item.id === track.id)) fail("selected release and verified audio must match the campaign");
  if (ad.campaignId !== smartLink.id || smartLink.sourceReleaseId !== release.id) fail("selected Smart Link must belong to the release");
  if (input.genreEvidence && input.genreEvidence.trackId !== track.id) fail("genre analysis source track mismatch");
  const genreResult = input.genreEvidence?.result;
  const snippets = input.snippets.filter(item => item.adCampaignId === ad.id && item.sourceTrackId === track.id && finite(item.startSeconds) && item.startSeconds >= 0 && finite(item.durationSeconds) && item.durationSeconds > 0);
  const selected = input.creatives.filter(item => item.adCampaignId === ad.id && item.selected);
  if (selected.some(item => item.sourceTrackId && item.sourceTrackId !== track.id)) fail("selected creative source track mismatch");
  if (!Number.isSafeInteger(ad.dailyBudgetMinor) || ad.dailyBudgetMinor < 0) fail("invalid daily budget");
  const unavailable: AdsAssistantContext["unavailable"] = [];
  if (!genreResult) unavailable.push("genre_analysis");
  if (!snippets.length) unavailable.push("hooks");
  if (!selected.some(item => item.stableCreativeId && input.studioProjects?.[item.stableCreativeId])) unavailable.push("studio_timeline");
  if (!input.analytics) unavailable.push("analytics");
  const targeting = record(ad.targeting);
  const interests = Array.isArray(targeting.interests) ? targeting.interests : [];
  const overlay = record(targeting.adOverlay);
  const metric = (value: unknown) => finite(value) && value >= 0 ? value : null;
  const analytics = input.analytics;
  if (analytics && analytics.adCampaign.id !== ad.id) fail("analytics campaign mismatch");
  return {
    schemaVersion: 1,
    evidence: {
      release: { id: release.id, title: release.title, artistName: release.artistName, releaseType: release.releaseType, publishedAt: release.publishedAt, genre: release.genre },
      audio: { trackId: track.id, title: track.title, durationSeconds: metric(track.durationSeconds), verified: true, snippets: snippets.map(item => ({ id: item.id, label: item.label, startSeconds: item.startSeconds, durationSeconds: item.durationSeconds })) },
      genre: { campaignGenre: ad.genre, source: ad.genreSource, analysis: genreResult ? { engine: genreResult.engine, primary: genreResult.primary, secondary: genreResult.secondary, related: genreResult.related.slice(0, 6), family: genreResult.family, bpm: metric(genreResult.tempo?.bpm), confidence: metric(genreResult.tempo?.confidence) ?? 0, onsetsSeconds: (genreResult.tempo?.onsetsSeconds || []).filter(value => finite(value) && value >= 0).slice(0, 256) } : null },
      hooks: snippets.map(item => ({ snippetId: item.id, startSeconds: item.startSeconds, durationSeconds: item.durationSeconds, beatCuts: (input.cutsBySnippet?.[item.id] || []).filter(cut => finite(cut.cutSeconds) && cut.cutSeconds > 0 && cut.cutSeconds < item.durationSeconds && ["onset", "tempo", "even"].includes(cut.source)).map(cut => ({ seconds: cut.cutSeconds, source: cut.source })) })),
      creative: { selected: selected.map(item => {
        const project = item.stableCreativeId ? input.studioProjects?.[item.stableCreativeId] : null;
        if (project) validateCreativeStudioProject(project, { audioSnippetIds: (item.audioSnippets || []).map(ref => ref.snippetId), backgroundMediaIds: (item.backgroundMedia || []).map(ref => ref.mediaId), overlayIds: (item.overlays || []).map(ref => ref.id) });
        const tracks = project?.variants?.["9:16"]?.tracks || project?.tracks || [];
        return { id: item.id, status: item.status, durationSeconds: metric(item.durationSeconds), studio: project ? { revision: project.revision, durationFrames: project.durationFrames, fps: project.timebase.framesPerSecond.numerator / project.timebase.framesPerSecond.denominator, tracks: tracks.map(track => ({ kind: track.kind, clips: track.clips.map(clip => ({ startFrame: clip.startFrame, durationFrames: clip.durationFrames, sourceId: "snippetId" in clip ? clip.snippetId : "mediaId" in clip ? clip.mediaId || null : "overlayId" in clip ? clip.overlayId || null : null, ...(track.kind === "text" && "text" in clip ? { text: clip.text } : {}) })) })) } : null };
      }), overlay: { headline: text(overlay.headline), caption: text(overlay.caption), cta: text(overlay.cta), position: overlay.position === "top" || overlay.position === "center" ? overlay.position : "bottom" } },
      destination: { smartLinkId: smartLink.id, status: smartLink.status, publicUrl: smartLink.publicUrl, enabled: smartLink.destinations.filter(item => item.enabled).map(item => ({ id: item.id || null, label: item.label, platform: item.platform, kind: item.kind })) },
      campaign: { id: ad.id, goal: ad.goal, status: ad.status, metaStatus: ad.metaStatus, dailyBudgetMinor: ad.dailyBudgetMinor, currency: ad.currency, scheduleStart: ad.scheduleStart, scheduleEnd: ad.scheduleEnd, audienceDraft: { countries: Array.isArray(targeting.countries) ? targeting.countries.filter((x): x is string => typeof x === "string") : [], ageMin: metric(targeting.ageMin), ageMax: metric(targeting.ageMax), gender: typeof targeting.gender === "string" ? targeting.gender : null, interests: interests.map(record).filter(item => typeof item.id === "string" && typeof item.name === "string").map(item => ({ id: String(item.id), name: String(item.name) })), placementTargets: Array.isArray(targeting.placementTargets) ? targeting.placementTargets.filter((x): x is string => typeof x === "string") : [] }, placements: ad.placements },
      analytics: analytics ? { capturedAt: analytics.capturedAt, stale: analytics.stale, since: analytics.range.since, until: analytics.range.until, impressions: metric(analytics.meta.summary.impressions), outboundClicks: metric(analytics.meta.summary.outboundClicks), spend: metric(analytics.meta.summary.spend), smartLinkVisits: analytics.ysong.totals.views, platformClicks: analytics.ysong.totals.clicks, emailCaptures: analytics.ysong.totals.emailCaptures, conversions: analytics.ysong.totals.conversions, warnings: [...analytics.warnings.map(item => item.code), ...analytics.meta.warnings.map(item => item.code)] } : null,
    },
    unavailable,
  };
}

/** Model text is never an action. Reject extra keys, executable payloads, and unsupported evidence references. */
export function validateAdsAssistantResponse(value: unknown, context: AdsAssistantContext): asserts value is AdsAssistantResponse {
  const exact = (value: unknown, keys: string[]): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Ads Smart Assistant response object.");
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some(key => !keys.includes(key)) || keys.some(key => !(key in row))) throw new Error("Invalid Ads Smart Assistant response fields.");
    return row;
  };
  const root = exact(value, ["schemaVersion", "summary", "suggestions"]);
  if (root.schemaVersion !== 1 || typeof root.summary !== "string" || root.summary.length > 1200 || !Array.isArray(root.suggestions) || root.suggestions.length > 8) throw new Error("Invalid Ads Smart Assistant response.");
  const evidence = context.evidence as unknown as Record<string, unknown>;
  for (const value of root.suggestions) {
    const row = exact(value, ["kind", "title", "rationale", "evidencePaths", "confidence"]);
    if (!["creative", "audience", "budget", "destination", "measurement"].includes(String(row.kind)) || !["low", "medium", "high"].includes(String(row.confidence)) || typeof row.title !== "string" || !row.title.trim() || row.title.length > 160 || typeof row.rationale !== "string" || !row.rationale.trim() || row.rationale.length > 1000 || !Array.isArray(row.evidencePaths) || row.evidencePaths.length > 8) throw new Error("Invalid Ads Smart Assistant suggestion.");
    for (const path of row.evidencePaths) {
      if (typeof path !== "string" || !/^evidence\.[a-zA-Z]+(?:\.(?:[a-zA-Z]+|\d+))*$/.test(path)) throw new Error("Invalid Ads Smart Assistant evidence path.");
      const parts = path.split(".").slice(1);
      let current: unknown = evidence;
      for (const part of parts) current = current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined;
      if (current === undefined || current === null || typeof current === "object") throw new Error("Unverifiable Ads Smart Assistant evidence path.");
    }
  }
}
