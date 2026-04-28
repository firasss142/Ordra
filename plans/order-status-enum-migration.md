# Order Status Enum Migration

## Context

The Converty historical-import audit ([plans/ok-now-go-on-cached-dolphin.md is in `~/.claude/plans/`]) revealed the OMS `order_status` enum doesn't model what real carriers (and Converty) emit. We're locking in five enum changes as a prerequisite to that import:

| Change | Old | New | Semantic |
|---|---|---|---|
| Rename | `cancelled` | `deleted` | Manual removal by super_admin/manager |
| Rename | `new` | `pending` | Industry-standard wording, matches carrier APIs |
| Add | — | `cancelled` (NEW meaning) | Carrier-emitted cancellation |
| Add | — | `unverified` | Carrier-emitted: delivery problem, agent-visible. Auto-clears on next carrier event. |
| Add | — | `received` | Warehouse scans back a failed-delivery package. Stock +1. Re-deliverable (NOT terminal). |

The current value `confirmed` keeps its meaning ("agent confirmed AND carrier-ready"); Converty's pre-upload `confirmed` will map to `dispatch_scheduled` instead.

## Sequencing — five micro-phases, each independently testable

Each phase ends with `npm run typecheck && npm test` green before the next starts. Commit after each.

### Phase 1 — DB migration (no app-code changes yet)

Postgres can't drop or rename ENUM values in place — you must add new values, UPDATE rows, then drop the old type via swap.

New file: `supabase/migrations/20260428_status_enum_overhaul.sql`

Steps inside the migration:

1. Create a new enum type `order_status_v2` with the full target value set:
   ```
   pending, assigned, attempt_1, attempt_2, attempt_3, callback_scheduled,
   confirmed, dispatch_scheduled, dispatching, scanned,
   dispatched, deposit, in_transit, unverified, to_be_returned, received,
   delivered, returned, rejected, cancelled, deleted
   ```

2. ALTER `orders.status` and `order_history.status_from`/`status_to` to the new type with a CASE remap:
   - `'new'` → `'pending'`
   - `'cancelled'` → `'deleted'`
   - All others → identical name

3. DROP the old `order_status` type, rename `order_status_v2` → `order_status`.

4. Re-create every RPC that took/returned `order_status` (Postgres invalidates them on type swap). RPCs to recreate (full list verified by `grep`):
   - `transition_order_status` — see [005_carrier_dispatch.sql](supabase/migrations/005_carrier_dispatch.sql), [018_add_to_be_returned_status.sql](supabase/migrations/018_add_to_be_returned_status.sql), [20260418_attempts_count_and_retry_times.sql](supabase/migrations/20260418_attempts_count_and_retry_times.sql)
   - `set_order_status` (likely in [005_carrier_dispatch.sql](supabase/migrations/005_carrier_dispatch.sql))
   - `record_no_response` — [015_session9_no_response_rpc.sql](supabase/migrations/015_session9_no_response_rpc.sql)
   - `bulk_cancel_orders` — [028_bulk_cancel_orders_rpc.sql](supabase/migrations/028_bulk_cancel_orders_rpc.sql) (still uses `'cancelled'` literal — keep it but the literal now means carrier-cancelled; actual manual cancel must use `'deleted'`)
   - `apply_fulfillment_transition` — [010_fulfillment_transition.sql](supabase/migrations/010_fulfillment_transition.sql), [20260424_returns_reason_and_photo.sql](supabase/migrations/20260424_returns_reason_and_photo.sql)
   - Any RPC in [021_translate_assignment_notes_fr.sql](supabase/migrations/021_translate_assignment_notes_fr.sql) referencing `order_status`

5. Within each recreated RPC: replace `'new'::order_status` → `'pending'::order_status`, replace any `'cancelled'::order_status` that meant manual-removal with `'deleted'::order_status`.

