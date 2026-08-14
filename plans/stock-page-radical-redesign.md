# Stock page — radical redesign (HTML prototype first)

## Context

`/[locale]/dashboard/stock` is supposed to answer "do I have enough stock, and what is my
capital doing". It answers neither. Two independent reasons, both verified against the live
OMS project (`vshynigvgrlihngozuwb`) on 2026-08-14.

### Reason 1 — the page measures a ledger nobody writes to

| Fact | Value |
|---|---|
| Orders that ever reached status `scanned` | **0** (out of 27 588 `order_history` rows) |
| `inventory_log` rows, all time | **16** — 5 `initial_stock`, 3 `manual_adjustment`, 4 `deposit`, 2 `damaged_writeoff`, 2 `returned` |
| Most recent `inventory_log` row | 2026-07-08 (37 days ago) |
| Orders in `uploaded`, awaiting warehouse scan-out | **484 orders / 507 units**, oldest since 2026-05-20 (86 days) |
| Units `returned`, never scanned back in | **685** |

The page derives `avgDailySales` from `inventory_log` rows where `reason = 'scanned'`. There
are none. So in production **right now** it renders `daysOfSupply = null` for every product,
`classifyHealth` returns `healthy` for all, and it shows **8 healthy · 0 reorder · 0 low ·
0 out · 0 overstocked** over **four empty panels** (both the 30 d and 14 d windows begin
after the last log row).

### Reason 2 — Libya's stock isn't in our warehouse at all

All five active Libya SKUs are mapped in `carrier_product_mappings` to **Darb Assabil's
Tripoli warehouse** (`68a079176ddfe500994eea7e`). Darb physically holds the goods and picks
and ships them; 160 orders are flagged `fulfil_from_carrier_warehouse=true`, the most recent
on 2026-08-13. Those orders write **no `inventory_log` row at all** — the scan boundary was
never going to fire for them, because there is no scan.

