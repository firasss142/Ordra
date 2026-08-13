# Archive System — Reliability Rebuild

On execution, copy this file to `Ordra/plans/archive-system-reliability.md` (project rule: plans live in the repo).

---

## Context

The OMS has no archive system. What is called "the archive" is a read-only derived view over
`TERMINAL_STATUSES` (`src/types/order-status.ts:81-87`) — there is no `archived` column, no archive
table, no archive/unarchive endpoint, and no record of *when* an order was archived. Membership is a
side effect of six uncoordinated write paths reaching a terminal status.

That derivation is currently broken in production, and the brokenness is quantified against the live
database (project `vshynigvgrlihngozuwb`, Libya, last 90 days):

| | today | correct |
|---|---|---|
| terminal orders in range | 2,295 | 2,295 |
| rows the archive table **can** render | **321** (deleted only) | 2,295 |
| outcome tiles sum | **90.2 %** | 100 % |
| cohort bucketing | by `created_at` | by archival date (mean lag **5.49 days**) |

Goal: an archive that is durable (no divergence between the OMS and the carrier), whose displayed
numbers are exact and mutually consistent, and where archival is a recorded event rather than an
inference.

## Decisions (locked by the user)

1. Archive becomes an **explicit recorded state**: `orders.archived_at` + `orders.archived_by`.
   **No `archive_reason` column** — `order_history` already holds the note and actor.
2. Priorities: **durability / no loss** first, **correct numbers** second.
3. **D1 is a live bug** — fixed first, standalone, before any redesign.
4. Migrations applied **directly to production**, but **only after the user signs off on a
   prototype**. Nothing touches the database until then.
5. Recover restores the **prior status when it is in the call pool**, else clamps to `pending`.
6. **Orders only.** Leads archive gaps are logged as follow-up, not built here.

### Consequences of dropping `archive_reason`

The 271 terminal orders with no matching `order_history` row get `archived_at` estimated from
`updated_at`. They need no sentinel column — the set is recomputable at any time:

```sql
SELECT o.id FROM orders o WHERE o.archived_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM order_history h WHERE h.order_id=o.id AND h.status_to=o.status);
```

The trigger therefore never reads `app.archive_reason`, and `_manual_delete_order_locked` never sets it.

---

## Slice P — Prototype, before any code or migration

The user has not seen what this becomes. Ship a **published Artifact** (private URL) showing the
target archive, populated with the real Libya/90d figures above so the change is legible:

- The rebuilt archive page: five outcome tiles summing to 100 %, exact totals (no 20 000 cap),
  cohorts bucketed by archival date, results count from the exact `total`, all five terminal statuses
  in the table, no dead checkboxes, a real confirm dialog instead of `window.confirm`.
- A before/after panel on the same numbers: 321 → 2,295 rows; 90.2 % → 100 %.
- A diagram of durable bulk archive — per-order `intent → void → write`, and the five failure modes
  F1-F5 with which ones can diverge (only F2, repaired within 5 minutes).
- The recover flow under the call-pool rule.

**Gate: no migration, no RPC change, no schema change until this is approved.**

## Slice 0 — P0: the archive shows all five terminal statuses

`include_deleted` is **not** made tri-state — it is the user-facing "Afficher supprimées" contract on
`/orders`, which works correctly. Add an orthogonal `scope` axis instead; it grows in Slice 4 into
`archived_at IS NOT NULL`.

- `src/lib/orders/archive-scope.ts` — **new**. `ARCHIVE_STATUSES` (alias of `TERMINAL_STATUSES`, so
  `OUTCOME_KEYS` can never drift to four again) and `resolveArchiveStatuses(csv)`, which intersects
  with `ARCHIVE_STATUSES` so an unknown status cannot widen scope.
- `src/lib/orders/list-filters.ts` — add `scope: "orders" | "archive"`, default `"orders"`; parse,
  serialize, and add to `listQuerySchema`. **Excluded from `hasActiveFilters`** — it is page identity,
  not a filter.
- `src/app/api/orders/list/route.ts:79-82` and `src/app/api/orders/export/route.ts:75-90` — three-way:
  `scope==="archive"` → `.in("status", resolveArchiveStatuses(q.status))`; else the existing
  `include_deleted` behaviour, unchanged. Guard the later `q.status` block so the CSV isn't applied twice.
- `ArchivePageClient.tsx:120,212` — drop `includeDeleted: true`, send `scope: "archive"`.

**Tests first:** extend the `chain()` harness in `list/route.test.ts` — `scope=archive` calls `.in` with
all five and never `.eq("status","deleted")`; `scope=archive&status=pending` still yields all five;
both existing `include_deleted` regressions stay green. New `archive-scope.test.ts`. Keep
`export/route.test.ts:139` ("include_deleted=1 exports ONLY deleted") passing.