6. Update transition rules for the new statuses (also mirrored in TS — see Phase 2):
   - `dispatched`, `deposit`, `in_transit` → can transition to `unverified`
   - `unverified` → `dispatched`, `deposit`, `in_transit`, `to_be_returned`, `delivered`, `cancelled` (auto-clears on any carrier event)
   - `dispatched`, `deposit`, `in_transit`, `to_be_returned` → can transition to `cancelled` (carrier-cancelled, terminal)
   - `to_be_returned` → `received` (in addition to `returned`)
   - `received` → `scanned` (re-deliverable) OR terminal-ish; for now, leave it as a non-terminal endpoint with no outgoing transitions until warehouse re-dispatch flow is designed

7. Add migration RAISE NOTICE summarising remap counts.

**Manual sanity SQL after run:**
```sql
SELECT status, count(*) FROM orders GROUP BY 1 ORDER BY 2 DESC;
SELECT status_from, status_to, count(*) FROM order_history GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20;
```
Verify: zero rows have `'new'` or old-meaning `'cancelled'`.

### Phase 2 — TypeScript types and transitions

Files to edit:

- [src/types/order-status.ts](src/types/order-status.ts) — add to `ORDER_STATUSES` array: `'pending'` (replace `'new'`), `'unverified'` (after `in_transit`), `'received'` (after `to_be_returned`), `'deleted'` (replace `'cancelled'`'s old meaning, and add a NEW `'cancelled'` for carrier-cancelled). Update `TERMINAL_STATUSES` to `['delivered', 'returned', 'rejected', 'deleted', 'cancelled']`. Update `TRANSITIONS` map per Phase 1 step 6.
- Add helper `isAutoCleared(status: OrderStatus)` returning true only for `'unverified'` (consumed by carrier polling).

Tests to add **first** (TDD per CLAUDE.md):
- `src/types/__tests__/order-status.test.ts` — assertions on `canTransition` for every new edge: `unverified`→all carrier outcomes; `to_be_returned`→`received`; `received` is not terminal but has no outgoing transitions yet; `cancelled` is terminal; `deleted` is terminal.

### Phase 3 — i18n + UI status badges

- [src/messages/fr.json](src/messages/fr.json) and [src/messages/ar.json](src/messages/ar.json) — under `statuses.*`:
  - Rename key `new` → `pending` (FR: "En attente", AR: "قيد الانتظار")
  - Rename key `cancelled` → `deleted` (FR: "Supprimé", AR: "محذوف")
  - Add new key `cancelled` (carrier-cancelled): FR: "Annulé (transporteur)", AR: "ألغته شركة التوصيل"
  - Add `unverified`: FR: "À vérifier", AR: "بحاجة للتحقق"
  - Add `received`: FR: "Reçu en retour", AR: "تم استلامه"
- Status-color map (search `STATUS_COLORS` or similar in `src/components/`):
  - `pending`: same color as old `new` (gray/neutral)
  - `deleted`: same as old `cancelled` (red/neutral-strikethrough)
  - `cancelled` (new): warning-orange
  - `unverified`: yellow/warning
  - `received`: blue/info

Tests:
- Snapshot or unit test on the status-badge component for all five new/changed statuses.

### Phase 4 — Refactor 41 TS/TSX files

The `grep` showed 41 files reference `'new'` or `'cancelled'` literally. Process per file:

1. Replace `'new'` → `'pending'` where it's a status literal (NOT where it's an English word like `newOrder`, `newCustomer`, etc. — must inspect each).
2. Replace `'cancelled'` (manual-cancel meaning) → `'deleted'`. Crucially: in places that handle *carrier-cancelled* events (currently nowhere), keep `'cancelled'` — but those don't exist yet, so this is just a global rename for now.
3. Re-run `npm run typecheck` after every batch of ~5 files.

