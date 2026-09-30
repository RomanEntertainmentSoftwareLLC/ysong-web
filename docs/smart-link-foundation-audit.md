# Smart Link foundation audit

Audit snapshot: 2026-09-29. Frontend review only; the promotion API's persistence, validation, redirect rules, and event aggregation are backend-owned and are not verified here.

## Existing owners and flow

- `/app` → Tools → Promotion Center (`src/tools/promotion/PromotionCenterApp.tsx`) owns release campaign drafts, status, details, fan lists, and campaign analytics. It can import an existing YSong release or create a manual campaign; campaign kinds are `smart_link`, `presave`, and `release`.
- Public links use `/p/:slug` (`src/pages/PromotionLanding.tsx`). The page fetches campaign data, shows title/artist/artwork/copy, optional QR, destination links, and consented email capture. Artwork and QR are fetched from the promotion public API.
- Destinations are `PromotionDestination[]` with platform, label, URL, kind, enabled state, and optional position. Kinds cover stream, pre-save, social, store, and other. The UI lets an artist add multiple arbitrary platforms and URLs; frontend filtering does not enforce a particular provider.
- Destination clicks go through `/api/promotion/r/:slug/:destinationId`; the landing-page view and fan signup go through `/api/promotion/public/:slug/events` and `/fans`. UTM source/medium/campaign/content plus YSong ad campaign and creative IDs are forwarded. A visitor ID is stored in local storage when available.
- `PromotionAnalytics` exposes totals (views, clicks, email captures, conversions, unique visitors, rates), event-type counts, destination counts, and daily counts. Paid-ad analytics joins these YSong measures with Meta delivery data in the existing ad-campaign owner.

## Spotify assumptions and boundaries

- The Smart Link DTO, campaign kinds, landing-page renderer, click route, and analytics breakdowns contain no Spotify-specific destination field or provider branch. A platform is artist-supplied text; provider catalogs are returned by the backend.
- The create form used Spotify as the first example in its platform placeholder. This was presentation bias only, not a data or routing dependency; the placeholder is now neutral.
- Imported releases/tracks use YSong release and track IDs, not Spotify IDs. The public UI does not resolve catalog metadata or validate destination URL ownership. Those behaviors, enabled-destination enforcement, click attribution semantics, conversion definitions, and provider catalog contents must be confirmed against the backend contract before relying on them.

## Reuse guidance

Keep `/p/:slug`, `PromotionLanding`, `PromotionCenterApp`, and `src/tools/promotion/api.ts` as the Smart Link owners. Extend their existing DTO and event flow for new destination or release-campaign needs; keep paid Meta state in its current linked AdCampaign flow. Do not add a second link-page or campaign owner.
