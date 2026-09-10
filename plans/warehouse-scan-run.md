# Scan run ("tournée de scan"), scanned-list filters, stock list redesign

## Context

**What exists.** The warehouse agent's "Scan rapide" FAB goes to `/warehouse?scan=1`, which opens `ScanSheet` in *lookup* mode with nothing in hand. Batching is only implicit: the agent taps a roll colour on `RollRail`, taps "Prendre" on a card, scans, and the result card offers "Suivant, même rouleau". There is no product batching, no run, no progress, no end-of-batch summary. For managers, the "Mode scan" button on `PreparationConsole` links to `/warehouse/scan`, which redirects straight back to `/warehouse` (dead loop); `ScanStation variant="station"` is implemented but unreachable; the keyboard-wedge handler `createScannerInputHandler` is tested but never mounted.

**Scanned list.** `ScannedList` (phone) and `ScannedTable` (desk) share `useScannedActions` but have **no filters** and sort differently (desk floats problems first, phone does not). The three summary chips are read-only.

**Product list.** `WarehouseStockClient` has a search and nothing else: no state filter, no sort, the 14-day `series` it already receives is unused on the phone, and the per-site split (`product_site_stock`, Tripoli/Benghazi) is not shown anywhere in `src/`.

**Multi-product orders.** `order_items` exists (28 Libyan orders historically carry 2+ distinct products, 17 in the last 90 days, 2 of them already scanned), but every warehouse surface renders only the denormalised `orders.product_name × quantity`, and `scan_order_out` / `unscan_order` / `scan_return_in` move stock only for `orders.product_id`. A 3-product order shows as one line and deducts one product.

**Production today** (2026-09-10): one Libyan order on the bench (Benghazi, no branch group). Verification will need the Darb sandbox fixture (`docs/warehouse-e2e-fixture.md`).

**Outcome wanted.** Pressing Scan rapide opens an immersive, full-screen run: the agent chooses *same product* or *same colour/region*, picks a bucket, and works it one parcel at a time with progress, automatic advance and an end-of-bucket summary. Multi-product orders are handled honestly (their own bucket, all lines shown, all lines deducted). The scanned list gets real filters and a cleaner card/table, the stock list gets filters, sort, sparkline and per-site figures. Same run for agent, manager and super_admin.

## Non-negotiables carried over

- Roll colour rules (`plans/warehouse-agent-ux-critique.md` §3.7): exact hex, name never on the hue, branch code on a solid white plate, faint colours outlined, `DARB_ZONE_ORDER`, semantic states never a filled colour.
- Design system §4.20: mobile allowances only under the agent shell; no gradients; colour never the only channel; logical CSS props (RTL); targets ≥44 px, primary scan control 52 px; every string through `useTranslations` (fr + ar).
- Bind at Darb first, commit second (unchanged: `/api/warehouse/scan-out`). Parcel photo confirmation before the camera stays.
- TDD: failing test first for every new module/component. Test helpers in `src/test/helpers/` or `__tests__/fixtures.tsx`, never in production code.

---

## Part A — The scan run

### A1. Route and chrome
- `src/app/[locale]/(warehouse)/warehouse/scan/page.tsx`: replace the redirect with a server page: `canScanWarehouse` gate, `resolveSiteFilter`, prefetch `get_to_label_orders` (limit 200, same as `warehouse/page.tsx`) + zone index, render `<ScanRun market locale currency initialOrders siteName siteUnassigned role />`. Unassigned agent → the same "no site" card as `BenchHome`.
- Full-screen for every role: `(warehouse)/layout.tsx` already forks by role; add a `hideChrome` decision for the `/warehouse/scan` pathname (agent: no bottom bar, no FAB — `ScanFab` already hides on its own href; manager: sidebar collapsed/hidden). Simplest: the scan page renders its own top strip (exit ✕ at the start edge, bucket badge, progress) and the layout hides `WarehouseBottomBar` when `pathname` ends with `/warehouse/scan`. Test in `(warehouse)/__tests__/layout.test.tsx`.
- `ScanFab` href → `/${locale}/warehouse/scan`. `PreparationConsole` "Mode scan" link now works. `BenchHome` keeps `?scan=1` → sheet (lookup) for backward compatibility, but the FAB no longer uses it.

