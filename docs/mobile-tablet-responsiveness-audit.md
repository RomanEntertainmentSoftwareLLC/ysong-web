# YSong mobile and tablet responsiveness audit

## Defect map

| Surface | Phone (320–430 px) | Tablet (768–1023 px) | Follow-up |
| --- | --- | --- | --- |
| Signed-in shell | The 40 px navigation rail and viewport-fixed workspace leave little width for dense workspaces. Browser chrome can also change the visible height after load. | The same narrow rail is used until the 1024 px `lg` breakpoint; the workspace gets the remaining width. | Keep the rail consistent for this pass; evaluate a tablet sidebar mode and touch navigation separately. The shell now tracks dynamic viewport height. |
| Tabs and workspace navigation | The tab strip has horizontal scrolling and hidden scrollbars already. Long tab titles and many tabs still need touch-focused review. | Same behavior; the sidebar remains a drawer below `lg`. | Verify tab close/reorder and drawer access with touch; avoid changing established tab semantics. |
| Dialogs and popovers | Components using `.ys-dialog` could exceed the visible height or width if their content is dense. | Large dialogs can occupy most of the available viewport. | `.ys-dialog` now caps width/height and scrolls its content. Several overlays use custom styling and are outside this shared rule. |
| DAW and mixer | Dense transport/control rows, timeline tools, and mixer strips use fixed widths and require horizontal navigation or workspace redesign. | Mixer side banks can consume a large share of the available width; DAW has more room but still packs controls tightly. | Review track/control-bank collapse, touch target sizing, and landscape operation within each workspace. |
| Other workspaces and forms | Content grids and multi-column forms vary by workspace; no single shared rule can safely reflow every custom surface. | Cards generally have more room, though fixed side-by-side controls can remain cramped. | Follow up on representative Create Song, Rooms, Library, Visuals, and settings flows. |

## First pass

- Added a shared viewport-constrained scroll treatment for `.ys-dialog` surfaces.
- Changed the signed-in shell to use dynamic viewport height where supported, with a `100vh` fallback.

This is a source-level audit of shared structures and workspace control patterns. It does not certify every interactive workspace at every device width; the workspace-specific items above need hands-on layout review as they are redesigned.
