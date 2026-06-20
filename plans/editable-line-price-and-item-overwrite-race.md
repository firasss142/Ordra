# Editable line-item price + fix "product add/edit gets overwritten" race

## Context

Two user-reported problems in the order detail panel (agent queue + manager views),
both rooted in the same order-items editing machinery:

1. **Cannot change the price.** When a product is added to an order it always takes the
   product's `unit_price`/`default_price`, and there is **no UI to change the line price
   afterward**. In [OrderItemsCard.tsx](../../Documents/CODE/XPAND/Internal-tools/ORDER%20MANAGMENT%20SYSTEM/oms-cloned-/Ordra/src/components/queue/OrderDetailPanel/OrderItemsCard.tsx#L209-L212)
   the unit price is the only line attribute rendered as **static read-only text** —
   quantity (StepperField), product (Combobox), and delivery fee (InlineField) are all
   editable, but price is not. The backend item PATCH route *already* accepts `unit_price`,
   so this is purely a missing front-end control.

2. **Edits/additions sometimes revert ("overwritten sometimes").** Adding a product or
   editing quantity/price occasionally snaps back to the previous value. Confirmed race:
   in-flight local edits are clobbered by a blind full revalidation that fetches stale
   server state, because the item edit path bypasses the edit-lock entirely and the
   realtime items handler ignores the lock.

Intended outcome: line price is inline-editable like quantity, and no item add/edit
ever reverts.

## Root-cause findings (verified by reading code)

- **Backend ready for price edit.** `PATCH /api/orders/[id]/items/[itemId]`
  ([route.ts:100-107,128,142](../../Documents/CODE/XPAND/Internal-tools/ORDER%20MANAGMENT%20SYSTEM/oms-cloned-/Ordra/src/app/api/orders/[id]/items/[itemId]/route.ts))
  accepts `unit_price` (validates `number >= 0`), recomputes `line_total` + order totals. No backend change needed for real items.
- **Race cause A** — [index.tsx:1085-1096](../../Documents/CODE/XPAND/Internal-tools/ORDER%20MANAGMENT%20SYSTEM/oms-cloned-/Ordra/src/components/queue/OrderDetailPanel/index.tsx#L1085-L1096):
  `onPatchItem`/`onDeleteItem` do a **raw fetch + blind `mutate()`**, bypassing
  `useOrderMutation` and the `editLock` registry — no lock, no optimistic merge.
- **Race cause B** — [index.tsx:1105](../../Documents/CODE/XPAND/Internal-tools/ORDER%20MANAGMENT%20SYSTEM/oms-cloned-/Ordra/src/components/queue/OrderDetailPanel/index.tsx#L1105):
  `onAdded={() => mutate()}` fires a **second** revalidation on top of `addItemOptimistic`'s own `revalidate: true`.
- **Race cause C (core)** — [useOrderDetailRealtime.ts:92-141](../../Documents/CODE/XPAND/Internal-tools/ORDER%20MANAGMENT%20SYSTEM/oms-cloned-/Ordra/src/hooks/useOrderDetailRealtime.ts#L92-L141):
  unlike `orderHandler` (guards on `editLock.isLocked("orders", orderId)` at line 75),
  `itemsHandler` does **not** check the lock and always schedules a blind
  `mutate(swrKey)` 500ms after any realtime item event (lines 135-138). That refetch
  reflects stale server state and overwrites in-flight local edits.
- **Legacy synthetic row.** The order detail builds a synthetic `{ id: "legacy", ... }`
  row for webhook single-product orders. The order-level PATCH route does **not** accept
  `unit_price`, and PATCHing item id `"legacy"` would 404. So legacy rows must stay
  price-read-only until materialized (adding/editing materializes them into real
  `order_items` via the POST items route).

## Decisions

- **Anyone with `canEdit`** can edit the line price (per user). Gating = existing
  `canEdit` + `canEditOrder`/`EDIT_BLOCKED_STATUSES` on the route. No new permission.
- Reuse [InlineField](../../Documents/CODE/XPAND/Internal-tools/ORDER%20MANAGMENT%20SYSTEM/oms-cloned-/Ordra/src/components/ui/InlineField.tsx)
  (supports `validate`, `type="number"`, `readOnly`, `displayMode`, click-to-edit,
  commit on blur/Enter) exactly as the delivery-fee field already does.
- Do **not** add a new `unit_price` branch to the order-level route. Legacy rows stay
  read-only on price; they become editable once materialized. Minimal, avoids a divergent
  price-write path. (Future: a legacy order-route `unit_price` handler is a separate task.)

## Change 2 first — fix the overwrite race (foundational)

### 2.1 (TEST) `src/hooks/useOrderMutation.test.tsx`
Add tests for new `patchItemOptimistic(itemId, body)` and `deleteItemOptimistic(itemId)`,
reusing the existing SWRConfig+RealtimeProvider wrapper and `vi.stubGlobal("fetch")` pattern:
- PATCH hits `/api/orders/{id}/items/{itemId}`, method PATCH, JSON body.
- PATCH throws on non-ok (surfaces `err.error`).
- DELETE hits same URL, method DELETE; throws on non-ok.
- (lock contract) order is unlocked after the request resolves.

### 2.2 (IMPL) `src/hooks/useOrderMutation.ts`
Add two methods alongside `commit`/`addItemOptimistic`, mirroring `addItemOptimistic`'s
`lock/unlock("orders", orderId)` + `mutate(key, updater, {optimisticData, rollbackOnError,
revalidate: true, throwOnError})` shape:
- `patchItemOptimistic(itemId, body)`: optimistic shallow-merge `body` into the matching
  `order_items[]` row, recompute that row's `line_total` (`Math.round(q*p*1000)/1000`,
  same as line 75) when `quantity`/`unit_price` present; updater replaces the row with the
  server's returned item. `revalidate: true` backfills server totals.
- `deleteItemOptimistic(itemId)`: optimistic filter-out; updater removes the row (DELETE
  returns 204; parse+throw on non-ok). `revalidate: true`.

### 2.3 (TEST) `src/hooks/useOrderDetailRealtime.test.tsx` (new)
Capture the `useRealtimeSubscribe` callback; with fake timers:
- unlocked INSERT/UPDATE/DELETE still patches cache (regression).
- locked order → fire item event → advance 600ms → blind `mutate(swrKey)` **not** called.
- after `editLock.unlock(...)` → queued revalidation flushes exactly once.

### 2.4 (IMPL) `src/hooks/useOrderDetailRealtime.ts`
In `itemsHandler`: keep the in-place cache patch unconditionally, but guard the **500ms
debounced revalidation** — if `editLock.isLocked("orders", orderId)`, set
`pendingRevalidateRef.current = true` and return (the existing `onUnlock` effect at
lines 182-191 already flushes it once). Add `orderId`, `editLock` to the callback deps.

### 2.5 (IMPL) `src/components/queue/OrderDetailPanel/index.tsx`
- Destructure `patchItemOptimistic`, `deleteItemOptimistic` from `useOrderMutation` (line 446).
- Add `runItemPatch`/`runItemDelete` helpers next to `runCommit` (lines 535-549) that call
  the optimistic methods, set `saveFlash`/`saveError`, and call `mutateProducts()` when
  `product_id` is in the body (parity with `runCommit` line 541).
- `onPatchItem={(itemId, body) => runItemPatch(itemId, body)}`,
  `onDeleteItem={(itemId) => runItemDelete(itemId)}` — drop raw fetch + blind `mutate()`.
- `onAdded={() => {}}` — remove the redundant double-revalidate (line 1105).

### 2.6 (TEST FIXTURE) `src/components/queue/__tests__/OrderDetailPanel.test.tsx`
Update the `useOrderMutation` mock (lines 18-20) to also return
`patchItemOptimistic: vi.fn()`, `deleteItemOptimistic: vi.fn()` so the panel's destructure
doesn't crash the existing tests.

## Change 1 — inline-editable unit_price

### 1.1 (TEST) `src/components/queue/__tests__/OrderItemsCard.test.tsx` (new)
Render `OrderItemsCard` directly (no SWR/realtime deps) with `mockNextIntl`, one real item
(`id: "item-1"`, `unit_price: 50`), `canEdit: true`:
- price renders as editable InlineField; clicking reveals a `number` input.
- committing `75` calls `onPatchItem("item-1", { unit_price: 75 })`.
- `canEdit: false` → price stays read-only.
- legacy item (`id: "legacy"`) → price stays read-only.
- negative price → validation blocks commit (no `onPatchItem` call).

### 1.2 (IMPL) `src/components/queue/OrderDetailPanel/OrderItemsCard.tsx`
Replace the static price span (lines 209-212) with an `InlineField` mirroring the
delivery-fee usage (lines 249-256):
```tsx
<span className="text-[12px] text-ink-muted">×</span>
<InlineField
  value={String(item.unit_price)}
  onCommit={(v) => onPatchItem(item.id, { unit_price: parseFloat(v) || 0 })}
  validate={(v) => (parseFloat(v) >= 0 ? null : "invalid")}
  type="number"
  displayMode
  readOnly={!canEdit || item.id === "legacy"}
  displayClassName="text-[12px] text-ink-secondary tabular-nums"
/>
<span className="text-[12px] text-ink-muted">{displayCurrency}</span>
```
`InlineField` is already imported (line 6). Real items route through
`onPatchItem` → `patchItemOptimistic` (Change 2), so price edits get optimistic
update + lock + single revalidate and never revert.

## Edge cases
- Legacy synthetic row stays price-read-only; materializes on add/quantity/product edit, then becomes editable.
- Product-swap `unit_price` override ([items route:124](../../Documents/CODE/XPAND/Internal-tools/ORDER%20MANAGMENT%20SYSTEM/oms-cloned-/Ordra/src/app/api/orders/[id]/items/[itemId]/route.ts#L124)) unchanged; `revalidate: true` backfills the corrected price.
- Market isolation + `canEditOrder`/`EDIT_BLOCKED_STATUSES` gating untouched.
- Concurrent realtime UPDATE during a local edit: cache still patches in place, but blind revalidate is suppressed while locked and flushed once on unlock — the actual revert bug.

## Critical files
- `src/hooks/useOrderMutation.ts` (+ `.test.tsx`)
- `src/hooks/useOrderDetailRealtime.ts` (+ new `.test.tsx`)
- `src/components/queue/OrderDetailPanel/index.tsx`
- `src/components/queue/OrderDetailPanel/OrderItemsCard.tsx` (+ new `OrderItemsCard.test.tsx`)
- `src/components/queue/__tests__/OrderDetailPanel.test.tsx` (mock fixture update)
- reuse: `src/components/ui/InlineField.tsx`

## Verification
1. `npm test` — new/updated: `useOrderMutation`, `useOrderDetailRealtime`, `OrderItemsCard`, `OrderDetailPanel` (mock), `AddProductPicker` (stays green).
2. `npm run typecheck` — new return type, props, destructure.
3. `npm run lint` — exhaustive-deps on changed `itemsHandler` + new helpers.
4. **Manual E2E** (`npm run dev`, login `tn_agent_1`): expand a multi-item order receipt →
   edit a line price + blur → total updates, no flicker-back. Edit quantity twice rapidly →
   no revert. In a second tab (`tn_manager`) change the price on the same order → agent tab
   reflects it after unlock, not mid-edit. Add a product to a legacy single-product order →
   line materializes, price becomes editable. Open an `uploaded` order → price read-only.