The authoritative quantity already exists and is already implemented:
`fetchDarbWarehouseStock()` + `availableFor()` in
[carrier-warehouse.ts:173-222](Ordra/src/lib/carriers/carrier-warehouse.ts#L173-L222) return
per-product `quantity` and `lockedQuantity` (available = `quantity − lockedQuantity`). It is
called at dispatch time to gate a shipment, and **never persisted or shown**. The stock page
does not call it.

So for 5 of 6 active products, the number on screen is one somebody typed in months ago,
while the real one is a single function call away in code that already ships.

### What the numbers actually are

| Produit | Marché | Page affiche | Réel (registre − sorties + retours) | Engagé (sur la route) | Demande 28 j | Couverture |
|---|---|---|---|---|---|---|
| Biovera | TN | 1 000 | **−1 361** | 235 | 0 | dormant 110 j |
| دميه ملاكمه حجم صغير | LY | 216 | **−136** | 239 | 61 u (2,2/j) | à découvert |
| دميه ملاكمه حجم متوسط | LY | 200 | 25 | 107 | 58 u (2,1/j) | 45 j |
| دميه ملاكمه حجم كبير | LY | 600 | 541 | 29 | 21 u (0,75/j) | 761 j — excédent |
| القرآن تدبر وعمل | LY | 1 000 | 854 | 53 | 0 | dormant 41 j |
| كتاب الداء والدواء | LY | 200 | 145 | 4 | 0 | dormant 41 j |

**Drift: 3 148 units — ≈20 570 LYD + 23 610 TND of overstated stock value.** Two products
are physically negative while the page calls them healthy. On صغير, more units are on trucks
(239) than the ledger says exist on the shelf (216).

Capital, at cost, Libya: **10 578 engagé · 3 900 actif · 55 322 immobile — 79 % of Libya's
stock capital has no demand behind it.** القرآن alone is 54 % of it, with no sale in 41 days.

### What that means for the redesign

A restyle would be worthless. The redesign has to change what the page *measures*:

1. **Read stock from whoever actually holds it.** Carrier-held products get their live
   Darb figures; own-warehouse products keep the ledger. Label the source per row.
2. **Switch the demand source** — derive velocity from `orders` (units that reached
   `uploaded` or beyond), not from `inventory_log.reason='scanned'`.
   `src/lib/dashboard/health.ts:490` already does exactly this for `stockCoverDays` — reuse
   the approach rather than inventing one.
3. **Three stock numbers, not one** — physical / committed / free-to-sell.
4. **Make the drift a first-class KPI** instead of a silent assumption.
5. **Lead with capital, not with a taxonomy of health buckets.** A count of "healthy"
   products is not something anyone acts on.

Everything except the live carrier feed is computable from existing tables. **Zero migrations.**

---

## The design

### What gets deleted

| Removed | Why |
|---|---|
| The 5 health-count tiles (`healthy/reorder/low/out/overstocked`) | A taxonomy, not a decision. In prod it reads `8/0/0/0/0`. |
| `Mouvements par jour (14 j)` bar list | Measures the ledger, which is empty. History belongs on the product page. |
| `Mouvements récents` list | Same — empty in prod, and 30 log rows is not a dashboard. |
| `turnover_30d` column ("2,4 ×") | Nobody reorders off a turnover ratio at 6 SKUs. |
| `totals.damaged_count` | Already computed and never rendered. Folded into the returns column. |

### Four decision tiles — value, cover, waste, trust

Each answers one question and carries one action. Built on `MetricTile`
(`src/components/dashboard/MetricTile.tsx`) with its §4.19 tinted icon holder.

1. **Valeur du stock** — `69 800 LYD`, with a 3-segment composition bar as the tile visual:
   `engagé` (committed) / `actif` (≤ 90 j cover) / `immobile` (no demand, or > 90 j).
   Real: LY = 10 578 · 3 900 · **55 322 (79 %)**.
2. **Couverture** — the nearest stock-out: `صغير — à découvert`, secondary
   `متوسط — 45 j, rupture le 28 sept`. Labelled with the selected window.
3. **Capital dormant** — `55 322 LYD · 79 %`, hint `2 produits sans vente depuis 41 j`.
4. **Fiabilité** — `−3 148 u`, hint `5 produits sur 6 en stock non vérifié · 507 u en attente de scan`.

### The reliability band (above the tiles, conditional)

States the problem in money and links to the fix. Two distinct messages, because there are
two distinct causes:

- Carrier-held rows: *"Stock Libye détenu par Darb Assabil — chiffre saisi à la main, jamais
  synchronisé."* → connect the live feed.
- Own-warehouse rows: *"507 unités en attente de scan depuis 86 jours — stock surévalué de
  3 148 u (≈20 570 LYD + 23 610 TND)."* → warehouse queue.

Without this band the four tiles are estimates presented as facts.

### The product table — the page's core

Replaces the `<table>` with the row-band pattern from `CarrierTable.tsx` (one shared CSS grid
constant on header and `<li>` rows). One row per product:

`[produit + marché + source] [position] [couverture] [demande + sparkline] [retours] [valeur] [verdict]`

- **Source chip** — `Darb Tripoli` / `Entrepôt propre`, so it is never ambiguous which number
  is authoritative.
- **Position** — one track split into free-to-sell / committed, with a deficit marker when
  committed > physical. Reads `216 en stock · 239 engagés · −23 libres`.
- **Couverture** — days + stock-out date + `reorder_by` date (lead time from a new per-market
  `supplier_lead_time_days` setting; `settings` is jsonb key/value, no schema change).
  Coloured on the §4.17 D aging scale, always paired with a glyph.
- **Demande** — 8-week sparkline + `61 u / 28 j · 2,2/j`.
- **Retours** — `21 %` (from the existing `product_return_rate_view`), warm above 25 % —
  متوسط is at 31 %. A high return rate means the cover figure lies, because units come back.
- **Verdict** — one chip: `Réappro urgent` / `Dormant 41 j` / `Excédent 761 j` / `Sain`.

### Bottom row — two-up

- **Où va le capital** — stacked composition by product (`CostCompositionBars` pattern), so
  القرآن holding 54 % of Libya's stock capital is visible at a glance.
- **À faire** — an action list, not a feed. Each item carries money and a destination:
  synchroniser le stock Darb · scanner les 507 unités en attente (86 j) · القرآن, 37 880 LYD
  dormants depuis 41 j — relancer ou liquider · صغير, 239 engagées pour 216 en stock.

### Cross-cutting

- **Period control** — `PeriodTabs` (`src/components/dashboard/PeriodTabs.tsx`), 7 j / 28 j /
  90 j, driving the demand window. The page currently declares no period while hardcoding
  "dernières 30 jours" in its subtitle, and mixes three windows (30/14/14).
- **Confidence** — route cover figures through `src/lib/dashboard/confidence.ts`; suppress the
  estimate rather than print a number off a 3-unit sample.
- **Tokens** — move to `oms-*` (`bg-oms-bg`, `oms-ink-1/2/3`, `oms-ok/warn/bad`). The file
  currently mixes Tailwind tokens with ~15 hardcoded hexes and a `HEALTH_PALETTE` map.
- **RTL** — logical properties only; `dir="auto"` per node on product names.

---

## Step 1 — the HTML prototype (the next deliverable)

**File:** `Ordra/prototypes/stock-v1.html`, following the existing convention
(`products-ui-v5.html`, `pnl-v2.html`): one standalone file, tokens inlined from
`docs/design-system.md`, French UI, Inter + Noto Sans Arabic, dark prototype bar with tab
switcher. **Hardcoded with the real production figures above** — not lorem.

Three screens:

1. **`Avant — prod réel`** — the current page with what the API actually returns today:
   `69 800 LYD`, `8 produits suivis`, `0 unités scannées`, 8 healthy / 0 / 0 / 0 / 0, four
   empty panels. The argument for the redesign, not a strawman.
2. **`Après`** — the full new page.
3. **`Anatomie`** — one product row blown up and annotated: where each number comes from,
   which query it maps to, what action it triggers.

The prototype shows the **reconciliation view** — carrier-held and ledger figures side by
side — so the architectural fork below can be decided by looking at it rather than in the
abstract. Carrier quantities are the one set of figures that cannot be pulled from here
(Darb API needs live credentials); they are rendered as a designed state and **visibly
labelled as such**. Every other number on the prototype is real production data.

No application code is touched at this step.

## Step 2 — implementation (after prototype sign-off)

Strict TDD per `CLAUDE.md` — failing test first, always. Ordered by dependency.

0. **Unblock the lead-time setting.** `src/types/settings.ts` validates market settings with a
   strict whitelist, so `PATCH /api/settings/[marketId]` **400s on any payload containing
   `supplier_lead_time_days`** — the setting could never be saved. Add it to `MarketSettings`,
   `DEFAULT_MARKET_SETTINGS` (14), and an integer `0 ≤ n ≤ 365` branch to
   `isValidMarketSettings`.
1. **Pure calculations** — `src/lib/calculations/inventory-intelligence.ts`: `demandRatePerDay`,
   `effectiveWindowDays`, `daysOfCover`, `stockOutDate`, `reorderByDate`, `returnRate`,
   `computeDrift`, `classifyStockState`. Import the thresholds from
   `src/lib/dashboard/confidence.ts` — never redeclare them, or the stock page and the
   dashboard end up disagreeing about what "too thin to draw" means. Retire `classifyHealth`,
   `turnoverRate`, `avgDailySales`, `reorderSuggestions`, `bucketMovementsByDay`,
   `LOW_DAYS_OF_SUPPLY`, `OVERSTOCK_DAYS_OF_SUPPLY` (fixed thresholds are replaced by the
   per-market lead time — "reorder at 14 days" is wrong for a 30-day supplier).
2. **Aggregation — a `get_stock_position` RPC, not JS.** Follow `get_dashboard_health`
   (`20260823000003_dashboard_health_v2.sql`) exactly: one `SECURITY DEFINER` call returning
   `JSONB` of **raw sums only**, with every ratio and date derived in JS so it stays unit-testable.
   Three reasons this cannot be a PostgREST `.select()`: the 1000-row cap (the bug behind
   "1000 au total" against 2 578 orders, design-system.md §4.17 G) would silently truncate
   `committed` and cause an oversell; the per-row `order_history` RLS subplan was measured at
   **65× overhead** and crosses `statement_timeout` beyond ~1 week for a `market_manager`; and
   it is the house style for every other aggregate on the dashboard.

   Two definitions inside it are load-bearing:

   - **`committed` is keyed on the absence of a scan row, not on a status list.**
     `scan_order_out` already deducts from `current_stock` at `uploaded → scanned`. A status-based
     definition is right only while nobody scans; the day the warehouse starts, those units get
     subtracted twice and `free_to_sell` reads ~500 units low, screaming reorder on healthy
     products. Defining it as *in-flight units with no `inventory_log` row where
     `reason='scanned'`* is correct before and after, with no second migration.
   - **Demand is event-based, not cohort-based** — the *first* `order_history.status_to='uploaded'`
     event in the window (`MIN`, because a failed upload falls back to `confirmed` and is retried).
     Filtering on `orders.created_at` instead systematically depresses the right edge of the
     series, which is the part the reorder decision depends on. Orders whose status was set by a
     migration `UPDATE` have no event row; fall back to `created_at` and flag
     `demand_is_inferred` so the UI can caveat rather than quietly guess.

   Return rate stays on a **fixed 90-day window**, independent of the demand selector — at 7 days
   every product falls under the confidence floor and the column would always be blank.
3. **Carrier stock** — a cached read through the existing `fetchDarbWarehouseStock()`, with an
   explicit stale/unavailable state. Never block the page on it.
4. **API** — new route `src/app/api/inventory/position/route.ts` (thin auth + param shell) rather
   than reshaping `summary`, because the two answer from contradictory sources and merging them
   produces one endpoint where the ledger figure and the order-flow figure disagree by 100 % with
   no way to tell which is which. Types go in a **client-safe** `src/lib/inventory/stock-position-types.ts`
   — this also kills the current landmine where `useInventorySummary.ts` imports a type from a
   route module that pulls in `next/server`. Window lives in `useState` → an exported
   `buildStockKey()` → the SWR key, so "changing the window changes the key" is a unit test rather
   than a hope. An unrecognised `?window` returns **400**; silently coercing it is how a page ends
   up showing a window it did not label. Delete `summary` + `useInventorySummary` in a final
   commit once the UI has landed.
5. **UI** — rebuild `InventoryClient.tsx`, extracting tiles/rows instead of growing the
   577-line single file. Reuse `MetricTile`, `Section`, `PeriodTabs`, `Badge`, `Skeleton`,
   `EmptyWell`, `StockAdjustModal`.
6. **i18n** — new `inventory.*` keys in **both** `fr.json` and `ar.json`; delete the dead ones
   (`totals.lowStock/outOfStock/damaged`, most of `adjust.*`).
7. **Loading** — add `dashboard/stock/loading.tsx`; the inherited `dashboard/loading.tsx` is
   shape-matched to the P&L page and causes a visible layout jump.

### Wording that must not slip

- **Call the reconciliation figure "unités non rapprochées", never "shrinkage".** It is dominated
  by "the warehouse never scanned", and carrier-warehouse orders legitimately produce no
  `inventory_log` row at all. Naming it shrinkage accuses the warehouse of theft over a process gap.
- **`reorder_by_date` means "when an order must be placed *if none has been*".** There is no
  purchase-order table anywhere in the schema, so it cannot subtract stock already on order.
- **Return `null`, never `0`,** for `last_counted_at`, `coming_back` and `days_of_cover` when
  unknown — so the UI renders "jamais comptée" instead of a false "0 j".

## Verification

- `npm run typecheck` after every file change; `npm test` continuously.
- Unit tests covering the negative-stock and committed-exceeds-physical cases that صغير and
  Biovera actually exhibit — these are real rows, not hypotheticals.
- API route tests: the existing 401/403 matrix must keep passing (super_admin only, via
  `canViewFinanceSection`), plus a case per window value, plus carrier-feed-unavailable.
- Manual check against the Context table: the redesigned page must report صغير at deficit and
  القرآن dormant, where today it reports both healthy.
- `npm run build` before hand-off.

## Decisions this surfaces (flagged, not assumed)

- **Is Darb the source of truth for Libya?** The prototype shows both. If yes, `current_stock`
  for mapped products becomes a cache of someone else's number, and `adjust_product_stock` on
  those rows becomes misleading. This is the one genuinely architectural question here.
- **The page is super_admin-only** (`canViewFinanceSection`). Market managers are redirected
  away from their own market's stock.
- **Nothing here makes scanning happen.** The redesign prices the 507-unit backlog; closing it
  is an operations change.
- **Inbound stock is the one thing genuinely not computable.** There is no purchase-order table
  anywhere in the schema, so nothing can subtract stock already on order. Adding
  `purchase_orders` / `inbound_stock` is the only part of this design that would need new
  tables — deliberately left out, with `reorder_by_date` labelled accordingly instead.
- **Multi-line orders under-count.** `scan_order_out` deducts `orders.quantity` of
  `orders.product_id` and never reads `order_items`, so a two-product order never moves the
  second line's stock. The demand aggregation mirrors that same basis on purpose — matching the
  deduction path is what keeps the reconciliation figure interpretable — but both are wrong for
  the 30 multi-line orders in the table. Fix `scan_order_out` first, then the aggregation.
- **Pre-existing bugs found, out of scope:** `products.initial_stock` is never written
  (`api/products/route.ts:196` omits it), so `product_inventory_view.real_inventory` is always
  ≤ 0 and meaningless; `src/lib/fulfillment-engine.ts:12` still decrements at `deposit`,
  competing with the `scanned` boundary; `orders.order_number` is selected by
  `lib/warehouse/history-fetch.ts` but does not exist in the DB.
