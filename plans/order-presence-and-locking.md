# Order presence & agent locking

> Implementation step 0: copy this file to `plans/order-presence-and-locking.md` at the project root (per CLAUDE.md "Save every Claude-created plan under /plans").

## Context

Today an agent and a manager can work the same order at the same time with **zero mutual awareness**, and the system lets both of them win in different ways.

- An agent opens an order only in local React state (`selectedOrderId` in `QueuePage.tsx:391`). Nothing server-side records that anyone has it open.
- `assign_order` (`supabase/migrations/20260505233818_pending_assignment_model.sql`) never checks who currently owns the order — a reassign silently overwrites.
- `manager-takeover.ts` records a takeover in `order_history` *after the fact*; it never blocks and never warns.
- The agent finds out only when their next write returns `404 Order not found` (every agent route answers 404, not 403, on an ownership mismatch) — after the phone call is already over.

The concrete failure: an agent is on the phone confirming an order, a manager reassigns it, and the agent's confirmation is refused with an error indistinguishable from "this order was deleted."

**What we're building** — a presence layer with an asymmetric guarantee:

| Situation | Effect |
|---|---|
| Agent has the order open | Managers see a head icon **and are hard-blocked** from reassigning, editing, or changing status |
| Manager has the order open | Agent sees a head icon, distinguishing *consulte* from *modifie*. **No block** — an agent mid-call is never frozen |
| Two managers on one order | They see each other. No block; the existing `expected_updated_at` conflict path already covers them |
| super_admin force-releases an agent's lock | The agent's panel shows a takeover screen naming who took it |

The asymmetry is deliberate: the destructive direction (manager yanks an order out from under a live phone call) gets the hard block; the benign direction (manager glances at a row) gets an icon.

### Decisions already made
- Presence = **the order's detail view is open on screen**. Managers additionally distinguish `viewing` vs `editing`.
- Blocked manager actions: **reassign + field edits + status changes** (incl. cancel/delete).
- Locks **auto-expire ~75s** after the last heartbeat. **super_admin** gets force-release; `market_manager` does not.
- Bulk assign **skips locked orders and reports them** ("197 assignées, 3 verrouillées").
- Enforced on **all four reassignment surfaces**: orders list + drawer, Team control room roster, Assignment board, Alerts panel.

---

## 1. Data model

One migration, `supabase/migrations/20260925000001_order_presence.sql`.

> **Numbering matters**: the directory is at `20260924000004`, and `20260910000001` is already used by *two* files. A `20260910…` name would collide and sort before applied migrations. Start at `20260925000001`.

```sql
CREATE TABLE public.order_presence (
  order_id   UUID NOT NULL REFERENCES public.orders(id)   ON DELETE CASCADE,
  session_id UUID NOT NULL,                    -- per TAB, not per user
  user_id    UUID NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  market_id  UUID NOT NULL REFERENCES public.markets(id)  ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('agent','market_manager','super_admin')),
  mode       TEXT NOT NULL DEFAULT 'viewing' CHECK (mode IN ('viewing','editing')),
  opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (order_id, session_id)
);

CREATE INDEX idx_order_presence_market_live ON public.order_presence (market_id, expires_at DESC);
```

