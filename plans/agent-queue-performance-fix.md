# Agent interface: the slow queue and the dead realtime path

Status as of 2026-08-11: **steps 1–3 are done and deployed.** Steps 4–7 are
scoped but not started.

---

## What was wrong

Two independent root causes, both confirmed against the production database
(`vshynigvgrlihngozuwb`). They compounded: the path that should have made the
queue feel instant was silently broken, so every change fell back to a 60-second
poll of an endpoint that took 3–12 seconds and frequently timed out.

### Cause 1 — the enrichment RPC was the #1 consumer of time in the whole database

`GET /api/agent/queue` makes ~7 DB round trips. Four are enrichment RPCs
(`get_customer_history_batch` + `get_duplicate_orders_batch`, each called twice —
active rows and closed rows — and chained sequentially within each branch).

Both matched customers with the function call **on the column**, which no index
can serve:

```sql
AND ( (i.np  <> '' AND normalize_phone(o.customer_phone)   = i.np)
   OR (i.np  <> '' AND normalize_phone(o.customer_phone_2) = i.np)
   OR (i.np2 <> '' AND normalize_phone(o.customer_phone)   = i.np2)
   OR (i.np2 <> '' AND normalize_phone(o.customer_phone_2) = i.np2) )
```

`normalize_phone` is plpgsql at a measured 3.57 µs/call, so the nested loop over
the full cross product *was* the runtime:

| agent | inputs | market orders | pairs evaluated | matches | time |
|---|---|---|---|---|---|
| `b18b831b…` | 151 | 3,835 | 579,085 | 0 | 3,007 ms warm / **12,477 ms cold** |
| `32b9dbe0…` | 270 | 2,527 | 682,290 | 15 | 3,314 ms |

`pg_stat_statements` before the fix:

| Statement | Calls | Total | Mean | Max |
|---|---|---|---|---|
| `get_customer_history_batch` | 81,672 | **28,930 s — 11.8% of all DB time** | 356 ms | **7,792 ms** |
| `get_duplicate_orders_batch` | 76,199 | 3,985 s | 53 ms | 3,925 ms |

**It failed silently.** The `authenticated` role carries a role-level
`statement_timeout = 8s`. The RPC exceeded it and `enrich.ts:73-79` caught the
error and returned EMPTY for every row — agents waited 8 seconds and got no
repeat-buyer data. The max_exec_time cluster at 7,792 / 7,944 / 7,957 / 7,975 /
7,982 ms across the slowest statements was that ceiling being hit.

Corroboration: two indexes added for exactly this lookup had **never been scanned
in 133 days** — `idx_orders_market_phone` (432 kB) and `idx_orders_market_identity`
(784 kB, additionally dead on a `trim()` mismatch).

### Cause 2 — every realtime UPDATE on the agent queue was discarded

`useAgentQueueRealtime.ts` gated the UPDATE branch on `payload.old?.id`, which is
**always `undefined` in production**:

1. `orders` has `relreplident = 'd'`, so Postgres logs no old tuple for an UPDATE
   unless a replica-identity column changes — and `orders.id` never does.
2. `RealtimeChannel.js:700` → `records.old = convertChangeData(payload.columns, payload.old_record)`.
3. `transformers.js` → `convertChangeData` returns `{}` for a falsy record.
4. So `payload.old === {}` and the handler fell through to `return current`.

The queue's realtime cache-patching had **never worked for UPDATEs**. The
reassign-away and cancelled toasts never fired. The 10 unit tests passed only
because the stub fabricated an `old` row that production never sends.

Compounding it, `QueuePage.tsx` memoised the rendered list on
`length + first id + last id`. An in-place field change matches all three, so
even once UPDATEs landed the list would still have rendered stale.

---

## What was done

### Step 1 — sargable enrichment RPCs *(deployed)*

- `supabase/migrations/20260829000001_orders_phone_norm_indexes.sql` — three
  expression indexes, and drops of the three 0-scan indexes they supersede.
- `supabase/migrations/20260829000002_sargable_customer_history_and_duplicates.sql`
  — the four-branch OR becomes `= ANY (i.phones)` with
  `phones = array_remove(ARRAY[np, np2], '')`; the duplicates 24h window becomes
  a plain range on `created_at`; `normalize_phone` marked PARALLEL SAFE.

