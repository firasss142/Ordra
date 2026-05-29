# Realtime Instant Sync — Standardize Across All Order Views

## Context

Today the OMS has solid but inconsistent realtime coverage. Some views (agent queue, order detail, follow-ups) patch live; others (orders list with a "N new · reveal" banner, dashboard KPIs on a 5s server cache, in-delivery summary, agent presence, archive) lag behind. The user reports that CRUD on orders — price edits, deletions, line-item changes, status transitions — does not appear instantly across super_admin, manager, warehouse, and agent sessions.

**Goal:** every order CRUD becomes visible across every session within ~250 ms, with one unified realtime model. New rows auto-insert (no banner). Updated rows patch in place. Terminal transitions and deletes vanish from active lists with a brief toast (`Order #1041 was cancelled`). Open edit forms are protected from clobber.

System-actor writes (webhooks, `poll-carriers` cron, `dispatch-scheduled` cron, `performDispatch` RPC) already flow through PostgREST/RPC and broadcast cleanly — confirmed in [src/app/api/webhooks/[storefrontId]/route.ts](src/app/api/webhooks/[storefrontId]/route.ts), [src/app/api/cron/poll-carriers/handler.ts](src/app/api/cron/poll-carriers/handler.ts), [src/lib/carriers/perform-dispatch.ts:160](src/lib/carriers/perform-dispatch.ts#L160), [src/lib/orders/fulfillment.ts:33-37](src/lib/orders/fulfillment.ts#L33-L37). No bypass paths to fix.

---

## Approach: One RealtimeProvider, One Channel Per (Market × Table), Fan-out via Bus

Instead of every hook opening its own channel (current pattern — 9 hooks × multiple channels per page = N websocket subscriptions duplicated per user), introduce a single shared subscription per `(market_id, table)` tuple managed by a context provider. All data hooks subscribe to that bus and decide how to react to each event.

### Why this shape

- **Fewer websocket subscriptions per user** → faster initial connect, lower server load on busy markets.
- **One source of truth** for what's been received → no race between two hooks both patching the same SWR key.
- **Easy to add a kill-switch / debug overlay** in one place (helpful for the user when verifying).
- **Open edit forms register an "editing lock"** by `(table, row_id)`; the bus skips patches for locked rows and queues them for replay on unlock.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ RealtimeProvider (src/components/providers/RealtimeProvider)│
│  - Single supabase.channel per (market_id, table)           │
│  - Maintains EditLockRegistry  Map<`${table}:${rowId}`, ttl>│
│  - Exposes useRealtimeSubscribe(table, filter, handler)     │
│  - Exposes useEditLock(table, rowId) → {lock(), unlock()}   │
│  - Exposes useRealtimeToast() for terminal-status toasts    │
└────────────────────────┬────────────────────────────────────┘
                         │
       ┌─────────────────┼─────────────────┬──────────────────┐
       ▼                 ▼                 ▼                  ▼
useOrdersList     useOrderDetail    useDashboardSummary  useWarehouse*
(auto-patch)      (3-table sub)     (debounced revalid)  (debounced revalid)
```

### Edit-lock contract

`<InlineField>` and product/quantity/city pickers in [src/components/queue/OrderDetailPanel.tsx](src/components/queue/OrderDetailPanel.tsx) call `lock("orders", orderId)` when they enter edit mode and `unlock()` on commit/cancel/blur. The bus:
- **drops UPDATE patches for locked rows** (does not buffer or apply)
- on unlock, **revalidates the SWR cache once** so the user sees the latest server state after their edit lands
- shows a subtle pill on the edited field: `Updated remotely · refresh after save`

Field-level dirty tracking was considered and ruled out (too complex for the inline-field architecture).

---

## Changes

### 1. New: Unified RealtimeProvider

**File:** [src/components/providers/RealtimeProvider.tsx](src/components/providers/RealtimeProvider.tsx) (new)

Exports:
- `<RealtimeProvider marketId={...} userRole={...}>` — wraps the dashboard layout
- `useRealtimeSubscribe(table, opts, handler)` — registers a handler against the shared channel; refcounted (unsubscribes channel only when no listeners remain)
- `useEditLock(table, rowId)` — `{ lock, unlock, isLocked }`; auto-unlock on component unmount
- `useRealtimeToast()` — `toast.terminal(order, transition)` → shows `Order #N was {cancelled|rejected|delivered|returned}`

Wire into [src/app/[locale]/layout.tsx:62-64](src/app/[locale]/layout.tsx#L62-L64), inside `SWRProvider` and inside `MarketScopeProvider` so it reads the scoped market id.

### 2. Migrate existing realtime hooks to the bus

Refactor (no behavior change yet, just plumbing):
- [src/hooks/useOrdersRealtime.ts](src/hooks/useOrdersRealtime.ts)
- [src/hooks/useAgentQueueRealtime.ts](src/hooks/useAgentQueueRealtime.ts)
- [src/hooks/useOrderDetailRealtime.ts](src/hooks/useOrderDetailRealtime.ts)
- [src/hooks/useWarehouseRealtime.ts](src/hooks/useWarehouseRealtime.ts)
- [src/hooks/useConfirmationFlowRealtime.ts](src/hooks/useConfirmationFlowRealtime.ts)
- [src/hooks/useFollowUpsRealtime.ts](src/hooks/useFollowUpsRealtime.ts)
- [src/hooks/useAlerts.ts](src/hooks/useAlerts.ts)
- [src/hooks/useUnassignedOrders.ts](src/hooks/useUnassignedOrders.ts)
- [src/hooks/useAgentNotifications.ts](src/hooks/useAgentNotifications.ts)

Each replaces its `createClient() + .channel() + .on() + removeChannel()` block with `useRealtimeSubscribe("orders", { marketId, filter }, handleEvent)`. Cache-patch logic in [src/lib/agent-queue/cache-patch.ts](src/lib/agent-queue/cache-patch.ts) stays as-is.

### 3. Switch orders list from buffer-banner to auto-patch

**File:** [src/hooks/useOrdersRealtime.ts](src/hooks/useOrdersRealtime.ts)

- Remove the buffered-INSERT path and the "N new · reveal" state.
- On INSERT matching active filters: prepend to page 1 of the infinite cache via `mutate(prepend, { revalidate: false })`.
- On UPDATE: patch the row in place; if the new row no longer matches active filters (e.g., status moved to a terminal state), remove it AND fire `useRealtimeToast().terminal(order, transition)`.
- On DELETE: remove and fire toast.

**Delete the banner component** — [src/components/orders/NewOrdersBanner.tsx](src/components/orders/NewOrdersBanner.tsx) (and its usage in [src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx](src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx)).

Apply the same treatment to:
- [src/hooks/useFollowUpsRealtime.ts](src/hooks/useFollowUpsRealtime.ts) — drop the column-buffer pattern; cross-column moves animate via Framer Motion `layout` prop on the row.
- [src/app/[locale]/(dashboard)/orders/archive/ArchivePageClient.tsx](src/app/[locale]/(dashboard)/orders/archive/ArchivePageClient.tsx) — add the bus subscription so archive sees newly terminal orders arrive live.

### 4. Add realtime to coverage gaps

**Dashboard KPIs** — [src/hooks/useDashboardSummary.ts](src/hooks/useDashboardSummary.ts) (or create if absent) and the page at [src/app/[locale]/(dashboard)/dashboard/page.tsx](src/app/[locale]/(dashboard)/dashboard/page.tsx):
- Subscribe to `orders` (and `inventory_log` for stock-driven KPIs) on the active market.
- On any event, schedule a **1 s debounced revalidation** of `/api/dashboard/summary`. Reuse the existing debounced pattern from [src/hooks/useConfirmationFlowRealtime.ts](src/hooks/useConfirmationFlowRealtime.ts).
- Drop the 5 s server cache window on the summary route (or keep it, since debounce already serves as the rate limiter — confirm during impl).

**In-delivery summary** — [src/hooks/useInDeliverySummary.ts](src/hooks/useInDeliverySummary.ts): add the same subscription pattern, replace the 60 s `refreshInterval` with realtime + 1 s debounce.

**Team / agent presence** — [src/app/[locale]/(dashboard)/team/page.tsx](src/app/[locale]/(dashboard)/team/page.tsx): subscribe to `user_presence` (online status) and `orders` filtered by `assigned_to IS NOT NULL` (queue sizes per agent), debounced 1 s.

**Order detail edit protection** — [src/components/queue/OrderDetailPanel.tsx](src/components/queue/OrderDetailPanel.tsx):
- Wrap the existing `InlineField`, `Stepper`, product picker (lines 917–1432) so each calls `useEditLock("orders", orderId).lock()` on focus and `unlock()` on blur/commit.
- The optimistic `useOrderMutation` flow in [src/hooks/useOrderMutation.ts](src/hooks/useOrderMutation.ts) keeps working; the lock prevents incoming patches from racing the pending PATCH.

### 5. Realtime publication migration (explicit)

**New migration:** `supabase/migrations/20260530_realtime_publication.sql`

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE
  orders, order_items, order_history, products, inventory_log,
  user_presence, order_follow_ups, alert_acknowledgements, label_prints;
-- agent_notifications already added in 20260418_agent_notifications.sql
```

Idempotent with `IF NOT EXISTS` guards via a `DO` block (Postgres doesn't support `ADD TABLE IF NOT EXISTS` on publications directly — use a `pg_publication_tables` lookup).

### 6. Toast for terminal transitions and deletes

**File:** [src/lib/realtime/toast.ts](src/lib/realtime/toast.ts) (new), wired via `useRealtimeToast()`.

Triggers in two places:
- Inside `useOrdersRealtime` (list) when a row exits via terminal status or DELETE.
- Inside `useOrderDetailRealtime` when the open order itself becomes terminal/deleted (the existing `onTerminated` callback in [src/hooks/useOrderDetailRealtime.ts](src/hooks/useOrderDetailRealtime.ts) already covers this — just route it through the shared toast).

Toast copy uses next-intl keys, RTL-safe:
- `realtime.toast.cancelled` — `Order #{external_id} was cancelled by {actor}`
- `realtime.toast.rejected` — same shape
- `realtime.toast.delivered` — same shape
- `realtime.toast.returned` — same shape
- `realtime.toast.deleted` — `Order #{external_id} was deleted`

Auto-dismiss 4 s. Stacks. Clicking opens the order detail in a new tab.

### 7. System-actor write verification (already passed inspection — documented)

No code changes needed. For traceability, the verification notes live alongside this plan in a sibling doc, but the short version:
- Webhook intake → `adminClient.from("orders").insert/update` → ✅ broadcasts
- `poll-carriers` cron → `applyFulfillmentTransition()` → Supabase client → ✅ broadcasts
- `dispatch-scheduled` cron → `performDispatch()` → `.rpc("dispatch_order")` → ✅ broadcasts (RPC writes flow through the same publication)

---

## Critical files to be modified

**New:**
- [src/components/providers/RealtimeProvider.tsx](src/components/providers/RealtimeProvider.tsx)
- [src/lib/realtime/bus.ts](src/lib/realtime/bus.ts) — channel multiplexer + edit-lock registry
- [src/lib/realtime/toast.ts](src/lib/realtime/toast.ts)
- [supabase/migrations/20260530_realtime_publication.sql](supabase/migrations/20260530_realtime_publication.sql)

**Refactored to use the bus (mechanical):**
- [src/hooks/useOrdersRealtime.ts](src/hooks/useOrdersRealtime.ts) — also drops buffer
- [src/hooks/useAgentQueueRealtime.ts](src/hooks/useAgentQueueRealtime.ts)
- [src/hooks/useOrderDetailRealtime.ts](src/hooks/useOrderDetailRealtime.ts)
- [src/hooks/useWarehouseRealtime.ts](src/hooks/useWarehouseRealtime.ts)
- [src/hooks/useConfirmationFlowRealtime.ts](src/hooks/useConfirmationFlowRealtime.ts)
- [src/hooks/useFollowUpsRealtime.ts](src/hooks/useFollowUpsRealtime.ts) — also drops column buffer
- [src/hooks/useAlerts.ts](src/hooks/useAlerts.ts)
- [src/hooks/useUnassignedOrders.ts](src/hooks/useUnassignedOrders.ts)
- [src/hooks/useAgentNotifications.ts](src/hooks/useAgentNotifications.ts)

**Edited (new behavior):**
- [src/app/[locale]/layout.tsx](src/app/[locale]/layout.tsx) — wrap in `RealtimeProvider`
- [src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx](src/app/[locale]/(dashboard)/orders/OrdersPageClient.tsx) — remove banner
- [src/app/[locale]/(dashboard)/orders/archive/ArchivePageClient.tsx](src/app/[locale]/(dashboard)/orders/archive/ArchivePageClient.tsx) — add subscription
- [src/app/[locale]/(dashboard)/dashboard/page.tsx](src/app/[locale]/(dashboard)/dashboard/page.tsx) — add KPI subscription
- [src/hooks/useDashboardSummary.ts](src/hooks/useDashboardSummary.ts) — add debounced realtime
- [src/hooks/useInDeliverySummary.ts](src/hooks/useInDeliverySummary.ts) — add debounced realtime
- [src/app/[locale]/(dashboard)/team/page.tsx](src/app/[locale]/(dashboard)/team/page.tsx) — add presence + queue subscription
- [src/components/queue/OrderDetailPanel.tsx](src/components/queue/OrderDetailPanel.tsx) — wire edit-lock into inline editors
- [src/hooks/useOrderMutation.ts](src/hooks/useOrderMutation.ts) — call `unlock()` on settled (both success and error)
- [src/lib/swr-config.ts](src/lib/swr-config.ts) — no change; per-hook `refreshInterval` overrides (120 s on list, 60 s on summaries) get dropped where realtime now covers them
- [messages/fr.json](messages/fr.json), [messages/ar.json](messages/ar.json) — add `realtime.toast.*` keys

**Deleted:**
- [src/components/orders/NewOrdersBanner.tsx](src/components/orders/NewOrdersBanner.tsx)

---

## Reuse opportunities (already in the codebase)

- **Cache patch logic** — [src/lib/agent-queue/cache-patch.ts](src/lib/agent-queue/cache-patch.ts) `applyRealtimeEvent()` is the right model for the new bus subscriber; lift it to a generic `lib/realtime/cache-patch.ts` so list + queue + warehouse share it.
- **Debounce helper** — pattern in [src/hooks/useConfirmationFlowRealtime.ts:66-109](src/hooks/useConfirmationFlowRealtime.ts#L66-L109) (3 s active / 10 s hidden) is exactly what the dashboard KPIs need; factor it out to `lib/realtime/use-debounced-revalidate.ts`.
- **Supabase client** — [src/lib/supabase/client.ts](src/lib/supabase/client.ts) `createClient()` is fine; the bus creates exactly one instance.
- **Toast** — assumed shadcn/sonner toast already in [src/components/ui/toast.tsx](src/components/ui/toast.tsx). If absent, add `sonner` and a single `<Toaster />` next to `<RealtimeProvider>` in root layout.

---

## TDD slice (per project rule)

Before any production code, write failing tests in `src/test/`:
1. **`bus.test.ts`** — refcounted subscribe/unsubscribe; one channel per `(market, table)` regardless of subscriber count.
2. **`edit-lock.test.ts`** — locked row drops UPDATE; on unlock, exactly one revalidation fires.
3. **`useOrdersRealtime.auto-patch.test.tsx`** — INSERT prepends to page 1 with no banner state; terminal UPDATE removes row + toast called once.
4. **`useOrderDetailRealtime.lock.test.tsx`** — incoming UPDATE while lock held is dropped, applied on unlock.
5. **`dashboard-summary.realtime.test.tsx`** — 5 INSERTs in 200 ms cause exactly one `/api/dashboard/summary` revalidate at ~1 s.

Use the real Supabase Realtime in integration mode where possible (per the testing memory — don't mock the DB). Where pure timing is the subject, fake timers are OK.

---

## Verification (end-to-end, manual)

Two browsers open side-by-side, same market, different roles. For each scenario, the right pane should update within ~250 ms with no manual refresh.

1. **Webhook intake:** post a fake storefront webhook → new row appears on manager + super_admin list, dashboard pipeline bucket increments, agent queue (if assigned) shows the new card.
2. **Agent confirms:** confirm an order in agent tab → row updates status badge on manager list; if filter is "Pending", row disappears with toast.
3. **Manager edits price:** open detail panel, change `total_price` → super_admin list row patches; dashboard revenue KPI tick within ~1 s.
4. **Manager edits while agent confirms:** open customer_name field as manager; in second tab, agent confirms. Field stays in editing mode; pill `Updated remotely · refresh after save` appears; on save, single revalidation reconciles.
5. **Warehouse scan-out:** scan barcode → manager list row moves to `scanned`, warehouse "to-scan" queue removes it, dashboard stock KPI updates.
6. **Carrier poll cron fires `delivered`:** order leaves "in-transit" list, archive shows it, toast `Order #N delivered`, dashboard delivery rate ticks.
7. **Manager cancels:** row vanishes from active lists with toast on all open sessions; archive shows it.
8. **Manager deletes order:** same as cancel, with delete toast.
9. **Test super_admin "all markets" view:** confirm market filter on bus passes `undefined` and RLS still scopes correctly.
10. **Edit lock unmount:** open detail, focus a field, navigate away → unlock fires (no stale lock leaks).

Also run:
- `npm test` — all new tests green.
- `npm run typecheck` — clean.
- `npm run build` — clean.

Browser devtools → Network → WS: confirm exactly **one** websocket connection per tab and that subscribed channels match active views (no leaks when navigating away).
