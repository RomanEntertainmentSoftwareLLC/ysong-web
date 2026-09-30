# Ads Creative Studio project and edit contract

`ReusableAdCreative.studioProject` is the optional, versioned edit source for Ads creatives. The reusable creative keeps its existing music, media, CTA, caption, provenance, and render ownership. Campaign `AdCreative` rows and destination variants remain bindings and derived outputs. A project never copies object keys, signed URLs, or campaign credentials into clips.

## Timeline

- `schemaVersion: 1` is required. Readers reject unknown versions; migrations must be explicit.
- `durationFrames` and clip positions are integer frames. The rational `framesPerSecond` timebase gives exact timeline positions, including rates such as `30000/1001`. Clip intervals are half open: `[startFrame, startFrame + durationFrames)`. Keyframe frames are relative to their clip.
- `tracks` are ordered arrays. Visual and text tracks stack bottom to top; audio tracks are mixed in order. Clips are ordered by start frame within each track. Overlap is allowed for compositing and audio mixing.
- Visual clips resolve `mediaId` through the owner's `backgroundMedia`; audio clips resolve `snippetId` through `audioSnippets`. Source in/out seconds are relative to the referenced asset. The renderer must verify these ranges against authoritative asset durations and rights before rendering. Text clips own only text and style.
- Transforms use normalized canvas coordinates, scale (1 is native), degrees, and opacity from 0 to 1. Audio volume is 0 to 1. Keyframes interpolate within a clip. `cut` has zero duration; fades and dissolves consume clip frames. Editors must preserve unknown future fields only by declining to edit an unknown schema version.
- The project render block specifies canvas, H.264/AAC, and background. Rendered object keys and statuses stay on the reusable creative's existing `renders` fields; they are invalidated when the project changes.

## Persistence

The frontend validates loaded and outgoing JSON with `validateCreativeStudioProject`. `GET /api/tools/promotion/creatives/:creativeId/studio-project` returns `{ project: CreativeStudioProject | null }`. Saving targets `PUT` at the same path with `{ expectedRevision, project }`; `expectedRevision` and `project.edit.parentRevision` equal the revision the editor loaded. These APIs are a contract for the promotion backend, which is outside this repository and is **not implemented here**.

The backend must authenticate and authorize the reusable creative owner, validate the referenced snippet/media IDs against that creative, verify source ranges, enforce payload limits, and atomically compare the persisted revision before replacing the project. On success it increments `revision`, updates `edit.updatedAt`, stores the edit transactionally, marks derived renders stale, and returns the updated reusable creative. On mismatch it returns HTTP 409 with the current revision; clients must reload or explicitly merge, never retry a blind overwrite. Failed validation must leave the prior edit and render references untouched. A missing project starts at revision 0. Deleting source media referenced by a saved project requires an explicit edit or rejection.
