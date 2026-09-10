# Orders page — performance & real-time rebuild (2026-09-09 → 2026-09-10)

What changed on `/[locale]/orders`, why, what it is worth in measured numbers, and
**what to re-check before and after every remaining step**.

The step-by-step plan with its rationale lives in
[plans/orders-page-performance-plan.md](../plans/orders-page-performance-plan.md).
This file is the durable record: read it before touching the Orders page, and
update it when a step lands.

---

## The seven complaints this work started from

1. No real-time updates — a status set by the cron or an agent needed a manual refresh.
2. Simultaneous changes by admin and agent caused conflicts and lost edits.
3. Changing a customer address did not update the delivery-company recommendation.
4. Product images loaded slowly and only some appeared.
5. New orders appeared only after a refresh.
6. Slow search.
7. Every action felt slow.

Steps 1–6 close 1, 2, 3, 5, 7 and most of 6. Steps 7–11 (open) close 4 and the rest.

---

## Status at a glance

| Step | What it does | State | Commit |
|---|---|---|---|
| 1 | Enrichment RPCs become index-driven (LATERAL phone probe) | **DONE** | `bd2a462` |
| 2 | Vercel functions moved to `fra1`, next to the database | **DONE** | `b31af6b` |
| 3 | Filter/search no longer re-renders the server page | **DONE** | `6ae853d` |
| 4 | Real-time via Broadcast from Database, not `postgres_changes` | **DONE** | `3e4531a` |
| 5 | Optimistic concurrency on edits and actions | **DONE** | `485bc32` |
| 6 | Carrier recommendation follows the destination | **DONE** | `dbbd185` |
| 7 | Thumbnails: right size, first paint, never vanish | open | — |
| 8 | Search: one request per pause | open | — |
| 9 | KPI strip in one round trip | open | — |
| 10 | Middleware trusts the signed profile cookie | open | — |
| 11 | Detail panel GET in two round trips | open | — |

Cumulative effect measured in the browser on production: every Orders-page API call
went from **4,900–5,900 ms to 250–1,100 ms**.

---

## What each landed step actually did

### Step 1 — the two enrichment RPCs (`bd2a462`)

`get_customer_history_batch` ran on every list load and averaged **2.6 s**, with a
max of 7.4 s — the 8 s `authenticated` statement timeout, which is why badges
sometimes came back empty.

The phone join was `normalize_phone(o.customer_phone) = ANY (i.phones) OR …`, which
made the planner materialise every order in the market and evaluate the filter for
each input × order pair (~83k evaluations, two plpgsql calls each). The phone-norm
indexes were never used.

Rewritten as a `CROSS JOIN LATERAL` over `unnest(i.phones)`, so each phone becomes a
probe row and `idx_orders_market_phone_norm` / `_phone2_norm` drive the scan. Same
treatment for `get_duplicate_orders_batch`.

> **The trap, and it is a real one:** `unnest(phones)` yields up to two probe rows per
> input, so an order matching on both columns would be counted twice and inflate
> `prior_order_count`. The two legs are joined with `UNION`, **not `UNION ALL`**.
> When testing equivalence, compare with `EXCEPT ALL` **both ways** plus raw row
> counts and `sum(prior_order_count)` — plain `EXCEPT` dedupes and would hide exactly
> this bug. Verified: 0 differences, sums equal (LY 23=23, TN 42=42; dup LY 5=5, TN 16=16).

Migration: `supabase/migrations/20260924000001_batch_rpcs_lateral_phone_probe.sql`.
Signatures, `RETURNS TABLE`, `STABLE SECURITY DEFINER` and the caller-market guard
are unchanged, so `CREATE OR REPLACE` preserved grants.

**Measured on production 2026-09-09 23:40 UTC**, real 25-order LY page, as a
signed-in super_admin: history **25.5 ms** (was 2,625 ms mean / 7,377 ms max),
duplicates **9.1 ms** (was 126 ms). `/api/orders/list` 5,945 ms → 873 ms → **417 ms**
after Step 2.

### Step 2 — functions in Frankfurt (`b31af6b`)

