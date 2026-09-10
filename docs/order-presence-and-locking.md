# Order presence & the agent lock

*Landed 2026-09-11. Migrations `20260925000001`–`20260925000004`, all applied to production.*

## What it does

An agent with an order's detail view open **hard-blocks** every manager write on
it. A manager with the same order open blocks nobody — the agent just sees a
head icon on it.

| Situation | Effect |
|---|---|
| Agent has the order open | Managers see the icon **and are refused** reassign / field edit / status change / cancel |
| Manager has the order open | Agent sees the icon, hollow ring = *consulte*, filled = *modifie*. **No block** |
| Two managers on one order | They see each other. No block; `expected_updated_at` already covers them |
| super_admin force-releases | The agent's panel shows a takeover screen naming who took it |

The asymmetry is the point: the destructive direction (a manager yanking an
order out from under a live phone call) gets the block; the benign direction
(a manager glancing at a row) gets an icon. An agent mid-call is never frozen.

Locks expire ~75 s after the last heartbeat. `super_admin` can force-release;
`market_manager` deliberately cannot — a lock a colleague can break on a hunch
is not a lock.

## The three traps

**1. The Darb sweep runs under a real user's session.**
`src/app/api/darb-assabil/sync-market/route.ts:41` builds a *user-session*
client and calls `promote_darb_status` on every app launch, for every role. So
`auth.uid()` is a real manager's UUID during a large share of the sync's ~117k
order writes/day. **Any guard keyed on "is there a session?" breaks the Darb
sweep the moment one order in the market is locked.** The sound signal is the
declared actor: every system path passes `p_actor_id => NULL`, and
`assert_order_unlocked` returns immediately on that.

**2. The trigger must be SECURITY INVOKER.**
Inside a `SECURITY DEFINER` function `current_user` is the *owner*, so a DEFINER
trigger reads `postgres` on every call and the guard silently never runs. This
was written wrong first: the RPC path blocked correctly while a raw
`PATCH /api/orders/[id]` sailed straight through. Do not "harden" it.

**3. The guard has to cover `order_items` too.**
Line items are edited through their own table, and the route then recomputes
`orders.total_price` in a *second* call. Guarding `orders` alone produced
exactly the split those routes exist to prevent — items summing to one figure
while `total_price` kept another, which is silent revenue corruption given
CLAUDE.md pins revenue to `total_price`. `20260925000004` guards the item write
itself, so the first statement is refused and there is nothing to compensate.

## Shape

- `order_presence` — one row per open panel per **tab** (`session_id`), PK
  `(order_id, session_id)`. `role='agent'` rows block; manager rows are
  advisory. Stored `expires_at`, no `last_heartbeat_at`.
- `assert_order_unlocked(order, actor)` → raises **SQLSTATE 55006** with a JSON
  `DETAIL` naming the holder. `assert_orders_unlocked` for the array case.
- `trg_orders_lock_guard` / `trg_order_items_lock_guard` — `BEFORE UPDATE`,
  SECURITY **INVOKER**, keyed on `current_user <> 'authenticated'`.
- Routes translate 55006 → **409 `{ code: "locked", lock: {...} }`**;
  `readActionFailure` exposes it as `.locked` while keeping `.conflict` true.
- `POST /api/orders/[id]/presence` (`acquire|heartbeat|release`) — POST-only and
  content-type-tolerant because `sendBeacon` can only POST, in `text/plain`
  unless handed a typed Blob.
- Topics: `order_presence:market:<uuid>` (managers) and
  `order_presence:agent:<uuid>` (that agent only). **Never** prefix them
  `orders:market:` — `orders_broadcast_read` matches that with `LIKE` and admits
  role `agent`, which would leak the whole market's presence.

## Performance invariants — break these and it regresses silently

1. **The guard costs the Darb sync nothing.** Both short-circuits fire before
   any lookup. The trigger's `WHEN` list omits `carrier_status_*`,
   `tracking_number` and `updated_at` on purpose — that is what keeps
   `sync-batch/route.ts:190`'s raw write out of the function body.
2. **Presence never enters `/api/orders/list`.** Joining it would not even work:
   `useOrdersList` stops polling entirely while realtime is connected, and
   taking a lock changes no order row, so nothing would ever revalidate it.
3. **Heartbeats must not repaint the table.** `useOrderLocks` keeps rows in a
   **ref** and only sets state when the `orderId:userId:mode` signature changes.
   `presenceOf` returns a **shared** empty array — a fresh `[]` per call would
   defeat `OrderRow`'s memo for every unlocked row.
4. **The liveness tick is 10 s, not 60.** Expiry emits no DB event; with a 75 s
   TTL a minute-long tick would show a dead lock for another minute.
5. **No new `postgres_changes` subscriptions.** Broadcast only.
6. `assert_lock_guards_installed()` — run it after touching any guarded RPC. A
   later `CREATE OR REPLACE` would silently drop the guard otherwise.

## Also fixed on the way

- `useOrderDetailRealtime` tested `newRow.assigned_to` for **truthiness**, so a
  return-to-pool (`assigned_to = NULL`) left the agent's panel open while the
  queue card vanished.
- **There was no "Retour au pool" / "Désassigner" button on the Orders page at
  all.** Everything behind it was wired end to end; `usePrimaryAction:99` gated
  the menu item to `role === "agent"`, so the one role that needs it never saw
  it. Now open to managers and super_admins, and added on `confirmed`.
- `recomputeTotal` in `items/[itemId]/route.ts` discarded its error entirely.
- `AssignBoard` reported `ids.length` instead of what the server assigned.

## Verified

pgTAP-style probes against production plus a full HTTP run through the live app
with three signed-in accounts: agent acquires → manager's reassign, field edit,
return-to-pool and cancel all refused 409 naming the agent → `market_manager`
force-release 403 → agent heartbeat alive → release → manager edit succeeds →
super_admin force-release 200 → agent's next heartbeat 409 `lock_lost`.

> **Testing note.** That run was done against a *real* order and left permanent
> rows in its append-only `order_history` (two probe edits and one force-release
> line). `order_history` cannot be cleaned up. Create a disposable order for any
> future end-to-end run.
