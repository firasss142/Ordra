# Orders page performance — sequential, gated plan

## Context

The Orders page (`/[locale]/orders`) feels slow on every action, needs a manual refresh to
show status changes and new orders, shows stale carrier recommendations after a destination
edit, loads product thumbnails slowly, and has slow search. The audit of 2026-09-09
(code + production data) found three dominant causes and a set of secondary ones:

1. `get_customer_history_batch` runs on every list load and averages **2.6 s** (p50 3.3 s
   at the Supabase gateway, max 7.4 s = the 8 s `authenticated` statement timeout). Its
   plan is a nested loop over every order in the market calling `normalize_phone()` twice
   per pair; the phone-norm indexes are never used. A LATERAL rewrite was validated
   against production, read-only: **459 ms → 41 ms**, both phone indexes used.
2. Vercel functions run in `iad1` (US East) while Supabase is in `eu-central-1`
   (Frankfurt). Every DB round trip pays ~100 ms. Confirmed by the `x-vercel-id` header
   (`cdg1::iad1::…`) and by Supabase edge logs (authenticated p50 173 ms from IAD vs 42 ms
   from FRA).
3. Every filter change and every search keystroke calls `router.replace`, which makes
   Next 14 refetch the server page: middleware calls GoTrue, `page.tsx` re-runs an exact
   count and the agents query, all ignoring the filters. Then the client also fetches the
   list and the facet counts. Three requests per keystroke, one of them pure waste.

Realtime is wired (`useOrdersRealtime`) but production Realtime logs show the
`postgres_changes` poller being cancelled inside `realtime.apply_rls`, streams stopping and
restarting, and the client replaces rows with raw WAL rows (dropping image, display name
and badges) with no reconnect catch-up. Secondary: no optimistic concurrency on edits,
carrier-rate SWR key ignores the destination, SSR prefetch omits `image_url`, 1 MB PNGs
served into 40 px avatars, KPI strip = 8 round trips, middleware calls GoTrue on every
navigation, detail GET = 3 sequential round trips, and a 1 GB database tier shared with the
Darb sync's ~117k RPC calls/day.

**Rule of this plan:** steps are executed strictly in order. A step is finished only when
its *Done gate* is met and recorded. Step N+1 does not start before that.

**Scope constraint (from the request):** only the Orders page and what it directly depends
on. Other realtime consumers (agent queue, warehouse, detail panel) stay on
`postgres_changes` in this plan; the new broadcast channel is designed so they can adopt it
later.

### Baseline (browser) — captured 2026-09-09 21:55 UTC, super_admin, Libya market, Playwright

| Measurement on load | Before Step 1 | After Step 1 (same session, 2 min later) |
|---|---|---|
| `/api/orders/list?limit=25` | 5,945 ms | 873 ms |
| `/api/orders/status-counts` | 5,183 ms | 793 ms |
| `/api/orders/facet-counts` | 5,142 ms | 539 ms |
| `/api/agents`, `/api/products`, `/api/carriers` | 4,900–5,200 ms each | 470–580 ms each |
| Document response | 1,487 ms | — |
| Requests on load (all kinds) | 67 | — |

Typing `925782` in search (6 keystrokes, before Step 1): 1 list request (436 ms, few rows
so the enrichment was cheap), 1 facet-counts request, and 1 RSC refetch of the page
(794 ms) — the Step 3 target.

Note for a later step: the sidebar prefetches ~10 route RSC payloads on load
(`/fr/dashboard`, `/fr/products`, `/fr/dashboard/stock`, …), each a dynamic server render
competing with the page's own requests.

## Decisions taken with the user (2026-09-09)

- **Gates are verified on production** after the deploy from `main`, on
  `https://ordra-gamma.vercel.app` with the seeded test accounts (`admin@oms.local`,
  `manager.ly@oms.local`, `agent1.ly@oms.local`). Migrations land in the production
  Supabase project at step time, as they already do in this repo.
- **Step 4 migrates the Orders page only** (`useOrdersRealtime`, both mounts). The other
  hooks stay on `postgres_changes`; the broadcast topic is designed so they can adopt it in
  a later plan.
- **Step 10 may trust the signed 5-minute profile cookie** in middleware, the same trust
  every API route already applies through `getActor`.
- **The compute upgrade is not a step.** After Step 2's gate, re-measure
  `GET /rest/v1/orders` p50 in the edge logs; upgrade only if it stays above ~100 ms.

## Ground rules for every step

- TDD per `CLAUDE.md`: failing test first, minimal code, refactor. Test helpers live in
  `src/test/helpers/`, never in production code.
- After every file change: `npm run typecheck`. Before commit: `npm run lint`,
  `npm run test:run`, `npm run build`.
- SQL migrations: one file per concern in `supabase/migrations/`, named so they sort after
  the current last file `20260923000002_*` (use `20260924000001_…`, `…000002`, …), header
  comment with WHY / WHAT / NON-GOALS and the measured numbers (template:
  `20260829000002_sargable_customer_history_and_duplicates.sql`). Function migrations use
  `CREATE OR REPLACE` with an unchanged signature (grants are inherited) and no
  BEGIN/COMMIT; `CONCURRENTLY` index files contain index DDL only. Apply to project
  `vshynigvgrlihngozuwb` with the Supabase MCP `apply_migration` (index DDL via
  `execute_sql`, as `plans/agent-queue-performance-fix.md` records), commit the file, then
  re-verify with `execute_sql`. This repo has no `db:push` script.
