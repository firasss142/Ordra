# Ad Spend → Campaign Management Redesign

## Why
Today's `/settings/ad-spend` is a form-driven CRUD table. The user manages money as bookkeeping — not as campaign performance. Redesign reframes each entry as a *campaign block* with realized results (confirmations, CPC, ROAS) so the user can answer "did this spend work?" in one glance. P&L and CPL calculations downstream are not changing shape; this is a UX surface redesign plus supporting API work.

## What changes

### 1. API — realized-metrics overlay
`GET /api/ad-spend` currently returns raw rows. Extend with `?overlay=metrics` that joins each ad-spend block to:
- `confirmed_count` — confirmations in `[period_start, period_end]` for matching `product_id` (or market-wide if `product_id IS NULL`)
- `delivered_count`, `revenue` — delivered in period
- `cost_per_confirmation` = `amount / confirmed_count` (null when zero)
- `roas` = `revenue / amount` (null when amount is zero)

Method: one batched query per metric type, keyed by period + product. Reuse `order_history` pattern from `/api/profitability/route.ts`.

### 2. API — CSV import
New `POST /api/ad-spend/import`. Accepts parsed rows `[{date_start, date_end, amount, product_name?, campaign_name?}]`. Parser lives client-side; server only validates + bulk-inserts. Map `product_name` → `product_id` via a lookup within the market. Unmatched rows return with `warning` flags; the UI shows a preview step before commit.

### 3. API — period-lock guard
"Closed periods" = last full calendar quarter relative to today. Define `isPeriodLocked(period_end: string): boolean` — true if `period_end` falls in a quarter strictly before the current quarter. On PATCH / DELETE:
- market_manager → 403 if locked
- super_admin → must pass header `x-confirm-locked-period: true`, otherwise 409 with a structured body

No DB schema change needed; logic enforced in the route handler.

### 4. UI — reframe as campaign view
Three stacked sections, following the warehouse dark cinematic pattern (`D.pageBg: #061A1C`, `D.cardBg: #02090A`, `D.accent: #36F4A4`):

- **Rollups KPI strip** (4 cards): this-week spend, this-month spend, YTD spend, avg cost/confirmation this month. Each with a 12-week sparkline where relevant (recharts via dynamic import, matches `WarehouseKpiStrip`).
- **Timeline chart** (12-week stacked area per product, recharts `AreaChart`). Series = top N products + "market-wide" bucket. X = week-start. Hover shows per-week per-product spend.
- **Campaign cards grid** — one card per ad-spend entry. Each shows:
  - Period badge + product name (or "market-wide")
  - Spend amount (large, tabular-nums)
  - `confirmations → cost/conf` ("42 conf · 12 TND/conf")
  - `revenue → ROAS` ("1 840 TND · 3.7× ROAS")
  - Lock icon if in closed period
  - Edit / Delete (Delete hidden if locked and role ≠ super_admin)
- **Entry modal** (not inline): date range, amount, product_id selector (products in current market), note, budget flag. If saving into a locked period, super_admin gets a confirmation checkbox.
- **CSV import modal**: drag-drop / textarea, autodetect Meta vs TikTok columns, map-to-product picker for unmatched names, preview table, "Import N rows" button.

### 5. What is explicitly NOT in scope
- Intended monthly budget: the brief mentions budget-vs-actual. I'm adding a `monthly_budget` display only *if* there's already a `settings` row for it; no new table/column this pass. User can wire it later.
- Changing the profitability formula downstream.
- Changing `ad_spend` schema (no migration).

## Files touched

### Backend
- `src/app/api/ad-spend/route.ts` — extend GET (overlay=metrics, remove forced `.is(product_id, null)` when no filter, accept `include_products=true`)
- `src/app/api/ad-spend/[id]/route.ts` — period-lock guard on PATCH + DELETE
- `src/app/api/ad-spend/import/route.ts` — NEW, bulk insert after validation
- `src/lib/ad-spend/period-lock.ts` — NEW, `isPeriodLocked()` + quarter arithmetic
- `src/lib/ad-spend/csv-parse.ts` — NEW, Meta/TikTok column autodetect + row normalize
- `src/lib/ad-spend/realized-metrics.ts` — NEW, batched overlay join logic (reusable server-side)

### Frontend
- `src/app/[locale]/(dashboard)/settings/ad-spend/AdSpendClient.tsx` — rewritten shell
- `src/components/ad-spend/AdSpendRollups.tsx` — NEW (4-card KPI strip)
- `src/components/ad-spend/AdSpendTimeline.tsx` — NEW (12-week stacked area)
- `src/components/ad-spend/AdSpendCampaignCard.tsx` — NEW (single campaign card)
- `src/components/ad-spend/AdSpendCampaignList.tsx` — NEW (grid of cards with filters)
- `src/components/ad-spend/AdSpendEntryModal.tsx` — NEW (replaces inline form)
- `src/components/ad-spend/AdSpendCsvImport.tsx` — NEW (modal, parse → preview → commit)
- `src/hooks/useAdSpendCampaigns.ts` — NEW (SWR around GET ?overlay=metrics)
- `src/messages/fr.json`, `src/messages/ar.json` — new namespace `adSpend.*`

### Tests
- `src/lib/ad-spend/__tests__/period-lock.test.ts`
- `src/lib/ad-spend/__tests__/csv-parse.test.ts`
- `src/lib/ad-spend/__tests__/realized-metrics.test.ts` (pure function unit)
- `src/components/ad-spend/__tests__/AdSpendCampaignCard.test.tsx` (realized metrics rendering)
- `src/components/ad-spend/__tests__/AdSpendRollups.test.tsx` (rollup math)

### Retired / left in place but unused
- `src/components/dashboard/AdSpendManager.tsx` — still imported by `OverviewClient`; leave it. Only the `/settings/ad-spend` page switches.

## Design-system tradeoff
Design-system.md prescribes light theme for content. Recent warehouse pages have adopted a dark cinematic palette (`#061A1C`/`#02090A`/`#36F4A4`) for dashboard-style views — same convention applied here since this page is analytical, not a settings form. Will match warehouse component language exactly so the two pages feel like one system.

## Rollout
- No migration. Existing entries render as-is.
- Product selector: entries with `product_id IS NULL` show as "Market-wide" tag. Users can now create product-scoped entries from the UI.
- CSV import = additive — no risk to existing data flow.
