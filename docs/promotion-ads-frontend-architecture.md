# Promotion and Ads frontend architecture

Audit snapshot: 2026-09-29. This note describes the existing frontend so new Ads work can extend its current owners.

## Entry points and routes

- `/app` is the authenticated product shell. Its Tools pane (`src/tabs/Tools.tsx`) opens `PromotionCenterApp` as the `promotion` tool; Promotion Center is an embedded tool, not a standalone route.
- `/p/:slug` (`src/pages/PromotionLanding.tsx`) is the public campaign landing page. It loads the campaign, records views, captures consented email signups, and routes destination clicks through tracked redirects. Attribution query values include UTM fields and YSong ad campaign/creative IDs.
- `src/tabs/Analytics.tsx` is the product's general analytics screen. Paid-campaign reporting belongs to Promotion Center's campaign-specific analytics surfaces.

## Owners and models

- `src/tools/promotion/api.ts` is the frontend API boundary, DTO/type catalog, and request/auth wrapper. It calls the backend under `/api/tools/promotion` via `AUTH_BASE`; backend persistence and business rules are remote and are not owned by these React components.
- `PromotionCampaign` models a release promotion (`smart_link`, `presave`, or `release`) with source release, public slug/URL, destinations, SEO snapshot, and draft/active/archived state. `PromotionCenterApp.tsx` owns the Smart Link list, create/detail/status, fan list/export, SEO refresh, and organic Meta publishing UI. `PromotionLanding.tsx` owns the public visitor experience.
- `AdCampaign` is a separate paid campaign model, linked to a PromotionCampaign by `campaignId` and to music by `sourceTrackId`. It owns goal, budget/schedule, audience targeting, placements, Meta account/pixel and remote campaign IDs/status, and publishing metadata. Related models are `AudioSnippet`, `BackgroundVideo`, and `AdCreative`.
- `AdCampaignStudio.tsx` owns paid campaign selection/creation and creative production flow (music, audio clip, background video, render, setup, analytics, intelligence). `WaveformPicker.tsx` handles clip selection; `AudienceCampaignSetup.tsx` owns audience, budget, account, and ad setup. The Smart Link is a prerequisite/target for paid ads, not a duplicate campaign record.

## Analytics and Meta surfaces

- Smart Link `PromotionAnalytics` covers YSong views, destination clicks, email captures/conversions, unique visitors, daily and destination breakdowns. It is fetched with campaign detail or `/campaigns/:id/analytics` and displayed from Promotion Center campaign detail.
- `AdCampaignAnalytics.tsx` combines paid Meta Insights with YSong Smart Link attribution: spend/impressions/outbound clicks, downstream visits/platform clicks/email capture, creative/destination/placement/country breakdowns, and derived costs/rates. `PromotionIntelligence.tsx` presents advisory recommendations and qualified rankings from `/ad-campaigns/:id/intelligence`; its UI explicitly does not automate spend or campaign changes.
- Meta UI has two existing scopes: Promotion Center's Meta mode handles business connection and organic Facebook/Instagram publishing for a selected PromotionCampaign; `AudienceCampaignSetup.tsx` and `MetaPublishPanel.tsx` handle paid account/pixel/interest selection, preflight, explicit acknowledgements, paid publish/status/refresh/discard for an AdCampaign. OAuth status/start/select/disconnect and publishing live in the shared API client.
- `src/lib/ysongAds.ts` is a separate playback-ad selection/scheduling subsystem (house/provider audio and room prerolls) using visual advertising settings from `bridgeApi`. It is not the paid Meta campaign owner.

## Extension guidance

Add promotion/paid-ad UI and API calls to the existing `src/tools/promotion` owners and extend their shared DTO/client contract. Keep public campaign routing and attribution on `/p/:slug` and its existing event/redirect flow. Reuse the linked Smart Link and track rather than introducing another release campaign owner. Keep paid Meta actions in the existing preflight and acknowledged publishing flow. Do not treat the general Analytics tab or playback ad scheduler as owners of paid campaign state. This audit does not inspect or prescribe backend implementation details or external product specifications.

## YSong Ads product and IP guardrails

Solve common music-marketing problems through YSong's own UI, terminology, code, and architecture. Build on the existing Promotion Center and linked Smart Link flow described above; do not create a parallel campaign owner. Treat official Meta APIs, Pexels APIs, and other explicitly authorized provider APIs as the source of truth for provider capabilities, assets, data, and integrations.

Do not copy competitor source code, graphics, copy, proprietary data, distinctive branding, or pixel-for-pixel UI. Compete by delivering YSong's own product decisions and visual language.

Preserve the Ads differentiators as the experience grows:

- **Creative-first workflow:** start by helping artists make an effective ad from their music, then guide them through campaign setup.
- **Universal destinations:** support the artist's chosen listening and campaign destinations through the linked Smart Link, rather than assuming one streaming service.
- **Music intelligence:** use music-aware guidance to inform creative and campaign choices.
- **Audio and release matching:** connect the selected recording and release to the right campaign and creative.
- **Rights gate:** make rights readiness an explicit checkpoint before publishing or promoting audio.
- **Reusable creatives:** let artists reuse approved creative work across campaigns.
- **Destination variants:** support creative or campaign variants tailored to different destinations while preserving shared source music and attribution.

Extend these capabilities within existing Promotion Center owners and API contracts. Keep provider-specific behavior grounded in authorized APIs and keep artist-facing concepts and interaction design native to YSong.