- Test patterns to reuse (no new helpers needed): API routes mock
  `@/lib/supabase/server.createClient` with the self-returning awaitable chain
  (`src/app/api/orders/list/route.test.ts:36-46`) or mock `@/lib/auth/actor` with
  `makeGetActor` from `src/test/helpers/actorMock.ts`; realtime hooks wrap the real
  `RealtimeProvider` + `SWRConfig` with a channel stub that records `on()` and calls
  `subscribe(cb)` with `"SUBSCRIBED"` (`src/hooks/__tests__/useOrderDetailRealtime.test.tsx`,
  `src/lib/realtime/__tests__/bus.test.ts`); page clients mock the data hooks wholesale
  (`src/app/[locale]/(dashboard)/orders/archive/__tests__/ArchivePageClient.test.tsx`);
  `next/navigation` and `next-intl` are mocked per file (see
  `src/components/queue/__tests__/QueuePage.bulkAdvance.test.tsx:36-40` and
  `src/test/helpers/mockNextIntl.ts`).
- Measure before/after with the same instruments used for the baseline: Supabase
  `pg_stat_statements` (reset 2026-09-08 17:00 UTC), Supabase edge logs
  (`response.origin_time` per `request.path`), browser DevTools Network panel on the
  deployed app, Realtime logs.
