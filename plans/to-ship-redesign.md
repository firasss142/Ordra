# À EXPÉDIER — Dispatch Cockpit Redesign

## Goal
Replace the generic `orders?status=confirmed,dispatch_scheduled,scanned` link with a dedicated **Dispatch Cockpit** at `/[locale]/to-ship`. Manager-facing. Answers: *"what should we ship today, to whom, and by which carrier?"*

Warehouse physical prep (labels, scan-out) stays under `/warehouse/preparation`. The new cockpit orchestrates dispatch; warehouse executes packing.

## Scope (explicit)
1. New route `/[locale]/(dashboard)/to-ship/` — server page + `ToShipCockpit` client
2. Grouping: toggle between **by destination city** (default, carrier routing) and **by product** (batch-picking intent)
3. Scheduled callouts: a strip surfacing `dispatch_scheduled` orders grouped by date (e.g. "Tomorrow: 34 orders", "Today: 8 auto-dispatching")
4. Bulk dispatch: multi-select orders → pick a carrier → dispatch N at once via new `POST /api/orders/bulk-dispatch`
5. Printable picklist PDF: `POST /api/to-ship/picklist` returns a PDF grouped by whatever grouping is active (city or product)
6. Stock-underrun warning: flag rows whose dispatch would drop product below `low_stock_threshold`
7. Sidebar: replace current `toShip` entry with `href: "to-ship"` + update nav i18n
8. Tests: API route tests (bulk-dispatch, picklist), component test for grouping toggle + selection

## Out of scope (explicit)
- Carrier SLA / pickup-window countdowns: **dropped from v1**. The `carriers` table has no pickup_window or SLA fields (`src/types/carrier.ts` has only `api_key_encrypted`, `sender_*`, `api_base_url`, `is_active`). Adding SLA infra is its own project. The cockpit will show a simple per-carrier **queue count** ("Navex: 45 confirmed, 12 scheduled") which is actionable without schema changes.
- Carrier capacity limits — same reason, no data source.
- Mutating the existing `/warehouse/preparation` flow.

## Architecture

### Route
```
src/app/[locale]/(dashboard)/to-ship/
  page.tsx             # server: auth + initial fetch
  ToShipCockpit.tsx    # client: grouping, selection, bulk actions
```

### Data
Server-side fetch (same-market RLS) for orders where `status IN ('confirmed','dispatch_scheduled','scanned')`, joined with product (for stock + low_stock_threshold).

Reuse `useOrdersList` pagination IF the list can grow large, otherwise fetch-all-and-group (simpler). Decision: start with fetch-all capped at 500 rows. Grouping on 5k+ rows is a later optimization.

### Client state
```ts
type Grouping = "city" | "product";
type SelectionSet = Set<string>; // order IDs
```

### API
- **New**: `POST /api/orders/bulk-dispatch` — body `{ order_ids: string[], carrier_id: string, extra?: Record<string, unknown> }`. Loops through `performDispatch()` (already exists at `src/lib/carriers/perform-dispatch.ts`). Returns `{ succeeded: string[], failed: Array<{order_id, error, errorCode}> }`. Partial success is allowed — carrier API may reject individual orders (bad phone, unknown city).
- **New**: `POST /api/to-ship/picklist` — body `{ order_ids: string[], grouping: "city"|"product" }`. Returns `application/pdf`. Uses `@react-pdf/renderer` (already in deps). Simple grouped list with product, qty, customer, city.

### Stock warning logic
For each row, compute `projected_stock = product.current_stock - qty`. If `projected_stock < product.low_stock_threshold`, tag row with `stockWarning: true`. Products appear in multiple rows — accumulate the subtraction per product across selected rows when computing the projection for the "selection summary" bar.

### Scheduled callouts
Group `dispatch_scheduled` orders by `DATE(scheduled_at)`. Bucket:
- Today (auto vs manual split)
- Tomorrow
- Later this week
Render as a horizontal pill strip above the main list.

## File map

**New files:**
- `src/app/[locale]/(dashboard)/to-ship/page.tsx`
- `src/app/[locale]/(dashboard)/to-ship/ToShipCockpit.tsx`
- `src/app/api/orders/bulk-dispatch/route.ts`
- `src/app/api/orders/bulk-dispatch/route.test.ts`
- `src/app/api/to-ship/picklist/route.ts`
- `src/app/api/to-ship/picklist/route.test.ts`
- `src/lib/to-ship/group.ts` — pure grouping helpers (testable)
- `src/lib/to-ship/group.test.ts`
- `src/lib/to-ship/stock-warning.ts` — pure stock-projection logic
- `src/lib/to-ship/stock-warning.test.ts`
- `src/lib/to-ship/PicklistPdf.tsx` — @react-pdf/renderer template
- `src/components/to-ship/ToShipHeader.tsx` — title, grouping toggle, scheduled strip
- `src/components/to-ship/ScheduledStrip.tsx`
- `src/components/to-ship/GroupCard.tsx` — one group (city or product)
- `src/components/to-ship/DispatchBulkBar.tsx` — selection footer w/ carrier picker + dispatch btn
- `src/components/to-ship/ToShipCockpit.test.tsx`

**Modified files:**
- `src/components/layout/Sidebar.tsx` (line 107) — change href `"orders?status=..."` → `"to-ship"`
- `src/messages/fr.json` — add `toShip.*` keys
- `src/messages/ar.json` — same, RTL-aware strings

## Execution order (TDD)
1. Write failing test for `src/lib/to-ship/group.ts` → implement
2. Write failing test for `src/lib/to-ship/stock-warning.ts` → implement
3. Write failing test for `POST /api/orders/bulk-dispatch` → implement
4. Write failing test for `POST /api/to-ship/picklist` → implement (auth + basic shape; PDF content is rendered via @react-pdf, hard to assert pixel-perfect — assert Content-Type + status + headers)
5. Build `ToShipCockpit.tsx` + sub-components, with component test for grouping toggle + selection
6. Wire `page.tsx` (server) to fetch + pass to cockpit
7. Update sidebar + i18n
8. Typecheck + lint + build

## Risks
- **Bulk dispatch atomicity**: carrier API calls are sequential and non-transactional. If call #5 of 20 fails, calls 1-4 already succeeded. Response must surface this clearly. No retry built-in; agent re-selects failed rows and retries.
- **Stock-warning accuracy under concurrency**: `current_stock` is a snapshot; another dispatch could race. The warning is advisory; DB RPC `scan_order_out` is the source of truth and will reject at scan time if actually underflowing. Don't over-engineer.
- **Picklist PDF size** for 500 orders: `@react-pdf/renderer` is synchronous and can block. Cap at 200 orders per picklist server-side; return 400 if exceeded.
