# Entrepôt — mobile-first warehouse agent

## Context

The warehouse agent works standing up, one-handed, holding a parcel. Today they
get the same screens a manager gets at a desk: 1460px-wide pages, a horizontal
tab band, and `table-fixed` tables that scroll sideways on a phone. The four
mockups in `docs/design/entrepot/mobile/` show what it should be instead —
a phone app: bottom tab bar, a thumb-reachable scan button, stacked cards,
one deep green accent, a figure and a sparkline on every card.

Three decisions taken with the user:

1. **Agent role only.** `warehouse_agent` gets the phone shell; managers and
   super-admins keep the desktop console. `(warehouse)/layout.tsx` already
   branches on `isAgent`, so the split is clean and nothing a manager uses can
   regress.
2. **Build the missing metrics.** The mockups show figures the system cannot
   produce today. Rather than cut them (what the previous redesign did, see
   `docs/design/entrepot/README.md`), we build the real ones underneath.
3. **4 tabs + Scan FAB.** Aujourd'hui · Préparation · Retours · Stock, with a
   persistent green Scan button above the bar. Journal is reached from
   Aujourd'hui.

## What the mockups ask for, and what it becomes

Every figure below resolves to real data. Nothing is invented.

| Mockup | Real metric | Source |
|---|---|---|
| Today's Scans / Goal + bars | scans today vs `goal_daily_scanned`, 14-day bars | `get_warehouse_day_stats`, `get_warehouse_trend` — exist |
| Pending Returns | returns inbox | `get_warehouse_queue_stats.returns_inbox` — exists |
| Low Stock N Items | products under threshold | `summary.lowStock` — exists |
| Scanning Speed /hr | own scans per active hour today | **new** on `get_operator_prep_stats` |
| Last Hour Scans | own scans in the trailing 60 min | **new** on `get_operator_prep_stats` |
| Accuracy % | **count accuracy** — how close the books were to the shelf at the last counts | **new** RPC over `inventory_log` where `reason='stock_count'` |
| Avg processing time | `avg_cycle_seconds` | `get_operator_prep_stats` — exists |
| Critical task + % + deadline | the real bench queues (préparation, retours, comptages en retard); "deadline" becomes the oldest item's age, which is a true urgency signal | queue stats + **new** count-staleness |
| Per-product sparkline | `balance_after` over 14 days | **new** RPC over `inventory_log` |
| Stock 150 / Goal 200 | **new** nullable `products.stock_goal`; absent → the low-stock threshold band | **new** migration |
| Per-product accuracy | variance at that product's last count | **new** RPC |
| 3-step return stepper | already `step = picked ? (decision ? 3 : 2) : 1` | `ReturnsConsole` — exists |
| 3 return actions | `restock` / `damage` / `redeliver` | exists, exact match |

`inventory_log` carries `balance_after` on every row and is append-only, so the
per-product history is reconstructible without a new table.

## Plan

### A. Data
- `products.stock_goal INTEGER NULL` + comment. Nullable on purpose: a goal
  nobody set must not render as "Goal: 0".
- `get_product_stock_series(p_product_ids UUID[], p_days INT)` → one row per
  product per day, `balance_after` of the last movement that day, carried
  forward. Drawn as the inventory sparkline.
- `get_count_accuracy(p_market_id UUID, p_days INT)` → per product: last count
  date, variance, accuracy; plus a market rollup. Accuracy is
  `1 − |change| / GREATEST(balance_after − change, 1)` at each count.
- `get_operator_prep_stats` gains `scans_last_hour` and `rate_per_hour`.

### B. Routes
- `/api/warehouse/operator-stats` — pass the two new fields through.
- `/api/warehouse/stock` — add `stock_goal`, `accuracy`, `last_counted_at`.
- `/api/warehouse/stock/series` — the sparkline data, batched by product id.

### C. Shell
- `WarehouseMobileShell` under the `isAgent` branch: 52px top bar (market +
  bell + avatar), content, `WarehouseBottomBar` (4 tabs, 64px, safe-area
  inset), and `ScanFab`.
- Graph-paper ground: a 24px `--wh-grid` lattice at low alpha over `--wh-bg`,
  the mockups' most recognisable trait.
- Logical properties throughout — Libya is RTL and this is the only surface
  where that is load-bearing.

### D. Screens (mobile variants, same routes and data)
- **Aujourd'hui** — KPI carousel (snap-scrolling, matching the mockups' cut-off
  fourth card), Tâches critiques, Résumé (speed · accuracy · last hour).
- **Stock** — the inventory list: thumbnail, name, SKU, progress vs goal,
  sparkline, «Jrd» count button opening the existing `StockCountDialog`.
- **Retours** — one card per return: order, product, reason, the 3-step
  stepper, three decision buttons, avg processing time footer.
- **Préparation** — parcel cards banded by Darb roll colour; no table.
- **Scan** — the existing full-screen station, retuned for a phone: viewfinder
  with corner brackets, result pill, recent scans as 2-up cards.

### E. Design system
- New `docs/design-system.md` §4.20 «Entrepôt mobile — scoped extension»,
  following the §4.15 / §4.16 precedent, recording the allowances: bottom
  navigation, the FAB, the grid ground, and the one-accent green.
- `docs/design/entrepot/mobile/README.md` mapping each mockup to its screen.

## Verification
- TDD throughout: RPC verified against production read-only first, then route
  tests, then component tests at 390px.
- `npm run typecheck`, warehouse suites, `npm run build`.
- Capture every screen at 390×844 with `scripts/capture-warehouse-screens.mjs`
  extended with a `--viewport` flag, logged in as the Libyan warehouse agent
  (`warehouse.ly@oms.local`) so the shell is the agent shell and RTL is real.
