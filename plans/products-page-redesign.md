# Products Page Redesign

## Goals
- Modern, visually appealing product list while keeping the existing filter bar untouched.
- Roomier, scannable rows with a clear column structure and a left **health accent strip**.
- Floating sticky **bulk action bar** anchored to viewport bottom (Linear/Notion pattern).
- Tailwind utility classes referencing semantic tokens, per [docs/design-system.md §7](../docs/design-system.md).
- Default market for super_admin = **Tunisia** (use `getDefaultMarketId` semantics on the client).

## Out of scope
- `ProductsFilterBar` — DO NOT modify.
- Portfolio strip, product detail page, stock-adjust modal — leave as is.

## Files

### Edit
- [src/app/[locale]/(dashboard)/products/ProductsPageClient.tsx](../src/app/%5Blocale%5D/(dashboard)/products/ProductsPageClient.tsx)
  - Default `selectedMarketId` from markets list once loaded — prefer `code === "tn"`.
  - Wrap product list in a card shell with a column header row.
  - Render new floating `<BulkActionBar />` at the page level.
  - Migrate inline styles → Tailwind utilities.
- [src/components/products/ProductCatalogRow.tsx](../src/components/products/ProductCatalogRow.tsx)
  - Full Tailwind rewrite. Layout = checkbox · accent strip · product cell · stock cell · perf/cost cell · status cell · actions.
  - Roomier (~64–72px), tabular-nums on metrics, hover background `surface-hover`, selected background `surface-selected`.
  - Keep all existing behavior (toggle active, threshold inline edit, ⋯ menu, variants chip, low-stock badge) — tests must keep passing.
- [src/components/products/BulkActionBar.tsx](../src/components/products/BulkActionBar.tsx)
  - Rewrite as **floating, sticky-bottom** card (`fixed bottom-6 inset-x-0 mx-auto`), `shadow-floating`, `rounded-card`, white surface, ink-primary button.
  - Same props (`selectedCount`, `loading`, `onActivate`, `onDeactivate`, `onClear`).
  - Returns `null` when `selectedCount === 0`.

## Default market fix
- `ProductsPageClient` currently initializes `selectedMarketId = marketId` (the user's own). For super_admin, `marketId` is `""`, so they see no products until they pick one.
- Add a `useEffect` that, once `markets` is loaded and `selectedMarketId` is empty, sets it to the Tunisia market (`code === "tn"`) or the first market.

## Visual spec — row
- Container: `flex items-stretch min-h-[64px] border-b border-line-subtle hover:bg-surface-hover transition-colors duration-fast` + selected variant `bg-surface-selected`.
- Accent strip: 3px wide inline-start bar, color from health (green/amber/critical). Always present so rows align; transparent when no signal needed (always have one — keep simple).
- Columns (flex):
  1. Checkbox (32px, center)
  2. Health dot + product name (flex-1 min-w-0)
     - name 14/600, variant chip + low-stock pill underneath if applicable
  3. Stock cell (140px) — current/threshold w/ inline edit when manage+catalogue
  4. Metrics cell (flex 1) — perf metrics inline OR cost metrics (COGS / Emb / CPL)
  5. Status toggle (88px)
  6. Actions ⋯ (40px)
- Numbers: `tabular-nums`, ink-primary; labels ink-secondary.

## Visual spec — column header
- New row inside the products card: `flex items-center px-4 py-2 border-b border-line text-[12px] font-medium uppercase tracking-[0.05em] text-ink-secondary bg-surface-card`.
- Mirrors row column widths.

## Visual spec — floating bulk bar
- `fixed bottom-6 left-1/2 -translate-x-1/2 z-40` (use logical equivalents for RTL? Centered horizontally — `left-1/2` with `-translate-x-1/2` works in both directions; if not, use `inset-inline-start: 50%`).
- Pill-shaped: `bg-surface-card border border-line rounded-pill shadow-floating px-4 py-2 flex items-center gap-3`.
- Selected count chip + activate / deactivate / clear buttons.
- Animate-in: `transition-opacity duration-fast` (no transforms beyond positioning).

## TDD
Existing tests in `ProductCatalogRow.test.tsx` will validate behavior survives the rewrite. No new tests required for the redesign itself per the request scope, but I'll run the full suite before signing off.

## Verification
- `npm run typecheck`
- `npm test -- products`
- Boot dev server and click through (manual smoke).

## Risks
- Existing tests rely on `getByRole("img", { name })` for health dot — preserved.
- Existing tests rely on `getByRole("checkbox", { name: /sélectionner/i })` and `/statut/i` — preserved.
- Existing test queries `getByRole("button", { name: /actions/i })` for ⋯ menu — preserved.
- Filter bar still receives `selectedCount` etc. props (currently consumed). Plan: leave those props wired but the filter bar will keep showing its own bulk strip too — that duplicates UI. Decision: hide the filter bar's bulk strip by passing `selectedCount={0}` to the filter bar, since we promised not to modify the filter bar. The new floating bar becomes the sole bulk surface.