Functions ran in `iad1` (US East) while Supabase is in `eu-central-1`. Every DB round
trip paid ~100 ms. `vercel.json` now carries `"regions": ["fra1"]` — Hobby allows
exactly one region.

Verified: `x-vercel-id: cdg1::fra1::…`. Edge logs: FRA p50 **46 ms** vs IAD 216 ms.

> Keep functions in `fra1` for as long as the database is in `eu-central-1`. Moving
> either one without the other silently re-adds the transatlantic hop.

### Step 3 — no server re-render on filter/search (`6ae853d`)

Every filter change and keystroke called `router.replace`, which made Next 14 refetch
the server page: middleware called GoTrue, `page.tsx` re-ran an exact count and the
agents query — all of it ignoring the filters. Measured 794 ms of RSC request per search.

Now `window.history.replaceState(null, "", url)`.

> **The state argument MUST be `null`.** Next's patched `replaceState`
> (`node_modules/next/dist/client/components/app-router.js:449-451`) returns early when
> the state carries its `__NA` marker, which the current entry always does after
> hydration — so `replaceState(window.history.state, …)` is a silent no-op and
> `useSearchParams` never updates.

Verified: a facet click produces **zero** `?_rsc=` requests and exactly 2 API calls.

### Step 4 — real-time on Broadcast (`3e4531a`)

`postgres_changes` evaluates the `orders` RLS policy **once per change per subscriber**
inside Realtime's poller. Production logs showed those polls being cancelled by
Postgres inside `realtime.apply_rls` (3×/day), the stream stopping (5×) and restarting
(9×), fed by the Darb sync's ~117k order updates/day.

Now an `AFTER` trigger publishes a slim payload
(`op, id, market_id, status, assigned_to, archived_at, updated_at`) on the private topic
`orders:market:<uuid>` via `realtime.send`. Authorisation happens **once at channel
join**, through a SELECT policy on `realtime.messages`.

Four things here are load-bearing and easy to break:

- **`SECURITY DEFINER` on the trigger function is mandatory, not a nicety.**
  `realtime.send` inserts into `realtime.messages` as the *invoking* role, and that
  table has RLS with no INSERT policy for `authenticated`. Without DEFINER, writes made
  through a user session (a PATCH, a transition) would have their broadcast silently
  dropped as a warning, while cron/service-role writes worked — the worst kind of bug.
  **Verify as the `authenticated` role, never as `postgres`, which bypasses RLS and
  passes falsely.**
- **Two triggers, not one.** A single trigger cannot reference `OLD` on INSERT nor
  `NEW` on DELETE.
- **The UPDATE trigger's `WHEN` clause never compares `updated_at` or
  `carrier_status_*`.** `promote_darb_status` rewrites those ~117k times a day; that
  fan-out is exactly what the clause exists to keep off the socket. (`UPDATE OF` would
  not help — it is column-*mentioned*, not column-*changed*.)
- **The client treats the message as a signal, not as data.** It patches only the four
  fields it can patch without lying, then does one coalesced (300 ms) revalidation.
  The old code pasted raw WAL rows over enriched ones, which is why images, display
  names and badges used to disappear on update.

Also fixed here: `status-counts` and `facet-counts` sent `Cache-Control: private,
max-age=30/15`, so a real-time revalidation inside that window was served from the
browser cache and the KPI strip did not move. Both are now `no-store`.

Verified end-to-end on production with the database as second actor, **zero page
reloads**: INSERT → row at top within 3 s with thumbnail and badge, "Non assignées"
5→6; UPDATE → "1/8" and agent name within 2 s, image intact; DELETE → row gone, tile
back to 5.

### Step 5 — optimistic concurrency (`485bc32`)

When two people edited the same order, the last PATCH won silently: the loser saw the
"Enregistré" flash over someone else's value and their field reverted with no
explanation, while the list still showed the status they had just acted on.

`PATCH /api/orders/[id]` now accepts `expected_updated_at` and carries it as an UPDATE
precondition.

> **Pass the timestamp through verbatim.** The BEFORE trigger `update_updated_at`
> stamps `now()` with **microsecond** precision (e.g. `…:25.295959+00`). Normalising
> through `new Date(x).toISOString()` gives milliseconds and would truncate the value,
> making **every** save a false conflict. Validation is only "does this parse as a date".

