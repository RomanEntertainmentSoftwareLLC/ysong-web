import type { AdCampaign, AudioSnippet, BackgroundVideo, PromotionRelease, PromotionTrack } from "./api";
import type { AdsGenreResult } from "./adsGenreResult";

export type CreativePlanContext = {
  schemaVersion: 1;
  campaignId: string;
  track: { id: string; title: string; genre: string; energy: { label: string; confidence: number } | null };
  release: { id: string; title: string; hasArtwork: boolean };
  hooks: Array<{ id: string; label: string; startSeconds: number; durationSeconds: number }>;
  assets: Array<{ id: string; name: string; source: "stock" | "upload"; provider: string | null; attributionUrl: string | null }>;
};

export type CreativeConcept = {
  format: "cinematic" | "meme" | "performance" | "lyric" | "artwork";
  title: string;
  opening: string;
  visualDirection: string;
  textOverlay: string;
  callToAction: string;
  hookId: string;
  assetIds: string[];
  evidence: Array<"genre" | "energy" | "hook" | "asset" | "artwork">;
};
export type CreativePlan = { schemaVersion: 1; campaignId: string; trackId: string; status: "draft"; concepts: CreativeConcept[] };

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exact = (value: unknown, keys: string[]): Record<string, unknown> => {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) throw new Error("Invalid creative proposal fields.");
  return value;
};

/** Only verified song and imported library IDs enter a proposal. Private object keys and signed URLs stay out. */
export function buildCreativePlanContext(input: { ad: AdCampaign; release: PromotionRelease; track: PromotionTrack; snippets: AudioSnippet[]; backgrounds: BackgroundVideo[]; genreResult: AdsGenreResult | null }): CreativePlanContext {
  const { ad, release, track } = input;
  if (!ad.id || !track.id || ad.sourceTrackId !== track.id || !track.audioObjectKey || !release.tracks.some(item => item.id === track.id)) throw new Error("Creative planner requires the campaign's verified track.");
  const genre = input.genreResult?.primary || ad.genre || track.genre || release.genre || "";
  const energy = input.genreResult?.energy;
  return {
    schemaVersion: 1, campaignId: ad.id,
    track: { id: track.id, title: track.title, genre, energy: energy?.label ? { label: energy.label, confidence: finite(energy.confidence) ? Math.max(0, Math.min(1, energy.confidence)) : 0 } : null },
    release: { id: release.id, title: release.title, hasArtwork: Boolean(release.hasArtwork) },
    hooks: input.snippets.filter(item => item.adCampaignId === ad.id && item.sourceTrackId === track.id && finite(item.startSeconds) && item.startSeconds >= 0 && finite(item.durationSeconds) && item.durationSeconds >= 5 && item.durationSeconds <= 60).map(item => ({ id: item.id, label: item.label, startSeconds: item.startSeconds, durationSeconds: item.durationSeconds })),
    assets: input.backgrounds.filter(item => Boolean(item.id) && Boolean(item.objectKey)).map(item => {
      const stock = item.metadata?.source === "stock";
      return { id: item.id, name: item.originalName, source: stock ? "stock" as const : "upload" as const, provider: stock && typeof item.metadata?.provider === "string" ? item.metadata.provider : null, attributionUrl: stock && typeof item.metadata?.attributionUrl === "string" ? item.metadata.attributionUrl : null };
    }),
  };
}

