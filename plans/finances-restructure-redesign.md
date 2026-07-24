# FINANCES Section — Restructure, Bug Fixes & Redesign

Round 2 of the admin overhaul (round 1 = Accueil/COMMANDES, see `admin-sidebar-accueil-commandes-restructure.md`).

## Audit findings

### Structure
- **Dépenses pub** stranded at `settings/ad-spend` (not a settings page — CRUD on `ad_spend` + KPIs + chart). Ignores global market switcher (local select). Entire styling is a leftover **dark theme** (`components/ad-spend/theme.ts`: token `white` = `#1A1A1A`).
- **Produits & marges** = full catalog admin (create/edit/toggle/stock-adjust) + finance overlay toggle. Margin analytics live in 3 places (P&L, products performance mode, product detail).
- **Stock & inventaire** duplicates products page stock column + a *second divergent* stock-adjust modal (same RPC).
- **P&L** re-implements KpiCard/Panel locally (DenseCard/SecondaryKpi/DenseEmpty), duplicates dashboard revenue/profit heroes.

### Correctness bugs
1. **Stock metrics silently broken**: `/api/inventory/summary` counts scan-outs as `reason='deposit'`, but since migration `20260506000000` scan-out writes `'scanned'` → days-of-supply/turnover/reorder ≈ 0 on current data. Damaged returns matched via `'damaged_return'` (never written; actual = `'damaged_writeoff'` + `is_damaged`). Route tests encode the stale reasons. `KNOWN_REASONS` omits `scanned` (renders raw string), lists phantom `manual_restock`.
2. **Ad-spend**: "YTD" sums an 84-day window; cost/confirmation double-counts overlapping market+product entries; **POST + CSV import bypass the period lock**; PATCH can invert a period (single-sided validation); delete ignores `res.ok`; page rollups sum ALL entries while P&L/dashboard sum only `product_id IS NULL` → totals disagree across FINANCES.
3. **All-markets scope**: P&L silently shows default market (TN) with no indicator; products page shows a false "no products" empty state (SWR key null). Stock page sums TND+LYD into one currency-formatted number.
4. **Permissions**: two same-named `canViewProfitability` fns — `role-permissions.ts` (super_admin, gates pages) vs `profitability-permissions.ts` (+market_manager, gates `/api/ad-spend*`, `/api/profitability*`); `/api/inventory/summary` inlines the looser gate. Manager can CRUD ad-spend / read inventory via direct API while blocked from the pages.
5. **`ProductCreateForm`**: imports `calculateProductProfitability` from `lib/calculations` in the client AND hardcodes `carrier_delivery_fee: 7`, `carrier_return_fee: 4`.
6. **P&L client**: imports `lib/calculations/deltas` client-side; computes AOV/profit-per-delivered/return-rate in browser; `marketLabel` dead; `formatCurrency(loading)` no-op.
7. **Products page**: search/filter/sort client-side over the current 25-row page only (search doesn't search catalog); loading-vs-empty conflation; dead in-bar bulk-actions block.
8. **Dead code**: `components/dashboard/{AdSpendManager, ProfitabilityTable, Leaderboard, MarketsOverviewTable, RejectionBreakdown, PresencePanel, TeamOverview, DashboardTabs}.tsx`; `MetricsTable.tsx` alive only for `PeriodSelector`; `PUT /api/ad-spend/[id]`; `/api/dashboard/overview` (verify).
9. **Known numeric drift** (documented, deep fix maybe separate): market P&L counts `confirmed` only + excludes processing cost; product routes count `confirmed|uploaded` + include it → product profits don't sum to global P&L.

## Approved decisions
1. **Ad-spend → `/finance/ad-spend`** (own FINANCES page; old URL redirects; obeys global market scope; light-token redesign; all bugs fixed; one consistent "total ad spend" definition everywhere).
2. **Stock stays in FINANCES** — fix reason matching + tests, unify on shared `StockAdjustModal`, token redesign, handle all-markets currency mixing.
3. **Products stays unified** — sharpen Catalogue/Performance split, server-side search, fix all-markets + loading states, de-dup dead code, fix ProductCreateForm fees.
4. **All correctness fixes included** — incl. permission gate dedupe/tightening and dead-code deletion.

## Implementation — SHIPPED (branch `feat/finances-overhaul`, 11 commits)

1. **Permissions** — `src/lib/finance-permissions.ts`: `canViewFinanceSection` (super_admin; pages + `/api/profitability`, `/api/ad-spend*`, `/api/inventory/summary`) and `canViewProductProfitability` (+manager; product-level APIs). Both old same-named functions deleted; dead routes `/api/dashboard/overview` + `/api/profitability/business` removed.
2. **Inventory correctness** — scan-outs counted via `reason='scanned'`, damaged returns via `'damaged_writeoff' + is_damaged`; legacy `deposit` rows regression-tested as excluded; `scanned` label added (fr/ar), phantom `manual_restock` dropped.
3. **P&L** — API returns aov/profit-per-delivered/return-rate/returns-cost-share + server-computed deltas; client rebuilt on Panel/EmptyState/Skeleton + tokens; market chip rendered; all-markets fallback banner; FinanceHeroCard flat white (tone colors value only).
4. **Ad-spend** — moved to `/finance/ad-spend` (settings URL redirects; sidebar updated); obeys global MarketScopeSwitcher with all-markets prompt; period lock enforced on POST + import (`locked_period` rejects); PATCH validates vs stored period; legacy PUT deleted; GET meta.month_confirmed_count (de-duplicated); real YTD via Jan-1 fetch; delete errors surfaced; **one totals definition: ALL entries (market+product) count** — `load-summary.ts` + `dashboard/summary.ts` updated (P&L numbers change deliberately); theme relics fixed; new route tests for all three endpoints.
5. **Stock** — full token redesign (dark card removed), Skeletons, shared products `StockAdjustModal` (focus-trapped) replaces the private duplicate, mixed-currency guard on all-markets scope.
6. **Products** — `/api/products?q=` escaped ilike server search (+route test), 300ms debounce + page reset; select-a-market prompt; skeleton loading; `PeriodSelector` extracted to `components/shared` (underline tabs, i18n); ProductCreateForm live example deleted (client calc import + hardcoded fees 7/4); ProductsFilterBar dead bulk block removed.
7. **Dead code** — 9 orphaned dashboard components deleted.

Verified: typecheck clean, all touched-area tests green (full-suite failures are the pre-existing 14 files from unrelated in-progress variant work), production build passes, browser walkthrough as super_admin over P&L / ad-spend (redirect + scope + rollups) / stock.

**Known follow-up (documented, not fixed):** market P&L counts `confirmed` only and excludes `confirmation_processing_cost`, while product-level routes count `confirmed|uploaded` and include it — product profits still don't sum exactly to the global P&L. Reconciling needs a business decision on the canonical confirmed-cost model.