Zero affected rows now has two distinct meanings, and the route separates them: if a
re-read shows the stamp has moved, it is a **lost race** → `409 { code: "conflict",
data: <fresh order in the exact GET shape> }`. If the stamp is unchanged, it is the
pre-existing RLS refusal, message untouched.

Client-side rules that matter:

- The stamp comes from the **last server response**, never from the SWR cache —
  `commit` writes an optimistic row there, so two quick edits by the same user would
  send the value the second one overwrote, and the user would conflict with themselves.
- The stamp **never moves backwards**. A real-time event patches `updated_at` in place
  and a revalidation started before a save can land after it; adopting such a row would
  send a stamp the server has already passed.
- Commits are **serialised per order**.

Made visible for the first time:
- `CustomerCard` renders `saveError`. A failed address or destination edit previously
  showed nothing at all — the error was only rendered inside `OrderItemsCard`.
- `handleCancelSchedule` swallowed every non-ok response; the spinner just stopped.
- The list refreshes **before** the banner is shown when the failure means the view is
  stale, otherwise the message announces a change the table keeps denying.
  `bulk-assign` did not even read the response body.

`/transition` keeps its **400** (the queue and post-call callers branch on it) and gains
`code: "conflict"` plus the real status, which the RPC message already names
(`invalid transition from X to Y`).

**Verified twice.** In SQL, on production data in a rolled-back transaction: the loser's
guarded write touched **0 rows**, a write carrying the current stamp touched **1**. Then
end-to-end against the deployed app through the page's own authenticated session
(2026-09-10 00:57 UTC): current stamp → **200**; the same stamp re-used once it had gone
stale → **409 `code: "conflict"`** carrying the winner's order in the exact GET shape
(`history[]`, `order_items[]`). The row kept the winner's value, and `order_history` got
exactly one row — the rejected save wrote none, so the append-only timeline never recorded
an edit that did not happen.

### Step 6 — the quote follows the destination (`dbbd185`)

Changing an order's destination changed neither the price nor the recommended account.
Two defects, the second hidden behind the first.

**The SWR key was `?order_id=<id>` alone**, with a 60 s dedupe — so a different
destination produced the same key and the badge kept the previous address's quote. That is
not a cosmetic staleness: Libya's two Darb accounts are geographic. Measured on fresh
production quotes, `الخمس` is **20** via Tripoli against 25 via Benghazi, while
`بنغازي/البركة` is **10** via Benghazi against 30 via Tripoli. The badge was wrong by
20 LYD and named the wrong account.

The API was verified correct first — the same order flipped between those two destinations
returned Tripoli@20 then Benghazi@10, both on the `quote` rung — so the defect was
entirely client-side.

`destinationKey(order)` now rides in the key. It mirrors what the route actually resolves
the quote from: `darb_destination_id`, else the free-text `customer_city`.

> `city_id` and `dexpress_state_id` are deliberately **not** in the key. The rates route
> never reads them (it selects only `customer_city, darb_destination_id`), so including
> them would invent cache misses that change no answer. `customer_address` is excluded for
> the same reason — it is free text the quote does not depend on.

**And the selection could not move.** `pickInitialCarrier`'s first rule is "the current
selection always wins" — correct for protecting a deliberate choice, wrong across a
destination change. `useResetOnDestinationChange` clears the selection at that one moment,
never on mount (which would fight the auto-select effect). Applied to all three selections,
including `selectedDarbCarrierId`, which was reset **nowhere** before — not on close, not
on success.

> **SWR's filtered `mutate` only visits keys with a mounted subscriber.** Verified with a
> probe: a seeded, unmounted key survived `mutate(k => k.startsWith(prefix), undefined)`
> untouched. Since the carrier sheet is normally closed when someone edits the destination,
> the entries that go stale are precisely the ones a filtered mutate skips — so the
> eviction in `useOrderMutation` is a direct `cache.delete` over the cache keys.

Note for future steps: `ScheduleDispatchModal` holds no order object (its props are
`orderId` + `marketId`), so it receives the destination key as a prop from
`OrderDetailPanel`, its only renderer.

---

## Invariants — break these and the page regresses silently