## Slice 1 — Durable bulk archive (top priority)

Today `manual-delete.ts:152-154` voids every order at the carrier **before** one RPC call. A failure at
order N leaves 1..N−1 voided at the carrier and untouched in the OMS. Reversing to per-order
`intent → void → write` shrinks the window from N orders to at most one, and closes that one with a
write-ahead record plus a SQL reconciler.

**`20260830000001_manual_delete_idempotent.sql`**
- **Drop `carrier_event_log_carrier_code_check`.** It allows only `navex|dexpress`, so every
  `darb_assabil` void violates it — and the insert at `manual-delete.ts:46` is inside `try/catch`, so
  Libya's entire forensic trail has been discarded silently (table holds 10 rows, all `dexpress`).
  Dropping rather than extending prevents the next carrier repeating this. Also keep the `try/catch`
  but log the swallowed error.
- Extend `carrier_event_log_outcome_check` with `'pending'` (write-ahead intent).
- Partial index on `(order_id, created_at DESC) WHERE source='barcode_deletion' AND outcome_reason IN ('manual_delete','manual_delete_intent')`.
- `_manual_delete_order_locked(order_id, actor_id, note) RETURNS TEXT` — the existing per-order body,
  minus the auth gate, returning `deleted | already_deleted | status_not_deletable | not_found`.
  **Idempotent**: an already-`deleted` order returns `already_deleted` instead of raising `23514` and
  aborting the batch, which is what makes retry-after-partial-failure possible. `REVOKE` from `authenticated`.
- `manual_delete_orders` keeps its signature and auth gate, loops the worker, returns per-order
  buckets. Cross-market ids still `RAISE` — that is a bug, not a partial outcome.

**`20260830000002_reconcile_manual_delete_voids.sql`** — `reconcile_manual_delete_voids()` on pg_cron
`*/5 * * * *` (idempotent unschedule/schedule pattern from `20260624000003_pg_cron_notifications.sql:63-80`).
(a) void confirmed + order still live → re-run the idempotent delete. (b) intent written, outcome
unknown → set `needs_carrier_followup = true`; never guess.

> **Load-bearing:** the predicate must include `l.tracking_number IS NOT DISTINCT FROM o.tracking_number`.
> Three production orders (`11b1458f…`, `4733d293…`, `ddbe0ec4…`) were voided and legitimately
> **re-uploaded**; without this the reconciler would "repair" three healthy orders into `deleted`.

**`src/lib/orders/manual-delete.ts`** — rewrite `manualDeleteOrders` to per-order
`logIntent → voidCarrierOrder → rpc([id])`, returning `{ succeeded, voidFailed, failed, skipped, stockRestored }`,
modelled on the in-repo precedent `bulk-reopen/route.ts:116-187`. Add `actor_id` to `raw_body` — the
reconciler reads it. `bulk-cancel/route.ts:81-99` returns 200 with buckets instead of aborting with 409;
the batch-level 404/403/422 pre-flight gates stay all-or-nothing. Single-order callers
(`[id]/cancel`, `duplicate-delete.ts:158`) map `voidFailed[0]` to the existing 409 shape so their
contracts hold.

**Tests first:** new `src/lib/orders/__tests__/manual-delete.test.ts` — void throws on order 2 of 3 →
order 1 voided *and* deleted, order 2 in `voidFailed`, order 3 still attempted, RPC called **three times
with one id each**; intent row inserted **before** `adapter.voidDispatch` (assert call order);
`already_deleted` surfaces as `skipped`, not an error.

## Slice 2 — Cheap correctness (D3, D5, D7)

Disjoint from Slice 1; can run in parallel.

- `summary/route.ts` — add `cancelled` to `outcomes` and to the cohort buckets; read and apply `q` and
  `rejection_reason` so the cards describe the table (D5).
- `ArchivePageClient.tsx` — `OUTCOME_KEYS` becomes `ARCHIVE_STATUSES` (five) — this is D7's root cause;
  add the cancelled tile and cohort column (`orders.statuses.cancelled` already exists in fr + ar);
  `summaryKey` gains `q` and `rejection_reason`; results count uses the exact `total` that
  `useOrdersList` already returns (`list/route.ts:233`) instead of `rows.length`.
- **Tests first:** in `summary/route.test.ts`, assert the invariant the defect is about —
  `sum(Object.values(outcomes)) === total` — plus per-week cohort sums. New `ArchivePageClient.test.tsx`
  (component tests before component changes, per `src/components/CLAUDE.md`).

## Slice 3 — Schema: `archived_at` / `archived_by`

