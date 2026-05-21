# Plan: Duplicate dialog — protect committed orders + show icon only on the newest

## Context

Two follow-up fixes to the duplicate-order dialog shipped on `feat/duplicate-order-dialog-delete`:

1. **Committed orders must not be removable from the dialog.** Today the dialog's per-sibling delete
   uses `canManuallyDeleteOrderStatus`, which still includes `uploaded` and `scanned`. Deleting an
   `uploaded`/`scanned` sibling routes through `manual_delete_orders`, which **voids the carrier and
   removes the order**. The user does not want the duplicate dialog to remove an order that has been
   committed to the carrier (`uploaded`) or scanned out of stock (`scanned`). Barcode deletion already
   exists as the correct, reversible action for `uploaded` orders (the `carrier-delete` route pulls it
   back to `confirmed`) and lives in the upload flow — it stays there. **Decision: the dialog simply
   shows NO action for `uploaded`/`scanned` siblings** (info only). The server must also refuse these,
   for defense in depth.

2. **The icon should appear on ONE order per duplicate group, not all of them.** Today every member of a
   duplicate cluster shows the marker. **Decision: show it only on the NEWEST order** (latest
   `created_at`) in the group — the likely accidental re-order — and hide it on the older originals.
   Computed server-side so the 3 render sites share one source of truth.

Outcome: agents/managers can only clean up *pre-commitment* duplicates from the dialog; committed orders
are visible but untouchable there; and the marker sits on the single newest order, whose dialog lists the
older siblings (including any already shipped).

## Decisions (locked)
- Uploaded/scanned siblings in the dialog → **no action button**, just listed.
- Block **both** `uploaded` and `scanned` from dialog deletion.
- Icon shows on the **newest by `created_at`**; hide if any sibling is strictly newer; on exact tie, show
  (rare). Computed **server-side** in `detect.ts`.

## Step 1 — Dialog-specific deletable-status helper (`src/lib/order-permissions.ts`)

`MANUAL_DELETE_ORDER_STATUSES` stays as-is (the manager's general cancel legitimately deletes uploaded/
scanned). Add a NARROWER set for the duplicate dialog:

```ts
/** Statuses the duplicate DIALOG may remove — excludes carrier-committed (uploaded)
 *  and stock-deducted (scanned) orders, which must never be order-deleted from the
 *  dialog. Barcode deletion (carrier-delete route) is the action for uploaded orders. */
export const DUPLICATE_DIALOG_DELETE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "pending", "assigned", "attempt_1", "attempt_2", "attempt_3",
  "callback_scheduled", "confirmed", "dispatch_scheduled",
]);

export function canDeleteDuplicateSiblingStatus(status: string): status is OrderStatus {
  return DUPLICATE_DIALOG_DELETE_STATUSES.has(status as OrderStatus);
}
```

Add unit tests in `src/lib/order-permissions.test.ts`: allows pending/confirmed/dispatch_scheduled;
**rejects uploaded, scanned**, plus dispatched/delivered/deleted.

## Step 2 — Server gate uses the narrower set (`src/lib/orders/duplicate-delete.ts`)

Line 132–148 currently checks `canManuallyDeleteOrderStatus(target.status)`. Swap to
`canDeleteDuplicateSiblingStatus(target.status)` and keep the existing 400 `status_not_deletable` error.
Now an `uploaded`/`scanned` sibling is refused even if a crafted request reaches the route.

Update `src/lib/orders/duplicate-delete.test.ts`: the existing "non-deletable status" test uses
`dispatched`; add a case asserting **`uploaded` → 400 `status_not_deletable`** and the `deleteOrders`
spy is NOT called.

## Step 3 — Hide the dialog delete button for uploaded/scanned (`src/components/shared/DuplicateOrderBadge.tsx`)

Line ~142: change
```ts
const deletable = canDelete && canManuallyDeleteOrderStatus(s.status);
```
to
```ts
const deletable = canDelete && canDeleteDuplicateSiblingStatus(s.status);
```
(swap the import). Uploaded/scanned siblings now render with no Delete button — consistent with the
"show nothing" decision. The "already shipped" critical chip already communicates why.

