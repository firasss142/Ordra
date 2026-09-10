# Agent confirmation queue — real-time and load-time fix

Reported by the user, 2026-09-10:

1. **A status change does not move the order between tabs.** The card stays under
   its old status until a manual refresh.
2. **Orders take a long time to appear** when the agent opens the queue.
3. General real-time / performance issues on that page.

Scope is `/[locale]/queue` (the confirmation agent interface) and what it directly
depends on. The `/orders` manager page was rebuilt separately — see
[docs/orders-page-performance.md](../docs/orders-page-performance.md).

---

## Bug report summary

The queue's client-side logic is **correct**. `applyRealtimeEvent` recomputes
buckets on every UPDATE (`cache-patch.ts:114`) and `applyRowPatch` already moves a
row between the active and closed lists when its status changes
(`buckets.ts:149-162`). Nothing there needs fixing.

The defect is that **the events never arrive**. The queue is still on
`postgres_changes` (`useAgentQueueRealtime.ts:100`), the exact transport the Orders
page was moved off in Step 4 because production showed it failing — and it is still
failing, measured on 2026-09-09 → 2026-09-10:

| Signal (24 h, `realtime_logs`) | Count |
|---|---|
| Stream stops | 8 |
| Restarts | 12 |
| `apply_rls` / statement cancellations | 3 |

`postgres_changes` evaluates the `orders` RLS policy **once per changed row per
subscriber** inside Realtime's poller. `orders` is in the `supabase_realtime`
publication (verified), and the Darb sync writes ~117k order updates a day through
`promote_darb_status`. Every one of those is fed through `apply_rls` for every
connected agent. That is the fan-out that stalls and restarts the stream.

**Every stop is a silent window.** And the queue cannot even tell the agent, because
its connection indicator is fake:

```ts
// useAgentQueueRealtime.ts:105-107
useEffect(() => {
  setConnected(Boolean(agentId));
}, [agentId]);
```

`connected` is `true` whenever an agent id exists — it never reflects the socket. So
the page claims it is live while receiving nothing, and there is no catch-up
revalidation when the socket returns. The 60 s poll
(`useAgentQueue.ts:26`) is the only thing that eventually corrects the view, which
is exactly the "stays under the same tab" symptom: **up to 60 seconds of a wrong
tab, or indefinitely if the poll result is also stale.**

---

## Root causes, in priority order

### 1. Wrong transport (causes bug #1)

`postgres_changes` on a table taking 117k writes/day, with per-subscriber RLS
evaluation. Same defect, same table, same fix as Orders Step 4: a slim broadcast on
a private topic, authorised once at channel join.

### 2. Lying connection state (hides bug #1)

`connected` is derived from `agentId`, not from the socket. The agent has no way to
know the queue has gone stale, and the code has no trigger for a catch-up fetch.

### 3. No catch-up after a reconnect or tab focus

When the socket does come back, nothing revalidates. The queue waits for the next
60 s tick.

### 4. Load time: payload, not the database (causes bug #2)

Measured on production for `roqaya` (the busiest LY agent), impersonating her role:

| Step | Rows | Time |
|---|---|---|
| Active query | 26 | 5.3 ms |
| Closed query (7 d) | 351 | 1.9 ms |
| `order_history` last-action | 1,323 over 403 ids | 36.1 ms |
| `get_customer_history_batch` | 377 in | 47.9 ms |
| `get_duplicate_orders_batch` | 377 in | 163.2 ms |
| **Total DB** | | **~254 ms** |

The database is not slow. The problem is that the route builds, enriches and ships
**377 rows — about 1 MB of JSON — when the agent's actual work queue is 26 orders.**
351 of those rows are the closed 7-day history, enriched with duplicate and
repeat-buyer detection the closed list does not use for its primary purpose.

The duplicate enrichment alone (163 ms) is spent mostly on rows the agent is not
working. And on a mobile connection, ~1 MB before first paint is the "very slow load"
the agent sees.

### 5. Background contention (makes everything worse, intermittently)