### A2. Bucketing (pure, tested first)
`src/lib/warehouse/scan-buckets.ts`
```ts
export type RunMode = "product" | "zone";
export interface OrderLine { product_id: string|null; product_name: string; variant_label: string|null; quantity: number; image_url?: string|null }
export interface Bucket { key: string; kind: "product"|"mixed"|"zone"|"zone_unknown"|"region"; label: string; sublabel?: string; hex?: string|null; branchGroup?: string|null; imageUrl?: string|null; rows: PrepRow[] }
export function linesOf(row): OrderLine[]            // row.items when ≥1 else the denormalised single line
export function isMixed(row): boolean                // >1 distinct product_id in linesOf
export function bucketize(rows, mode, market): Bucket[]
```
- `product` mode: key = `product_id` (fallback `product_name`); orders with >1 distinct product go to one `mixed` bucket ("Colis mixtes"), **always last**, never filed under their first line. Buckets sorted by row count desc, then name.
- `zone` mode, Libya: key = `zone.colorHex`, ordered by `DARB_ZONE_ORDER`, `zone_unknown` last (dashed swatch, existing "Couleur inconnue" wording).
- `zone` mode, Tunisia: key = `resolveGovernorate(customer_city)` from `src/lib/carriers/governorates.ts` (null → "Gouvernorat inconnu" bucket, last); no hex, neutral swatch with the governorate's first letters.
- Within a bucket: oldest `uploaded_at ?? created_at` first (same as the bench).
- Skipped rows go to the end of the bucket, once.

### A3. Order lines on the queue rows
- `src/lib/warehouse/order-lines.ts`: `attachOrderLines(supabase, rows)` — one `order_items` query `in (ids)`, joined to product image via the existing `attachProductImages` helper pattern (`src/lib/warehouse/product-images.ts`). Adds `items: OrderLine[]` to each row. Used by `/api/warehouse/to-label` and `/api/warehouse/scanned` routes (and `warehouse/page.tsx` / `scan/page.tsx` prefetch). No SQL migration needed for display.
- `WarehouseOrderRow` gains `items?: OrderLine[]`; `ScannedRow` the same.

### A4. `ScanRun` component — `src/components/warehouse/run/`
- `ScanRun.tsx` (client, owns the state machine): `setup → running → bucketDone`. State `{mode, bucketKey, cursorId, skipped: string[], startedAt, tally:{bound,refused,skipped}}` mirrored to `sessionStorage["wh.run"]` (same survival rule as `wh.bench.hand`); `localStorage["wh.run.mode"]` remembers the last mode. SWR on `/api/warehouse/to-label?limit=200` with `fallbackData`, `revalidateOnFocus`; bound ids removed locally like `BenchHome.boundIds`.
- `RunSetup.tsx`: heading "Par quoi commencer ?"; two 52 px+ mode cards (Même produit / Même couleur — TN: Même région) with icon + one-line why; then the bucket list for the chosen mode as tappable rows: swatch (hex, or product thumb, or dashed for unknown/mixed), label, sublabel (zone name / branch plate on white; SKU), count pill, "oldest since {age}". Empty bench → the bench's own empty wording.
- `RunHeader.tsx`: exit button (start edge, 44 px), bucket badge (swatch + name + white plate for LY), "3 / 12" tabular, elapsed `mm:ss` (`useElapsed`), tally dots (✓ n · ✕ n · ⤼ n) with labels for a11y.
- `RunParcel.tsx`: the parcel in hand at instruction scale — roll band (reuse the band markup from `ScanSheet`; extract to `warehouse/bench/RollBand.tsx` so sheet + run share it), product photo 160 px (or a 2×2 mosaic when mixed), **all lines** listed `name · variant × qty` with per-line thumbs, customer, city/area, price small, age pill, stock chip. Primary "C'est bien ce colis" (52 px) → scanner block; secondary "Passer" (skip); "Ce n'est pas le bon colis" → skip too.
- `RunScanner.tsx`: camera-first per `readScannerPrefs().cameraFirst` using `QrScanner`/`ScanViewfinder` with the roll hex; numeric LTR input (LY) / text (TN); **mount `createScannerInputHandler`** (`src/lib/preparation/scanner-input.ts`) on `document` while running so a wedge gun works without focus; `useScanOut` does the submit. Result states reuse `ScanOutcome`/`errorLabelKey`; `signalOutcome` for sound/haptics.
  - `bound` / `bind_unverified`: green tile with code, stock effect, "moved to Scannés"; **auto-advance after 1200 ms** (cancelable "Rester"), reduced-motion safe. `bind_unverified` shows its hint and does not auto-advance.
  - `refused_*` / `bound_not_committed`: stays; "Réessayer" / "Passer".