- **PK `(order_id, session_id)`**, not `order_id` alone — an order now legitimately has several people present. `session_id` (a per-tab `crypto.randomUUID()`) also stops one closing tab from releasing another tab's row.
- **`role` is stamped on the row.** The block rule is a predicate over rows where `role = 'agent'`; managers are present but never blocking. Only the assignee can hold an agent row (RLS confines agents to `assigned_to = auth.uid()`), so at most one blocking identity exists per order without needing a unique index.
- **Stored `expires_at`, no `last_heartbeat_at`.** Force-release, natural expiry, and the client countdown all read one column, and the TTL lives in exactly one place. (A partial index `WHERE expires_at > now()` is illegal — `now()` isn't IMMUTABLE — hence the composite above.)
- Rows are **deleted** on release, never soft-deleted. The table holds "panels currently open" — tens of rows. Audit lives in `order_history`.

**RLS** — current initplan style (scalar-subquery wrapped, per `20260829000003_rls_initplan_orders_and_history.sql`):

```sql
CREATE POLICY order_presence_select ON public.order_presence FOR SELECT TO authenticated
USING (
  (select public.get_user_role()) = 'super_admin'
  OR ((select public.get_user_role()) = 'market_manager' AND market_id = (select public.get_user_market_id()))
  OR user_id = (select auth.uid())
  OR EXISTS (SELECT 1 FROM public.orders o
              WHERE o.id = order_id AND o.assigned_to = (select auth.uid()))
);
```

The last arm is what lets an agent see a manager standing on *their* order. It's a correlated `EXISTS` — normally the pattern `20260822000002` moved away from, but here it runs against a tens-of-rows table filtered to the agent's own queue ids, so it's a handful of PK lookups.

**No INSERT/UPDATE/DELETE policies.** `authenticated` cannot write this table directly; every mutation goes through a `SECURITY DEFINER` RPC that authorises itself — the shape `manual_delete_orders` already uses.

---

## 2. Enforcement — the hard block

### The trap that decides the design

`src/app/api/darb-assabil/sync-market/route.ts:41` builds a **user-session** client (not the admin client) and calls `promote_darb_status` with `p_actor_id: null` at line 164. This route fires **on every app launch, for every role**, and drives a large share of the Darb sync's ~117k order updates/day.

So `auth.uid()` is a real manager's UUID during those writes. **Any guard keyed on "is there a session?" would break the Darb sweep the moment one order in the market is locked.** The correct signal is the *named actor* (`p_actor_id`), which every system path already sets to `null` — verified in `sync-market/route.ts:164`, `sync-batch/route.ts:202`, and `auto-assignment-orchestrator.ts:80-86`.

`auth.uid()` *does* resolve inside `SECURITY DEFINER` (it reads the `request.jwt.claims` GUC; DEFINER changes the role, not GUCs). Proof in production: `manual_delete_orders` (`20260520181559_manual_delete_orders.sql:41`) opens with `IF p_actor_id IS NULL OR auth.uid() IS NULL OR auth.uid() <> p_actor_id`. And `auth.uid()` is NULL for `service_role` and pg_cron.

### Two-part guard

**(a) SQL helper, called by every mutating RPC** — `20260925000003_order_lock_guard.sql`:

```sql
CREATE OR REPLACE FUNCTION public.assert_order_unlocked(p_order_id uuid, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_holder uuid; v_name text; v_since timestamptz; v_expires timestamptz;
BEGIN
  IF p_actor_id IS NULL THEN RETURN; END IF;   -- system write: never blocked
  SELECT p.user_id, u.full_name, p.opened_at, p.expires_at
    INTO v_holder, v_name, v_since, v_expires
    FROM public.order_presence p JOIN public.users u ON u.id = p.user_id
   WHERE p.order_id = p_order_id
     AND p.role = 'agent'                       -- ONLY agents block
     AND p.expires_at > now()
     AND p.user_id <> p_actor_id                -- the holder's own writes pass
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  RAISE EXCEPTION 'order_locked' USING ERRCODE = '55006',
    DETAIL = json_build_object('order_id', p_order_id, 'holder_id', v_holder,
                               'holder_name', v_name, 'since', v_since,
                               'expires_at', v_expires)::text;
END; $$;
```

Called at the top of: `assign_order`, `unassign_order`, `return_order_to_pool`, `transition_order_status`, `no_response_with_auto_reject`, `manual_delete_orders`, `recover_deleted_order`, `bulk_cancel_orders`. `bulk_assign_orders` inherits it through `assign_order`.

**Deliberately NOT added to the warehouse RPCs** (`scan_order_out`, `scan_return_in`, `unscan_order`, `scan_received_in`, `record_stock_count`). An agent can legitimately hold a lock on an `uploaded` order; blocking the warehouse floor because a tab is open would be a worse bug than the one we're fixing. This carve-out gets its own test.

**(b) `BEFORE UPDATE` trigger on `orders`**, covering the direct `.update()` paths the helper can't reach (`PATCH /api/orders/[id]:506`, the two items routes):

```sql
-- SECURITY INVOKER is load-bearing. Inside a DEFINER function current_user is
-- the OWNER, so the test would read 'postgres' on every call and the guard would
-- silently never run. (Made and caught this mistake in production: the RPC path
-- blocked while a raw PATCH sailed through.)
CREATE OR REPLACE FUNCTION public.orders_assert_unlocked()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- service_role (admin client, cron) and postgres (any SECURITY DEFINER RPC)
  -- declare their actor via p_actor_id and are covered by assert_order_unlocked().
  -- Only a RAW table write as `authenticated` reaches here.
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  PERFORM public.assert_order_unlocked(NEW.id, (select auth.uid()));
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_orders_lock_guard BEFORE UPDATE ON public.orders FOR EACH ROW
WHEN (   OLD.assigned_to IS DISTINCT FROM NEW.assigned_to
      OR OLD.status IS DISTINCT FROM NEW.status
      OR OLD.customer_name IS DISTINCT FROM NEW.customer_name
      OR OLD.customer_phone IS DISTINCT FROM NEW.customer_phone
      OR OLD.customer_phone_2 IS DISTINCT FROM NEW.customer_phone_2
      OR OLD.customer_address IS DISTINCT FROM NEW.customer_address
      OR OLD.customer_city IS DISTINCT FROM NEW.customer_city
      OR OLD.customer_note IS DISTINCT FROM NEW.customer_note
      OR OLD.quantity IS DISTINCT FROM NEW.quantity
      OR OLD.total_price IS DISTINCT FROM NEW.total_price)
EXECUTE FUNCTION public.orders_assert_unlocked();
```

The `WHEN` list mirrors `trg_orders_broadcast_upd` and **deliberately omits `carrier_status_*`, `tracking_number`, `updated_at`** — which is what keeps `sync-batch/route.ts:190`'s raw `carrier_status_synced_at` write (an `authenticated` write!) out of the function body entirely.

**No route-level pre-flight checks.** The trigger runs inside the UPDATE and is race-free; a pre-check would be TOCTOU-racy and a second source of truth. Routes only *translate* the error.

### Error contract

SQLSTATE **`55006` (`object_in_use`)** → HTTP **409** with `{ code: "locked", lock: {...} }`, mirroring the existing `code: "conflict"` convention so `readActionFailure()` keeps working for callers that only check `conflict`.

New `src/lib/orders/order-lock.ts` holds `ORDER_LOCKED_SQLSTATE`, `LOCK_TTL_SECONDS = 75`, `LOCK_HEARTBEAT_MS = 25_000`, `readOrderLockError()`, `lockedResponse()`. Extend `src/lib/orders/action-failure.ts` with a `locked: OrderLockInfo | null` field.

> **The refactor that will silently half-ship this feature.** `src/lib/orders/assignment.ts:37,55,70,84`, `src/lib/orders/transition.ts:37` and `src/lib/orders/manual-delete.ts:159` all do `throw new Error(error.message)`, which **destroys `code` and `details`**. Every route behind them would receive the bare string `"order_locked"` and be unable to branch. These three must preserve the PostgREST error object (or throw a typed `OrderLockedError`). Nothing fails loudly if this is missed — the block just won't surface through ~12 routes.

Routes needing translation: `[id]/route.ts` (PATCH — currently a blanket 500 on `updateError`), `[id]/items/**`, `[id]/assign`, `[id]/reassign`, `[id]/transition`, `[id]/cancel`, `[id]/recover` (one new arm on its existing SQLSTATE switch), `[id]/confirm`, `/reject`, `/callback`, `/no-answer`, `/no-response`, `/attempt`, `/schedule-dispatch`, `/dispatch`.

### Bulk: skip and report

`bulk_assign_orders` is currently a `FOREACH` loop, all-or-nothing. Wrap the per-order call in a plpgsql `EXCEPTION WHEN SQLSTATE '55006'` block — that opens a subtransaction, so the locked order rolls back **alone** and the loop continues:

```sql
FOREACH v_id IN ARRAY p_order_ids LOOP
  BEGIN
    PERFORM public.assign_order(v_id, p_agent_id, p_actor_id, 'manager');
    v_assigned := v_assigned || v_id;
  EXCEPTION WHEN SQLSTATE '55006' THEN
    v_skipped := v_skipped || jsonb_build_object('order_id', v_id, 'reason', 'locked');
  END;
END LOOP;
RETURN json_build_object('assigned', v_assigned, 'skipped', v_skipped);
```

This is exactly the contract `/api/orders/auto-assign-bulk` already ships (`assigned[]` + `skipped[{order_id, reason}]`) — mirror its `SkippedEntry` union by adding `"locked"`. Same treatment for `bulk_cancel_orders`.

> The RPC *signature* is unchanged, but the JSON *shape* changes with **no compile-time check** (there is no generated Supabase types file, and `bulk-assign/route.ts:81` casts to `{ assigned: number }`). Ship migration + route together and tolerate both shapes for one release.

House rule worth writing down: **single-order action → fail loudly (409); bulk action → skip and report.**

---

## 3. Acquire / heartbeat / release

**One route, one verb** — `navigator.sendBeacon` can only POST, so a `DELETE` route would be unreachable from a tab-close beacon.

```
POST /api/orders/[id]/presence
  body { action: "acquire"|"heartbeat"|"release", session_id, mode }
  200 { data: { expires_at, server_now } }
  409 { code: "locked", lock }      acquire: an agent already holds it
  409 { code: "lock_lost" }         heartbeat: expired / force-released
POST /api/orders/[id]/presence/force-release     super_admin ONLY (403 for market_manager)
GET  /api/orders/presence?market_id=<uuid>       super_admin | market_manager only
```

Backing RPCs (`20260925000002_order_presence_rpcs.sql`), all `SECURITY DEFINER`, all self-authorising against `auth.uid()`:
`acquire_order_presence`, `heartbeat_order_presence`, `release_order_presence`, `force_release_order_presence`.

Acquire checks in order: `auth.uid()` non-null → role is one of the three → if `role = 'agent'`, `orders.assigned_to = auth.uid()` and the status is agent-actionable → then upsert `ON CONFLICT (order_id, session_id) DO UPDATE`, which takes the row lock and is race-free without an explicit `FOR UPDATE`. The client **never** sets `expires_at`; the RPC computes it from `p_ttl_seconds` so SQL and TS can't drift.

`force_release_order_presence` deletes only `role = 'agent'` rows (manager rows never block, so there is nothing to force), raises `42501` for `market_manager` **in the RPC** not just the route, appends one `order_history` row mirroring `logManagerTakeOver`'s wording, and emits the takeover push.

**Cadence: 25s heartbeat / 75s TTL** — three missed beats before expiry, tighter than the existing `usePresenceHeartbeat` (60s/5min), which is right: a lock should expire fast.

**Heartbeat stops when the tab is hidden.** The alternative — beating while hidden — means an agent who leaves a tab open overnight holds a lock forever, and `market_manager` has no force-release. Browsers throttle background `setInterval` to ≥1/min anyway. On `visibilitychange → visible`, **re-acquire** rather than heartbeat; it's idempotent if nobody took it, and returns `{acquired:false, holder}` if someone did, firing the same takeover path.

**Release on close**: `sendBeacon` on **`pagehide`** (not `beforeunload` — doesn't fire on mobile or bfcache entry), with `new Blob([JSON.stringify(body)], {type:"application/json"})` so the route can `req.json()`. Same-origin cookies ride along, so `getActor()`'s signed-cookie fast path works. Also release on panel close and unmount via plain `fetch`. **The TTL is the real fallback** — a crashed browser is gone in ≤75s with no cleanup job. Optional hygiene: a daily pg_cron `DELETE ... WHERE expires_at < now() - interval '1 hour'` (pg_cron already exists per `20260909000005`).

**New hook, not an extension of `usePresenceHeartbeat`** — different cadence, lifetime, payload and failure semantics. Coupling them would force the app-wide user beat from 60s to 25s, a 2.4× increase in a stream someone deliberately optimised off `auth.getUser()`.

---

## 4. Realtime

**Broadcast only. No new `postgres_changes` subscriptions.**

| Topic | Event | Who may join |
|---|---|---|
| `order_presence:market:<uuid>` | `presence_changed` | super_admin, market_manager |
| `order_presence:agent:<uuid>` | `presence_changed`, `lock_forced` | that agent only (exact match, no LIKE) |

> **The topic prefix must not start with `orders:market:`.** `orders_broadcast_read` matches `realtime.topic() LIKE 'orders:market:%'` and, since `20260924000004`, admits role `'agent'`. Naming this `orders:market:<uuid>:presence` would hand every agent the market's entire presence state.

Two **new, separate** SELECT policies on `realtime.messages` (policies are OR'd, so this can't weaken `orders_broadcast_read` and avoids the drop-and-recreate `20260924000004` needed).

Trigger mirrors `orders_broadcast_change` exactly: `SECURITY DEFINER`, `SET search_path = ''`, `realtime.send(..., private => true)`, body wrapped in `EXCEPTION WHEN OTHERS THEN RAISE WARNING` so a Realtime hiccup can never fail a presence write, and split INSERT/DELETE vs UPDATE (one trigger can't reference `OLD` on INSERT). The trigger routes to the market topic **and** to the assignee's agent topic when the presence row belongs to someone else.

`lock_forced` is emitted **from inside the RPC**, not the trigger — a normal release is also a DELETE, and only the RPC knows which case is a takeover.

---

## 5. Client & UI

### Agent side
- New `src/hooks/useOrderPresence.ts` — mounted by `OrderDetailPanel`, acquires on open, beats every 25s, releases on close/`pagehide`.
- `OrderDetailPanel` header + `OrderCard` in the queue show a manager head icon when a manager row exists on that order: **hollow 1.5px `--oms-ink-3` ring = "consulte"**, **filled 2px `--action` ring = "modifie"**, with the name in a `title` and a `Popover` on hover.
- New `src/components/queue/OrderTakeoverScreen.tsx` — full-panel, names the admin, one CTA back to the queue. Fired by `lock_forced` **and** by a `409 lock_lost` heartbeat (belt and braces: broadcast gives ≤1s, heartbeat gives ≤25s when the socket is down).
- Extend `useOrderDetailRealtime` with `onForceReleased` (note the hook's existing props are `onReassignedAway` / `onTerminated`; `onTerminatedByManager` is the *panel's* prop name).

### Manager side
- New `src/hooks/useOrderLocks.ts` — a **separate small SWR key**, deliberately not joined into the orders list (see §6).
- Indicator lives in the **agent cell** of `OrdersTable` (col 6, 130px), reusing the prior art in `src/components/team/control-room/AgentAvatar.tsx:43-48` (10px dot, `-bottom-0.5 -end-0.5`, `border-2 border-surface-card`). Per design-system §4.17 D, **never colour alone** — every indicator carries a `title`/`aria-label` naming the person and elapsed time. Per §7, **no pulsing or entrance animation**; only the two permitted 120ms colour transitions.
- New `src/components/orders/OrderLockedDialog.tsx` — `Sheet placement="center"` (there is no `Modal.tsx`; `CLAUDE.md:28` is stale). Shows the agent's avatar, name, "a cette commande ouverte depuis 3 min", the attempted action, and auto-dismisses when the lock clears. super_admin additionally gets "Forcer la libération".
- Blocked affordances (reassign, cancel, status) render disabled with an explanatory `title` rather than silently failing.
- Bulk bar reports partial results: "197 assignées, 3 verrouillées par un agent".
- Same treatment on the three other reassignment doors: `AgentRoster.tsx` (its "Réassigner à X" moves an agent's whole queue — highest-risk surface), `AssignBoard.tsx`, `AlertsPanel.tsx`.

i18n: new keys in `src/messages/fr.json` **and** `ar.json`; RTL-safe logical properties (`-s-`/`-e-`) throughout.

---

## 6. Performance guardrails

Explicit, because this repo has hard-won wins in `docs/orders-page-performance.md` that must not regress.

1. **The guard costs the Darb sync nothing.** Its writes are either `promote_darb_status` (`SECURITY DEFINER` → trigger's first `IF` returns; `p_actor_id NULL` → helper's first `IF` returns) or admin-client (`service_role` → first `IF` returns). Marginal cost is the trigger's ~10 `IS DISTINCT FROM` comparisons in `WHEN`, identical to what `trg_orders_broadcast_upd` already pays, and false for the overwhelming majority.
2. **Presence never enters `/api/orders/list`.** Beyond cost, joining it *doesn't work*: `useOrdersList` sets `revalidateFirstPage:false`, `revalidateOnFocus:false`, and `refreshInterval: 0` when realtime is live — acquiring a lock changes no order row, so no `order_changed` broadcast fires and a joined value would go stale indefinitely. SSR prefetch, cursor pagination and the `exact` count are untouched.
3. **No new `postgres_changes` subscriptions** — the transport `20260924000002` was written to escape. One extra Broadcast channel for managers, one per agent.
4. **Heartbeat broadcasts must not re-render the manager's table.** A pure heartbeat only moves `expires_at`. The client keeps entries in a **ref** and derives a render signature of `orderId:userId:mode` triples; `setState` fires only when that signature changes. Otherwise 50 rows would re-render every 25s.
5. **`OrderRow`'s memo comparator** (`OrderRow.tsx:417-442`) gains two **primitive** props (`presenceKind`, `presenceName`) computed once in `OrdersTable`. Passing a map object would defeat the memo and re-render every row.
6. **The liveness tick is 10s, not 60s**, and runs **only when ≥1 live presence row exists and the tab is visible**. With a 75s TTL, a 60s tick could show a lock as held up to 60s past expiry — the indicator would be lying. Zero locks → no timer at all.
7. **Clock skew**: the API returns `server_now`; compute the offset once. Five lines that kill the whole "indicator said unlocked but the save 409'd" bug class.
8. **Write volume** is one tiny upsert per open panel per 25s, bounded by concurrent open panels (tens). No new index on `orders`; the one new index is on a tens-of-rows table.
9. **Zero added latency on the agent's own hot path** — their writes short-circuit on `user_id = p_actor_id`.

---

## 7. Sequencing

Phases 1–3 ship **dark** — no client creates presence rows yet, so enforcement can be verified in production against zero rows before any UI exists.

- **Phase 0** — fix the `assigned_to: null` truthiness bug at `useOrderDetailRealtime.ts:65` (own commit, failing test first). Today `unassign_order`/`return_order_to_pool` set `assigned_to = NULL`, which fails the truthiness guard, so the panel stays open while `cache-patch.ts:109` correctly removes the card from the queue — an observable inconsistency *before* any lock work. Fix: `if (agentId && "assigned_to" in newRow && newRow.assigned_to !== agentId)`.
- **Phase 1** — `20260925000001`: table + RLS + index + broadcast triggers + the two new `realtime.messages` policies.
- **Phase 2** — `20260925000002`: the four presence RPCs + grants.
- **Phase 3** — `20260925000003`: `assert_order_unlocked` + calls in the 8 RPCs + `trg_orders_lock_guard`. pgTAP red→green.
- **Phase 4** — `src/lib/orders/order-lock.ts`, `action-failure.ts` extension, **and the lossy-rethrow refactor**.
- **Phase 5** — the three routes + `55006` translation across the ~15 mutating routes.
- **Phase 6** — bulk skip-and-report (RPC + route + bulk bar).
- **Phase 7** — agent client: `useOrderPresence`, panel wiring, `OrderTakeoverScreen`, manager-present icon.
- **Phase 8** — manager client: `useOrderLocks`, row indicator, `OrderLockedDialog`, disabled affordances, the three other surfaces.

---

## 8. Verification

**TDD is non-negotiable** (`CLAUDE.md`) — every phase writes its failing test first.

### pgTAP — `supabase/tests/order_presence.test.sql`
Follow `supabase/tests/scan_order_out.atomicity.test.sql` (`BEGIN; SELECT plan(n); … ROLLBACK;`, run via `psql -f`). The load-bearing cases:

- **`promote_darb_status` on a locked order succeeds with a manager's `auth.uid()` set.** *The single most important regression test in the set* — it is the Darb sweep.
- Raw `UPDATE orders SET carrier_status_synced_at` as `authenticated` on a locked order **succeeds** (the `WHEN` list; this is `sync-batch:190`).
- Raw `UPDATE orders SET status` as `service_role` **succeeds**; as `authenticated` **raises 55006**.
- `scan_order_out` on a locked `uploaded` order **succeeds** (the warehouse carve-out).
- `assert_order_unlocked(order, NULL)` is silent (system exemption); `(order, holder)` silent; `(order, other)` raises with parseable JSON `DETAIL`.
- A **manager** presence row does **not** block anyone; only `role='agent'` rows do.
- `market_manager` calling `acquire` → `42501`; calling `force_release` → `42501`.
- Two tabs of the same agent: closing one leaves the other's row (`session_id`).
- `bulk_assign_orders` with 3 of 5 locked → `assigned:[2]`, `skipped:[3]`, and the 2 really committed.
- RLS: agent sees a manager's row on their own order; sees nothing from another market.

### Vitest
Route tests per `src/app/api/presence/heartbeat/route.test.ts` (chainable `@/lib/supabase/server` mock + `makeGetActor`); hook tests per `src/hooks/__tests__/useOrdersRealtime.test.tsx` (the `channels[]` fake).
- `PATCH /api/orders/[id]` turns `55006` into `409 {code:"locked"}`, **not** the current blanket 500.
- `[id]/assign` asserts `details` **survives** `assignOrder()`'s rethrow — the test that catches the lossy `new Error(error.message)`.
- `useOrderPresence`: fake timers — beats at 25s, stops on hidden, **re-acquires** on visible, `sendBeacon` with the right Blob type on `pagehide`.
- `useOrderLocks`: liveness flips false on the tick with no new data; a heartbeat-only broadcast causes **no re-render**; skewed `Date.now()` still resolves via `server_now`.
- `OrderDetailPanel`: **a manager opening the panel never POSTs an agent-role presence row.**

### Browser, end to end (Playwright MCP, two sessions)
1. `agent1.tn@oms.local` opens an order → `admin@oms.local` sees the head icon on that row within ~1s.
2. Admin tries reassign → `OrderLockedDialog` names the agent and the elapsed time; the DB shows `assigned_to` unchanged.
3. Admin forces release → agent's panel shows the takeover screen; one `order_history` row written.
4. Reverse: admin opens the drawer → agent sees "consulte"; admin focuses a field → it becomes "modifie"; the agent confirms the order successfully **(no block)**.
5. Agent closes the tab → icon clears within ~1s (beacon) and, with the beacon blocked, within ≤75s (TTL).
6. Bulk-assign 20 orders with 2 locked → "18 assignées, 2 verrouillées".

### Perf regression checks
`npm run typecheck`, `npm run lint`, `npm run build`. Then confirm against `docs/orders-page-performance.md`: the orders list still makes **no** poll when realtime is connected; the Darb app-launch sweep still completes with locks present; the table does not re-render on heartbeat (React DevTools profiler).

Update `CLAUDE.md`'s reference list and add `docs/order-presence-and-locking.md` per the progressive-disclosure rule.