- Each step ends with a commit (`git commit`, user's call whether to push) and a gate
  record appended to the durable copy of this plan under `plans/`.
- Rollback path is listed per step; nothing in this plan touches `order_history` or
  `inventory_log`, and no stock path.

## Baseline (production, 2026-09-09)

| Measurement | Value |
|---|---|
| `get_customer_history_batch` mean / max (pg_stat_statements) | 2,625 ms / 7,377 ms |
| `get_customer_history_batch` gateway p50 / p95 | 3,265 ms / 4,953 ms |
| `get_duplicate_orders_batch` mean, gateway p50 | 126 ms, 230 ms |
| `GET /rest/v1/orders` gateway p50 / p95 | 212 ms / 1,928 ms |
| `HEAD /rest/v1/orders` (KPI counts) p50 / p95 | 221 ms / 2,278 ms |
| `/auth/v1/user` calls per day, p50 / p95 | 4,820, 120 ms / 1,452 ms |
| Authenticated request p50 from IAD vs FRA colo | 173 ms vs 42 ms |
| Realtime: apply_rls cancellations / stream stops / restarts (24 h) | 3 / 5 / 9 |
| Largest product images | 1,101 KB and 927 KB PNG |
| Same image via Storage render endpoint at 80×80 | 2 KB (verified, HTTP 200) |
| DB tier signals | shared_buffers 280 MB, max_connections 60, 1 GB RAM |

Browser-side baseline to capture in Step 0 (DevTools, admin account, Orders page, LY
market): time-to-rows on load, `/api/orders/list` duration, `/api/orders/status-counts`
duration, request count on load, request count per search keystroke.

## Steps

### Step 0 — Bank the plan and capture the browser baseline

**Goal:** a durable, editable copy of this plan in the repo, and numbers to compare every
gate against.

- Copy this file to `plans/orders-page-performance-plan.md` (house rule: plans live under
  `plans/`). Gate results get appended there after each step.
- With the deployed app (`https://ordra-gamma.vercel.app`) and the super_admin test
  account, open the Orders page on the LY market with DevTools → Network, "Disable cache"
  on. Record: total requests on load; duration of `/api/orders/list`,
  `/api/orders/status-counts`, `/api/orders/facet-counts`; the RSC request (`?_rsc=`) that
  fires when a filter chip is clicked; requests fired per search keystroke (type a
  phone number). Note the `x-vercel-id` header region prefix.

**Done gate:** the plan file exists under `plans/` with a "Baseline (browser)" table filled
in.

---

### Step 1 — Make the two enrichment RPCs index-driven

**Goal:** `/api/orders/list` no longer waits seconds on `get_customer_history_batch`;
the 8 s timeout tail (empty badges) disappears.

**Why this shape:** the current phone leg is
`JOIN orders o ON … AND (normalize_phone(o.customer_phone) = ANY (i.phones) OR …)`.
The planner materialises all ~3.3k market orders and evaluates the join filter for every
input × order pair (83k evaluations, two plpgsql calls each). Turning each phone into a
probe row and joining through a LATERAL subquery makes both expression indexes
(`idx_orders_market_phone_norm`, `idx_orders_market_phone2_norm`) the driving path.
Validated read-only on production with a real 25-row page: 459 ms → 41 ms.

**Changes**

- New migration `supabase/migrations/2026MMDD000001_customer_history_batch_lateral.sql`
  (function-only; keep the same signature, RETURNS TABLE, SECURITY DEFINER, STABLE,
  grants and the caller-market guard at the top of the body):
  - Replace CTEs `inputs` → add `phone_probe AS (SELECT src_id, src_kind, unnest(phones) AS ph FROM inputs)`.
  - Replace `order_phone_matches` with `FROM phone_probe pp CROSS JOIN LATERAL (
    SELECT … FROM orders o WHERE o.market_id = p_market_id AND normalize_phone(o.customer_phone) = pp.ph AND (o.id <> pp.src_id OR pp.src_kind <> 'order') AND o.status::text <> 'deleted'
    UNION SELECT … WHERE normalize_phone(o.customer_phone_2) = pp.ph …) o` (UNION dedupes a
    number present in both columns).
  - Leave `order_identity_matches`, `lead_phone_matches` and the aggregates as they are
    (12 ms and 20 ms in the measured plan).
  - Header comment records the before/after plan and the "do not use `= ANY(array)` from a
    CTE" lesson.
- Same treatment for `get_duplicate_orders_batch` in the same migration: its `matches` CTE
  (`20260829000002_sargable_customer_history_and_duplicates.sql:218-313`) has the identical
  `normalize_phone(o.customer_phone) = ANY (i.phones) OR …phone_2… = ANY (i.phones)` join
  (mean 126 ms, gateway p50 230 ms today). Rewrite it as the same LATERAL phone-probe
  (UNION of the two phone legs) and keep the product, ±86,400 s window and status
  predicates inside the lateral subquery; keep the `LEFT JOIN products p` after it.
- Double-counting guard: `unnest(phones)` yields up to two probe rows per input, so an
  order whose number matches on both probes would be emitted twice and inflate
  `prior_order_count` / `duplicate_count` / `siblings`. Apply `SELECT DISTINCT ON (src_id,
  oid)` (or `DISTINCT`) on the lateral output before aggregating, in both functions, and
  re-EXPLAIN after adding it. `20260829000002_…sql:16-22` documents this exact trap.
- Both functions keep their exact signatures, `RETURNS TABLE` columns, `STABLE SECURITY
  DEFINER`, and the caller-market guard; no `DROP FUNCTION` (a signature change would
  create a second overload, see `20260827000005_rejection_subreason_in_transition.sql:1-13`).
- No TypeScript change: `src/lib/customer-history/enrich.ts` and
  `src/lib/duplicate-orders/detect.ts` keep the same contract.

**Tests first**

- SQL functions have no Vitest harness here; the pgTAP files in `supabase/tests/` are
  psql-driven and not wired to CI, so the tests for this step are run through the MCP
  before applying, read-only:
  1. Equivalence: for 200 recent orders per market, run the OLD inner query and the NEW
     inner query as plain SELECTs and compare with `EXCEPT ALL` both ways → 0 rows, AND
     compare raw row counts and `sum(prior_order_count)` / `sum(duplicate_count)` (plain
     `EXCEPT` dedupes and would hide the double-count above; `20260829000002:30-41`
     explains why). For the duplicates function also compare the sibling id sets.
  2. Plan: `EXPLAIN (ANALYZE, BUFFERS)` of each new body with the 25-row sample shows the
     phone-norm index scans and executes in < 60 ms.
- The existing Vitest suites for the list route, `detect.ts` and `classify.ts` stay
  green (they mock the RPC and cover the contract).

**Done gate** (all three):

1. `EXPLAIN ANALYZE` of the new function body on production shows
   `Index Scan using idx_orders_market_phone_norm` and `…phone2_norm`, execution < 60 ms.
2. Recorded within 24 h of deploy (non-blocking for Step 2, which is config-only):
   `pg_stat_statements` mean for the function < 100 ms and max < 1,000 ms; edge-logs p50
   for `/rest/v1/rpc/get_customer_history_batch` < 200 ms.
3. Browser: `/api/orders/list` duration on the LY market ≤ 1,000 ms (baseline captured in
   Step 0; it should fall by roughly the 3 s the RPC cost).

**Rollback:** re-apply the previous function body (from
`supabase/migrations/20260829000002_*`); no schema change is involved.

**Gate record (2026-09-09 21:57 UTC):** migration `20260924000001_batch_rpcs_lateral_phone_probe.sql`
applied via MCP `apply_migration`. (1) EXPLAIN on production: phone leg on
`idx_orders_market_phone_norm` / `_phone2_norm`, 49 ms (was 415 ms); duplicates 21 ms on
`idx_orders_market_created`. Equivalence: 0 differing rows both ways on 200 orders per
market, sums equal. (3) Browser `/api/orders/list`: 5,945 ms → 873 ms. (2) `pg_stat_statements`
mean is cumulative since 2026-09-08 and still shows the old figure; first post-migration
call registered `min_exec_time` 43.1 ms — re-read within 24 h. Vitest: list route,
`detect.ts`, `classify.ts` suites green (42 tests). Step 1 DONE; Step 2 may start.


---

### Step 2 — Run Vercel functions next to the database

**Goal:** remove the transatlantic hop from every DB round trip.

**Changes**

- `vercel.json`: add `"regions": ["fra1"]` (Frankfurt, same city as `eu-central-1`;
  Hobby allows exactly one region). Keep the existing `functions` block.
- Nothing else. Middleware stays at the edge; the browser client is unaffected.

**Tests first:** none applicable (config). Add a one-line note in `docs/mastery-guide.md`
or the plan file that functions must stay in `fra1` while the DB is in `eu-central-1`.

**Done gate:**

1. Response header on the deployed app reads `x-vercel-id: <edge>::fra1::…`.
2. Supabase edge logs, recorded within 24 h (non-blocking for Step 3): authenticated
   requests now arrive at a European colo (`request.cf.colo` = FRA/CDG/AMS…) with p50
   `origin_time` < 80 ms (baseline 173 ms).
3. Browser: `/api/orders/status-counts` and `/api/orders/list` both faster than the
   Step 1 gate numbers by ≥ 150 ms.

**Rollback:** remove the `regions` key and redeploy.

---

### Step 3 — Stop the server re-render on filter changes and search keystrokes

**Goal:** a filter click or a search pause fires exactly one list request (plus facet
counts), never an RSC round trip.

**Changes**

- `src/hooks/useOrdersFiltersUrl.ts:35`: replace `router.replace(url, { scroll: false })`
  with `window.history.replaceState(null, "", url)`. **The state argument must be `null`,
  not `window.history.state`**: Next's patched `replaceState`
  (`node_modules/next/dist/client/components/app-router.js:449-451`) returns early when
  the state carries `__NA`, which the current entry always does after hydration, and then
  `useSearchParams` never updates. With `null`, Next copies its internal state and
  dispatches the URL change, so `parseFiltersFromSearchParams` re-runs. (The existing
  `open`/`view` sync in `OrdersPageClient.tsx` passes `window.history.state`; it gets away
  with it only because those params are never read back.) Drop the `useRouter` import.
- `src/app/[locale]/(dashboard)/orders/page.tsx`: no change needed for correctness (a hard
  reload with filters in the URL still SSR-renders). Optional: keep as is.

**Tests first**

- New `src/hooks/__tests__/useOrdersFiltersUrl.test.tsx` (none exists; the pure core
  `list-filters.ts` is already covered): with `next/navigation` mocked per file and a
  `vi.spyOn(window.history, "replaceState")`, `setFilters` must call `replaceState` with
  `null` state and the serialised params, must preserve `open`/`view`, and must not call
  `router.replace`. The `next/navigation` mock must return a real `URLSearchParams`
  (the hook spreads it).

**Done gate:**

1. Tests green; typecheck/lint/build green.
2. Browser: clicking a status facet or typing in search produces no `?_rsc=` request; the
   skeleton from `loading.tsx` never flashes; the URL still updates, the table follows it,
   and a reload reproduces the filtered view. The `/auth/v1/user` drop is middleware-side
   and shows only in the Supabase edge logs (count per hour before/after).

**Rollback:** revert the one-line change.

---

### Step 4 — Rebuild the Orders page realtime on Broadcast from Database

**Goal:** status changes (agent, manager, cron) and new orders appear on the Orders page
within ~1 s without a refresh; the KPI strip and facet counts follow; reconnects catch up;
the footer tells the truth.

**Why broadcast:** `postgres_changes` evaluates the `orders` RLS policy per change per
subscriber inside Realtime's poller; production logs show those polls being cancelled and
the stream stopping/restarting. Broadcast authorises once at channel join (RLS on
`realtime.messages`) and the trigger sends a slim payload. The project already has
`realtime.send(payload, event, topic, private)` and `realtime.topic()` (verified).

**Changes**

*Database (one migration `…_orders_broadcast.sql`):*
- Trigger function `public.orders_broadcast_change()` declared **`SECURITY DEFINER SET
  search_path = ''`** (owner `postgres`). This is mandatory: `realtime.send` is not
  security-definer, it inserts into `realtime.messages` as the invoking role, that table
  has RLS enabled with no INSERT policy, so a write made through a user session (PATCH,
  `transition_order_status`) would have its broadcast silently dropped as a warning while
  cron/service-role writes would work. The function calls
  `realtime.send(jsonb_build_object('op', TG_OP, 'id', …, 'market_id', …, 'status', …,
  'assigned_to', …, 'archived_at', …, 'updated_at', …), 'order_changed',
  'orders:market:' || COALESCE(NEW.market_id, OLD.market_id)::text, true)`, wrapped in
  `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING` so a Realtime hiccup can never fail
  an order write.
- Two triggers, because one trigger cannot reference `OLD` on INSERT or `NEW` on DELETE:
  `trg_orders_broadcast_ins_del AFTER INSERT OR DELETE ON orders FOR EACH ROW`, and
  `trg_orders_broadcast_upd AFTER UPDATE ON orders FOR EACH ROW WHEN (…)` — the UPDATE
  one fires only when a list-visible column actually changed
  (`OLD.status IS DISTINCT FROM NEW.status OR … assigned_to, archived_at, carrier_id,
  tracking_number, customer_name, customer_phone, customer_city, product_id, quantity,
  total_price, callback_scheduled_at, attempts_count, rejection_reason,
  carrier_barcode_deleted_at`). Never compare `updated_at` or `carrier_status_*`:
  `promote_darb_status` (`20260922000021_darb_status_model.sql:104-107`) rewrites
  `carrier_status_slug`, `carrier_status_synced_at` and `tracking_number` on every poll
  and bumps `updated_at` through `trg_orders_updated_at`, ~117k times a day. `UPDATE OF`
  alone would not filter that (it is column-mentioned, not column-changed). This is the
  first AFTER trigger on `orders`; the three existing BEFORE triggers (`…updated_at`,
  `…stamp_terminal`, `…set_warehouse`) have already run, so `NEW` is final. Use
  `DROP TRIGGER IF EXISTS … ; CREATE TRIGGER …` as the other two do.
- RLS on `realtime.messages`: `CREATE POLICY orders_broadcast_read ON realtime.messages
  FOR SELECT TO authenticated USING (realtime.topic() LIKE 'orders:market:%' AND (
  (select get_user_role()) = 'super_admin' OR ((select get_user_role()) IN
  ('market_manager') AND realtime.topic() = 'orders:market:' || (select get_user_market_id())::text)))`.
  Super_admin "all markets" subscribes to both market topics and resubscribes on scope
  switch. Membership is checked at join and token refresh only, so a role change needs a
  rejoin (documented, acceptable).

*Client:*
- `src/lib/realtime/bus.ts`: add `subscribeBroadcast({ topic, event }, handler, onStatus?)`
  — refcounted like `subscribe`, channel created with `{ config: { private: true } }`,
  `await supabase.realtime.setAuth()` **with no argument** before `subscribe` (supabase-js
  2.103 already wires the session token into joins and pushes on `TOKEN_REFRESHED`;
  passing an explicit token switches the client to manual mode and disables the
  automatic refresh), and a `subscribe((status) => …)` callback that fans out
  `SUBSCRIBED | CHANNEL_ERROR | TIMED_OUT | CLOSED` to listeners, exposing per-topic
  connection state from the bus/provider (not from the hook, to avoid the
  `useOrdersList` ↔ `useOrdersRealtime` cycle). Access `supabase.realtime` lazily inside
  the subscribe call so the existing `@/lib/supabase/client` stubs in other tests keep
  working. The existing
  `subscribe()` (postgres_changes) stays untouched: nine other hooks use it
  (`useOrderDetailRealtime`, `useAgentQueueRealtime`, `useWarehouseRealtime`,
  `useFollowUpsRealtime`, `useAlerts`, `useTeamLive`, `useInDeliverySummary`,
  `useAgentNotifications`, `useUnassignedOrders`). Expose `useRealtimeBroadcast` in
  `RealtimeProvider.tsx` (mounted once in `src/app/[locale]/layout.tsx`) mirroring
  `useRealtimeSubscribe`.
- `src/hooks/useOrdersRealtime.ts`: switch to the broadcast hook, one subscription per
  market topic (two for super_admin "all"). It has two mounts, `OrdersPageClient.tsx` and
  `archive/ArchivePageClient.tsx` (`matchFilter: () => false`, removal-only) — both must
  keep working. Event handling:
  - Coalesce events for 300 ms (single timer), then `mutate()` the infinite list and
    `globalMutate` every key starting with `/api/orders/status-counts`,
    `/api/orders/facet-counts` and `/api/orders/unassigned/count` (reuse the pattern in
    `OrdersPageClient.refreshAfterAssign`). Those two routes send `Cache-Control:
    private, max-age=30` / `max-age=15`, so a revalidation within that window is served
    from the browser cache and the KPI strip would not move: change both routes to
    `no-store` (the SWR layer already dedupes) in this step. This also fixes the same
    latent bug in `refreshAfterAssign`.
  - Before the timer fires, patch the row in place if present: only `status`,
    `assigned_to`, `archived_at`, `updated_at` (never replace the whole row). Rows that
    stop matching `matchFilter` are removed; terminal transitions still call
    `useRealtimeToast` with the cached row (it needs `external_id`, which the slim payload
    does not carry).
  - `DELETE` events remove the row; `INSERT` events just trigger the revalidate (a full row
    needs the enriched shape from the API).
  - Respect `editLock` exactly as today.
- Connection state: read `connected` for the market topic(s) from the provider in
  `OrdersPageClient` and pass it to `useOrdersList`, which sets `refreshInterval`
  `20_000` while disconnected and `0` while connected (drop the fixed 120 s poll).
  Revalidate on transition to `SUBSCRIBED` and on `document.visibilitychange → visible`.
  `ArchivePageClient.test.tsx:27` mocks `useOrdersRealtime` as `() => {}`; update it to
  the new return shape.
- `OrdersPageClient.tsx` footer: replace the static `orders.footerLive` text
  ("temps réel" / "مباشر") with a two-state indicator using new keys
  `realtime.connection.live` / `realtime.connection.reconnecting` in `src/messages/fr.json`
  and `ar.json` (the `realtime` namespace already holds the toast strings).

**Tests first**

- Extend `src/lib/realtime/__tests__/bus.test.ts`: broadcast subscribe is refcounted,
  sets auth before joining, fans out status changes, removes the channel on last
  unsubscribe.
- New `src/hooks/__tests__/useOrdersRealtime.test.tsx` (none exists; copy the wrapper
  from `useOrderDetailRealtime.test.tsx`): an `order_changed` event patches only the
  listed fields, coalesces two events into one `mutate`, removes rows that no longer
  match, calls `globalMutate` for the `/api/orders/status-counts`,
  `/api/orders/facet-counts` and `/api/orders/unassigned/count` prefixes, ignores locked
  rows, and flips `connected`.
- Migration verified by SQL **as the `authenticated` role**, not as `postgres` (which
  bypasses RLS and would pass falsely): in one `execute_sql` call, `SET ROLE authenticated;
  SELECT set_config('request.jwt.claims', '{"sub":"<manager.ly user id>","role":"authenticated"}', true);`
  then `UPDATE orders SET carrier_status_synced_at = now() WHERE id = <test order>` must
  NOT produce a `realtime.messages` row, while a status change on the seeded E2E order
  must produce exactly one with the slim payload. Run inside a transaction that is rolled
  back.

**Done gate:**

1. Tests green; typecheck/lint/build green.
2. Two browsers on production: agent (`agent1.ly`) confirms/rejects an order → the
   manager's (`manager.ly`) Orders page row, KPI strip and facet counts update within 2 s
   with no refresh; a webhook-created order (or one created via "Nouvelle commande" from
   another session) appears at the top within 2 s; a status set by the Darb sync appears
   without refresh.
3. Sleep the laptop 2 minutes, wake: the footer shows "reconnecting" then "live", and the
   list revalidates once.
4. Informational, not blocking: Realtime logs over the next day, count of
   `PoolingReplication…` cancellations (nine other hooks still use `postgres_changes`, so
   the count is not attributable to this page).

**Rollback:** `DROP TRIGGER IF EXISTS` for both triggers, drop the function and the
policy; the old `postgres_changes` path stays in `bus.ts` and can be re-pointed in
`useOrdersRealtime`.

---

### Step 5 — Optimistic concurrency for edits and actions

**Goal:** two people acting on the same order never silently overwrite each other; the
loser sees what happened and gets fresh data.

**Changes**

- `src/app/api/orders/[id]/route.ts` (PATCH): accept optional `expected_updated_at` in the
  body. When present, run the UPDATE with `.eq("id", id).eq("updated_at", expected)`.
  Pass the string through exactly as the client received it: the BEFORE trigger
  `update_updated_at` stamps `now()` with microseconds, so normalising through
  `new Date(x).toISOString()` (millisecond precision) would make every save a conflict.
  Validate only that it parses as a date.
  On zero rows, re-read `updated_at`: if it differs → respond `409 { error: "conflict",
  data: <fresh order incl. history + items, same shape as GET> }`; if it is equal → keep the
  existing "ne peut plus être modifiée" 409 (RLS refusal). The history INSERT stays after a
  confirmed write, as today.
- `src/hooks/useOrderMutation.ts` `commit()`: send `expected_updated_at` from a
  per-order ref holding the **last server-returned** `updated_at` (updated from every
  successful PATCH/GET response), not from the optimistic cache: two quick edits by the
  same user overlap (that is why `commitIdRef` exists), and reading the pre-optimistic
  value would make the user's own second edit a false conflict. Serialise commits per
  order (await the previous one) as a second guard. On a 409 `conflict`, after the
  awaited `mutate` rejects (its `rollbackOnError` runs first), write the server's fresh
  `data` into the SWR cache and throw a typed `OrderConflictError`.
- The route's explicit `updates.updated_at = new Date().toISOString()` is dead code (the
  BEFORE trigger overrides it); remove it to avoid confusion.
