# PRÉPARATION Redesign — Warehouse Label Print + Scan-Out

Status: plan
Owner: warehouse workflow
Date: 2026-04-23

## 0. Current state (verified)

- Two separate pages: `/[locale]/warehouse/to-label` + `/[locale]/warehouse/to-scan`
- Each has its own SWR queue and action flow. No shared context.
- `scan_order_out` RPC (supabase/migrations/20260421_warehouse_rpcs.sql:220–317) is already **atomic**: validates role + market + status + label prerequisite, decrements stock, inserts `inventory_log`, updates `orders.status`, inserts `order_history`. Returns `{ stock_after, inventory_log_id, history_id }`.
- Label print (src/app/api/warehouse/label-prints/route.ts) already supports **batch** via `order_ids[]` and generates one combined PDF.
- Hardware scanner input is assumed to arrive as keyboard input. ToScanQueue input is already auto-focused (src/components/warehouse/ToScanQueue.tsx:100–102).
- Audio feedback exists: `playBeep` uses AudioContext (880 Hz success / 220 Hz error) + navigator.vibrate fallback in src/components/warehouse/ScanFeedbackTile.tsx:128–153.
- No per-operator stats hook. KPIs come from `/api/warehouse/summary`.

What's **missing** and what this plan delivers:
1. Unified workspace with a linear flow (print → scan → done) instead of two disconnected pages.
2. Operator-level stats (labels printed, orders scanned, avg cycle time) — not market-level.
3. Robust error recovery on scan (order not found / already scanned / stock race) without losing the tray.
4. Dedicated atomicity tests for `scan_order_out` (concurrent scans, stock race, missing label, double-scan).

---

## 1. UX model — "Préparation" single workspace

**Route:** `/[locale]/warehouse/preparation` (new). Keep old routes as redirects to the new page for 1 release, then remove.

**Layout (light palette — matches existing queue palette, not the dark overview palette):**

```
┌─────────────────────────────────────────────────────────────┐
│ Top: Operator stats strip (4 tiles)                         │
│   Labels printed today | Orders scanned | Avg cycle | Tray  │
├─────────────────────────────────────────────────────────────┤
│ Left 58%: the tray (current working batch)                  │
│   - Orders selected for this prep session                   │
│   - Each row: order short ID, city, customer, stock, status │
│     pill (printed / scanned / error)                        │
│   - Progress meter: 4/12 scanned                            │
│   - Sticky bottom: "Print labels" (if any unprinted)        │
├─────────────────────────────────────────────────────────────┤
│ Right 42%: scanner panel (sticky, always visible)           │
│   - Big invisible input (captures hardware scanner)         │
│   - Feedback tile (flash green / red, stock_after)          │
│   - Last 8 scans list                                       │
└─────────────────────────────────────────────────────────────┘

Below the tray: the backlog queue (paginated, unchanged visual
from current ToLabelQueue). Add-to-tray checkbox replaces
"select for print".
```

**Flow contract:**
1. Operator checks orders in the backlog → they appear in the tray with state=`ready_to_print`.
2. Operator clicks "Print labels" → PDF downloads, tray rows transition to state=`printed`. Inventory is NOT touched yet.
3. Operator scans each tracked package → row transitions `printed` → `scanned`; stock decrements server-side.
4. When tray is fully scanned (or operator clicks "End session"), tray empties and stats refresh.

**Why a tray model (not just tabs):** separates "backlog I haven't committed to" from "work I've started". Solves the error-recovery requirement — a failed scan keeps the row in the tray with state=`error` + reason, doesn't dump the operator back to the queue.

---

## 2. Component breakdown (new files)

Under `src/components/warehouse/preparation/`:

- `PreparationClient.tsx` — the shell. Owns tray state (array of tray rows with client-side status machine), backlog SWR, operator stats SWR, mutation wiring.
- `PreparationStatsStrip.tsx` — 4 stat tiles. Props: `{ labelsPrintedToday, ordersScannedToday, avgCycleSeconds, traySize }`. Uses same tokens as WarehouseKpiStrip but light palette to match the queue surface.
- `PreparationTray.tsx` — renders tray rows with status pills. Props: `{ rows, onRemove, onRetryScan }`.
- `PreparationScannerPanel.tsx` — extracts the right-hand scan card from ToScanQueue. Owns: invisible input, submit, feedback tile, audio beep, last-scans list. Props: `{ onScan: (orderId) => Promise<ScanResult> }` — inverts control so the parent orchestrates tray transitions.
- `PreparationBacklog.tsx` — lean version of current ToLabelQueue: table + pagination + real-time banner + `onAddToTray(orderId)` callback. No internal selection state for printing — tray holds that.
- `usePreparationTray.ts` — state hook. Exposes `{ rows, add, remove, markPrinted, markScanned, markError, clear }`. Rows shape: `{ id, shortId, city, customer, productLabel, quantity, stockLevel, state, errorReason?, printedAt?, scannedAt? }`. Holds a Map, derives order for rendering.
- `useOperatorStats.ts` — SWR hook for `/api/warehouse/operator-stats`, 60s refresh.

Under `src/lib/preparation/`:

- `tray-state.ts` — pure state-machine for tray transitions: `ready_to_print → printed → scanned` (with `error` side-state). No React. Unit tests for each transition.
- `cycle-time.ts` — compute avg ms between `printedAt` and `scannedAt` per tray row; expose `summarize(rows)` returning seconds. Pure.

---

## 3. API changes

### 3.1 NEW `GET /api/warehouse/operator-stats`

Returns current operator's stats for today (resets at market's local midnight — use market timezone from markets table, default UTC).

Response:
```json
{
  "labels_printed_today": 42,
  "orders_scanned_today": 36,
  "avg_cycle_seconds": 240,
  "market_id": "..."
}
```

