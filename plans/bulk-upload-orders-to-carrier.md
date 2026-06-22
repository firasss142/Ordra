# Bulk upload selected orders to a carrier/account (Phase 1)

> On implementation, copy this plan to the project at
> `plans/bulk-upload-orders-to-carrier.md` (per the user's plan-storage convention).

## Context

The manager/super_admin **orders dashboard** has a bulk action bar
([OrdersBulkBar.tsx](src/components/orders/OrdersBulkBar.tsx)) that appears on multi-select
and currently offers **assign-to-agent** and **cancel**. The user wants to add a
**bulk "upload to a delivery company/account"** action — a simplified batch panel that
ships many confirmed orders to one chosen carrier/account (now including the newly-added
second Darb Assabil account).

**Why this is harder than assign-to-agent:** assigning takes one value (the agent) and
applies it to all orders. Uploading needs a **per-order destination**, and the carrier
adapters enforce it:
- Darb throws `"zone (area) manquante"` without `extra.customer_area`, and
  `"aucun forfait de service (service_id)"` without a service id
  ([darb-assabil-adapter.ts:55-89](src/lib/carriers/darb-assabil-adapter.ts#L55-L89)).
  Both Darb accounts have an **empty `default_service_id`** (verified in Settings), so a
  service id must be supplied per dispatch.
- Dexpress needs a per-order `state_id` (`orders.dexpress_state_id`).

So a single shared payload can't drive a heterogeneous selection. An existing
`POST /api/orders/bulk-dispatch` ([route.ts](src/app/api/orders/bulk-dispatch/route.ts))
exists but is **unused by any UI** and, as written (one shared `extra` for all orders),
would mis-ship or fail every Darb order.

**Decisions (confirmed with the user):**
- **Scope:** Phase 1 = **bulk upload of `confirmed` orders only**. Bulk reopen and bulk
  move-to-another-carrier/account are **deferred** (the move, when built, is
  account-switch within the same carrier).
- **Who/where:** **managers/super_admin only**, on the orders-dashboard bulk bar (matches
  the existing assign-to-agent + the bulk-dispatch endpoint's agent-403).
- **Unresolvable destinations:** **skip-and-report** — auto-upload only orders that resolve
  cleanly; list the rest as "needs manual dispatch" for the one-by-one modal.

## Approach

Rewrite the unused `bulk-dispatch` endpoint to resolve **each order's destination
server-side** (reusing the cron's proven resolver) with a **dry-run preview** + **skip
buckets**, and drive it from a new **"Upload to carrier"** button → batch panel.

### Reuse (do not reinvent)
- **Server-side destination resolver — copy the cron's exact pattern**
  ([cron/dispatch-scheduled/route.ts:51-116](src/app/api/cron/dispatch-scheduled/route.ts#L51-L116)):
  reads `orders.darb_destination_id` → `darb_destinations(city, area)` → `extra =
  { city, customer_area }`; `orders.dexpress_state_id` → `extra = { state_id }`; treats a
  missing destination as a skip. This is authoritative (it's what the picker persisted) and
  resolves multi-area cities whose area was already chosen.
- **Fallback resolver** `resolveDarbAny(customer_city)`
  ([darb-assabil-areas.ts](src/lib/carriers/darb-assabil-areas.ts)) only when
  `darb_destination_id` is null — skip if it returns `null` or `area === null` (multi-area).
- **Per-order dispatch primitive** `performDispatch({ orderId, carrierId, actorId, extra })`
  ([perform-dispatch.ts](src/lib/carriers/perform-dispatch.ts)) — already enforces
  `carrier.market_id === order.market_id` + `is_active`.
- **Coverage** `coverageFor(customer_city, dexpress_state_id)`
  ([coverage.ts](src/lib/carriers/coverage.ts)) — defense-in-depth skip for `uncovered`
  (treat `unknown` as eligible).
- **Default Darb service** — fetch the `is_default` row from `darb_services` once per batch
  (same source the modal uses) and inject `extra.service_id`.
- **Duplicate guard** `enrichRowsWithDuplicates` (the array-accepting fn the single
  dispatch route uses) for the batch-level confirm.
- **Carriers list** `useCarriers(marketId)` ([useCarriers.ts](src/hooks/useCarriers.ts)) —
  already returns both Darb accounts.

## Implementation (TDD — failing test first per step)

### 1. Preflight helper — `src/lib/carriers/bulk-dispatch-preflight.ts` (new)
Pure, unit-testable `resolveOrderDispatch(admin, order, carrier, defaultDarbServiceId)`
→ `{ eligible: true, extra } | { eligible: false, reason }`. `reason` is a string union:
`wrong_status | wrong_market | carrier_inactive | no_destination | no_state | no_service |
missing_address | not_covered | order_not_found | unknown_carrier`.
Gate precedence: status (`confirmed`|`dispatch_scheduled`) → market → destination/coverage.
Build `extra` per carrier code (Darb: `{ city, customer_area, service_id }`; Dexpress:
`{ state_id }`; Navex: none).

### 2. Rewrite `src/app/api/orders/bulk-dispatch/route.ts`
- Request: `{ order_ids, carrier_id, dry_run?, confirm_duplicates? }`. Keep `MAX_BATCH=200`,
  agent-403, 400s. Drop the old shared `extra` from the contract.
- One batched `orders` fetch (`.in("id", order_ids)`, selecting status/market/customer_city/
  customer_address/`dexpress_state_id`/`darb_destination_id`) + carrier fetch + `darb_services`
  default fetch. Run §1 per order.
- `dry_run:true` → `{ dry_run:true, eligible:[id], skipped:[{order_id,reason}] }` (never calls
  `performDispatch`).
- execute → batch `enrichRowsWithDuplicates` over eligible ids; orders with an uploaded
  sibling go to `needs_confirmation` unless `confirm_duplicates:true`; dispatch the rest via
  `performDispatch`. Return `{ succeeded:[{order_id,tracking_number}],
  failed:[{order_id,error,errorCode?}], skipped:[{order_id,reason}],
  needs_confirmation:[{order_id,duplicate_external_id}] }`. Failed orders stay `confirmed`
  (no rollback — existing `dispatch_order` semantics).

### 3. `src/components/orders/BulkUploadPanel.tsx` (new)
Modal shell mirroring [DarbAssabilDispatchModal.tsx](src/components/queue/DarbAssabilDispatchModal.tsx)
(FocusTrap, Escape, design tokens, **logical `ps/pe` + `start/end` for RTL** per
[components/CLAUDE.md](src/components/CLAUDE.md)). State machine `pick → preview → results`:
- **pick:** carrier/account picker via `useCarriers`.
- **preview:** POST `dry_run:true` → "N ready, M skipped" grouped by reason; primary button
  disabled when `eligible.length === 0`.
- **results:** POST execute → succeeded (tracking) / failed (error) / skipped (reason) /
  `needs_confirmation`; **"Retry failed"** (re-POST execute with failed ids) and **"Upload
  anyway"** (re-POST `confirm_duplicates:true`).

### 4. `src/components/orders/OrdersBulkBar.tsx` + `OrdersPageClient.tsx`
- Add an **"Upload to carrier"** button to the bar gated by `canUpload` (pass
  `canUpload={canAssign}` — already `isSuperAdmin || market_manager`).
- In [OrdersPageClient.tsx](src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx): add
  `uploadOpen` state + handlers next to `handleBulkAssign`/`handleBulkCancel` (POST to
  `/api/orders/bulk-dispatch`; on done `clearSelection()` + `mutate()`); mount
  `<BulkUploadPanel>` with `selectedIds` + `effectiveMarketId`. super_admin "all markets"
  view → gate the picker on a single market (disable with a hint; cross-market bulk is
  deferred). The client sends only ids + carrier id — **the server preflight is the single
  source of truth**, so no new fields on `OrdersListRow`.
- Add `orders.bulk.upload*` keys to `src/messages/fr.json` + `ar.json`.

### TDD order
preflight test → preflight lib → route test (extend
[bulk-dispatch/route.test.ts](src/app/api/orders/bulk-dispatch/route.test.ts)) → route
rewrite → `BulkUploadPanel.test.tsx` → panel → `OrdersBulkBar.test.tsx` (extend) → button →
wire `OrdersPageClient` + i18n. `npm run typecheck` after each file.

## Verification

1. `npm run typecheck` + Vitest suites green (preflight matrix, route dry-run/execute/skip/
   duplicate/coverage, panel pick→preview→results→retry, bar button gating).
2. **Safe end-to-end (no shipments):** dev server + super_admin on the orders dashboard →
   select several **confirmed Libya** orders → "Upload to carrier" → pick **"Darb Assabil —
   Compte 2"** → the **dry-run preview** lists ready vs skipped against real data **without
   creating any shipment**. This exercises the full resolver path safely.
3. **Optional live confirm:** execute on **1–2** orders → verify tracking numbers, then void
   via the existing reopen / carrier-delete (real-shipment caveat — same as the Darb account
   test). The dry-run in step 2 is the primary safe gate; keep any live run tiny.

## Risks / edge cases (handled)

- **super_admin cross-market selection** → per-order `wrong_market` skip (+`performDispatch`
  re-checks); UI gates the picker on one market.
- **Partial failure / no rollback** → four result buckets + "Retry failed"; failed stay
  `confirmed` and re-appear eligible on retry.
- **Multi-area Darb city without a persisted `darb_destination_id`** → `no_destination` skip
  (resolve via the single-order modal). Door left open for a future "bulk pick area".
- **Empty `default_service_id`** → batch sources `service_id` from `darb_services`; if none,
  `no_service` skip (not an opaque adapter throw).
- **Already-uploaded/scanned/terminal orders in the selection** → `wrong_status` skip; never
  re-dispatched (no double-ship).
- **Coverage `unknown` vs `uncovered`** → only `uncovered` skips; `unknown` stays eligible so
  the carrier's own resolution can try (matches `coverage.ts` intent).
- **`darb_destination_id` set but row missing/inactive** → fall back to
  `resolveDarbAny(customer_city)`; only skip if that also fails.