- `src/components/queue/OrderDetailPanel/index.tsx` `runCommit` (line 607): catch
  `OrderConflictError`, set `saveError` to a new i18n message ("Modifié entre-temps par un
  autre utilisateur, valeurs rechargées") and leave the field editable with the fresh
  value. Today `saveError` is rendered only inside `OrderItemsCard` (`OrderItemsCard.tsx:323`);
  a failed address or destination commit shows nothing but the 2.5 s header flash. Pass
  `saveError` to `CustomerCard` as well and render it under the field that failed.
- Status actions from the Orders page (`cancel`, `recover`, bulk assign/cancel/reopen/
  upload, the post-call sheet): they already go through `transition_order_status` /
  `fulfill_order_transition`, which lock the row and validate the from-status.
  `transition/route.ts:71-73` already answers `400` for `invalid transition` and the queue
  and post-call callers depend on that; keep the status code and add `code: "conflict"`
  plus the fresh `status` to that body (and to the page's action routes). In
  `OrdersPageClient` handlers, on `code === "conflict"`: `mutate()` the list and show the
  banner "Commande déjà traitée entre-temps, liste actualisée" (the RPC error carries no
  actor name).

**Tests first**

- Extend `src/app/api/orders/[id]/patch.test.ts` (812 lines, Pattern A chain mocks):
  matching `expected_updated_at` → 200; stale → 409 with fresh `data`; missing → old
  behaviour; RLS zero-row with equal `updated_at` → the existing 409 message.
- `src/hooks/useOrderMutation.test.tsx`: 409 conflict replaces cache with server data
  and rejects with `OrderConflictError`; optimistic value is not kept; two overlapping
  commits send the server's `updated_at`, not the optimistic one.
  `OrderDetailPanel.test.tsx:18` mocks `useOrderMutation` — extend the mock shape.
- `transition/route.test.ts`: RPC error containing `invalid transition` → 400 with
  `code: "conflict"` and the fresh `status`.

**Done gate:** tests green; manual check on production with two sessions: manager edits
the address while the agent edits the phone on the same order → second save gets the
conflict notice and sees both values after reload of the panel; agent confirms an order the
manager is cancelling → the manager gets the banner and the list shows `confirmed`.

**Rollback:** the body field is optional, so reverting the client alone restores the old
behaviour.

---

### Step 6 — Carrier recommendation follows the destination

**Goal:** after a Darb destination (or Tunisian city) edit, the rate badges and the
pre-selected carrier update immediately.

**Changes**

- `src/hooks/useCarrierRates.ts`: signature becomes
  `useCarrierRates(orderId, enabled, destinationKey: string | null)`; the SWR key appends
  `&dest=<destinationKey>` (a cache discriminator; the route ignores it). Callers pass
  `order.darb_destination_id ?? order.dexpress_state_id ?? order.city_id ?? order.customer_city`.
  Call sites: `OrderDetailPanel/index.tsx`, `PostCallActionSheet.tsx`,
  `ScheduleDispatchModal.tsx`, `DarbAssabilDispatchModal.tsx`.
- `useOrderMutation.commit`: after a successful PATCH whose body contained
  `darb_destination_id`, `city_id` or `dexpress_state_id` (the only three keys that move
  the destination; `customer_address` is copied through untouched by the route),
  `globalMutate` keys starting with `/api/carriers/rates?order_id=<id>` (belt and braces
  with the key change).
- Picker selection reset: `PostCallActionSheet.tsx` keeps `selectedCarrierId` (line 242)
  and its auto-select effect (lines 357-374) defers to `pickInitialCarrier`, whose first
  rule is "the current selection always wins" — so a destination change can never move
  the selection today. Reset `selectedCarrierId` to `null` in an effect keyed on the
  destination key. The detail panel's upload sheet dispatches on click and holds no
  selection; only its `selectedDarbCarrierId` (Darb modal) needs the same reset.
- Copy: the address field gets a one-line helper (new i18n key) saying the price follows
  the destination picker, since free-text address edits cannot change the Darb city/area
  pair. No automatic re-binding.

**Tests first**

- New `src/hooks/__tests__/useCarrierRates.test.tsx`: key changes when `destinationKey`
  changes; null key when disabled.
- `initial-carrier-selection.test.ts` already covers the pure rule; add a
  `PostCallActionSheet` test: a destination change clears the selection and the next
  `bestChoiceCarrierId` is applied.
- `useOrderMutation.test.tsx`: a commit with `darb_destination_id` triggers the rates-key
  mutate; one with `customer_address` does not.

**Done gate:** tests green; on production, open a confirmed LY order, change its Darb
destination to a different city → within one request the badge amounts and "le moins
cher" pill change and the pre-selected carrier follows.

**Rollback:** revert; the route is untouched.

---

### Step 7 — Product thumbnails: right size, present on first paint, never vanish

**Changes**

- `src/app/[locale]/(dashboard)/orders/page.tsx`: `LIST_COLS` embed becomes
  `product:products!orders_product_id_fkey(name, image_url)` and the row mapper sets
  `product_image_url: unwrapEmbed(product)?.image_url ?? null` (helper already in
  `src/lib/orders/display-name.ts`). Keep the "must stay in sync with LIST_SELECT" comment.
- New client-safe helper `src/lib/images/thumb-url.ts`: `productThumbUrl(url, px)`
  rewrites a Supabase public object URL (`/storage/v1/object/public/…`) to the render
  endpoint (`/storage/v1/render/image/public/…?width=px&height=px&resize=cover&quality=70`),
  preserving the `?v=` cache-buster as an extra param; non-Supabase URLs pass through.
  (Verified on this project: 112 KB → 2 KB at 80×80, HTTP 200.)
- `src/components/orders/ProductAvatar.tsx`: `src = productThumbUrl(imageUrl, size*2)`
  with `srcSet` for 1x/2x, keep `loading="lazy" decoding="async"`, add
  `fetchPriority="low"`. On `onError`: first fall back to the original URL, only then to
  the initial; reset the error state whenever `imageUrl` changes (today `errored` is
  never reset when the prop changes in place). Reuse `getProductInitial` /
  `getProductAvatarColor` from `src/lib/product-avatar.ts` (already tested) instead of the
  inlined duplicate.
- No `sharp`, no `next/image` needed: the Storage render endpoint resizes and the CDN
  caches it.
- Step 4 already removed the row replacement that wiped `product_image_url`.

**Tests first**

- New `src/lib/images/__tests__/thumb-url.test.ts` (Supabase URL with `?v=`,
  non-Supabase URL, null).
- New `src/components/orders/__tests__/ProductAvatar.test.tsx`: renders the
  render-endpoint URL; falls back to the original, then to the initial.
- `page.tsx` has no test; the list route test asserts `product_image_url` is present in
  rows (already true) — add the same assertion for the SSR mapper by extracting it into
  `src/lib/orders/list-row-mapper.ts` shared by `page.tsx` and the route, with a unit test.

**Done gate:** tests green; browser: thumbnails visible on first paint (before
`/api/orders/list` returns); every avatar request < 10 KB; no avatar reverts to initials
after a realtime update.

**Rollback:** revert the component and helper; SSR column addition is harmless to keep.

---

### Step 8 — Search: one request per pause

**Changes**

- `src/components/orders/OrdersSearchBar.tsx`: `DEBOUNCE_MS` 180 → 300.
- `OrdersPageClient.tsx`: derive `facetCountsKey` from a debounced copy of `filters`
  (`useDebounce(filters, 500)`, hook exists in `src/hooks/useDebounce.ts`) so facet counts
  refetch once the list has settled, not per keystroke; keep `keepPreviousData`.
- Leave `count: "exact"` (cheap at this table size) and the trigram indexes as they are.

**Tests first:** search-bar test for the new debounce; page test that facet-count key lags
filters.

There is no `OrdersPageClient` test; extract the lagging facet key into a small hook
(`useSettledFacetKey`) and unit-test that instead of the page.

**Done gate:** typing a 9-digit phone number produces ≤ 2 list requests and ≤ 1
facet-count request; the last list request completes in < 500 ms (DevTools).

---

### Step 9 — KPI strip in one round trip

**Changes**

- Migration: `get_orders_kpi_counts(p_market_id uuid, p_from timestamptz, p_to timestamptz)`
  returning jsonb with `total, unassigned, to_recall, uploaded, rejected, delivered,
  period_total` computed with `count(*) FILTER (WHERE …)` in one pass over `orders`,
  SECURITY INVOKER (RLS applies), `GRANT EXECUTE TO authenticated`. Predicates copied
  verbatim from `src/app/api/orders/status-counts/route.ts` and
  `src/lib/orders/unassigned.ts` (`status = 'pending' AND assigned_to IS NULL`);
  `p_market_id IS NULL` means all markets (super_admin scope "all"); `total` includes
  soft-deleted orders, `period_total` excludes them, exactly as the route does today.
  `src/app/api/orders/unassigned/count/route.ts` shares the unassigned predicate and
  should read the same RPC.
- `status-counts/route.ts`: call the new RPC and `get_confirmation_rate_windows` in one
  `Promise.all` (8 round trips → 2). Response shape unchanged.
- Drift fix bundled in the same migration: `get_confirmation_rate_windows` is called by
  the route and exists in the live database but is absent from `supabase/migrations/`.
  Snapshot its live body with `pg_get_functiondef` into the migration (the repo's
  "corps exact appliqué en production" convention) so the schema history is complete.
  Pattern for the counts function: `get_warehouse_queue_stats` in
  `20260922000014_warehouse_queues_by_site.sql:64-102`.

**Tests first:** extend `src/app/api/orders/status-counts/route.test.ts` (Pattern A with
`mockRpc`) to assert the same `StatusCounts` shape from the new RPC; SQL check on
production comparing the new function's numbers with the seven HEAD counts for both
markets (must match exactly).

**Done gate:** numbers identical to the old route for TN and LY; `HEAD /rest/v1/orders`
count per hour in the edge logs drops by the KPI strip's share (other summaries still
head-count `orders`, so it will not reach zero); `/api/orders/status-counts` browser
duration < 300 ms.

---

### Step 10 — Middleware: trust the signed profile cookie, refresh only near expiry

**Changes**

- `src/middleware.ts`: after the public-path check, read the signed `oms_profile` cookie
  first (`verifyProfile`). If valid AND the stored session (`supabase.auth.getSession()`,
  local, no network) has `expires_at` more than 5 minutes away, skip `auth.getUser()` and
  proceed with the cookie's role/market. Otherwise keep today's path. This is the same
  trust model `getActor` already applies to every API route (`src/lib/auth/actor.ts`).
- Keep the `cached.user_id === session.user.id` binding that middleware applies today,
  and the 5-minute cookie TTL. Accepted change to record: a deactivation or global
  sign-out now takes up to 5 minutes to bounce an open page (today it is immediate for
  pages, already ≤ 5 min for API calls). `getSession()` still refreshes over the network
  when the token is expired, so "no network" holds only on the > 5-minutes branch.

**Tests first:** new `src/middleware.test.ts` (none exists; mock `@supabase/ssr`
`createServerClient` and `@/lib/auth/profile-cookie`) for: valid cookie + fresh session →
no `getUser` call; valid cookie + session expiring in 2 min → `getUser` called; invalid
cookie → `getUser` called; public paths untouched.

**Done gate:** `/auth/v1/user` calls per hour drop by > 80 % in the edge logs (the
per-navigation saving is below DevTools noise, so the log count is the only gate).

---

### Step 11 — Detail panel GET in two round trips

**Changes**

- `src/app/api/orders/[id]/route.ts` (GET): move `enrichRowsWithDuplicates` into the
  existing `Promise.all` (it only needs the order row already loaded).

**Tests first:** route test asserting the duplicate RPC is invoked and the response shape
is unchanged.

**Done gate:** `/api/orders/<id>` browser duration < 400 ms (DevTools, LY order).

---

### Decision point after Step 2 — database headroom (not a step)

- Re-measure `GET /rest/v1/orders` p50 from the FRA colo in the edge logs one working day
  after Step 2. If it stays above ~100 ms, the user decides on a one-tier compute upgrade
  (Micro → Small); its own check would be `max_connections` = 90 and a p50 under 100 ms.
- Out of scope but recorded: `POST /rest/v1/darb_shipments` p50 5.1 s and
  `darb_timeline_events` p50 2.8 s deserve their own investigation; the Darb sync's ~117k
  `promote_darb_status` calls/day are the background load on this instance.

## Verification summary

Every step has its own gate; the whole plan is done when, on production from a Tunisian
or Libyan connection: the Orders page paints rows with thumbnails in under 1.5 s, a filter
click or search pause returns in under 0.7 s, status changes and new orders appear without
refresh within 2 s, conflicting edits are reported instead of overwritten, and a
destination edit updates the carrier badges in one request.