**`20260831000001_orders_archive_state.sql`** — two columns plus
`trg_orders_archive_stamp BEFORE INSERT OR UPDATE OF status`, calling `orders_stamp_archive()`:
stamps on entering a terminal status, NULLs both on leaving. `UPDATE OF status` skips the body on the
~90 % of order updates that don't touch status. The name sorts before `trg_orders_updated_at` (the only
other trigger on `orders`), and they write disjoint columns.

A trigger rather than editing the RPCs: there are six live write paths to a terminal status reached from
20 call sites. Editing four RPCs leaves `transition_order_status` (11 callers, every status) as the one
that must never regress, and leaves direct SQL and future adapters uncovered.

`archived_by` is **best-effort attribution**; `order_history` stays authoritative. Resolution:
`app.archive_actor` unset → `auth.uid()`; `'system'` → NULL; a uuid → that uuid. Attribution is wrapped
so it can never fail an order write.

**`20260831000004_archive_actor_attribution.sql`** — one `PERFORM set_config('app.archive_actor', …, true)`
before the `UPDATE orders` in `promote_darb_status`, `fulfill_order_transition`, `transition_order_status`.
Required, not cosmetic: `/api/darb-assabil/sync-market/route.ts:38` uses the RLS-scoped client, so without
the `'system'` sentinel a carrier-driven promotion is attributed to whichever manager had the app open.

**`20260831000002_orders_archive_backfill.sql`** — one transaction. `DISTINCT ON` over the **latest**
`order_history` row landing on the order's **current** status (32 orders were archived → recovered →
re-archived; the earliest row would stamp a stale date). `archived_by := actor_id` — 0 orphans verified,
so the FK is safe. 271 orders with no matching row fall back to `updated_at`.

> **Hazard:** `trg_orders_updated_at` sets `updated_at = now()` unconditionally. Left enabled, this
> backfill resets `updated_at` on 5,476 orders and **re-opens the 7-day agent reopen/edit window on
> 1,863 rejected orders**. The migration must `DISABLE TRIGGER trg_orders_updated_at` … `ENABLE` inside
> the transaction. Sub-second ACCESS EXCLUSIVE at this row count; still run outside Libyan business hours.

**`20260831000003_orders_archive_constraint.sql`**, only after the backfill verifies:
`CHECK ((status IN (…5…)) = (archived_at IS NOT NULL))` `NOT VALID` then `VALIDATE`, plus
`idx_orders_archived (market_id, archived_at DESC, id DESC) WHERE archived_at IS NOT NULL`.

**Verification (run each via `mcp__supabase__execute_sql`):**
1. `update orders set status='rejected' where id=X` → `archived_at ≈ now()`, `archived_by = auth.uid()`
2. `recover_deleted_order` on a deleted order → both columns NULL
3. `update orders set customer_name='x'` on a terminal order → `archived_at` unchanged
4. `update orders set archived_at=null where status='delivered'` → raises `23514`
5. `select count(*) from orders where (status in (…)) <> (archived_at is not null)` → **0**
6. re-run the backfill migration → 0 rows updated
7. `select count(*) from orders where updated_at > <migration start>` → **0**
8. estimated-timestamp set (query in Context) → **271**

**TS:** add both columns to `OrdersListRow` (`useOrdersList.ts:8-50`) and `LIST_SELECT` (`list/route.ts:16-23`).

## Slice 4 — Reads move to `archived_at` + DB-side aggregate (D4, D9, D1 permanently)

**`20260901000001_get_archive_summary.sql`** — `get_archive_summary(...) RETURNS JSONB`,
`SECURITY DEFINER STABLE`, guard and UTC bounds copied from `get_profitability_daily`
(`20260828000001…:56-70`). One CTE feeds every aggregate, so **`total = Σ outcomes` by construction** —
D3 cannot recur — and `MAX_ROWS = 20_000` disappears, so counts are exact. Filters on `archived_at`, so
cohorts finally mean archival weeks (D9). Week keys use `to_char(archived_at AT TIME ZONE 'UTC','IYYY"-W"IW')`,
byte-identical to the current `isoWeekKey()` output, so the client table is unchanged.

- `archive-scope.ts` grows `applyArchiveScope(query, opts)` — the single PostgREST builder used by
  list, export and summary, so they cannot diverge again.
- `summary/route.ts` — replace lines 69-161 with one `rpc()` call; keep the role gate and 400s; zero-fill
  `rejectionReasons` in TS so the client contract is unchanged; map PG `42501` → 403; delete `MAX_ROWS`,
  `isoWeekKey`, `topN`.
- `list/route.ts` / `export/route.ts` — in the archive branch, route dates to `archived_at`, order by
  `archived_at DESC, id DESC`, cursor on `archived_at`. `encodeKeysetCursor` (`src/lib/cursor.ts`) is
  column-agnostic and needs no change.