1. Vercel functions stay in `fra1` while the database is in `eu-central-1`.
2. `replaceState` for filter/search state is called with a **`null`** first argument.
3. `orders_broadcast_change()` stays `SECURITY DEFINER`.
4. The broadcast UPDATE trigger's `WHEN` clause never mentions `updated_at` or
   `carrier_status_*`.
5. The Orders real-time client patches fields in place — it never replaces a row with
   the payload.
6. `status-counts` / `facet-counts` stay `no-store`.
7. `expected_updated_at` is passed through as an opaque string, never re-serialised.
8. `LIST_COLS` in `orders/page.tsx` stays in sync with `LIST_SELECT` in the list route.
9. Any per-destination answer is keyed on `destinationKey(order)`, and that key mirrors
   what the route actually reads — never more, never less.
10. Evicting SWR entries that may have no mounted subscriber is done with `cache.delete`,
    not a filtered `mutate`.

---

## How to re-check, before and after every remaining step

Run these **before** starting a step (to know the ground truth) and **after** it
deploys (to prove nothing regressed). Do not trust an earlier run of this file — the
numbers move.

### 1. Database objects still in place

```sql
select 'trigger: '||tgname as object,
       case when tgenabled='O' then 'enabled' else 'DISABLED' end as state
from pg_trigger where tgname like 'trg_orders_broadcast%'
union all select 'policy: '||polname, 'on realtime.messages'
  from pg_policy where polname='orders_broadcast_read'
union all select 'function: '||p.proname,
       case when p.prosecdef then 'SECURITY DEFINER' else 'INVOKER (WRONG)' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='orders_broadcast_change'
order by 1;
```
Expect four rows: two enabled triggers, the policy, and the function as SECURITY DEFINER.

### 2. RPC cost, measured honestly

**`pg_stat_statements` means are cumulative since the last reset and will average in
pre-fix calls — that is what made the original Step 1 deferred gate unreadable.**
Stats were reset **2026-09-09 23:43 UTC**; readings after that date are post-fix only.
For an on-demand number, time the functions directly — and note they are
`SECURITY DEFINER` with a caller-market guard, so **an unauthenticated session returns
0 rows in ~2 ms and looks deceptively fast**. Impersonate a real user:

```sql
do $$
declare v_market uuid; v_rows jsonb; v_uid uuid;
        t0 timestamptz; t1 numeric; t2 numeric; n1 int; n2 int;
begin
  select id into v_market from markets where code='ly';
  select id into v_uid from users where role='super_admin' limit 1;
  select jsonb_agg(jsonb_build_object(
           'id',o.id,'source','order','phone',o.customer_phone,
           'phone_2',o.customer_phone_2,'name',o.customer_name,
           'address',o.customer_address,'city',o.customer_city,
           'product_id',o.product_id,'quantity',o.quantity,'created_at',o.created_at))
    into v_rows
  from (select * from orders o2 where o2.market_id=v_market and o2.status<>'deleted'
        order by o2.created_at desc limit 25) o;
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_uid,'role','authenticated')::text, true);
  t0:=clock_timestamp(); select count(*) into n1 from get_customer_history_batch(v_market,v_rows);
  t1:=extract(epoch from clock_timestamp()-t0)*1000;
  t0:=clock_timestamp(); select count(*) into n2 from get_duplicate_orders_batch(v_market,v_rows);
  t2:=extract(epoch from clock_timestamp()-t0)*1000;
  raise exception 'history=% ms (% rows) duplicates=% ms (% rows)',
    round(t1,1),n1,round(t2,1),n2;
end $$;
```
Expect **25 rows each** and both well under 100 ms. Zero rows means the guard rejected
you, not that the query was fast.

### 3. Region

```bash
curl -sI https://ordra-gamma.vercel.app/fr/login | grep -i x-vercel-id
```
Expect `…::fra1::…`.

### 4. Concurrency precondition (safe, rolls back)

The `do $$ … raise exception 'RESULT …' $$` block used in Step 5: read a stamp, write
once as the "winner", then attempt a guarded write with the stale stamp. Expect
`stale_rows=0` and `fresh_rows=1`. The `RAISE EXCEPTION` at the end both returns the
values and rolls everything back.