**`= ANY`, deliberately not a `UNION ALL`.** `JOIN ON (a OR b)` emits one row per
qualifying pair however many branches hold; `UNION ALL` emits one *per branch*,
so an order matching on both phone columns would double-count into
`prior_order_count` and `duplicate_count`.

Equivalence verified against production before applying — full computed output,
and equal **raw** row counts rather than just equal `EXCEPT` sets, which is what
would expose the double-count:

| | inputs | old rows | new rows | `EXCEPT ALL` both ways |
|---|---|---|---|---|
| history, market 1 | 788 | 720 | 720 | 0 / 0 |
| history, market 2 | 615 | 494 | 494 | 0 / 0 |
| duplicates (incl. interval rewrite) | 615 | 93 | 93 | 0 / 0 |

**Result: 12,477 ms → 38.9 ms (321×).** The plan is now a `BitmapOr` over
`idx_orders_market_phone_norm` and `idx_orders_market_phone2_norm`, both taking
`= ANY(...)` as an `Index Cond`; `Rows Removed by Join Filter: 510055` is gone.
Both new indexes took >4,000 live production scans within minutes of creation.
Index footprint net **−848 kB**.

### Step 2 — realtime UPDATEs revived *(done)*

- `cache-patch.ts` — `old` dropped from the UPDATE variant (the branch only ever
  read `event.new`).
- `useAgentQueueRealtime.ts` — gate on `payload.new?.id`.
- Two regression tests feed the real wire shape (`old: {}`); both failed before
  the fix and pass after.

### Step 3 — list memo staleness *(done)*

- New `src/lib/agent-queue/stable-orders.ts` — `sameQueueOrders` does a per-row
  shallow compare, plus a shared frozen `NO_SIBLINGS` so `duplicate_siblings`
  stays reference-stable.
- `QueuePage.tsx` uses it in place of the length/first-id/last-id heuristic.
- 9 unit tests, including the middle-row change the old heuristic could not see.

**Shipped together with step 2 on purpose** — once UPDATEs actually land, the
staleness bug would have become user-visible for the first time.

---

## What remains

Ordered by measured impact. The agent-visible latency problem is already solved;
these are refinements.

### Step 4 — cut the payload

`select("*")` ships `raw_payload` (372 B/row, the largest key on the wire, read
by no agent surface), and `orders` is a subset of `allOrders` yet both are sent —
**647 of 649 active rows fleet-wide appear in both (99.7% duplication)**.

| | today | + column list | + drop dup | + cap closed at 50 |
|---|---|---|---|---|
| agent `6e5367ef…` (24 active / 372 closed) | 1,017 KB | 471 KB | 445 KB | **84 KB** |
| agent `b18b831b…` (133 active / 2 closed) | 494 KB | 263 KB | 138 KB | **138 KB** |

Replace both `select("*")` with an explicit `QUEUE_SELECT` (33 base columns + 2
embeds, down from 59 + 2), mirroring `LIST_SELECT` in `/api/orders/list/route.ts`.
The gate on what the UI actually reads is `toQueueOrder` (`QueuePage.tsx:56-111`).
Bound the closed list, which today has no `.limit()`.

**Hazard:** `cache-patch.ts` merges `{ ...prev, ...event.new }` and `shallowEqual`
compares key *counts*. A realtime row carries all 59 columns while the fetched row
would carry 33, so patched rows would silently regain `raw_payload` and drift in
shape. Narrow the realtime row to the same set before merging, and compare a known
key set rather than `Object.keys().length`.

### Step 5 — halve the enrichment round trips

The two enrichments in `agent/queue/route.ts:238-245` are `.then()`-chained but
independent — `Promise.all` them. Collapse the four RPC calls into two over the
union of rows. Same sequential-chaining fix at `orders/list/route.ts:191-202`.
First check whether closed rows render repeat-buyer/duplicate badges at all — if
not, two of the four calls disappear outright.

### Step 6 — RLS initplan, and `attachLastAgentAction`

Supabase's advisor flags `auth_rls_initplan` on `orders`, `order_history` and
`leads`: the SELECT policies re-evaluate `auth.uid()` / `get_user_role()` per row.
Measured on `attachLastAgentAction` for a 396-order agent: **17.8 ms without RLS →
301.8 ms with the `order_history_select` predicate inlined** — that delta is the
production 489 ms mean. Wrap the auth calls in scalar subqueries
(`(select get_user_role())`) so they become a once-per-query InitPlan. This taxes
every `orders` read in the app, not just the agent path.

