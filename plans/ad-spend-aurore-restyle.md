# Dépenses pub — restyle in the Finances kit (as Produits & marges)

2026-10-05. Branch `feat/ad-spend-aurore` (worktree `.claude/worktrees/ad-spend-aurore`, off origin/main 06bf361).

## Why
Since PR #84, Dépenses pub is the only Finances page outside the shared kit (`src/components/finance/kit`):
flat white on grey, its own `--ads-*` tokens and formatter. Moving from Produits & marges to Dépenses pub
reads as two products. The owner asked to keep "almost everything" and only bring the visuals in line with
/products. (This reverses "skip ad spend, keep it as it is" from round 4 of plans/finances-redesign.md.)

## Owner's answers (2026-10-05, all « recommandé »)
1. **Scope** — the new look + display-only fixes. No new behaviour, no new data.
2. **Top band** — the chain stays a chain, in one glass card (not KPI tiles).
3. **Overlays** — page fully restyled; the mapping drawer, entry modal, CSV import and delete confirm get
   the kit's frame, buttons, inputs and colours; the drawer's v2 inner layout (2026-10-01) does not change.
4. **Process** — HTML prototype first.

## Phase 0 — prototype (gate)
`prototypes/finances-pub-v4.html` · `?screen=page|drawer|entry|locked|import|preview|delete` ·
`?open=tad|mal|unm` · `?notes=0` hides the numbered fix markers. French only (super_admin-only screen).
Fictional data (public repo). No React before the owner says yes.

## Display fixes (numbered in the prototype)
1. Paid cost per lead in **orange** (`--m-ads`), not green — green is profit everywhere else in Finances.
2. « Profit net » → « Bénéfice brut » (chain, stack, table, banner), as P&L and Produits.
3. Products with no attributed spend fold into ONE dashed line under the bars, not one « Coût inconnu » bar each.
4. Table: product column sticky while the 11 columns scroll.
5. Each verdict explains itself on hover.
6. « Où partent… » in the section's money order and colours (achat, livraison, retours, pub, emballage;
   packaging purple, returns = a tint of delivery). Live has pub first, packaging pink, returns violet.
7. Delete confirm says the market currency — `adSpend.deleteDescription` hard-codes « TND » (fr + ar).
8. Coverage banner shows a readable date — today it prints the raw ISO `2026-07-14`.

Not taken from finances-pub-v3 (new behaviour): period picker, platform per campaign, « + N en route »,
« Trop tôt », bar → table jump, TikTok/Snapchat sync cells.

## Decisions I made as the expert
- Page width = the kit's 1200 px. The chain keeps its links down to 1340 px viewport, then wraps to a grid
  as live does. Step holders (Produits' tinted icons) were tried and dropped: they made the chain collide at
  1200 px; a small money-colour square marks each step instead.
- Bars: orange solid to min(CPL, seuil), green hatch = margin left, red hatch = overrun; CPL caption only when
  the solid part is > 20 % of the track (live: 12 %, which overflowed on short bars).
- Product tiles = Produits' `.pimg`; in React they keep the real product image (`ProductAvatar`) inside the tile.
- Verdict pills on kit hues (Scaler brand, Sain good, Réparer warn, À couper bad, Non attribué flat).

## Phase 1 — React (after the yes)
- Wrap the page in `.fin.ads` (never bare `.fin`: Next keeps a visited page's CSS, P&L's `.flow` would leak).
  New `src/components/ad-spend/ad-spend.css` scoped `.fin.ads`, px values (root font 14 px).
- Swap `ads-*` Tailwind classes and `AD_SPEND_THEME` for kit tokens; delete `theme.ts` and the `--ads-*`
  block in globals.css once nothing reads them (grep first — `--ads-*` may be read elsewhere).
- Formatting via the kit's `makeFmt`/`Money`.
- Overlays: Sheet/modal frame + inputs/buttons only; MappingList/Detail/Editor markup untouched.
- No route, hook, RPC or migration change. Tests: AdSpendProductTable + mapping drawer tests must stay green;
  add tests for fixes 3, 5, 7, 8 (behaviour visible to a user) first (TDD).
- Avoid the class `ring` (collides with Tailwind's `.ring`).
- Verify with screenshots against the prototype on the local stack before the PR.

## Revision v5 (2026-10-05) — the owner's one change
« follow it exactly, just one thing: remove these warnings and put them in one place under
Campagnes et produits » → asked where; answer: **inside the drawer**. `prototypes/finances-pub-v5.html`:
the page has no banners, the drawer's button carries their total (campaigns waiting + products with
no spend), and the drawer opens on one band holding both lines and the meter. With no Meta account
there is no drawer, so the page keeps the banners (an alert must never simply disappear).

## Build log (2026-10-05)
- `src/components/ad-spend/ad-spend.css` — the prototype's page CSS under `.fin.ads`, overlays under
  `.ads-ov` (kit tokens + frame, NO kit resets: `.fin button{…}` outranks the drawer's Tailwind).
- `AdSpendEconomics.tsx` rewritten in kit classes, same props and exports + `AdSpendCoverageNote`
  (the drawer's line). Tooltips render BESIDE each card: `.card` has `backdrop-filter`, which makes a
  fixed child position against the card.
- `AdSpendClient.tsx`: kit header, warnings counted on the button, overlays beside the root, delete
  confirm with the market currency. `AdSpendMappingDrawer`: kit head + the warnings band (`coverage`
  prop); panes untouched. Entry modal + CSV import: kit frame, same fields and logic.
- `theme.ts` deleted (no readers). `--ads-*` tokens in globals.css left in place.
- Found on the way: the CSV import's « Analyser » was black text on black (#1A1A1A / #000) — invisible;
  fr-FR grouping (U+202F) has no width in Plus Jakarta Sans — « 34707 » — swapped for U+00A0 in the
  page's and the drawer's formatters.
- Visual check without a dev server (the env copy is refused): `src/__preview__` rendered the real
  components to static HTML with the compiled Tailwind + kit CSS, screenshotted next to v5. Deleted after.
- Deviation: chain figures 24px, not 26 — at a 1440 screen the prototype clips « LYD » after « 103 031 » against the cost pill.