> Two lessons about verifying in a rolled-back block, both learned here the hard way:
> `RAISE NOTICE` output is **not** returned by the MCP — put results in the
> `RAISE EXCEPTION` message. And **a rolled-back block never fires deferred constraint
> triggers**; if the thing under test is `DEFERRABLE INITIALLY DEFERRED`, use
> `SET CONSTRAINTS ALL IMMEDIATE` or the test passes while the real write fails
> (see `7abb048`).

### 5. Test suite — compare against baseline, do not read the raw count

This repo has **pre-existing failures unrelated to this work**: as of 2026-09-10,
**25 tests in 15 files**. A raw "N failed" number proves nothing. Compare the failing
*file set* against the untouched tree:

```bash
npx vitest run 2>&1 | grep -E "^ FAIL" | grep -oE "src/[^ ]+\.(test|spec)\.tsx?" | sort -u > /tmp/after.txt
git stash push -u && npx vitest run 2>&1 | grep -E "^ FAIL" | grep -oE "src/[^ ]+\.(test|spec)\.tsx?" | sort -u > /tmp/before.txt && git stash pop
comm -13 /tmp/before.txt /tmp/after.txt   # anything printed here is YOUR regression
```

Known pre-existing failures (do not chase them as part of this work):
`leads/campaigns/preview`, `leads/metrics`, `api/metrics`, `warehouse/label-prints`,
`layout/sidebar`, `queue/DarbStatusSection`, `settings/CarriersSection`,
`settings/TeamSection`, `ui/DatePicker`, `ui/DateRangePicker`, `context/market-scope`,
`carriers/dexpress/adapter`, `lib/leads/metrics`, `lib/orders/webhook-handler`,
`lib/storefronts/buybox-adapter`.

### 6. Checks that do and do not work here

- `npm run typecheck` — works, run after every file change.
- `npm run build` — works.
- `npm run test:run` / `npx vitest run` — works, but read it via the comparison above.
- **`npm run lint` is NOT usable in this repo**: there is no ESLint config, so it drops
  into an interactive bootstrap prompt and hangs. Use typecheck + build + tests instead.

### 7. Mocks that must be updated when a hook's return shape changes

Several page/panel tests mock hooks wholesale, so **adding a field to a hook's return
breaks them at runtime, not at typecheck**:
- `src/components/queue/__tests__/OrderDetailPanel.test.tsx` mocks `useOrderMutation`
  (must expose `noteServerRow`, and re-export the real `OrderConflictError` via
  `importActual` because the panel branches on `instanceof`).
- `…/orders/archive/__tests__/ArchivePageClient.test.tsx` mocks `useOrdersRealtime`
  (must return `{ connected }`).

---

## Open steps — what to know before starting each

- **Step 7 (thumbnails).** SSR `LIST_COLS` omits `image_url`; the Storage render
  endpoint takes a 1,101 KB PNG to **2 KB** at 80×80 (verified, HTTP 200). `ProductAvatar`
  never resets its `errored` state when the prop changes in place. Step 4 already removed
  the row replacement that used to wipe `product_image_url`.
- **Step 8 (search).** Debounce 180 → 300 ms and lag the facet-counts key behind the
  list. There is no `OrdersPageClient` test — extract the lagging key into a hook and
  unit-test that instead.
- **Step 9 (KPI strip).** One `count(*) FILTER (…)` pass replacing 8 round trips. Bundle
  the drift fix: `get_confirmation_rate_windows` exists live but is **absent from
  `supabase/migrations/`** — snapshot it with `pg_get_functiondef`.
- **Step 10 (middleware).** Accepted trade-off to record when it lands: a deactivation or
  global sign-out takes up to 5 minutes to bounce an open page.
- **Step 11 (detail GET).** Move `enrichRowsWithDuplicates` into the existing `Promise.all`.

### Decision still open

Re-measure `GET /rest/v1/orders` p50 from the FRA colo one working day after Step 2.
Upgrade compute (Micro → Small) only if it stays above ~100 ms. Out of scope but
recorded: `POST /rest/v1/darb_shipments` p50 **5.1 s** and `darb_timeline_events` p50
**2.8 s** deserve their own investigation.
