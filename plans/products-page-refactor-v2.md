# /products — Full Layout & Data-Layer Refactor

> **STATUS: implemented.** Prototype: https://claude.ai/code/artifact/f0c21aa6-ab2c-4ac6-a6a6-4897f25efa39
> Supersedes [products-page-redesign.md](./products-page-redesign.md), whose "DO NOT modify
> `ProductsFilterBar`" constraint is the reason that file was still 100% inline styles.

## Deviations from this plan, and why

1. **The migration does NOT set `security_invoker = true`.** The plan bundled it with the
   column widening. Split, because flipping it also re-evaluates `real_inventory`'s correlated
   delivered-order count under the caller's `orders_select` policy AND puts the embedded
   `product_variants(count)` under `product_variants` RLS — either can change a number on
   screen, and bundling that with "the view was missing seven columns" makes a regression
   impossible to isolate. **Open follow-up.** Verified in production that this is pre-existing
   and systemic, not introduced: `pg_class.reloptions` for the view is `(none)`, and the
   Supabase advisor flags all three views in the database (`product_inventory_view`,
   `product_return_rate_view`, `follow_up_campaigns`) the same way. Verified no new exposure —
   `has_column_privilege('authenticated','products','unit_cogs','SELECT')` was already `true`,
   so the view grants `authenticated` nothing it could not already read off the base table, and
   `REVOKE ALL … FROM anon` confirms `anon` cannot read the view at all.