`claim_darb_sync` has a **p50 of 12.3 s and a max of 132 s** in the edge logs, and at
09:00 four cron jobs fire together (`invoke_carrier_poll`,
`invoke_google_sheets_sync`, `invoke_dispatch_scheduled`, `run_notifications_check`).
During that window database-wide p50 hit 21.5 s. Any queue load landing in it is
slow regardless of this page's own code. **Out of scope here — recorded, not fixed.**

---

## Fixes

Order of work: **A and B first** — they are the reported bugs and are low-risk.
**C after**, verified separately.

### Fix A — move the queue onto the broadcast topic (root cause 1) — FIRST

The trigger, the private topic and the `realtime.messages` policy already exist from
Orders Step 4 (`20260924000002_orders_broadcast.sql`). The topic is per market,
`orders:market:<uuid>`, and the payload carries `assigned_to` — everything the
queue's ownership check needs.

**No migration required for the happy path.** The one gap: the existing RLS policy on
`realtime.messages` allows `super_admin`, `market_manager` and `warehouse_agent`.
`agent` is not in the list, so an agent cannot join the topic. One migration adds
`agent`, scoped to its own market, matching the existing shape.

Client: `useAgentQueueRealtime` swaps `useRealtimeSubscribe` for
`useRealtimeBroadcast` and reuses `useBroadcastConnected` for real socket state. The
broadcast payload is slim (`op, id, market_id, status, assigned_to, archived_at,
updated_at`), so — exactly as on Orders — it is treated as a **signal**: patch the
fields it carries, then coalesce one revalidation for the enriched rest.

This also fixes a subtle correctness bug in passing: the current
`postgres_changes` handler merges a raw WAL row into the cache
(`pickQueueFields` narrows it, but `product_display_name`, `repeat_kind`,
`duplicate_siblings` and `last_action_at` have no realtime equivalent and survive
only by the spread). A signal-plus-revalidate model cannot get that wrong.

### Fix B — real connection state + catch-up (root causes 2, 3)

`connected` comes from `useBroadcastConnected(topic)`. On the transition to
connected, and on `visibilitychange → visible`, revalidate once. While
disconnected, poll every 20 s instead of 60 s; while connected, stop polling.

### Fix C — stop shipping the closed list on first paint (root cause 4) — SECOND

The closed 7-day list is 351 of 377 rows and ~93% of the payload, and it is
secondary information — the agent works the active queue. Split it: the queue
returns the active set immediately, and the closed set loads on demand (its own key,
fetched when that tab is opened).

This is the single biggest win for "slow load" and it removes ~1 MB from the
critical path.

> **Checked, and it changes the shape of this fix.** `computeBuckets` sets
> `b.fermees = closedOrders.length` (`buckets.ts:84`), so the closed COUNT is shown
> on the active screen. The split therefore cannot just drop the rows: the route
> must return a `closedCount` for the badge, and the rows themselves load when the
> "Fermées" tab is opened. Larger and riskier than A/B, so it ships separately and
> only after A/B are verified.

---

## Validation plan

**Automated**
- `useAgentQueueRealtime` test: joins the private topic, reports real connected
  state, patches a status change, removes a reassigned-away row, coalesces a burst.
- A test that a status change moves the row between active and closed lists *and*
  that bucket counts follow (this is the reported bug, asserted directly).
- Existing `cache-patch` / `buckets` tests must stay green untouched — the logic is
  correct and must not be disturbed.
- Full suite compared by failing-FILE set against the untouched tree (this repo has
  pre-existing failures; a raw count proves nothing).

**Manual, on production**
- Open the queue as an agent. Confirm the footer/indicator reads connected.
- From a second session (or the database), change an order's status. The card must
  leave its tab and appear under the new one within ~2 s, with no reload.
- Reassign an order away from the agent → it disappears with the existing notice.
- Measure `/api/agent/queue` duration and payload before/after Fix C.

**Rollback**
- Fix A/B: revert the hook; `useRealtimeSubscribe` and the `postgres_changes` path
  stay in `bus.ts` (nine other consumers use it), so reverting the hook alone
  restores today's behaviour. The migration only widens an RLS policy and can be
  reverted independently.
- Fix C: revert the route and the client key; no schema involved.