- `RunSummary.tsx`: bucket done — big count, bound/refused/skipped, duration, per-minute rate only if ≥1 bound; "Suivant : {next bucket}" (largest remaining, same mode) / "Changer de mode" / "Retour au banc". Refused parcels listed with their reason so they are not forgotten. Nothing invented: no accuracy, no goal.
- Desk (manager/super_admin): same component; ≥`md` layout goes two-column (parcel | scanner + recent scans list from `useScanOut.scans`), camera as the 50 px toggle, input auto-focused (`ScanStation` behaviour). `ScanStation variant="station"` and its `RollStrip` are superseded: delete the station branch after the run ships (keep `panel`).

### A5. Bench and sheet touch-ups
- `BenchCard`, `PrepCard`/desk row, `ScanSheet.ParcelConfirm`, `ScannedCard`, `ScannedTable`: render `linesOf(row)`; a mixed order shows "3 produits" + lines, with a small "Mixte" neutral pill (icon + text).
- `RollRail`: unchanged. `BenchHome`: hero gains a "Lancer une tournée" secondary button beside the segments (same href as the FAB) so the run is discoverable when the FAB is covered by the keyboard.

### A6. Stock for multi-product orders — DB (approved 2026-09-10)
Migration `supabase/migrations/2026MMDD_scan_multi_line_stock.sql` redefining `scan_order_out`, `unscan_order`, `scan_return_in`, `scan_received_in` to iterate `order_items` (fallback to `orders.product_id/quantity` when the order has no items rows). One `inventory_log` row per line (the site trigger already ventilates each movement), `STOCK_UNDERFLOW` checked per line before any write, `stock_after` returned per line + the primary line kept for the existing response shape. Apply via `mcp__supabase__apply_migration` after local review; `rls-reviewer` pass.

---

## Part B — Scanned list

- `src/lib/warehouse/scanned-filters.ts` (pure, tested): `ScannedFilter = { seg: "all"|"check"|"waiting"|"handed"; hex: string|"unknown"|null; product: string|null; q: string; who: string|null }`, `applyScannedFilters(rows, f)`, `sortScanned(rows)` (problems first, then `scanned_at` desc) — **one sort for both surfaces**, `scannedFacets(rows)` (counts per segment/roll/product/scanner).
- `useScannedActions` gains nothing; a new `useScannedView(rows)` hook holds filter state + derived rows, shared by phone and desk.
- Phone `ScannedList`: sticky filter bar: `SegmentedTabs` size sm (Tous / À vérifier n / En attente n / Remis n), compact roll rail (LY, reuse `RollRail` with `compact` prop), search field (sticker, Darb number, customer), product pill. Empty-with-filters state ("Aucun colis pour ces filtres · Effacer") distinct from empty. Counts describe the loaded page (≤100 rows); say so in a caption when `nextCursor` is set, and add "Charger plus" (the API already pages).
- `ScannedCard` redesign: sticker number is the loudest element (it is what the agent matches on the box), bind pill beside it, roll bar at the leading edge (existing), lines list, `scannedBy` relative time ("il y a 12 min"), actions row unchanged but "Dé-scanner" stays the only red one; "Re-lier" input inline (existing).
- Desk `ScannedTable`: same filter bar above the table + "Scanné par" pill; columns: Colis (lines) · Sticker · Chez Darb · État · Rouleau (LY) · Scanné · actions in a `Menu` (`components/ui/Menu.tsx`) to stop the 3-button row wrapping. Keep `data-testid="wh-bind-state"`.

---

## Part C — Stock list