2. **The sidebar stays dark.** The reference screenshot showed a light sidebar; adopting it
   rewrites every page in the app and contradicts `docs/design-system.md` §1 rule 2 ("the
   sidebar is the only dark surface"). Out of scope for a `/products` change — needs its own
   decision.

3. **No `Supprimer` in the bulk bar**, despite the reference showing one. Products have no hard
   delete: `is_active` IS the soft delete and `orders.product_id` references products, so a real
   DELETE would detach order history and silently change already-reported profitability.
   Deactivation is the destructive action offered, and it is reversible. **Open decision.**

4. **`Marge moyenne` is not a fourth KPI card and `Marge faible` is not a sixth exception
   tile** — following the reference's three cards / five tiles. Average margin appears as the
   Profit-net card's subline; `thinMargin` survives as a facet in the Filtres menu so the
   capability is not lost.

5. **A minimal `prod.*` token scope was added** (7 CSS vars in `globals.css`, aliased in
   `tailwind.config.ts`), following the existing `oms.*` / `agent.*` / `hue.*` precedent.
   Red/amber/blue reuse `status.*`; only the grass green was genuinely missing —
   `status.success` is a teal and `accent` is reserved by the design system for two specific uses.

6. **`MarginBar` was upgraded and reused** rather than left orphaned beside a hand-rolled
   duplicate in the row: label-first (the reference's order), three tiers instead of two so
   `thinMargin` is expressible, locale-aware formatting via an injected formatter, and a
   `data-tone` attribute so the test asserts the tone rather than a hex.
   **`HealthDot` was deleted** — no consumer remains; health now reads through badges, the
   status pill, and coloured figures.

7. **`npm run lint` was not run** — this repo has no ESLint config, so `next lint` drops into
   an interactive setup prompt. Pre-existing gap, deliberately not resolved here.

8. **Pre-existing test failures**: 35 tests across 15 files fail on `main` (leads, warehouse,
   settings, team, carriers, storefronts, orders webhook, DatePicker, market-scope). Confirmed
   by stashing this work and re-running. Untouched.

9. **The drawer's cost composition carries all six cost lines and reconciles.** The prototype
   synthesised them client-side (`delivered_count × unit_cogs`, `confirmed_count × packing_cost`,
   …), which (a) duplicated the canonical formula, (b) could not express carrier fees at all —
   delivery is summed per delivered order and return per returned order, each at that order's
   own carrier's rate, so counts cannot reconstruct them — and (c) therefore did not add up. The
   prototype's own figures were off by 590 LYD:
   `12 420 − 5 146 − 747 − 77 − 354 − 1 180 − 101 = 4 815`, against a stated net of `+4 225`.
   `ProductPeriodMetrics` now carries `cogs`, `delivery_cost`, `return_cost`, `packing_cost`,
   `processing_cost` and `ad_spend` straight off `calculateProductProfitability`, unrounded, and
   a test asserts `revenue − Σcosts === net_profit`. A `Net` summary row closes the arithmetic
   on screen. Zero-value lines are rendered rather than filtered: an absent bar reads as "does
   not apply", a zero bar as "applies and is zero", and on a COD product a 0 return cost is
   information.

## Context

`/products` is the oldest-generation list page in the app. It predates the `/orders` console
(the current house style) and shows it: a div-based pseudo-table instead of a real `<table>`,
100% inline styles with hardcoded hexes in `ProductsFilterBar`, a segmented Catalogue/Performance
toggle that only swaps one column, an inert KPI strip, and no product imagery.

Worse, it is **factually wrong on screen**. `GET /api/products` serves `product_inventory_view`,
which contains only 9 columns — `unit_cogs`, `packing_cost`, `is_active`, `sku`, `default_price`
and `image_url` are all absent. Because `select("*")` masks missing keys, this produces four
silent defects visible in the screenshot that prompted this work:

1. `COGS NaN LYD` / `Emb. NaN LYD` on every row — `Intl.NumberFormat.format(undefined)` → `"NaN"`.
2. Every health dot and accent strip renders **red** — `getProductHealth` starts with
   `if (!input.isActive) return "red"`, and `is_active` is `undefined`.
3. Every status toggle reads "Désactiver" and **can never deactivate** — `!undefined` is always `true`.
4. The `Actifs` filter matches zero rows, and `PortfolioStrip` reports `0` active / `0` low stock.

On top of that, status filtering and sorting run **client-side over the current 25-row page only**
while search runs server-side over the whole catalogue — so "Stock bas" only finds low stock on
page 1, and the pagination range label disagrees with the reported total.

**Outcome:** one unified, correct, dense product table with real numbers, KPI tiles that navigate,
whole-catalogue server-side filtering and sorting, a slide-over detail drawer, and a data layer
whose counts cannot lie.

---

## Confirmed decisions

| Decision | Choice |
|---|---|
| Primary jobs | Money (which products earn) · Catalogue (maintain data) · Operations (how products convert) |
| Structure | **One unified table, no modes.** Catalogue/Performance segmented toggle is deleted |
| Density | Dense real `<table>`, sticky header, 28px thumbnails, ~56px rows |
| Default columns | Profit block + Funnel block + **always-on compact stock chip** |
| Hidden columns | Cost block, stock detail, volume counts — behind a column picker |
| Detail view | **Slide-over drawer** via `ui/Sheet.tsx`, deep-linked `?open=<id>` |
| Drawer content | 1. Profitability breakdown · 2. Stock panel · 3. Costs & pricing (editable). **No agent content in v1** |
| Row actions | Inline-edit threshold + costs only. Active toggle and Ajuster le stock move to the `⋯` menu + drawer |
| Bulk actions | Keep checkboxes + floating bar; **extend** with bulk threshold set + CSV export |
| Sorting | **Clickable column headers**, server-side, URL-synced. Sort dropdown deleted |
| KPI tiles | Read-only **Portefeuille** first, then clickable: Rupture · Stock bas · Perdant de l'argent · Marge faible · Sans ventes · Inactifs |
| Stock filtering | Sortable STOCK header + the stock tiles (user added these back mid-planning) |
| Default period | **Last 30 days** (replaces today-only) |
| Zero-revenue margin | **Keep the canonical formula** (`margin_pct = 0` when `revenue = 0`). Zero-revenue products surface via the `Sans ventes` tile, not `Perdant de l'argent` |
| Fix scope | Everything: API fields, server-side filter/sort, honest counts |

**Stated design decision (not asked, flagged for reversal):** products stays on the **global**
`surface/ink/line/status` tokens, not the `oms.*` warm/violet palette scoped to the orders console.
We match `/orders` *structurally* (real table, sticky header, KPI-as-navigation, drawer, deep-link)
not *chromatically*. Reversing this is a token swap in two components, not a rework.

---

## Layout

```
Produits                                                    [Export CSV] [+ Ajouter un produit]
● Libya · 8 produits · 30 derniers jours

╭╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╮ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
╎ PORTEFEUILLE      ╎ │ RUPTURE  │ │STOCK BAS │ │ PERDANT  │ │  MARGE   │ │  SANS    │ │ INACTIFS │
╎                   ╎ │          │ │          │ │ L'ARGENT │ │  FAIBLE  │ │  VENTES  │ │          │
╎ 18 400 LYD stock  ╎ │    2     │ │    2     │ │    1     │ │    2     │ │    3     │ │    2     │
╎ CA 12 300 · 34 %  ╎ │ produits │ │ ≤ seuil  │ │ profit<0 │ │  ≤ 10 %  │ │0 prospect│ │désactivés│
╰╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╯ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
      read-only          clickable · aria-pressed · active = accent border + accent-bg + inset ring

┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 🔍 Rechercher…  [30 derniers jours ▾]  [Filtres ▾ ②]  ⋯⋯⋯  [⊞ Colonnes ▾]                       │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
  ⓧ Marge faible   ⓧ « quran »   Tout effacer          ← removable chips, only when filters active

┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ☐ │ PRODUIT              │ STOCK↕│    CA ↕│ PROFIT ↕│  MARGE ↕│CONF↕│LIV ↕│RET ↕│ STATUT │  ⋯  │  ← sticky
├───┼──────────────────────┼───────┼────────┼─────────┼─────────┼─────┼─────┼─────┼────────┼─────┤
│ ☐ │▐[img] دمية الملاكمة   │  200  │  4 200 │  +1 428 │▓▓▓░ 34 %│ 68 %│ 82 %│ 11 %│ ● Actif│  ⋯  │
│   │     3 variantes · SKU │ /20   │        │         │         │     │     │     │        │     │
├───┼──────────────────────┼───────┼────────┼─────────┼─────────┼─────┼─────┼─────┼────────┼─────┤
│ ☐ │▐[img] Quran          │ 1 000 │  1 850 │   +388  │▓▓░░ 21 %│ 54 %│ 76 %│ 18 %│ ● Actif│  ⋯  │
├───┼──────────────────────┼───────┼────────┼─────────┼─────────┼─────┼─────┼─────┼────────┼─────┤
│ ☐ │▐[img] XX  ⚠ Rupture  │    0  │      — │      —  │    —    │  —  │  —  │  —  │ ○ Inact│  ⋯  │
│   │                      │ /5    │        │         │         │     │     │     │        │     │
├───┴──────────────────────┴───────┴────────┴─────────┴─────────┴─────┴─────┴─────┴────────┴─────┤
│ ‹ Précédent            1–8 sur 8  ·  Page 1 sur 1              Suivant ›     [25 par page ▾]    │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

                    ╭──────────────────────────────────────────╮
                    │  ◆ 3 sélectionnés   Activer  Désactiver  │  ← floating, fixed bottom-6
                    │     Seuil…   Export CSV   ✕ Effacer      │
                    ╰──────────────────────────────────────────╯
```

`▐` = 3px health accent strip (leading edge, logical `inset-inline-start`).

### Grid / responsive

KPI strip: `grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))`, Portefeuille tile
`grid-column: span 2`. At ~1400px content width that is 8 tracks → portfolio(2) + 6 tiles fit one
row; it degrades to two rows below ~1150px without a media query.

Table: `<colgroup>` fixed widths, `tableLayout: fixed`, `minWidth: 1044`, `overflowX: auto` on the
card. Sticky `<thead>` (`position: sticky; top: 0; z-index: 1`).

---

## Column spec

Default-visible, in order. Sortable columns get a `<button>` inside the `<th>` with an
`ArrowUp`/`ArrowDown`/`ArrowUpDown` indicator and `aria-sort`.

| # | Column | Width | Content | Sort key |
|---|---|---|---|---|
| 1 | checkbox | 44 | select-all in header | — |
| 2 | **PRODUIT** | auto, min 240 | 28px `ProductAvatar` · name 14/600 **`dir="auto"`** · micro-line 11px: variants chip, SKU, stock-state badge | `name` |
| 3 | **STOCK** | 92 | number 15/600 colored by stock state · `/ threshold` 11px below (inline-editable) | `current_stock` |
| 4 | **CA** | 110 | `formatCurrency`, tabular, end-aligned | `revenue` |
| 5 | **PROFIT NET** | 110 | signed; **color on the figure only**, never the cell | `net_profit` |
| 6 | **MARGE** | 100 | `MarginBar` + % | `margin_pct` |
| 7 | **CONF.** | 74 | % — a rate is a status (§4.16), so it may carry status color | `confirmation_rate` |
| 8 | **LIV.** | 74 | % | `delivery_rate` |
| 9 | **RET.** | 74 | % (inverted thresholds — high is bad) | `return_rate` |
| 10 | **STATUT** | 88 | `Badge` + `StatusGlyph`, **not** a switch | `is_active` |
| 11 | ⋯ | 48 | `ui/Menu.tsx` | — |

**Behind the column picker** (persisted per user in `localStorage`, key `oms:products:columns`):
SKU · COGS unitaire · Emballage · Frais confirmation · Prix de vente · Valeur stock ·
Seuil · Système vs Réel · Endommagés · Prospects · Livrées · Retournées · Pub · Coût/livrée.

### Cell rules
- All numbers `tabular-nums`. Empty metric renders `—`, never `0`, never `NaN`.
- Product name, variant labels and any Arabic string carry **`dir="auto"` per node, never on a
  container** (§4.17 F). This is the bug that will bite hardest in the Libya market — today
  `ProductCatalogRow` has zero `dir="auto"`.
- Row click (outside checkbox / `⋯` / inline inputs) opens the drawer. Name remains a real `<Link>`
  to `/products/[id]` so ⌘-click still opens a tab.
- No `next/image` — `images.remotePatterns` is unconfigured; reuse `orders/ProductAvatar.tsx`.

---

## Data layer

Recommendation: **compute in the route handler**, not in SQL. The canonical money formula
(`src/lib/calculations/product-profitability.ts`) must stay TypeScript so Vitest can assert it —
reimplementing it in PL/pgSQL would strip its unit tests, which collides with the mandatory-TDD
rule. The catalogue is small (single-digit to low-hundreds per market); the cost axis is order
volume, which the page already pays today. `investor_daily_product_stats` is rejected as a source:
it attributes through `order_items` and prorates ad spend, so it would **disagree with the product
detail page** it links to.

Documented promote-to-SQL trigger: >~2000 products in one market, or >1.5s p95 on the 30-day window.

### Migration — one, containing no formula

`supabase/migrations/<ts>_product_inventory_view_full_columns.sql`

`CREATE OR REPLACE VIEW product_inventory_view` — keep the existing 9 columns **in position**
(a `CREATE OR REPLACE` requirement), append `sku, image_url, unit_cogs, packing_cost,
confirmation_processing_cost, default_price, is_active`. Then:

```sql
ALTER VIEW product_inventory_view SET (security_invoker = true);
REVOKE ALL ON product_inventory_view FROM anon;
```

Three things this settles:
- The view is consumed by **exactly one file** (`src/app/api/products/route.ts`) — blast radius of one route.
- `security_invoker` appears nowhere in this repo, so on PG15+ the view currently runs as its
  superuser owner and **`products_select` RLS does not apply through it**. Market isolation for
  `/api/products` rests entirely on a hand-written `.eq("market_id", …)` — contradicting
  *"market isolation enforced via RLS at the data layer"*. Setting `security_invoker = true` is the
  RLS-hardening half of this change.
- It **closes** a COGS leak rather than opening one: `20260819000007` stripped the cost columns from
  `anon` on the base table; under `security_invoker` the view is checked against the caller's column
  privileges, so `anon` still cannot read them.

Semantic check to reason about, not hand-wave: `real_inventory`'s correlated delivered-order count
now runs under the caller's `orders_select`. For `super_admin` (all markets) and `market_manager`
(own market) every relevant order is visible → value **identical to today**. Agents are routed to
the `products` table and never touch the view. Document in `COMMENT ON VIEW`.

Verification via `DO` blocks with `RAISE EXCEPTION 'FAIL: …'`, following `20260819000007` — the
repo's only mechanism for testing SQL. Assert: all 16 columns present; `pg_class.reloptions`
contains `security_invoker=true`; `has_column_privilege('anon', …, 'unit_cogs', 'SELECT')` is false.

**Post-apply smoke check:** `security_invoker` also puts the embedded `product_variants(count)`
under `product_variants` RLS — confirm `variant_count` is still non-zero for a `market_manager`
before merging.

### `GET /api/products` — fixed in place

All existing params and **both** existing response shapes preserved (the legacy no-`page` form
returns bare `{ data }` and is consumed by `MappingsPageClient`, `OrdersPageClient`, `NewLeadModal`,
`ConvertLeadModal`, `AdminPositionsPanel`). Only the projection widens. The second `image_url`
lookup at `route.ts:95-105` is deleted — the view now carries it.

The agent path stays **unchanged and narrow** (`id, name, image_url, current_stock, is_active,
market_id` from `products`) — no financial columns, enforced by the select list, not post-filtering.

Also fix a latent bug this exposes: `NewLeadModal.tsx:122` and `ConvertLeadModal.tsx:61` both send
`&is_active=true`, which the route has never read.

### `GET /api/products/list` — new

Follows the existing `/api/orders` + `/api/orders/list` precedent, so requirement 1 can ship alone
and the order-creation picker never pays for a metric aggregation.

```
?market_id &q &filter &sort &dir &from_date &to_date &page &limit
filter: all|active|inactive|outOfStock|lowStock|losingMoney|noSales     default all
sort:   name|current_stock|unit_cogs|revenue|net_profit|margin_pct
        |confirmation_rate|delivery_rate|return_rate                    default name
dir:    asc|desc          period default: lastNDaysPeriod(30)           limit ∈ {10,25,50,100}
```

Response: `{ data[], pagination{total,page,limit,totalPages,rangeFrom,rangeTo}, facets{}, highlights{}, period{}, currency }`

- Period metrics are **nested** as `row.metrics`, not flattened — physically separating
  period-scoped figures from standing ones. Deletes `metricsMap` from the client entirely.
- `metrics: null` = *not permitted / not requested*, distinct from all-zeros = *no activity*.
  Conflating them is the same class of mistake as `is_active === undefined → !undefined → true`.
- `net_profit` on the wire, `simplifiedNetProfit` in the calc lib — renamed in exactly one
  `toWireMetrics()` function, so `product-profitability.ts` and its tests don't change.
- `currency` comes from `markets.currency`, killing the hardcoded
  `code === "ly" ? "LYD" : "TND"` at `ProductsPageClient.tsx:139` (a hardcoded cost variable).
  Display code goes through `formatDisplayCurrencyCode` / `formatCurrency` so products stops
  disagreeing with the rest of the app.
- `highlights` (top earner / worst margin) computed from the **full** enriched array — today
  `PortfolioStrip` derives them from the 25-row page and is therefore market-wide wrong. They link
  to product detail; they are navigation, not filters.
- Auth: `canViewProductProfitability(role)` → 403 for agent / warehouse_agent / investor.
  `super_admin` without `market_id` → **400** (cross-market ad-spend allocation is undefined).
  `market_manager` ignores the param and uses `actor.market_id`. Reads via `createClient()` —
  **never** `createAdminClient()`.
- `Cache-Control: private, max-age=30, stale-while-revalidate=300` (established across ~11 routes).

### Counts that cannot lie

One module, `src/lib/products/list-filters.ts`, with one predicate function; everything derives
from it — `predicateForFacet`, `applyFacet`, `computeFacetCounts`, `comparatorFor`.
`lowStock` reuses `isLowStock` from `src/lib/product-calculations.ts` (already encodes
`threshold === 0 → false`).

The route body reads, in this order and only this order:

```
enriched = merge(baseRows, metricsMap)
facets   = computeFacetCounts(enriched)     // every facet via the SAME predicate
matched  = applyFacet(enriched, filter)
sorted   = sortRows(matched, sort, dir)
data     = sorted.slice(offset, offset + limit)
total    = matched.length
```

`facets[filter] === pagination.total` therefore holds **by construction** — asserted as a test at
both the pure-function and HTTP layers. Tile id **is** the facet value, so there is no mapping
table to drift (unlike `src/lib/orders/kpi-tiles.ts`).

Two facts the UI must respect:
- **Facets are not a partition** — a product with `threshold > 0` and `stock <= 0` counts under both
  `outOfStock` and `lowStock`. Tiles must never be presented as summing to `all`.
- `margin_pct = 0` when `revenue = 0`, so an ad-spend burner with no deliveries lands in
  `Sans ventes`, not `Perdant de l'argent`. **This is why the Sans ventes tile exists.**

Catalogue reads use the existing `fetchAllRows` helper (`src/lib/supabase/fetch-all.ts`), never a
bare `.select()` — PostgREST caps at 1000 rows. No `count: "exact"` anywhere; `total` comes from the
array the rows were sliced from.

### Sorting

Every comparator ends with a **fixed tie-break: name collator, then `id`, always ascending
regardless of `dir`.** This is correctness, not polish — with 8 products over 30 days most
`revenue`/`net_profit` values are `0`, so ties are the *common* case, and without a total order
`.slice()` pagination can repeat a page-1 row on page 2. `name` uses
`Intl.Collator(undefined, {numeric: true, sensitivity: "base"})` — better than Postgres
`ORDER BY name` for Arabic.

**Page clamping:** if `page > totalPages` after a filter change, the server clamps and returns the
clamped value in `pagination.page`; the client syncs the URL **from the response**. `rangeFrom` /
`rangeTo` are server-computed — `ProductsPageClient.tsx:458-459` currently derives them from
post-client-filter length against a server total, which is wrong by construction.

`src/lib/product-sort.ts` and its test are **deleted** — client-side sorting over one page is the defect.

### `profitability-bulk`: absorbed and deleted in the same PR

Verified consumers: one fetcher (`ProductsPageClient.tsx:175`) plus type-only imports in
`ProductCatalogRow.tsx` and its test. Move the whole route body to
`src/lib/products/metrics.ts` as `loadProductPeriodMetrics({supabase, marketId, fromDate, toDate,
products})` → `Map<string, ProductPeriodMetrics>`, guaranteeing an entry for **every** product
(zeros, not absent — absence is what makes `noSales` unreliable). Migrate its auth-matrix tests into
the new route's test rather than losing them. Update the `finance-permissions.ts:14` docstring.

Not deprecated-in-place: two endpoints computing the same numbers is how one gets changed and the
other doesn't.

### Types — `src/types/product-list.ts`

`ProductPeriodMetrics` · `ProductListRow` · `ProductFacet` + `PRODUCT_FACETS` · `ProductSortKey` +
`PRODUCT_SORT_KEYS` · `SortDirection` · `ProductFacetCounts` (`Partial<Record<…>>`) ·
`ProductHighlights` · `ProductListResponse`. snake_case throughout, mirroring the JSON exactly.

Deliberately **not** an extension of `Product` in `src/types/product.ts` — that is the full DB row.
Conflating a projection with the row is how 8 competing product shapes happened. Consolidates:
`ProductRow` ×2, `BulkProductMetrics`, `PortfolioProduct`/`PortfolioMetrics`,
`SortableProduct`, `ProductFilterStatus` (→ `ProductFacet`, gaining `inactive`/`outOfStock`/`noSales`),
`ProductSortKey`. Out of scope on purpose: `ProductSheetProduct`, `ProductIntelligence`,
`EditableProduct`.

### SWR

**One key holding every server-affecting param** — any split key lets a stale filter's rows paint
under a new filter's counts, the exact lie being fixed. New `src/hooks/useProductsList.ts`
following `useOrdersList.ts`, with `{keepPreviousData: true, revalidateOnFocus: false,
dedupingInterval: 30_000}`. No `unstable_cache` — wrapping a cookie-scoped Supabase client is a
cross-user cache-poisoning hazard.

Client rules: `filter`/`sort`/`dir`/`q` changes reset `page` to 1 **in the same `router.replace`**
(today page resets for search but **not** for sort — sorting on page 3 leaves you on page 3 of a
reordered set). `filter`/`sort`/`dir`/`page`/`limit`/`period` all live in the URL via the existing
`setQuery`. `is_active` toggles optimistically then `mutate()` the one active key — a product
toggled off while `filter=active` must leave the list, and only the server can say what backfills it.

`PeriodSelector`'s hardcoded `useState<TabKey>("today")` must change to `"last30"` or it shows the
wrong tab as active. Its currently-ignored `period` prop gets wired up.

---

## Files

### New
- `supabase/migrations/<ts>_product_inventory_view_full_columns.sql`
- `src/types/product-list.ts`
- `src/lib/products/list-filters.ts` — facets, predicates, counts, comparators, parse/serialize, zod schema
- `src/lib/products/metrics.ts` — lifted from `profitability-bulk` + `toWireMetrics`
- `src/app/api/products/list/route.ts`
- `src/hooks/useProductsList.ts`
- `src/components/products/ProductsTable.tsx` — real `<table>`, `<colgroup>`, sticky `<thead>`, sortable headers, skeleton + empty early-returns
- `src/components/products/ProductsTableRow.tsx` — replaces `ProductCatalogRow`
- `src/components/products/ProductsKpiStrip.tsx` — replaces `PortfolioStrip`
- `src/components/products/ProductsToolbar.tsx` — replaces `ProductsFilterBar`; search (`/` + `⌘K` hotkey), period, overflow filter menu, column picker
- `src/components/products/ProductColumnPicker.tsx`
- `src/components/products/ProductDetailDrawer.tsx` — `ui/Sheet.tsx` `placement="end"`, `next/dynamic({ssr:false})`, `key={openId}`

### Modified
- `src/app/api/products/route.ts` — widen projection, drop the image second-lookup, honour `is_active`
- `src/app/[locale]/(dashboard)/products/page.tsx` — h1 to 20–22/600 on token background (currently 24/700 with hardcoded `#F6F6F7`/`#1A1A1A`); move `+ Ajouter un produit` and `Export CSV` to the header, per `/orders`
- `src/app/[locale]/(dashboard)/products/ProductsPageClient.tsx` — delete `filteredProducts`, `metricsMap`, `sortProducts`, the currency ternary, the range arithmetic; add drawer deep-link via `window.history.replaceState`
- `src/components/products/BulkActionBar.tsx` — add bulk threshold + CSV export
- `src/components/shared/PeriodSelector.tsx` — wire the ignored `period` prop, default `last30`
- `src/messages/fr.json` + `src/messages/ar.json` — new keys under the existing `products` namespace (~130 keys already there). Both files, always.

### Deleted
- `src/app/api/products/profitability-bulk/` (route + tests, after migrating the auth matrix)
- `src/lib/product-sort.ts` + test
- `src/components/products/ProductsFilterBar.tsx`, `ProductCatalogRow.tsx`, `PortfolioStrip.tsx` (+ tests, superseded)

### Reused — do not rebuild
`ui/Sheet.tsx` · `ui/Menu.tsx` · `ui/Badge.tsx` · `ui/Button.tsx` · `ui/Skeleton.tsx` ·
`ui/InlineField.tsx` · `ui/Toast.tsx` (`useToast`) · `shared/Pagination.tsx` ·
`shared/StatusGlyph.tsx` · `shared/PeriodSelector.tsx` · `orders/ProductAvatar.tsx` ·
`products/HealthDot.tsx` · `products/MarginBar.tsx` · `products/StockAdjustModal.tsx` ·
`products/StockHistoryPanel.tsx` · `finance/{FinanceHeroCard,FinanceFunnel,CostCompositionBars}.tsx`
(drawer) · `lib/products/stock-badge.ts` · `lib/product-calculations.ts` · `lib/format.ts` ·
`lib/supabase/fetch-all.ts` · `hooks/useDebounce.ts` (exists, currently unused here)

---

## Also fixed on the way through

Hardcoded French strings bypassing i18n — `ProductsPageClient.tsx` ~293 `"La quantité doit être un
entier non nul."`, ~297 `"La note est obligatoire."`, ~308 `` `Erreur ${res.status}` ``, ~416
`"Sélectionner tout"`; `ProductCatalogRow.tsx` ~188 `aria-label="Sélectionner"`, ~309
`aria-label="Statut actif"`, ~84 `aria-label="Actions"`. Missing `dir="auto"` throughout. No error
banner and no `useToast()` — errors currently surface only inside the stock modal. Empty state has
no icon (use `OrdersTable`'s `Inbox`-in-a-circle). `⋯` menu reimplements `ui/Menu.tsx` with its own
outside-click listener.

---

## Implementation order

**Step 0 — Prototype, then STOP.** Build a self-contained static HTML mock (real Arabic product
names from the screenshot, plausible numbers, both LTR and RTL, sticky header, hover/selected
states, tile active states, drawer open state, column picker open state) and publish it as a private
Artifact link. **Wait for explicit confirmation before touching `src/`.** Also copy this plan to
`Ordra/plans/products-page-refactor-v2.md` per the repo's plan rule.

**Phase 1 — correctness, ships alone.** Migration → apply to a Supabase branch → smoke-check
`variant_count` and `real_inventory` for both markets → tests → widen `/api/products`. Verify on the
*existing* UI with zero client changes: `NaN LYD` gone, health dots no longer uniformly red, toggle
stops always sending `true`.

**Phase 2 — shared layer.** `src/types/product-list.ts` → tests → `list-filters.ts` → tests → `metrics.ts`.

**Phase 3 — endpoint.** tests → `/api/products/list` → delete `profitability-bulk`.

**Phase 4 — UI.** `useProductsList` → `ProductsTable` + `ProductsTableRow` → `ProductsKpiStrip` →
`ProductsToolbar` + column picker → `ProductDetailDrawer` → rewire `ProductsPageClient` → extend
`BulkActionBar` → i18n keys in both locales → delete superseded components.

TDD per `Ordra/CLAUDE.md` — failing test first, every phase.

---

## Tests

1. **`src/lib/products/__tests__/list-filters.test.ts`** (pure, first — fastest red-green loop).
   All 7 predicates against a 7-row fixture including one row that is *both* `outOfStock` and
   `lowStock` and one with `metrics: null`. Exact `computeFacetCounts`. **The invariant:** for every
   `f`, `computeFacetCounts(rows)[f] === applyFacet(rows, f).length`. `losingMoney`/`noSales` keys
   **absent** (not `0`) when metrics are null. `comparatorFor("revenue","desc")` orders revenue →
   name → id, and flipping `dir` does **not** reorder ties. **Stability across a slice boundary:**
   5 rows with identical revenue paginated 2+2+1 yields each row exactly once. Param parse defaults
   and unknown-value fallbacks; serialize round-trips and omits defaults.
2. **`src/lib/products/__tests__/metrics.test.ts`** — one entry per product, **zeros not absent** for
   a product with no orders in-window. **Parity:** `net_profit` equals
   `calculateProductProfitability(...).simplifiedNetProfit` and the three rates match — this is what
   makes deleting `profitability-bulk` safe. `margin_pct === 0` when `revenue === 0`. Goes through
   `fetchAllRows` (assert `.range` invoked).
3. **`src/app/api/products/route.test.ts`** (extend) — existing tests stay green as a regression
   fence. Agent rows contain the 6 safe keys and **do not** contain `unit_cogs`/`packing_cost`/
   `confirmation_processing_cost`. Manager/admin rows contain every widened field. **Legacy no-`page`
   call still returns bare `{data}`** with no `pagination`. `is_active=true` now filters.
4. **`src/app/api/products/list/route.test.ts`** — 401; 403 agent/warehouse_agent/investor; 400
   super_admin without `market_id`; manager ignores the param (migrated from `profitability-bulk`).
   Metric sort/filter from a role without metric permission → **403, not silently ignored** (silently
   ignoring is how a count starts lying). **`facets[filter] === pagination.total` for every facet at
   the HTTP layer.** `page > totalPages` clamps and reports the clamped value. `rangeFrom`/`rangeTo`
   agree with `data.length` and `total`, incl. `total === 0`. Absent dates → last 30 days.
   `filter=lowStock` and `sort=margin_pct&dir=asc` each return the correct row **from outside the
   first page of the unfiltered set** — the actual defect. `Cache-Control` present. `currency` from
   `markets.currency`.
5. **Component tests** — `ProductsTable.test.tsx` (sticky header, `aria-sort` flips on header click,
   skeleton, empty state, RTL), `ProductsTableRow.test.tsx` (carrying over the existing accessible-name
   assertions: `getByRole("img", {name})` for the health dot, `checkbox` `/sélectionner/i`,
   `button` `/actions/i`; plus `dir="auto"` on the name and `—` never `NaN` for missing metrics),
   `ProductsKpiStrip.test.tsx` (`aria-pressed`, tile→facet, read-only tile is not a button),
   `ProductDetailDrawer.test.tsx` (ESC closes, focus trap, `?open=` sync).
6. **SQL** — `DO`-block assertions inside the migration.

---

## Verification

```bash
cd Ordra
npm test -- products          # unit + component
npm run typecheck             # surfaces any remaining consumer of the deleted shapes
npm run lint
npm run build
npm run dev
```

Then, manually — the checks that catch what tests can't:

1. **`super_admin` + Libya scope** — costs render real numbers, no `NaN`, currency label consistent
   with the rest of the app.
2. **`ly_manager@oms.local`** — RTL layout, Arabic names resolve their own direction while the table
   chrome stays LTR, market label non-empty, currency correct (today a Libyan manager sees
   `NaN TND` because `/api/markets` is `super_admin`-only).
3. **Count integrity** — click each KPI tile; the tile's number must equal the pagination total, on
   every tile, including from page 3 of an unfiltered list.
4. **Whole-catalogue filter** — set page size to 10, go to page 1, click `Stock bas`; a low-stock
   product that lives on page 3 of the unfiltered set must appear. This is the headline defect.
5. **Sort stability** — with most metrics at 0, page through the full list at `sort=revenue`; no row
   appears twice and none is skipped.
6. **Toggle** — deactivate a product from the `⋯` menu; it must actually deactivate (today it cannot),
   and must leave the list when `filter=active` is applied.
7. **Drawer** — `?open=<id>` deep-links, ESC closes, filters and scroll position survive.
8. **Health dots** — verify a green and an amber product exist; uniformly red means `is_active` is
   still missing.
9. `mcp__supabase__get_advisors` after the migration — confirm no new RLS/security findings.

## Risks

- `CREATE OR REPLACE VIEW` requires unchanged leading column order/types — append only.
- `security_invoker = true` is new to this repo. The `variant_count` smoke check is mandatory, not optional.
- Migration and `/api/products` widening land in Phase 1 alone so a regression is isolated from the UI rewrite.
- Deleting three components takes their tests with them; the accessible-name assertions must be
  carried into the replacements deliberately, not dropped.