Counts and rows remain two HTTP requests, but share one predicate via `applyArchiveScope`; merging them
would require reimplementing `enrichRowsWithCustomerHistory` / `enrichRowsWithDuplicates` in SQL.

## Slice 5 — Realtime (D6, D7, D8)

Depends on Slice 4 — "prepend to page 1" is only correct once the archive sorts by `archived_at DESC`.

`useOrdersRealtime.ts:75-105` — the UPDATE branch currently only patches or removes, so a newly-terminal
order never appears live, contradicting both its own comment and `plans/realtime-instant-sync.md:95`.
Add the upsert path: matches + absent → insert; matches + present → patch; no longer matches → remove.
Insert only when `currentPage === 1`; otherwise mark stale (prepending on page 3 of a keyset list
duplicates a row). `archiveMatch` uses `isArchived` + all five statuses (D7) and checks the date window
against `archived_at`. Pass `mutateSummary` into both the realtime callback and `handleRecover:196`
so the tiles refresh (D8), debounced 1 s per `useConfirmationFlowRealtime`.

**Tests first:** new `useOrdersRealtime.test.tsx` — the D7 regression (an UPDATE to `cancelled` on a
matching filter keeps the row) and the D6 insert case.

## Slice 6 — Recover restores the call-pool status

`recover_deleted_order` currently forces `pending`. The `status_from` lookup already exists
(`20260815000001` lines ~85-95). Restore it when it is in `CALL_POOL_STATUSES`
(`pending | attempt_1 | attempt_2 | attempt_3 | callback_scheduled` — already defined in
`src/lib/order-permissions.ts`), else clamp to `pending`. Those five have zero carrier or stock side
effects. `scanned` stays refused (stock already restored); `uploaded` and `confirmed` clamp — the
tracking number is dead at the carrier and the phone confirmation is of unknown age.
Update `orders.archive.recoverConfirm` in **both** `fr.json` and `ar.json`, and extend
`recover/route.test.ts` (7 existing cases stay green).

## Slice 7 — UI hygiene (D15)

`OrdersTable` gains `selectable?: boolean` (default `true`); the archive passes `false`, removing the
checkbox column and the three no-op handlers at `ArchivePageClient.tsx:598,610-611` that today render
fully functional-looking checkboxes that do nothing. Replace `window.confirm`/`window.alert`
(185, 194, 199) with the existing `useToast` + a `Modal`. Convert the ~200 lines of inline `style={{}}`
to Tailwind tokens (`bg-surface-card`, `border-line`, `text-ink-primary`, … in `tailwind.config.ts:31-51`)
per `src/components/CLAUDE.md`, using logical properties for RTL. New i18n keys in fr **and** ar.

## Slice 8 — The two leaks that cost money (D11)

- `src/lib/orders/agent-capacity.ts:32` omits `deleted`, so **689 soft-deleted orders** inflate agent
  queue size and distort auto-assignment. Add it, and recreate `idx_orders_assigned_status_partial`
  with the 5-status predicate so the query stays index-covered.
- `status-counts/route.ts` — `.neq("status","deleted")` on the `total` head-count only.
- Delete `src/lib/fulfillment-engine.ts` + its test — dead code whose only importer is its own test.

DB-level exclusion (RLS or an `orders_active` view) is **not** recommended: it would break
`recover_deleted_order`, the archive page itself, `get_profitability_summary` and every timeline
surface, all of which legitimately read terminal orders.

---

## Verification

- `npm run typecheck` gates every slice. `npm test` (vitest) has a known baseline of ~31 pre-existing
  failures — compare against baseline, do not expect zero.
- Per-slice test commands are listed in each slice; all new tests are written **before** the code
  (repo `test-driven-development` skill + `src/components/CLAUDE.md`).
- SQL is verified through `mcp__supabase__execute_sql` using the 8 assertions in Slice 3 and the
  reconciler check in Slice 1 — `reconcile_manual_delete_voids()` must return `{"repaired":0,"flagged":0}`
  on today's data, which is the regression test for the re-upload discriminator.
- End-to-end: `/fr/orders/archive` for Libya/90d shows ~2,295 rows across five statuses (not 321), tiles
  sum to 100 %, the cancelled tile shows 226, cohorts shift by ~5.5 days versus today, and two browser
  windows show a rejected order appearing live in the second.

## Deliberately out of scope

Leads archive (irreversible, no confirm dialog, archived leads counted in the default list and in
`getLeadsMetrics` total); the `canReopenOrder` TS/SQL guard mismatch (`uploaded` vs `confirmed`, which
yields a raw 500); the unimplemented "90-day cold storage" copy in the admin logs UI
(`LogsWorkspace.tsx:271`) — either implement or delete; and 2 live orders with `status='new'`, a value
absent from `ORDER_STATUSES`.