High-impact files to do FIRST (most test coverage):
- [src/app/api/orders/[id]/cancel/route.ts](src/app/api/orders/[id]/cancel/route.ts) — manual cancel must now write `'deleted'`
- [src/app/api/orders/bulk-cancel/route.ts](src/app/api/orders/bulk-cancel/route.ts) — same
- [src/app/api/orders/route.ts](src/app/api/orders/route.ts) — initial status `'new'` → `'pending'`
- Webhook intake: [src/lib/orders/webhook-handler.ts](src/lib/orders/webhook-handler.ts) — line that hardcodes `status: 'new'`
- All test files — keep test assertions in lockstep with renames

### Phase 5 — Behavior wiring for `unverified` and `received`

#### Unverified auto-clear

In [src/lib/carriers/polling/poller.ts](src/lib/carriers/polling/poller.ts):
- Add `'unverified'` to `OPEN_STATUSES` array (line 12) so the poller continues to watch unverified orders.
- In the carrier-status → OMS-status mapper (find with `grep -rn "carrierStatus" src/lib/carriers/`), add: when an unverified OMS order receives any non-unverified carrier event, the new status replaces unverified directly. (No special "auto-clear" handler needed — the poller already overwrites status; just don't filter unverified out of polling.)

#### Received status

- Add new RPC `scan_received_in(p_order_id, p_actor_id)` (mirrors `scan_return_in` but transitions to `'received'` and writes inventory_log with `reason='received_back'`). Add `'received_back'` to inventory_log reason check constraint if it's enforced.
- Update warehouse UI's return-scanning page to offer a "Mark as received (re-deliverable)" button alongside the existing return button.

Tests:
- RPC test: scanning an order in `to_be_returned` via `scan_received_in` → status becomes `'received'`, products.current_stock += 1, inventory_log row written with reason `'received_back'`.

## Net data effect (post-migration)

Orders table (counts based on current OMS data, not Converty):
- All `'new'` rows → `'pending'`
- All old `'cancelled'` rows → `'deleted'`
- Zero rows with new statuses (`unverified`/`received`/new-`cancelled`) until carrier events or imports populate them.

## Critical files to modify (consolidated)

- `supabase/migrations/20260428_status_enum_overhaul.sql` (NEW)
- [src/types/order-status.ts](src/types/order-status.ts)
- [src/types/__tests__/order-status.test.ts](src/types/__tests__/order-status.test.ts)
- [src/messages/fr.json](src/messages/fr.json), [src/messages/ar.json](src/messages/ar.json)
- [src/lib/orders/webhook-handler.ts](src/lib/orders/webhook-handler.ts)
- [src/lib/carriers/polling/poller.ts](src/lib/carriers/polling/poller.ts) + carrier status mappers
- 41 TS/TSX files with literal `'new'` / `'cancelled'` (full list via `grep -rln "['\"]new['\"]" src/ --include="*.ts" --include="*.tsx"` and same for cancelled — must inspect each match to avoid false positives like `newOrder`)

## Verification

1. `npm run typecheck` — must pass after each phase.
2. `npm test` — full suite green; new tests for transitions and `received` RPC.
3. `npm run build` — production build succeeds.
4. Manual smoke: log in as super_admin, manually delete an order → status shows "Supprimé"; confirm an order through dispatch → status shows "Confirmé"; trigger a carrier 502/unverified event (or insert manually) → status shows "À vérifier" in agent queue.
5. SQL sanity check: `SELECT status, count(*) FROM orders GROUP BY 1` — zero `'new'`, zero old `'cancelled'`.

## Risks

- **Type-swap breaks any view, materialized view, or trigger that references `order_status`.** Recreate all of them in the same migration. Check: `SELECT * FROM information_schema.columns WHERE udt_name = 'order_status'` before running.
- **41-file TS refactor** — easy to miss false-positive `'new'` matches (e.g., `Set` constructor args, English UI text). Use code review on the diff.
- **Tests reference status literals** — many test fixtures hardcode `'new'` and will break until updated. Plan for ~30 min of test churn.
- **Live data**: if running on a hot DB, the type swap requires `ACCESS EXCLUSIVE` lock on `orders` and `order_history` — schedule for low-traffic window.
