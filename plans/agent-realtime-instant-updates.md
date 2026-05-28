# Agent Interface — Real-Time Instant Updates

## Context

This OMS is multi-agent: 1–5 agents per market today, working a shared confirmation queue. The agent surface (`/[locale]/dashboard/queue`) is mission-critical — every second of latency between a manager's action and the agent seeing it is a wasted call, a duplicate confirmation, or a contradicted customer.

Current state of the agent surface:

- `useAgentQueue` polls `/api/agent/queue` every 30s. **No Supabase Realtime wiring.**
- `OrderDetailPanel` polls a single order via SWR. **No Realtime wiring.**
- `PostCallActionSheet` actions (confirm / reject / callback / no-answer / dispatch / schedule-dispatch) `await fetch(...)` and only then call `onSuccess` → `mutate()`. The card moves bucket **after** the round-trip — feels sluggish.
- Manager realtime exists (`useConfirmationFlowRealtime`, `useOrdersRealtime`) but agents have no equivalent.
- Callbacks coming due are detected by the bell (notifications channel), but the **queue order does not re-sort** until the next 30s poll — a 14:00 callback stays buried below pending rows for up to 30s after 14:00.
- Race protection lives in DB RPCs (`FOR UPDATE` locks + transition validation in `transition_order_status`). Stale UI surfaces conflicts as action-time errors rather than preempting them.

**Goal**: bring the agent's screen to sub-second freshness across queue + open panel, make their own actions instant via optimistic updates with safe rollback, and auto-close the panel on reassignment/cancellation. Scope is the agent surface only — manager realtime untouched.

User-confirmed decisions:

- **Scope**: queue list reordering, open `OrderDetailPanel` live sync, own-click optimism.
- **Reassignment UX**: auto-close panel + non-blocking toast (no read-only mode, no blocking modal).
- **Edit conflicts**: last-write-wins with live field sync (no version checks; matches Google-Docs-lite mental model).
- **Callback re-sort**: client-side 60s tick re-runs `sortAgentQueue` against the cached data — no extra server roundtrip.
- **Scale**: 1–5 agents per market. One per-agent Realtime channel filtered to `assigned_to=eq.{agentId}` is the sweet spot.

## Architecture summary