Then replace the 10,000-row `order_history` fetch with a `DISTINCT ON (order_id)`
RPC: **301.8 ms → 29.7 ms**, 374 rows instead of 1,575.

### Step 7 — polling and dead code

- `/api/agent/leads/queue` polls every 30 s even on the orders tab, because
  `AgentTabsContainer` keeps both mounted with `display:none`. Gate the interval
  on visibility (idiom exists at `useLogsWorkspace.ts:107`) without unmounting.
- `useAgentNotifications.ts:35-46` full-refetches on every realtime event —
  debounce it (pattern in `useWarehouseRealtime.ts:52-57`).
- With realtime working, reconsider the 60 s queue poll as a reconciliation net.
- Delete confirmed-dead code: `src/app/api/orders/queue/route.ts` (zero client
  references; duplicates agent-queue logic with a *different* status list and
  sort — a live divergence risk), `src/components/queue/AgentQueue.tsx`,
  `src/lib/supabase/browser.ts`.

---

## Related

A separate multi-agent correctness sweep produced
[agent-interface-bugs.md](./agent-interface-bugs.md) — 22 adversarially-verified
bugs. Three of them collide with the work above and must be coordinated, not
edited in parallel: `attachLastAgentAction` (bug #7 wants a `DISTINCT ON` RPC —
same one step 6 needs), `CLOSED_STATUSES` (bug #5 widens the closed query, so
size any `.range()` after it), and `detect.ts`/`enrich.ts` error handling (the
"distinguish *no duplicates* from *could not determine*" contract).

## Notes for whoever picks this up

- **The same `payload.old` bug affects four more hooks** and is not yet fixed:
  `useOrdersRealtime.ts:82,108`, `useFollowUpsRealtime.ts:124,169`,
  `useConfirmationFlowRealtime.ts:68`. They derive an old status from
  `payload.old?.status`, which is always `undefined`, so status-transition
  branches never fire. They degrade more subtly than the agent queue did (no hard
  gate), but they are wrong. Each should read the previous row from the SWR cache.
- **Do not set `REPLICA IDENTITY FULL`** to make `payload.old` populate. Realtime
  WAL polling is already 13.8% of DB time (5.07 M calls); doubling every payload
  to fix a client-side gate is the wrong trade.
- **Do not narrow the realtime filter to `assigned_to=eq.<agentId>`.**
  `realtime.apply_rls` evaluates the filter against the NEW row for UPDATEs, so a
  reassign-away would stop being delivered to the losing agent and the
  reassignment toast would silently die.
- **Migration ledger:** the index DDL was applied via `execute_sql` (CONCURRENTLY
  cannot run inside the transaction `apply_migration` uses) and so is not in
  `supabase_migrations.schema_migrations`. The file is fully idempotent
  (`IF NOT EXISTS` / `IF EXISTS`), so a later push re-running it is a no-op. Note
  that file version numbers and recorded versions already diverge for every
  migration in this repo.
- **`pg_stat_statements` was reset for those two queryids only** (all other
  history preserved), so post-fix means can be read directly.

## Verification

Before-numbers to beat: 12,477 ms cold / 3,314 ms warm for the 133-row
customer-history payload; mean 356 ms, max 7,792 ms; ~7 round trips and
500 KB–1 MB per queue load.

1. `EXPLAIN (ANALYZE, BUFFERS)` on the phone-match CTE for a real agent — expect
   `BitmapOr` over the two new indexes and <50 ms. ✅ **38.9 ms**
2. Old-vs-new diff over the same real inputs — identical raw row counts,
   `EXCEPT ALL` = 0 both directions. ✅
3. After a day of traffic: `get_customer_history_batch` mean <50 ms, max well
   under 8,000 ms, no longer top-10 by `total_exec_time`. **Pending**
4. `idx_orders_market_phone_norm` shows `idx_scan > 0`. ✅ **4,097 within minutes**
5. Two browsers: change an order from the manager console, confirm the agent's
   card updates without a 60 s wait; reassign it away, confirm the toast fires and
   the open panel closes. Both were impossible before. **Needs a manual pass**
6. `/api/agent/queue` payload for agent `6e5367ef…`: 1,017 KB → <150 KB.
   **After step 4**
7. `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
