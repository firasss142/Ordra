# P&L /api/profitability 30-day timeout — denormalize market_id onto order_history

## Root cause (from Phase-1 live profiling)
The route runs under the ANON key + user session (RLS ON). For `market_manager`, the
`order_history_select` policy evaluates a per-row `EXISTS(SELECT 1 FROM orders o WHERE
o.id = order_history.order_id AND o.market_id = get_user_market_id())` plus the joined
`orders_select` policy, each calling STABLE SECURITY DEFINER helpers. Cost scales linearly
with the candidate-row scan and crosses the DB `statement_timeout` (~8s) between a 7-day and
14-day window. Same query is 302ms under service-role (RLS off) / 2231ms under super_admin
(RLS short-circuits). Trivial result sets (delivered 278 / returned 79 / confirmed 1013 rows).

## Fix chosen for THIS task
Denormalize `orders.market_id` onto `order_history.market_id`, kept in sync by a DB
`BEFORE INSERT` trigger. Then the market filter is a base-table column predicate on
`order_history` (no join to `orders` needed for filtering), a composite index
`(market_id, status_to, created_at)` is fully usable, and load-summary.ts drops the
`orders!inner(..., market_id)` filter to `order_history.market_id`. This removes the
per-row EXISTS-on-orders RLS join. Combined with hardening the RLS helpers as
`(SELECT get_user_role())` / `(SELECT get_user_market_id())` (evaluated once per statement
via InitPlan instead of per row), the manager path drops from timeout to sub-second.

Why a TRIGGER and not app code: order_history is written from 5 TypeScript `.insert()`
sites AND ~30 SQL RPCs (`INSERT INTO order_history (order_id, status_from, status_to,
actor_id, actor_type, note)` — none pass market_id). A trigger is the ONLY place that
covers every current and future write path with zero edits to RPCs or app code.

## Append-only compatibility
market_id is an immutable derived attribute of an existing row (order_id → orders.market_id
never changes; market isolation forbids re-homing an order). The trigger only sets it on
INSERT. No UPDATE/DELETE policy is added. order_history remains append-only. The backfill
is a one-time historical correction of a newly added column (same precedent as prior
column-add migrations), not mutation of business history.

## Migration (supabase/migrations/20260818000001_order_history_market_id.sql)
1. `ALTER TABLE order_history ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES markets(id);`
2. Backfill (~23k rows, single statement, fast under service-role/DDL context):
   `UPDATE order_history oh SET market_id = o.market_id FROM orders o
    WHERE o.id = oh.order_id AND oh.market_id IS NULL;`
3. `BEFORE INSERT` trigger function (SECURITY DEFINER, search_path pinned):
   if NEW.market_id IS NULL then `SELECT market_id INTO NEW.market_id FROM orders WHERE id = NEW.order_id;`
   Attach `BEFORE INSERT ON order_history FOR EACH ROW`.
4. Index: `CREATE INDEX idx_order_history_market_status_created
    ON order_history (market_id, status_to, created_at);`
   (Plain CREATE INDEX inside the migration; the repo runs migrations transactionally —
   the existing 019 CONCURRENTLY examples are the exception, not the rule. If run against
   prod live, split into a separate non-transactional step with CONCURRENTLY.)
5. Harden helpers usage: replace `order_history_select` policy body's function calls with
   `(SELECT get_user_role())` / `(SELECT get_user_market_id())` and, because market_id now
   lives on the row, the policy can drop to a direct column check for managers:
   `(SELECT get_user_role()) = 'super_admin'
    OR ((SELECT get_user_role()) = 'market_manager' AND market_id = (SELECT get_user_market_id()))
    OR ((SELECT get_user_role()) = 'agent' AND EXISTS(SELECT 1 FROM orders o
        WHERE o.id = order_history.order_id AND o.assigned_to = auth.uid()))`
   (agent branch still needs orders for assigned_to, but agents don't hit the P&L route.)
   NOTE column-based check is optional; the load-summary win comes mostly from removing the
   filtering join. Keep the policy change minimal/reviewed to avoid altering agent access.

## load-summary.ts changes (src/lib/profitability/load-summary.ts)
For each of the 3 fetchAllRows calls, change:
  `.select("order_id, orders!inner(id, total_price, quantity, product_id, carrier_id, market_id)")`
  `.eq("orders.market_id", marketId)`
to filter on the base column and keep orders as a NON-filtering embed:
  `.select("order_id, market_id, orders(id, total_price, quantity, product_id, carrier_id)")`
  `.eq("market_id", marketId)`     ← now order_history.market_id (base table)
The `orders(...)` embed stays (still need total_price/quantity/product_id/carrier_id per row),
but it is no longer the filter target, so PostgREST no longer forces an inner-join filter and
RLS no longer runs the per-row market EXISTS on order_history. Row-shape mapping
(`h.orders`) is unchanged. delivered/returned/confirmed selects keep the exact same order
columns → identical downstream math.

Optional round-trip reduction (independent, keep numbers identical): raise fetch-all PAGE or
leave as-is; confirmed is the only query that ever exceeds 1 page (1013 rows), so this is
minor once RLS cost is gone. Do NOT change select lists or filters beyond the above.

## Keeping P&L numbers IDENTICAL
- Revenue still = SUM(orders.total_price) over delivered order_history rows (unchanged embed).
- COGS/delivery/return/packing still derive from products/carriers via the same maps.
- delivered_count/returned_count/confirmed_count/leads_count unchanged (same rows, same
  status_to filters, same market filter — just sourced from order_history.market_id which is
  by construction == orders.market_id via the trigger/backfill).
- ad_spend query untouched. leads count (orders head:true) untouched.
Verification: run loadProfitabilitySummary for a fixed window against a seeded DB BEFORE and
AFTER, assert byte-identical ProfitabilitySummary; assert `COUNT(*) FROM order_history WHERE
market_id IS NULL` = 0 post-backfill; assert `order_history.market_id == orders.market_id`
for all rows via a join check.

## Risks / edge cases
- Rows with NULL order_id: none possible (order_id is NOT NULL FK). market_id will always
  resolve. If an order were ever hard-deleted the FK would block it; historically fine.
- Trigger must be SECURITY DEFINER with pinned search_path so anon-context inserts can read
  orders.market_id regardless of RLS.
- The `.eq("market_id", marketId)` change relies on the backfill being complete before deploy
  — ship migration first, then code. If deployed out of order, pre-backfill rows would have
  NULL market_id and be filtered out; mitigate by running backfill in the same migration
  transaction as the column add (it is).
- Alternative/complementary fix (Phase-1 recommendation): route P&L reads through
  createAdminClient after the already-present canViewProfitability + marketId validation.
  That is lower-effort and also fixes it, but this task specifically asked for the
  denormalization design. The two are compatible; denormalization also speeds super_admin
  and any other RLS reader of order_history by market.
