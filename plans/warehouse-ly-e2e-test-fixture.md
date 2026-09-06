# Libya warehouse E2E test — revertible fixture, Darb sandbox, audit protocol

> Durable copy (step 0 of execution): `plans/warehouse-ly-e2e-test-fixture.md` in the project.

## Context

The Libya warehouse section has **never been used in production**: 445 LY orders sit in `uploaded`, zero `scanned` events exist, no order carries a `carrier_sticker_ref`, and there are 0 `to_be_returned` LY orders. The user wants a brutal end-to-end pass of the whole section from the **LY warehouse agent's phone shell** (data accuracy, bugs, missing metrics, UX), fixing what we find, on test data we can remove at any time.

Two hard constraints shape the design:

1. **The app runs against the production Supabase project** (`vshynigvgrlihngozuwb`); there is no local stack or seed. Every test row lands in prod and must be tagged and reversible.
2. **Scan-out talks to Darb Assabil live** (`GET /api/local/shipments?reference=` then `PATCH /api/local/shipments/reference/:_id`) *before* committing locally. Real Darb must not see test parcels, and we must never type real sticker numbers (Darb binds any number, even another merchant's). So test orders point at a **sandbox carrier row** whose `api_endpoint` is a local mock — zero production-code changes to route traffic.

Pre-printed QR stickers: in Libya the scanned string is **bound**, not looked up. The operator "takes" the order from the queue (`hand`), scans the sticker, the number replaces Darb's temporary `SH…` reference and is stored in `orders.carrier_sticker_ref`. The camera path passes the decoded QR text straight into the same submit, with **no normalisation** — so what the QR actually encodes matters (open question below).

## Ground truth verified in the live DB (drives the design)

| Fact | Consequence |
|---|---|
| `warehouse.ly@oms.local` (id `99c37709-…`) is `is_active=false` **and** `deleted_at=2026-09-03 18:20`; same for `warehouse.tn`. Active LY warehouse agents: `adel@oms.local` (id `e5e04699-…`), `tarek@oms.local`. | User chose to test as **adel** (see Decisions). No user rows are modified. |
| `orders_update` RLS policy has branches for super_admin / market_manager / agent — **no `warehouse_agent`**. | `scan-out/route.ts:187` writes `carrier_extra` back with the operator's session → silent 0-row update for the floor role. Production bug (see Fixes). |
| `inventory_log` has `BEFORE DELETE/UPDATE` triggers that raise unconditionally; `order_history` has none. FKs from `order_history`, `inventory_log`, `carrier_event_log`, `webhook_delivery_log`, `order_follow_ups` to orders have no cascade. | Teardown of `inventory_log` rows needs one owner-level transaction via the Supabase MCP (`ALTER TABLE … DISABLE TRIGGER`), everything else is service-role deletes in FK order. |
| Carriers unique on `(market_id, code, name)`; Darb rows have `carrier_type='navex'`, `investor_billing_mode='billed_only'`, `api_credentials` = jsonb **string** of `encrypt(JSON)` (AES-256-CBC, `ENCRYPTION_KEY`). Cron darb-sync / rate-harvest / dispatch pickers filter `is_active=true`. | Sandbox carrier: `code='darb_assabil'`, distinct name, `is_active=false`, `supplies_own_labels=true`, `api_endpoint='http://127.0.0.1:4545'`. Invisible to crons and agents; visible (inactive) in Settings › Transporteurs during the window. |
| LY users are locale-forced to `/ar` (`getLocaleForMarket('ly') → 'ar'`); the mobile shell is chosen by role in `(warehouse)/layout.tsx`. | Agent pass = Arabic RTL at 390×844. French/desk pass = `admin@oms.local` with scope cookie `oms_scope_market=ly`. |
| `get_to_label_orders` (live) filters `status='uploaded' AND archived_at IS NULL AND bench_cleared_at IS NULL AND fulfil_from_carrier_warehouse IS DISTINCT FROM 'true'`; `uploaded_at` = max `order_history` row with `status_to='uploaded'`. | Seed must write realistic `order_history` trails; bench age comes from them. |
| LY `settings` has `goal_daily_treated=12` but **no `goal_daily_scanned`** → dashboard/prep use hardcoded default 40. | Finding to surface; add the setting (and check the settings UI exposes it). |
| Low-stock definitions disagree: dashboard/summary uses `current_stock < threshold` (`get_low_stock_products`), Stock page uses `current_stock <= threshold`. | Data-accuracy finding; unify. |
| `warehouse_market_tz('ly') = Africa/Tripoli` (UTC+2) but LY `shift_config.timezone = Africa/Tunis` (UTC+1). | "Today" boundaries differ by an hour between warehouse stats and the rest; surface. |
| **Darb returns bypass the warehouse.** `promote_darb_status` maps Darb slug `returned` → OMS `returned` (terminal) straight from `uploaded`, `actor_type='system'`, **no stock credit, no inventory_log row**; Darb `returning` is not mapped at all. Live: 103 LY orders went `uploaded → returned` this way; `to_be_returned` (the only status `/warehouse/returns` shows) has never been set for LY. | A physically returned Darb parcel scanned at Retours answers `wrong_status: returned` and cannot be restocked / written off / re-shipped; LY stock is never credited for returns. Fix = route Darb `returning`/`returned` to `to_be_returned` and let the warehouse scan finalise (see Fixes §0). |
| Returned/dispatched LY orders carry the plain-digit Darb reference in `tracking_number` (repaired by the sync), never in `carrier_sticker_ref` (stickers were bound in the Darb app). | `find_return_by_code` must resolve by `tracking_number`; add a scenario that proves it. |

## Approach

Four deliverables, in order:

1. **Darb sandbox** — `scripts/darb-sandbox.mjs` (Node 22, no deps) on `127.0.0.1:4545`.
2. **Fixture** — `scripts/wh-test-fixture.ts` (`seed | status | teardown | session`, dry-run unless `--apply`) + shared manifest `scripts/wh-test-scenarios.mjs`, state in `scripts/.wh-test-state.json` (gitignored).
3. **Audit protocol** — drive the app with the Playwright MCP at 390×844 as the LY agent; after every action, the DB (via Supabase MCP) and the sandbox state are the oracle.
4. **Fixes** — TDD (failing test first) for every bug/UX gap found, gated by `npm run typecheck`, `npm run lint`, `npm run test:run`. Findings that need schema changes ship as migrations in `supabase/migrations/`.

### 1. `scripts/darb-sandbox.mjs`

- Shipments table built from the manifest (`SCENARIOS.filter(s => s.sandbox)` → `{_id, reference, toBranchGroup, status}`).
- `GET /api/local/shipments?reference=X&limit=1&offset=0` → `{status:true,data:{results:[…]}}`; unknown ref → empty results (→ `DARB_SHIPMENT_UNKNOWN`); repeated/comma-joined param → HTTP 400 (mirrors the vendor trap in `docs/darb-assabil-sync.md` §1).
- `PATCH /api/local/shipments/reference/:id` body `{reference}` → mode-dependent: `ok` records the bind and returns 200 `{status:true}`; `refuse` returns 200 `{status:false,messages:[{message}]}`; `down` destroys the socket; `slow` waits 20 s **then still applies the bind** (real-world timeout shape: the OMS gives up at 15 s, Darb completed anyway → next re-scan must rebind idempotently). Unknown `_id` → `{status:false}`.
- Header guard on every request: `Authorization: apikey sandbox`, `X-API-VERSION: 1.0.0`, `X-ACCOUNT-ID: sandbox`; anything else → `{status:false}` + logged, so a header regression in `darb-assabil-http.ts` is caught.
- `GET /__sandbox/state` (binds + request log), `POST /__sandbox/mode {mode}`, `POST /__sandbox/reset`. One stdout line per request.

### 2. `scripts/wh-test-fixture.ts` + manifest

Pattern: `scripts/verify-market-metrics.ts` (.env.local loader, service-role client), `--apply` convention from `scripts/seed-darb-warehouse-products.ts`, `encrypt` from `src/lib/crypto.ts`, session minting from `scripts/capture-warehouse-screens.mjs:65-84`.

**Tagging** — fixed UUIDs (`ffffffff-0000-4000-8000-0000000001xx` orders, `…02xx` products, `…0301` carrier), `external_id` prefix `WH-TEST-`, `[TEST]` in every name, `[WH-TEST]` in every history/log note, `raw_payload={"wh_test":true}`. Teardown deletes **only by id / prefix**, never by name.

**Seed creates (LY unless stated):**
- Sandbox carrier (above), fees copied from the Tripoli row at seed time.
- Product A `[TEST] طرد اختبار المستودع` initial/current 12, threshold 3; Product B `[TEST] stock 1` 1/1, threshold 3 (lands in low stock); Product TN `[TEST] Colis test TN` 1/1 (for the market-isolation order). Each with its one `inventory_log` `reason='initial_stock'` row (stock-integrity path 1), actor admin.
- Orders on storefront `Test` (`624959b2-…`, LY) / `TestSF` (`1fff7a2e-…`, TN), `external_platform='manual'`, Arabic customer names prefixed `[TEST]`, `order_history` trail `→pending (system) → confirmed (manager) → uploaded (manager, = bench clock)`; returns add `dispatched → in_transit → to_be_returned`.
- No user changes (login is adel).
- A **snapshot of real rows** (every non-test LY+TN product's `current_stock`/`damaged_return_count`, real order counts per market×status, `inventory_log`/`order_history` totals excluding test ids, carriers' `is_active`) so `status` can prove **zero real rows changed**.

**Scenario matrix (18 orders):**

| Key | Status | City / branch | Identifiers | Qty·Prod | Bench age | Exercises |
|---|---|---|---|---|---|---|
| a | uploaded | طرابلس / TR | darb id `sbx-a`, `SHTEST0001` | 1·A | 2 h | happy path, roll **rouge** |
| b | uploaded | بنغازي / BN | `sbx-b` | 1·A | 3 h | **vert**; then duplicate-sticker refusal |
| c | uploaded | الزاوية / ZWY | `sbx-c` | 1·A | 4 h | **orange**; refuse / down / slow modes, idempotent rebind |
| d | uploaded | سبها / SB | `sbx-d` | 1·A | 5 h | **cyan** |
| e | uploaded | مصراتة, no branch, no darb id | `SHTEST0005` known to sandbox → `sbx-e`, MS | 1·A | 6 h | resolve-lookup path, directory colour **jaune**, exposes the RLS write-back bug |
| f | uploaded | قرية مجهولة, no branch | sandbox knows, `toBranchGroup:null` | 1·A | 7 h | zone unknown (dashed strip), scan still allowed |
| g | uploaded | طرابلس / TR | `sbx-g` | **2·B** | 8 h | precheck ok → bind ok → `stock cannot go below zero` → `darb_bound:true` amber tile |
| h | uploaded | طرابلس | `fulfil_from_carrier_warehouse:true` | 1·A | 9 h | excluded from queue; API → 409 `CARRIER_WAREHOUSE_ORDER`; `carrier_warehouse` +1 |
| i | uploaded | طرابلس / TR | `sbx-i` | 1·A | 3 d | `late_prepare` +1 |
| j | uploaded | طرابلس / TR | `sbx-j` | 1·A | 10 d | `never_scanned` +1 |
| k | uploaded | طرابلس / TR | `carrier_status_slug='released'` | 1·A | 1 h | "gone at carrier", Take disabled, `released_at_carrier` +1; **server still allows the scan** (finding) |
| l | confirmed | طرابلس | — | 1·A | — | `confirmed_not_uploaded` +1, absent from queue, API → `INVALID_STATUS` |
| m1 | to_be_returned | طرابلس | `carrier_sticker_ref='9900101'` | 1·A | — | returns lookup by sticker → **restock** |
| m2 | to_be_returned | بنغازي | `carrier_sticker_ref='9900102'` | 1·A | — | **damaged**, reason `other` + note |
| m3 | to_be_returned | طرابلس | `tracking_number='000000990103'` | 1·A | — | leading-zero folding → **redeliver** (`received`) |
| m4 | to_be_returned | طرابلس | `tracking_number='7700888'` (plain digits, no sticker ref), `carrier_status_slug='returned'` | 1·A | — | the **real** Darb-return shape (sticker bound in Darb's app, reference repaired by sync) → lookup by tracking → restock |
| n | to_be_returned, **TN** | تونس | `carrier_sticker_ref='9900101'` (same as m1) | 1·TN | — | market isolation of lookup; `MARKET_MISMATCH` via API |
| o | uploaded | طرابلس, no darb id | `SHTEST0404` unknown to sandbox | 1·A | 30 min | 409 `DARB_SHIPMENT_UNKNOWN`, no PATCH |
| p | uploaded | طرابلس / TR | `sbx-p`, `SHTEST0016` | 1·A | 1 d | **simulated Darb return**: call `promote_darb_status(p,'returned','7700777')` via SQL exactly as the sync does → today lands terminal `returned` with no stock; after Fix §0 lands `to_be_returned`, appears in the inbox, and scanning `7700777` resolves it |

Bonus with no extra rows: lookup `ffffff` → `ambiguous` (uuid prefix hits every test order); `123` → `not_found`.

Expected ledger if the protocol runs in full: A 12 → 4 (8 scans) → 5 (m1) → 6 (m3) → count 6 (delta-0 row) → count 5 (−1); B stays 1; `damaged_return_count(A)=1`.

**Teardown (FK-safe, all scoped by test ids):**
1. If `inventory_log` test rows exist → one transaction through the Supabase MCP (table owner): `DISABLE TRIGGER inventory_log_no_delete` → `DELETE … WHERE product_id IN (test products) OR order_id IN (test orders)` → `ENABLE TRIGGER`. Script prints the exact SQL and expected row count; fallback flag `--archive-products` soft-archives the products instead (`is_active=false, deleted_at=now()`) if the owner path is unavailable.
2. Script `--apply`: `order_history` → defensive deletes on `carrier_event_log` / `webhook_delivery_log` / `order_follow_ups` (abort if `leads` reference a test order) → `orders` (cascades `order_items`, `agent_notifications`, `label_prints`, `investor_order_facts`; set-null on `darb_*`, `agent_commission_ledger`) → `products` → sandbox `carriers` row (assert no `darb_shipping_rates` / `darb_sync_runs` / mappings reference it) → delete state file → print `status` (zero tagged rows, zero real-row diff).

### 3. Audit protocol (Playwright MCP, 390×844, `/ar/…`, then `/fr/…` as admin scoped to LY)

Setup: `node scripts/darb-sandbox.mjs` · `npm run dev` · `seed --apply` · log in at `/ar/login` as `adel@oms.local` (fallback: `session` prints cookie chunks for `browser_run_code_unsafe`). Direct API probes via `browser_evaluate` → `fetch('/api/warehouse/…')`.

| Screen | DB / sandbox assertions | UX / RTL / i18n review |
|---|---|---|
| `/warehouse` dashboard | queue stats = `get_warehouse_queue_stats(LY)` deltas per matrix; low-stock KPI shows B; `operator-stats` counts each scan; `handed` = `scanned` count | KPI carousel legibility, empty states, "Objectif 40" hardcoded, task cards link targets, bottom bar badge |
| `/warehouse/preparation` | rows = `get_to_label_orders` (h, l, m*, n absent); strip colours a rouge, b vert, c orange, d cyan, e jaune(directory), f dashed; k disabled + "released"; e/f/o `noCarrierRef`; ages from `uploaded` history | mobile cards vs desk table, filters, search by sticker, Scan-mode entry |
| `/warehouse/scan` | a: 200 → `status='scanned'`, `carrier_sticker_ref='7700001'`, `inventory_log(scanned,-1,balance 11, actor=agent, note has sticker)`, `order_history(uploaded→scanned, actor_type='agent')`; sandbox bind `sbx-a SHTEST0001→7700001` with all three headers. e: GET then PATCH; **`carrier_extra.darb_assabil_id` expected present — will be absent (RLS bug)**. f: `colourUnknown` shown, scan ok. Roll label = precheck `required_color` | no-hand state, camera-first layout, mono LTR input inside RTL, result tile tones, recent list |
| Scan error paths | duplicate `7700001` on b → 409 `STICKER_ALREADY_USED`, **no PATCH**; refuse → 502 `refused_darb`, c untouched; down → 502; slow → ~15 s then 502, sandbox bound anyway, re-scan in `ok` → 200 (idempotent); g → 409 `STOCK_UNDERFLOW` + `darb_bound:true` amber; o → 409 `DARB_SHIPMENT_UNKNOWN`; API: h 409 `CARRIER_WAREHOUSE_ORDER`, l 409 `INVALID_STATUS`, n 409 `MARKET_MISMATCH`, missing order_id 400, k **accepted by server** (finding) | is the 15 s hang communicated? does the UI drop Darb's own message (`ScanStation.tsx:158`)? |
| `/warehouse/returns` | `9900101` → m1 not n; `990103` → m3; `7700888` → m4 (tracking-only, the real Darb shape); `7700001` → `wrong_status`; `ffffff` → `ambiguous`; m1 restock → A+1, `reason='returned'`, `terminal_at` set; m2 damage other+note → `damaged_return_count`+1, `damaged_writeoff` row with reason/note, stock unchanged; m3 redeliver → `received`, `received_back`, A+1; m4 restock; API `scan-return` on n → market error; `returns_inbox` → 0. **Then p**: run `promote_darb_status` as the sync would, show it lands terminal today (inbox unchanged, lookup says `wrong_status`), apply Fix §0, re-run on a fresh copy → lands in the inbox → scan `7700777` → restock | 3-decision cards on phone, reason sheet, validate gating, what the agent sees for a parcel the OMS already closed |
| `/warehouse/stock` + count | A/B rows with `engaged`/`free`; count = current → `stock_count` delta-0 row + `last_counted_at`; count 5 → `change=-1`; empty note blocks | search, low/negative pills, dialog on phone |
| `/warehouse/history` | one row per scan/return/count with actor + `balance_after` matching `inventory_log`; CSV export | filters, Tripoli timezone |
| `/warehouse/settings` | renders for agent; sign-out works | — |
| `/fr/…` desk (admin, scope ly) | same counts in manager shell; "Rouleau Rouge" | LTR |

### 4. Fixes already identified (TDD each; more will come from the audit)

0. **Darb returns must land in the warehouse inbox** (the user's explicit ask). Migration replacing `promote_darb_status`: slugs `returning` and `returned` promote `uploaded → to_be_returned` (non-terminal, `actor_type='system'`, note keeps the Darb slug); `completed → delivered` and `cancelled → cancelled` unchanged; an order already `to_be_returned` only gets its slug refreshed. `returned` (terminal, +stock) is then set **only** by `scan_return_in` / damaged / `scan_received_in` at the bench, which is the existing three-decision console. Also confirm `transition_order_status` allows `uploaded → to_be_returned` for Darb. Tests: pgTAP-style SQL check in `supabase/tests/` + a unit test on the sync's expectation in `src/lib/carriers/darb-sync-cycle` (it treats `promoted:true` generically). Historical 103 orders: **not** rewritten by default (terminal rows feed investor facts); a one-off report lists them so the user can decide (option in the questions).
1. **RLS: warehouse_agent cannot persist `carrier_extra`** — `scan-out/route.ts:187`. Recommended: SECURITY DEFINER RPC `cache_darb_shipment_ref(p_order_id, p_actor_id, p_darb_id, p_branch_group)` with the same actor/market guard as `precheck_scan_out` (new migration), called via `supabase.rpc`; failing test first in `src/app/api/warehouse/scan-out/route.test.ts` (today's assertion at 313-325 only checks `update` was *called*). Alternative if a migration is not wanted: admin client for that one write, guarded by the session read that already passed.
2. **Server accepts scanning a `released` parcel** — only the UI disables Take. Add the `carrier_status_slug` guard to `precheck_scan_out` (migration) + route test.
3. **`goal_daily_scanned` missing for LY** → hardcoded 40. Add the setting row + verify Settings UI field.
4. **Low-stock `<` vs `<=`** inconsistency between summary RPC and Stock page.
5. **Non-numeric scan payload guard** — the Darb QR is the bare number, so a payload with anything but digits is a mis-scan (wrong code on the parcel, a URL, a Tunisian label). Add `isDarbStickerPayload()` in `src/lib/preparation/` (tested) and refuse it in `ScanStation` for LY before any network call, with its own message (fr + ar).
6. **UI swallows Darb's own refusal message** (`errorLabel` wins over `body.message`) — show both.
7. **No-hand camera scan on phone says "Commande introuvable"** instead of "take a parcel first" — wrong diagnosis for the operator.
8. `classifyRpcError` maps "Actor role … cannot scan out" to `ORDER_NOT_FOUND` 422; stale `"not in confirmed"` check.

### Files

- New: `scripts/darb-sandbox.mjs`, `scripts/wh-test-scenarios.mjs`, `scripts/wh-test-fixture.ts`, `.gitignore` (+ `scripts/.wh-test-state.json`), `plans/warehouse-ly-e2e-test-fixture.md`, `docs/warehouse-e2e-fixture.md` (how to rerun/teardown).
- Likely touched by fixes: `src/app/api/warehouse/scan-out/route.ts` (+ test), `src/components/warehouse/console/ScanStation.tsx` (+ tests), `src/lib/preparation/*`, `supabase/migrations/2026090xxxxxxx_*.sql` (RLS/RPC), `src/messages/fr.json` + `ar.json` (keep the 572-key parity), possibly `src/lib/warehouse/summary.ts` / stock route.

## Verification

1. `seed --apply` then `status`: 16 orders, 3 products, 1 carrier, trails present, real-row diff = 0.
2. Sandbox self-check: `curl -H 'Authorization: apikey sandbox' -H 'X-API-VERSION: 1.0.0' -H 'X-ACCOUNT-ID: sandbox' 'http://127.0.0.1:4545/api/local/shipments?reference=SHTEST0001'`.
3. Run the protocol table top to bottom, screenshotting each screen (Arabic + French) into the scratchpad; after each mutating step run `status` and a targeted SQL check.
4. For each fix: failing test → fix → `npm run test:run`, `npm run typecheck`, `npm run lint`; re-run the affected scenario through the browser.
5. `teardown` (dry-run → MCP inventory_log transaction → `--apply`) then `status`: zero tagged rows, real-row diff still 0, sandbox carrier gone, adel's operator stats back to pre-test values.
6. Deliver a findings report (bugs fixed, findings left open with reasons, screenshots) plus `report/ly-returns-without-stock-credit.csv`.

## Decisions (answered by the user)

- **Login: `adel@oms.local` / `adel`** (real, active LY warehouse agent). No user rows are touched by seed or teardown. Test scans will appear in adel's operator stats and the journal only while the fixture exists: those figures are computed from `order_history` / `inventory_log`, which teardown removes, so they revert with it. The `session` subcommand stays as a fallback only.
- **Darb QR = the bare sticker number.** No normaliser; fix 5 shrinks to a guard in the scan submit that refuses a non-numeric payload with a clear message instead of binding it (tested).
- **Migrations: write to `supabase/migrations/` and apply to production via the Supabase MCP** in the same run, then verify end-to-end.
- **Returns fix is forward-only.** `promote_darb_status` routes `returning`/`returned` to `to_be_returned` for new syncs; the 103 historical LY orders are **not** rewritten. Deliverable: `report/ly-returns-without-stock-credit.csv` (order id, external id, customer, product, quantity, returned date, tracking) for a manual stock decision.
- Timing: the fixture is seeded immediately on approval and torn down at the end of the run; adel and tarek may see `[TEST]` rows in their live queue during that window.

## Outcome (run of 2026-09-06, as adel@oms.local on a 390×844 viewport, Arabic)

Fixture seeded, every scenario exercised, fixture removed; `status` showed
zero tagged rows and no change on any real product. Screenshots in the
session scratchpad (`shots/01…09`).

### Data accuracy — verified exact
Every scan, return decision and count reconciled between screen, `orders`,
`inventory_log`, `order_history` and the sandbox's bind log (sticker,
actor, balance, history actor type). Queue stats matched the DB to the unit
on every screen. Market isolation held (the Tunisian twin of sticker 9900101
was never returned to the Libyan agent; a Tunisian order scanned through the
API answered `MARKET_MISMATCH`). Returns lookup resolved by sticker, by
zero-padded tracking and by plain-digit tracking (the real Darb shape), and
answered `wrong_status` / `ambiguous` / `not_found` correctly.

### Fixed in this run (all TDD, migrations applied to production)
1. **Darb returns never reached the warehouse** — `promote_darb_status` closed
   them as terminal `returned` with no stock; now `returning`/`returned` →
   `to_be_returned`, finalised by the bench scan. Also promotes from `scanned`
   (needed now that the OMS scans out). Migration `…000003`.
2. **warehouse_agent could not read the ledgers** — Journal empty, "never
   counted" beside an 87.5 % accuracy, activity zero. RLS SELECT on
   `inventory_log` and `order_history` for own market. Migration `…000002`.
3. **Darb id write-back was a silent no-op for agents** (orders UPDATE policy)
   — new `cache_darb_shipment_ref` RPC. Migration `…000004`.
4. **Server scanned out a parcel already released by the carrier** and
   **bound a URL as a sticker** — `GONE_AT_CARRIER` and `STICKER_NOT_NUMERIC`
   in `precheck_scan_out` / `scan_order_out`, plus a local digits-only guard
   in `ScanStation`. Migration `…000004`.
5. **Stock "engaged" double-counted scanned units** (held 7, engaged 11,
   free −4) — engaged is now `confirmed / dispatch_scheduled / uploaded`.
6. **Low stock `<` vs `<=`** — RPC now inclusive. Migration `…000005`.
7. **Scan tile "from" figure was the row's cached stock** ("10 → 8") — now
   derived from the server's `stock_after`.
8. **Returns on the phone had no scan field** until a card was tapped, and
   the loading state printed "queue empty / 0,00 TND" — scan field always
   on top, honest skeleton, no currency before data.
9. **French inside the Arabic shell**: roll colours and zone names (the one
   control the routing rests on), age labels "j/h", "Libye", "Échap",
   "Entrepôt" aria-label, "S-4" week labels, "u" unit, "il y a N j".
10. Darb's own refusal wording now shown beside ours; no-hand camera scan says
    "take a parcel first" instead of "order not found"; in-flight "Liaison
    chez Darb…" during the up-to-15 s bind; `FORBIDDEN` mapped to 403.
11. `/manifest.webmanifest` was redirected to `/login` by the middleware (PWA
    install broken) — added to the static-asset bypass.

### Left open (with reasons)
- **103 historical Libyan returns (105 units) closed without stock credit** —
  `report/ly-returns-without-stock-credit.csv`; manual decision (terminal
  rows feed investor facts).
- **`goal_daily_scanned` is not set for Libya** — dashboard/prep use the
  hardcoded default 40; no Settings field exposes it.
- **Timezone split**: warehouse stats use Africa/Tripoli, Libya
  `shift_config` says Africa/Tunis — one-hour disagreement on "today".
- **`avg_cycle_seconds` is label-print based** — always 0 for Libya (no
  labels are printed); the "processing time" figure is meaningless there.
- **Prep queue cache** (`stale-while-revalidate=30`) keeps row stock a scan
  or two behind; harmless now that the tile uses the server figure.
- History/ledger notes are written in French by the RPCs regardless of market.
- `npm run lint` cannot run (no ESLint config or package); 24 test failures in
  14 files pre-exist on `main` (verified in a HEAD worktree).
- Settings "Market: Libya" shows the DB market name, not a translation.