Two new realtime hooks colocated with the SWR caches they patch, one optimistic-action helper, one client-side tick for callback promotion, and a small shared `Toast` primitive extracted from the existing `ToastBanner` inside [src/components/layout/NotificationBell.tsx:502](src/components/layout/NotificationBell.tsx#L502).

```
useAgentQueue (modified)
 ├─ useAgentQueueRealtime          → subscribes to orders WHERE assigned_to = me
 │                                    patches "/api/agent/queue" SWR cache in-place
 │                                    emits onReassignedAway / onCancelled events
 └─ visibility-aware 60s tick      → re-runs sortAgentQueue so newly-due callbacks float to top

OrderDetailPanel (modified)
 └─ useOrderDetailRealtime         → subscribes to orders/order_items/order_history
                                      patches "/api/orders/{id}" SWR cache live
                                      detects reassign-away / terminate → calls onClose + toast

PostCallActionSheet (modified)
 └─ useOptimisticOrderAction       → wraps mutate("/api/agent/queue", patch, { rollbackOnError })
                                      monotonic commit id to drop stale responses
```

All realtime is driven by existing `postgres_changes` on the `orders`, `order_items`, `order_history` tables. **Zero server changes** — no new API routes, no migrations, no broadcasts.

## A. `useAgentQueueRealtime` (new)

[src/hooks/useAgentQueueRealtime.ts](src/hooks/useAgentQueueRealtime.ts) — mounted **inside** `useAgentQueue` so consumers don't need to know realtime exists.

**Channel**: `agent-queue:${agentId}`
**Filter**: `event: "*"`, `schema: "public"`, `table: "orders"`, `filter: "assigned_to=eq.{agentId}"`

The Realtime filter excludes rows that aren't ours — but importantly, when a manager reassigns away, the post-update row's `assigned_to` no longer matches and we'd miss the event. **Solution**: subscribe with the filter applied on the `assigned_to` column using Supabase's `WHERE old OR new` semantics is not supported, so use a **two-channel approach**:

- Channel 1 `agent-queue-mine:${agentId}` — `filter: assigned_to=eq.{agentId}` (INSERT / UPDATE-into-mine / UPDATE-still-mine).
- Channel 2 `agent-queue-departures:${agentId}` — no filter; client-side guards on `payload.old.assigned_to === agentId && payload.new.assigned_to !== agentId` to detect reassign-away. Drops every other event.

(If post-image filtering proves enough — i.e. UPDATE events fire for both old and new filter matches — collapse to channel 1. Test this empirically with two browsers before finalizing.)

**Cache patcher** lives in [src/lib/agent-queue/cache-patch.ts](src/lib/agent-queue/cache-patch.ts) as a pure function `applyRealtimeEvent(cache, event)` so it's unit-testable without React/Supabase.

The cache envelope is `{ orders, allOrders, closedOrders, buckets }`. Status determines which list a row belongs in:

- `ACTIVE_AGENT_STATUSES` = `pending|assigned|attempt_1|attempt_2|attempt_3|callback_scheduled|dispatch_scheduled|confirmed` → `allOrders` (and `orders` once sorted).
- `CLOSED_AGENT_STATUSES` (within 7d) = `uploaded|rejected|dispatched` → `closedOrders`.
- `cancelled` / `deleted` → drop from all three (these are not "closed" from the agent's perspective; see the queue route's closed-status filter).

Event handling rules:

| Event | Condition | Action |
|---|---|---|
| INSERT | `assigned_to === agentId` | Add to `allOrders` (and `orders`), bump `buckets` |
| UPDATE | reassign-away (`old=me`, `new≠me`) | Remove from all arrays, emit `onReassignedAway(row)` |
| UPDATE | status → `cancelled` or `deleted` | Remove from all arrays, emit `onCancelled(row)` |
| UPDATE | status changes active↔closed | Move between `allOrders` and `closedOrders`, recompute `buckets` |
| UPDATE | field edit only (no status change, still mine) | Replace in-place where it lives |
| DELETE | row was in cache | Remove from all arrays |

After every patch, recompute `buckets` from the resulting arrays — never trust deltas. `mutate(..., { revalidate: false })` for all patches.

**Idempotency**: `applyRealtimeEvent` shallow-diffs `payload.new` against the cached row by id; if content is identical it returns the cache unchanged. This prevents flicker when the optimistic patch (section C) and the eventual realtime UPDATE arrive in either order.

`useAgentQueue` return type extends to:

```ts
{ orders, allOrders, closedOrders, buckets, error, isLoading, mutate, connected, reassignmentEvent, tick }
```

`reassignmentEvent`: `{ orderId, managerName: string | null, kind: "reassigned" | "cancelled" } | null` — consumed by `QueuePage` to fire toast + close panel.

## B. `useOrderDetailRealtime` (new)

[src/hooks/useOrderDetailRealtime.ts](src/hooks/useOrderDetailRealtime.ts) — mounted inside [src/components/queue/OrderDetailPanel.tsx](src/components/queue/OrderDetailPanel.tsx) right after the existing `useSWR<{ data: OrderDetail }>` call.

Three channels (per-order), all scoped via `id=eq.{orderId}` so payload volume is tiny:

1. `order-detail:${orderId}` → `orders` UPDATE.
2. `order-detail-items:${orderId}` → `order_items` `event: "*"`, `filter: order_id=eq.${orderId}`.
3. `order-detail-history:${orderId}` → `order_history` INSERT only, `filter: order_id=eq.${orderId}`.

Cache key: `/api/orders/${orderId}`. Envelope: `{ data: OrderDetail }` (matches the panel's existing SWR shape).

Behaviour:

- **orders UPDATE** with `assigned_to !== agentId` → call `onReassignedAway(payload.new)` and skip cache patch (panel is about to unmount).
- **orders UPDATE** with `status ∈ {cancelled, deleted}` → call `onTerminated(payload.new)`, skip patch.
- **orders UPDATE** otherwise → shallow-merge `payload.new` into `data`, preserving `history` and `order_items` (the payload doesn't carry them).
- **order_items INSERT/UPDATE/DELETE** → append/replace/filter `data.order_items` by id; then debounced 500ms `mutate(swrKey)` (revalidate) so server-recomputed `total_price`/`quantity` come back. Matches the existing `useOrderMutation.addItemOptimistic` precedent.
- **order_history INSERT** → prepend new row to `data.history` (panel renders DESC by `created_at`). Append-only — no revalidate needed.

`OrderDetailPanel` accepts two new props: `onReassignedAway?: (managerName: string | null) => void` and `onTerminated?: (kind: "cancelled" | "deleted") => void`. `QueuePage` wires them to close the panel and fire the toast.

## C. Optimistic status actions

New helper [src/hooks/useOptimisticOrderAction.ts](src/hooks/useOptimisticOrderAction.ts) — mirrors the existing [src/hooks/useOrderMutation.ts](src/hooks/useOrderMutation.ts) pattern (monotonic `commitIdRef`, `rollbackOnError: true`, `throwOnError: false`).

```ts
useOptimisticOrderAction(orderId: string): {
  run: <T>(opts: {
    optimisticPatch: (order: RawOrder) => Partial<RawOrder>,
    request: () => Promise<Response>,
  }) => Promise<{ ok: true; data: T } | { ok: false; status: number; error?: string }>
}
```

Internally:

1. Patch `/api/agent/queue` cache: locate the row by id in `orders`/`allOrders`/`closedOrders`, apply patch, run the same active↔closed migration logic from `applyRealtimeEvent`, recompute `buckets`.
2. Also patch `/api/orders/{id}` cache (if present) so an open detail panel reflects the optimistic state.
3. `await request()` — on non-ok, return error and let SWR roll back both caches.

Refactor these handlers in [src/components/queue/PostCallActionSheet.tsx](src/components/queue/PostCallActionSheet.tsx):

| Handler | Optimistic patch | Endpoint |
|---|---|---|
| `submitConfirm` | `{ status: "confirmed" }` | `POST /api/orders/{id}/confirm` |
| `submitReject` | `{ status: "rejected", rejection_reason, rejection_note }` | `POST /api/orders/{id}/reject` |
| `submitCallback` | `{ status: "callback_scheduled", callback_scheduled_at }` | `POST /api/orders/{id}/callback` |
| `submitNoAnswer` | `{ status: nextAttemptStatus(...), attempts_count: n+1 }` or auto-reject | `POST /api/orders/{id}/no-answer` |
| `submitUploadNow` | `{ status: "uploaded" }` (tracking_number arrives via realtime) | `POST /api/orders/{id}/dispatch` |
| `submitScheduleUpload` | `{ status: "dispatch_scheduled", scheduled_dispatch_at, scheduled_dispatch_auto, scheduled_dispatch_carrier_id }` | `POST /api/orders/{id}/schedule-dispatch` |

Reuse the existing attempt-progression rule (search [src/lib/orders/](src/lib/orders/) — likely in `transition.ts` or `attempt-logic.ts`; if not found as a pure helper, extract one). The rule: `pending → attempt_1`, `attempt_1 → attempt_2`, `attempt_2 → attempt_3`, and when `attempts_count + 1 > maxAttempts` it auto-rejects with `reason: "injoignable"`.

On error: `setError(...)` already drives an inline error banner inside the sheet — keep that, no separate toast needed for action failures.

## D. Callback ticking timer

Inside `useAgentQueue`:

```ts
const [tick, setTick] = useState(0);
useEffect(() => {
  const fire = () => {
    if (document.visibilityState === "visible") setTick((t) => (t + 1) % 1_000_000);
  };
  const intervalId = setInterval(fire, 60_000);
  document.addEventListener("visibilitychange", fire);
  return () => {
    clearInterval(intervalId);
    document.removeEventListener("visibilitychange", fire);
  };
}, []);
```

The hook returns `tick`. `QueuePage` lists it in the `useMemo` deps that re-run `sortAgentQueue` (from [src/lib/orders/queue-sort.ts](src/lib/orders/queue-sort.ts)). When 14:00 crosses, a `callback_scheduled` row whose `callback_scheduled_at <= now` jumps to priority 0 ahead of attempts and pending. No network call.

Visibility gate prevents background tabs from burning CPU; the `visibilitychange` listener fires the tick immediately when the tab returns, so a tab hidden for an hour catches up on first paint.

## E. Toast primitive

No shared `Toast` exists today. The only toast in the codebase is `ToastBanner` inline at [src/components/layout/NotificationBell.tsx:502](src/components/layout/NotificationBell.tsx#L502).

Create [src/components/ui/Toast.tsx](src/components/ui/Toast.tsx) + a small `ToastProvider` mounted once at the dashboard layout root ([src/app/[locale]/(dashboard)/layout.tsx](src/app/[locale]/(dashboard)/layout.tsx) — verify path during implementation). API: `useToast().show({ tone: "info" | "warning" | "critical", message: string, duration?: number })`. Auto-dismiss 5s. Esc dismisses. Adheres to [docs/design-system.md](docs/design-system.md): light surface, accent rail by tone, zero decoration. Migrate `NotificationBell`'s `ToastBanner` to the shared primitive once it's available (out-of-scope optional follow-up).

i18n keys to add to [src/messages/fr.json](src/messages/fr.json) and [src/messages/ar.json](src/messages/ar.json) under `queue.realtime.toast`:

```json
{
  "reassignedAway": "Cette commande a été réattribuée",
  "cancelledByManager": "Cette commande a été annulée",
  "deletedByManager": "Cette commande a été supprimée",
  "connectionLost": "Connexion temps réel interrompue",
  "connectionRestored": "Connexion rétablie"
}
```

Manager-name lookup is **out-of-scope for v1** — `payload.new` doesn't carry the actor; resolving it requires either a follow-up read of `order_history` or a denorm column. Ship the generic copy first; revisit only if managers ask for attribution.

## F. Connection health + fallback

`useAgentQueueRealtime` listens to `system` events from the channel (`SUBSCRIBED`, `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`) and exposes `connected: boolean`.

When `connected === false` for >3s:

1. `useAgentQueue` switches SWR `refreshInterval` to 10s (from the realtime-mode default of disabled or 60s) to bridge the gap until reconnect.
2. Show a subtle pip in the queue header — green dot when connected, hollow grey + `aria-live="polite"` "Connexion temps réel interrompue" when not. Reuse the existing `Badge` `dot` variant.
3. On reconnect: run `mutate()` once to backfill any missed events, switch poll back to realtime-mode cadence.

Default `refreshInterval` when realtime is connected: drop from 30s to **disabled** (rely fully on realtime), or keep at **60s** as a safety net. **Recommend 60s safety net** — cheap insurance against silent subscription drift.

## G. Files

**Create**:
- [src/hooks/useAgentQueueRealtime.ts](src/hooks/useAgentQueueRealtime.ts)
- [src/hooks/useOrderDetailRealtime.ts](src/hooks/useOrderDetailRealtime.ts)
- [src/hooks/useOptimisticOrderAction.ts](src/hooks/useOptimisticOrderAction.ts)
- [src/lib/agent-queue/cache-patch.ts](src/lib/agent-queue/cache-patch.ts)
- [src/components/ui/Toast.tsx](src/components/ui/Toast.tsx) + `ToastProvider`
- All test files listed in section H.

**Modify**:
- [src/hooks/useAgentQueue.ts](src/hooks/useAgentQueue.ts) — accept `agentId` arg, mark `"use client"`, mount realtime hook + tick, return `connected` / `reassignmentEvent` / `tick`. Drop polling to 60s safety net.
- [src/components/queue/QueuePage.tsx](src/components/queue/QueuePage.tsx) — pass `user?.id` to `useAgentQueue`, wire `reassignmentEvent` → toast + close panel, list `tick` in the sort `useMemo` deps.
- [src/components/queue/OrderDetailPanel.tsx](src/components/queue/OrderDetailPanel.tsx) — mount `useOrderDetailRealtime`, accept `onReassignedAway` / `onTerminated` props.
- [src/components/queue/PostCallActionSheet.tsx](src/components/queue/PostCallActionSheet.tsx) — refactor six submit handlers via `useOptimisticOrderAction`.
- [src/messages/fr.json](src/messages/fr.json) + [src/messages/ar.json](src/messages/ar.json) — toast i18n keys.
- [src/app/[locale]/(dashboard)/layout.tsx](src/app/[locale]/(dashboard)/layout.tsx) (or the closest agent-facing layout) — mount `ToastProvider`.

**Do not touch**:
- [src/hooks/useConfirmationFlowRealtime.ts](src/hooks/useConfirmationFlowRealtime.ts), [src/hooks/useOrdersRealtime.ts](src/hooks/useOrdersRealtime.ts) — manager realtime, out of scope.
- Any [src/app/api/orders/](src/app/api/orders/) routes — realtime is purely DB-change-driven; no server changes.

## H. Tests (TDD — write failing tests first)

Per [.claude/skills/test-driven-development/SKILL.md](.claude/skills/test-driven-development/SKILL.md), red-green-refactor:

| Test file | Asserts |
|---|---|
| `src/lib/agent-queue/__tests__/cache-patch.test.ts` | `applyRealtimeEvent` for: INSERT pending → lands in `allOrders` + `buckets.nouveau++`; UPDATE pending→confirmed promotes within `allOrders`, `buckets.nouveau--`, `buckets.confirme++`; UPDATE pending→uploaded moves to `closedOrders`; UPDATE assigned_to away → row removed from all arrays; UPDATE status→cancelled → row removed from all arrays; DELETE → row removed; content-identical UPDATE returns same cache reference. |
| `src/hooks/__tests__/useAgentQueueRealtime.test.tsx` | Mock `createClient`. Subscribes on mount with channel name `agent-queue-mine:{agentId}` + filter `assigned_to=eq.{agentId}`. Unsubscribes on unmount. Synthetic INSERT payload triggers `mutate` with expected next cache. UPDATE with reassign-away invokes `onReassignedAway` exactly once and removes the row. |
| `src/hooks/__tests__/useOrderDetailRealtime.test.tsx` | All three channels subscribed with id-scoped filters. `orders` UPDATE with reassign-away calls `onReassignedAway` and **does not** mutate cache. `order_items` INSERT appends to `data.order_items`. `order_history` INSERT prepends a history row. |
| `src/components/queue/__tests__/PostCallActionSheet.optimistic.test.tsx` | Seed `/api/agent/queue` cache with a pending order. Click "Confirmé": status becomes `confirmed` synchronously **before** `fetch` resolves. When `fetch` rejects (mock error), cache rolls back to `pending`. Same shape for reject, callback, no-answer. |
| `src/hooks/__tests__/useAgentQueueCallbackTick.test.tsx` | Fake timers. Seed a `callback_scheduled` order with `callback_scheduled_at = now + 30s` and a pending order. Initial sort places callback below pending. Advance 60s → assert tick fires and sort places callback at index 0. Tab hidden → tick suppressed. Tab visible → tick fires immediately. |
| `src/components/queue/__tests__/OrderDetailPanel.realtime.test.tsx` | Render panel for an order. Drive synthetic reassign-away through mocked supabase client → assert `onClose` called, toast text = `queue.realtime.toast.reassignedAway`. Drive status=cancelled → same with cancelled copy. |
| `src/components/ui/__tests__/Toast.test.tsx` | `show()` renders text, auto-dismisses after 5s (fake timers), Esc dismisses, `role="status"` for info/warning, `role="alert"` for critical. |

## I. Verification

Two browser windows side by side:
- A: `agent1.tn@oms.local` on `/fr/dashboard/queue`.
- B: `manager.tn@oms.local` on `/fr/orders`.

1. **Reassignment toast**: A opens an order's detail panel from "Nouveau". B reassigns to `agent2.tn`. Within ~1s on A: panel closes, toast "Cette commande a été réattribuée", row leaves "Nouveau", `buckets.nouveau--`.
2. **Cancellation**: A on detail. B cancels via order action. Within ~1s on A: panel closes, toast "Cette commande a été annulée", row gone.
3. **Live field sync**: A opens detail. B edits `customer_address` from `/fr/orders/{id}`. Within ~1s A's panel shows the new address — no flash, no refresh.
4. **Live history**: B transitions an order. A's open detail panel timeline gets a new row at the top without action.
5. **Optimistic confirm**: A opens post-call sheet on pending order, clicks "Confirmé". Card moves "Nouveau"→"Confirmé" **before** DevTools network tab shows `/confirm` resolved (within a single frame).
6. **Optimistic rollback**: Same as #5 but Chrome throttled to Offline. Click "Confirmé". Optimistic move + ~5–10s later fetch fails → rolls back to "Nouveau" + inline error banner in the sheet.
7. **Callback tick**: Manually set an order's `callback_scheduled_at` to `now + 30s`. A on "En cours → Rappel" subfilter. Wait 60s with no interaction → order floats to top.
8. **INSERT new assignment**: B assigns a new pending order to `agent1.tn`. A on "Nouveau": card appears within ~1s, `buckets.nouveau++`.
9. **Connection health**: DevTools → Network → Offline mode for >3s. Pip turns grey, "Connexion temps réel interrompue" appears. Restore network → pip turns green, full `mutate()` runs. No data loss.

Automated:
- `npm test` — all new test files green.
- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run build` — clean.

## J. Risks

1. **Reassign-away detection**: Supabase Realtime's `filter:` is applied post-image only — an UPDATE that moves a row *out* of the filter may not fire. **Empirically verify first** with the two-channel pattern in section A; if post-image firing is sufficient, collapse to one channel.
2. **Optimistic ↔ realtime race**: agent confirms; realtime UPDATE arrives before our `fetch` resolves. Final state is identical so no flicker, but the optimistic helper's monotonic `commitIdRef` (matching `useOrderMutation`) drops stale responses. Realtime patches always win.
3. **Rollback flicker on slow networks**: optimistic patch and the eventual realtime UPDATE both produce the same final state. Rollback only fires on `fetch` error — a loud failure is the desired UX.
4. **Channel quota**: ~4 channels per active agent (1 queue mine + 1 queue departures + up to 3 detail-panel per open order). At 5 agents per market × 2 markets = 10 agents × ~4 channels = 40 channels. Well within Supabase Realtime limits.
5. **Last-write-wins on inline edits**: user-confirmed acceptable. Worst case: agent re-saves what they meant. No version checks.
6. **Feature flag**: gate the new behavior on `NEXT_PUBLIC_AGENT_REALTIME_ENABLED` (default `true`). When `false`, skip mounting both realtime hooks and disable optimistic actions — full fallback to today's 30s polling. Developer-only kill switch, no UI surface.