Implementation:
- Query `label_prints` where `printed_by = actor.id AND printed_at >= local_midnight`.
- Query `inventory_log` where `actor_id = actor.id AND reason = 'scanned' AND created_at >= local_midnight`.
- Avg cycle: join label_prints to inventory_log on order_id, compute `scanned_at - printed_at` mean. Cap outliers at 1h (operator went to lunch — don't skew the number).
- Cache-Control: `private, max-age=10, stale-while-revalidate=60`.

Atomicity is not required (read-only). New RPC `get_operator_prep_stats(p_actor_id uuid)` defined in a new migration `20260424_operator_prep_stats.sql` — runs one query per stat and returns JSON.

### 3.2 `POST /api/warehouse/label-prints` — minor addition

Return JSON metadata **alongside** the PDF is not possible in one response. Two options:

- **A (recommended):** After successful print, client reads PDF from `/api/warehouse/label-prints` and, on success, calls a new `GET /api/warehouse/label-prints/batch/:batch_id` to fetch `{ bl_numbers: { [orderId]: bl } }` so the tray can show BL numbers next to each row.
- **B:** Encode batch_id in `X-Batch-Id` response header; skip BL-number display in tray. Simpler — start here, add A if operators ask for BL numbers inline.

**Decision:** start with B. Add A only if operators need BL numbers visible in the tray.

### 3.3 `POST /api/warehouse/scan-out` — already exists, verify response shape

Already returns `{ order_id, status, stock_after, ... }` from the RPC. No changes needed.

Error codes the client must handle (from RPC `raise exception`):
- `ORDER_NOT_FOUND`
- `MARKET_MISMATCH`
- `INVALID_STATUS` (e.g. already scanned) — message includes current status
- `NO_LABEL_PRINTED`
- `STOCK_UNDERFLOW`

The scan-out route currently surfaces the PG exception message. Add structured error mapping in the route: parse PG error code / message and return `{ error_code, message }` with HTTP 409 for business conflicts (vs. 500 for unexpected). This lets the tray show a **specific** reason on the error state.

---

## 4. Error recovery UX (hard requirement)

When a scan fails, the tray **must not lose state**:

| Error | Row visual | Toast | Can retry? |
|-------|-----------|-------|------------|
| `ORDER_NOT_FOUND` | Row stays unprinted if scanned-from-tray, otherwise shows "Not in tray — add first" | "Order not in tray" | — |
| `INVALID_STATUS` (already scanned) | Row flips to `scanned` (idempotent — the work is done elsewhere) | Neutral toast: "Already scanned by X at HH:MM" | No |
| `STOCK_UNDERFLOW` | Row flips to `error` with reason "Stock race" | Red toast | Yes — operator checks physical stock, calls super_admin |
| `NO_LABEL_PRINTED` | Row flips to `error`, with quick-action "Print this label" | Yellow toast | Yes — one-click reprint for this row only |
| Network error | Row stays `printed`, shows small retry icon | Generic toast | Yes — auto-retry once on next scan cycle |

Key principle: **the tray is the source of truth for the operator's working batch**. Server truth wins on conflicts (idempotent reconciliation), but the operator never has to re-select rows from the backlog to recover.

---

## 5. Scanner input handling (hardware-friendly)

Hardware scanners emit keyboard events faster than humans (typically <50ms per char, terminated by Enter). Current ToScanQueue just listens for Enter on a focused input — good enough but fragile (blur steals the scanner's input).

Improvement: global keyboard listener attached at the PreparationClient level, active only when the tray panel is visible and no modal is open:

```
- Buffer keystrokes if inter-key interval < 80ms.
- Treat the buffered string as a scan when Enter is received.
- If inter-key interval > 80ms (human typing), drop the buffer and
  let normal input behavior handle the keys.
- Always re-focus the invisible input on scan completion so manual
  typing also works.
```

This survives accidental focus loss (operator clicks a tray row, then scans).

Implementation lives in `src/lib/preparation/scanner-input.ts` as a hook `useGlobalScannerInput({ enabled, onScan })`. Pure DOM. Unit-tested with fake timers.

---

## 6. Visual feedback spec

Reuse `ScanFeedbackTile` and `playBeep` — they already work. Add:

- Tray row success: short 400ms background flash (`#E3F1D9` → white) on `scanned` transition.
- Tray row error: steady red left border (`#D72C0D`) until operator dismisses the error or retries.
- Scanner panel: on success, number ticker for `stock_after` so operator notices low stock (<5 = yellow text, 0 = red).
- Audio: success = existing 880Hz beep. Error = existing 220Hz beep. Idempotent "already scanned" = single short 660Hz beep (neutral — adds a new variant to `playBeep`: `"neutral"`).

Accessibility: all feedback also rendered as aria-live="polite" text. Color alone never conveys state.

---

## 7. Testing plan

### 7.1 Unit tests (Vitest)

- `tray-state.test.ts` — transitions only (pure state machine).
- `cycle-time.test.ts` — avg calc, outlier capping, empty input.
- `scanner-input.test.ts` — buffering behavior, inter-key intervals, buffer reset on slow typing, Enter-terminated submit.
- `usePreparationTray.test.ts` — React hook tests with @testing-library/react.

### 7.2 Component tests

- `PreparationClient.test.tsx` — full flow: add → print → scan → tray empty. Mock fetch for `/api/warehouse/label-prints` (returns 200 + fake PDF blob) and `/api/warehouse/scan-out` (returns `{ stock_after }`). Assert tray state transitions and stats refresh called.
- Error recovery: mock scan-out → 409 `INVALID_STATUS`. Assert row flips to `scanned` (not `error`) + neutral toast.
- Error recovery: mock scan-out → 409 `NO_LABEL_PRINTED`. Assert row flips to `error` with reprint action visible.

### 7.3 Atomicity tests (hard requirement from brief)

**File:** `supabase/tests/scan_order_out.atomicity.test.sql` — pgTAP tests, run via `npm run db:test` (add script if missing).

Cases:
1. Happy path: `confirmed` order → `scanned`. Assert `orders.status`, `inventory_log` row (reason='scanned', balance_after), `order_history` row all exist in one transaction.
2. **Double-scan race:** start two transactions scanning the same order concurrently. Only one succeeds; the other gets `INVALID_STATUS`. Stock decrements exactly once.
3. **Stock underflow:** set `current_stock = 0`, attempt scan. Exception raised, **nothing** committed (no inventory_log, no history, status unchanged).
4. **Missing label prerequisite:** no `label_prints` row → exception. Nothing committed.
5. **Market mismatch:** warehouse_agent from market A scanning market B order → exception. Nothing committed.

Each case wraps the RPC call in a transaction and uses pgTAP `throws_ok`/`lives_ok` + row-count assertions on `inventory_log`, `order_history`, `orders`.

If pgTAP isn't set up, fall back to a Vitest integration test hitting a dedicated test database via supabase-js — slower but doable. Prefer pgTAP.

### 7.4 E2E smoke (manual, documented in PR)

- Log in as `warehouse.tn`, add 3 confirmed orders to tray, print labels, scan each, verify stats strip updates, verify backlog drops those 3 rows.
- Scan an order that was already scanned elsewhere → neutral "already scanned" feedback.
- Scan an order with no label → yellow error with reprint action, click reprint, scan again → success.

---

## 8. Migration + rollout

1. Ship new route + components behind the same role gate (`canScanWarehouse`).
2. Update `WarehouseNavTabs`:
   - Remove "to-label" + "to-scan" tabs.
   - Add single "Préparation" tab → `/preparation`.
   - Keep "returns" and "history" tabs unchanged.
3. `src/app/[locale]/(warehouse)/warehouse/to-label/page.tsx` and `to-scan/page.tsx` become thin redirects to `/preparation`. Remove after one week.
4. i18n: add strings under `warehouse.preparation.*` in `fr.json` and `ar.json`. Reuse existing `warehouse.toLabel.*` and `warehouse.toScan.*` where labels make sense.
5. RTL: the left-tray/right-scanner split must flip for Arabic. Use logical properties — `marginInlineStart`, `gridTemplateColumns` unchanged (DOM order = LTR order, CSS flips via `direction: rtl` on the shell).

---

## 9. File manifest

**New:**
- `src/app/[locale]/(warehouse)/warehouse/preparation/page.tsx`
- `src/app/api/warehouse/operator-stats/route.ts`
- `src/components/warehouse/preparation/PreparationClient.tsx`
- `src/components/warehouse/preparation/PreparationStatsStrip.tsx`
- `src/components/warehouse/preparation/PreparationTray.tsx`
- `src/components/warehouse/preparation/PreparationScannerPanel.tsx`
- `src/components/warehouse/preparation/PreparationBacklog.tsx`
- `src/hooks/usePreparationTray.ts`
- `src/hooks/useOperatorStats.ts`
- `src/lib/preparation/tray-state.ts`
- `src/lib/preparation/cycle-time.ts`
- `src/lib/preparation/scanner-input.ts`
- `supabase/migrations/20260424_operator_prep_stats.sql`
- `supabase/tests/scan_order_out.atomicity.test.sql`
- Tests for every new file under `__tests__/` siblings.

**Modified:**
- `src/components/layout/WarehouseNavTabs.tsx` — nav entries.
- `src/app/api/warehouse/scan-out/route.ts` — structured error mapping.
- `src/messages/fr.json`, `src/messages/ar.json` — new strings.
- `src/app/[locale]/(warehouse)/warehouse/to-label/page.tsx`, `to-scan/page.tsx` — redirect.

**Deleted (after rollout window):**
- `src/components/warehouse/ToLabelQueue.tsx` (logic moved into PreparationBacklog + PreparationTray)
- `src/components/warehouse/ToScanQueue.tsx` (logic moved into PreparationScannerPanel)
- The two old routes once redirect window closes.

---

## 10. Open questions (flag before implementation)

1. Does `scan_order_out` actually run inside a single implicit transaction today? Confirm by reading the migration — the exploration report says yes, but the RPC uses `SECURITY DEFINER` functions with multiple statements; Postgres wraps this in one transaction by default.
2. Should operator stats reset at market-local midnight or UTC? Plan assumes market-local (markets.timezone). Confirm the column exists; if not, fallback to UTC for v1.
3. Is there a hard cap on tray size? Suggest 50 — beyond that, label PDF gets unwieldy and operators should split into batches. Implement as a soft warning at 50, hard block at 100.
4. Reprint tracking: when the operator clicks "reprint this row" from an error, the label_prints row should set `is_reprint=true`. Wire this through.

---

## 11. Execution order (for the implementation session)

1. Write failing pgTAP atomicity tests (cases 1–5 from §7.3).
2. Run them against current RPC — they should all pass (RPC is already atomic). If any fail, fix the RPC first.
3. Write `tray-state.ts` + unit tests. TDD.
4. Write `scanner-input.ts` + unit tests. TDD.
5. Write `cycle-time.ts` + unit tests. TDD.
6. Build hooks: `usePreparationTray`, `useOperatorStats`.
7. Build API: `/api/warehouse/operator-stats` route + migration + tests.
8. Add structured error mapping to `/api/warehouse/scan-out` route + tests.
9. Build components bottom-up: Scanner panel, Stats strip, Tray, Backlog, Client.
10. Wire the new page + redirects + nav change.
11. i18n strings.
12. Manual E2E smoke per §7.4.
13. Delete old components + routes.
