# Light theme defect audit

## First pass

- The root declared both color schemes while its default foreground and page background were dark-theme values. Light mode could inherit pale text on a light surface, and native controls had ambiguous scheme colors.
- Inputs used a mid-gray translucent fill and a white focus ring in both themes, making fields muddy and focus hard to see in light mode.
- The persistent player range track and thumb used dark-mode colors regardless of theme; global link/button hover shadows also added muddy halos on light surfaces.
- Borders vary across components and many surfaces still use literal neutral classes. A broader component-level contrast review is still needed; this pass adjusts shared defaults and obvious controls only.

## First-pass changes

Added light and dark root color tokens, applied page foreground/surface tokens, gave inputs theme-aware fill, border, and focus colors, and split player range colors by theme. Reduced light-mode button hover shadow and removed the light link halo.