Update `DuplicateOrderBadge.test.tsx`: the existing "hides delete button for a non-deletable status" test
uses `dispatched`; add an explicit case for `status: "uploaded"` → no `Supprimer` button (and keep one
asserting `confirmed`/`pending` still shows it).

## Step 4 — "Newest in group" flag, server-side (`src/lib/duplicate-orders/detect.ts`)

Add `is_duplicate_anchor: boolean` to `DuplicateEnrichment`. The row is the anchor (carries the icon) iff
it is potentially-duplicate AND no sibling is strictly newer than it.

`deriveDuplicateEnrichment` currently takes only `siblings`; it has no access to the row's own
`created_at`. Change its signature to `deriveDuplicateEnrichment(siblings, ownCreatedAt?)` and compute:

```ts
const ownTime = ownCreatedAt ? Date.parse(ownCreatedAt) : NaN;
const hasNewerSibling = siblings.some((s) => {
  const st = Date.parse(s.created_at);
  return Number.isFinite(st) && Number.isFinite(ownTime) && st > ownTime;
});
is_duplicate_anchor: !hasNewerSibling, // newest (or tie) → anchor
```
`EMPTY` gets `is_duplicate_anchor: false`. In `enrichRowsWithDuplicates`, pass `r.created_at` when calling
`deriveDuplicateEnrichment` (the enrichable row already has `created_at`). No SQL/RPC change needed — the
sibling list already carries each sibling's `created_at`, so the comparison is done in TS.

Update `detect.test.ts`: add cases — single duplicate where own is newer → `is_duplicate_anchor true`;
own older than a sibling → `false`; no siblings → `false`; exact tie → `true`.

## Step 5 — Render the icon only on the anchor (3 sites + types)

Add `is_duplicate_anchor?: boolean` to the row types: `src/types/queue.ts` (QueueOrder) and
`src/hooks/useOrdersList.ts` (OrdersListRow). The API routes already spread the full enrichment, so the
new field flows through automatically (verify the three enrich call sites in
`api/agent/queue/route.ts`, `api/orders/list/route.ts`, `api/orders/[id]/route.ts` spread `...dup`).

Change the render condition at each site from `order.is_potential_duplicate &&` to
`order.is_potential_duplicate && order.is_duplicate_anchor &&`:
- `src/components/queue/OrderCard.tsx` (~line 339)
- `src/components/orders/OrderRow.tsx` (~line 233)
- `src/components/orders/OrderDetail.tsx` (~line 140)

Single-order detail (`api/orders/[id]`): a lone order enriched by itself has no siblings → not a
duplicate → no icon, which is correct. When opened from a list it still carries the flag from the batch.

## Step 6 — Verification

- `npm run typecheck` (expect clean).
- `npx vitest run` on the touched files:
  `src/lib/order-permissions.test.ts src/lib/orders/duplicate-delete.test.ts
   src/lib/duplicate-orders/detect.test.ts src/components/shared/DuplicateOrderBadge.test.tsx`
  — all green (TDD: add the new assertions first, watch fail, implement).
- `npm run build` — confirm compiles.
- (Pre-existing: 29 unrelated suite failures + `next lint` interactive prompt — do not touch.)
- Manual (optional, `npm run dev`): with two pending duplicate orders, only the **newer** shows the icon;
  its dialog lists the older one with a Delete button. Make one sibling `uploaded` → it appears in the
  dialog with the "Déjà envoyé" chip and **no** Delete button; the API refuses a crafted delete of it
  with 400.

## Critical files
- `src/lib/order-permissions.ts` (+ `.test.ts`) — new `DUPLICATE_DIALOG_DELETE_STATUSES` / `canDeleteDuplicateSiblingStatus`
- `src/lib/orders/duplicate-delete.ts` (+ `.test.ts`) — swap status check
- `src/lib/duplicate-orders/detect.ts` (+ `.test.ts`) — `is_duplicate_anchor`
- `src/components/shared/DuplicateOrderBadge.tsx` (+ `.test.tsx`) — dialog delete-button gate
- `src/components/queue/OrderCard.tsx`, `src/components/orders/OrderRow.tsx`, `src/components/orders/OrderDetail.tsx` — render condition
- `src/types/queue.ts`, `src/hooks/useOrdersList.ts` — add `is_duplicate_anchor`