- `/api/warehouse/stock` route: add `sites: { warehouse_id, code, name, current_stock, last_counted_at }[]` from `product_site_stock` joined to `warehouses` (only when the market has >1 active warehouse), and `unallocated = current_stock − Σ sites`.
- `src/lib/warehouse/stock-filters.ts` (pure, tested): `seg: "all"|"low"|"negative"|"uncounted"`, `sort: "name"|"stock"|"free"`, `applyStockFilters`, facets.
- `WarehouseStockClient`: filter segments + sort pill next to the search; KPI grid unchanged (whole catalogue); phone chips become the segments (tappable, counts follow the search as today).
- `StockCard`: level bar (fill = `current_stock / max(threshold×2, goal ?? threshold×2)`, threshold tick; amber/red only via the existing state), 14-day sparkline (`series`) in the open state, per-site lines (Tripoli 12 · Benghazi 5 · non ventilé 3) with "jamais compté" per site, count button per site when >1 site (`StockCountDialog` gains a `warehouseId` prop; `POST /api/warehouse/stock/count` already accepts `warehouse_id`). Desk table: sparkline cell + sites cell.

---

## Decisions (2026-09-10)
Multi-product: fix DB + UI. Run surface: full-screen `/warehouse/scan`. Game depth: progress, auto-advance, bucket summary only (no streaks, no stored bests). Tunisia region = governorate.

## Order of work
1. Copy this plan to `plans/warehouse-scan-run.md` in the repo (durable copy, per user CLAUDE.md).
2. Pure libs with tests: `scan-buckets`, `order-lines`, `scanned-filters`, `stock-filters`.
3. API rows carry `items` (`to-label`, `scanned`); stock route carries `sites`.
4. Migration A6 (multi-line stock) + `rls-reviewer`; apply to the OMS project (`vshynigvgrlihngozuwb`) after the SQL tests pass.
5. Run components + route + shell/FAB wiring; retire `ScanStation` station variant.
6. Scanned list (phone + desk), then stock list.
7. i18n fr/ar, `i18n-reviewer`, docs, browser verification with the Libya fixture.

## Files

New: `src/lib/warehouse/{scan-buckets,order-lines,scanned-filters,stock-filters}.ts` (+ `__tests__`), `src/components/warehouse/run/{ScanRun,RunSetup,RunHeader,RunParcel,RunScanner,RunSummary}.tsx` (+ `__tests__`), `src/components/warehouse/bench/RollBand.tsx`, `src/components/warehouse/bench/useScannedView.ts`, `src/hooks/useElapsed.ts`, migration (if A6 approved).

Modified: `(warehouse)/warehouse/scan/page.tsx`, `(warehouse)/layout.tsx`, `shell/ScanFab.tsx`, `shell/WarehouseMobileShell.tsx`, `bench/{BenchHome,BenchCard,ScanSheet,ScannedList,ScannedCard}.tsx`, `console/{PreparationConsole,PrepCard,ScannedTable,ScanStation,WarehouseStockClient,StockCard}.tsx`, `api/warehouse/{to-label,scanned,stock}/route.ts`, `lib/warehouse/summary.ts` (row type), `messages/{fr,ar}.json` (`warehouse.run.*`, `warehouse.scanned.filters.*`, `warehouse.stock.filters.*`), `docs/warehouse-sites-and-statuses.md` + a new `docs/warehouse-scan-run.md` (linked from CLAUDE.md references).

## Verification

1. `npm test` — new unit tests for the four pure modules; component tests: RunSetup lists buckets in the right order with a mixed bucket last; RunParcel lists every line of a 3-product order; auto-advance after `bound`, none after `bind_unverified`; skip moves to end once; state survives remount via sessionStorage; wedge input fires a scan with no focused field; layout hides the bottom bar on `/warehouse/scan`; ScannedList/Table share the sort and filters; StockCard renders sites and never invents a goal. `i18n-reviewer` + `rls-reviewer` agents after UI/API work.
2. `npm run typecheck`, `npm run lint`, `npm run build`.
3. Browser (Playwright MCP, 390×844 and desktop): seed the Libya fixture (`docs/warehouse-e2e-fixture.md`, Darb sandbox) with ≥2 rolls, ≥2 products and one 3-product order; log in as `warehouse.ly@oms.local` → FAB → product mode → mixed bucket → scan → auto-advance → summary; then as `manager.ly@oms.local` → Mode scan → same run at desk with typed input; check the scanned list filters and the stock per-site lines; RTL pass in Arabic. Screenshots to `report/shots/`.
4. If A6 lands: scan a 3-line fixture order and assert three `inventory_log` rows and three `product_site_stock` decrements via `execute_sql`; teardown the fixture.