/** Validate even local drafts so stale or fabricated references cannot be treated as usable sources. */
export function validateCreativePlan(value: unknown, context: CreativePlanContext): asserts value is CreativePlan {
  const plan = exact(value, ["schemaVersion", "campaignId", "trackId", "status", "concepts"]);
  if (plan.schemaVersion !== 1 || plan.campaignId !== context.campaignId || plan.trackId !== context.track.id || plan.status !== "draft" || !Array.isArray(plan.concepts) || plan.concepts.length > 5) throw new Error("Invalid creative proposal scope.");
  const formats = new Set<string>();
  for (const item of plan.concepts) {
    const row = exact(item, ["format", "title", "opening", "visualDirection", "textOverlay", "callToAction", "hookId", "assetIds", "evidence"]);
    if (typeof row.format !== "string" || !["cinematic", "meme", "performance", "lyric", "artwork"].includes(row.format) || formats.has(row.format)) throw new Error("Invalid creative proposal format.");
    formats.add(row.format);
    for (const field of ["title", "opening", "visualDirection", "textOverlay", "callToAction"] as const) if (typeof row[field] !== "string" || !row[field].trim() || row[field].length > 500) throw new Error(`Invalid creative proposal ${field}.`);
    if (typeof row.hookId !== "string" || !context.hooks.some(hook => hook.id === row.hookId)) throw new Error("Creative proposal references an unavailable hook.");
    if (!Array.isArray(row.assetIds) || row.assetIds.length > 3 || new Set(row.assetIds).size !== row.assetIds.length || row.assetIds.some(id => typeof id !== "string" || !context.assets.some(asset => asset.id === id))) throw new Error("Creative proposal references an unavailable asset.");
    if (!Array.isArray(row.evidence) || row.evidence.length === 0 || new Set(row.evidence).size !== row.evidence.length || row.evidence.some(ref => !["genre", "energy", "hook", "asset", "artwork"].includes(String(ref)))) throw new Error("Invalid creative proposal evidence.");
    if (!row.evidence.includes("hook") || (row.evidence.includes("genre") && !context.track.genre) || (row.evidence.includes("energy") && !context.track.energy) || (row.evidence.includes("asset") && row.assetIds.length === 0) || (row.evidence.includes("artwork") && !context.release.hasArtwork)) throw new Error("Unverifiable creative proposal evidence.");
  }
}

/** Evidence-led starting points. The artist edits every field before using any sources. */
export function proposeCreativePlan(context: CreativePlanContext): CreativePlan {
  const hook = context.hooks[0];
  if (!hook) throw new Error("Save a hook clip before planning ad concepts.");
  const asset = context.assets[0];
  const genre = context.track.genre;
  const energy = context.track.energy?.label;
  const musicDirection = [genre ? `${genre} style` : "the song's style", energy ? `${energy.toLowerCase()} energy` : "the hook's dynamics"].join(" and ");
  const evidence: CreativeConcept["evidence"] = ["hook", ...(genre ? ["genre" as const] : []), ...(energy ? ["energy" as const] : [])];
  const base = { hookId: hook.id, callToAction: "Listen on YSong", textOverlay: context.track.title };
  const concepts: CreativeConcept[] = [
    { ...base, format: "cinematic", title: "Cinematic hook", opening: `Open on the ${hook.label || "selected hook"} at ${hook.startSeconds.toFixed(1)}s.`, visualDirection: asset ? `Build a vertical sequence around ${asset.name}; pace the cuts to ${musicDirection}.` : `Add a rights-cleared visual and pace its cuts to ${musicDirection}.`, assetIds: asset ? [asset.id] : [], evidence: asset ? [...evidence, "asset"] : evidence },
    { ...base, format: "meme", title: "Meme reaction", opening: "Start with a short setup that lands when the hook begins.", visualDirection: asset ? `Test whether ${asset.name} supports the joke; write the setup yourself.` : "Add a suitable visual; write the setup yourself.", textOverlay: "Write a setup grounded in your song", assetIds: asset ? [asset.id] : [], evidence: asset ? ["hook", "asset"] : ["hook"] },
    { ...base, format: "performance", title: "Performance moment", opening: "Lead with an authentic performance moment over the selected hook.", visualDirection: "Use a verified performance upload if available; otherwise record one before production.", assetIds: [], evidence: ["hook"] },
    { ...base, format: "lyric", title: "Lyric moment", opening: "Reveal a checked lyric line as the hook begins.", visualDirection: "Add a lyric you own and verify its timing; no lyrics were inferred from audio.", textOverlay: "Add a verified lyric line", assetIds: [], evidence: ["hook"] },
  ];
  if (context.release.hasArtwork) concepts.push({ ...base, format: "artwork", title: "Artwork reveal", opening: "Reveal the release artwork as the selected hook starts.", visualDirection: "Animate the release artwork after checking the source and crop.", assetIds: [], evidence: ["hook", "artwork"] });
  const plan: CreativePlan = { schemaVersion: 1, campaignId: context.campaignId, trackId: context.track.id, status: "draft", concepts };
  validateCreativePlan(plan, context);
  return plan;
}
