-- ============================================================
-- 20260822000002_order_history_select_rls_market_id.sql
--
-- Rewrite order_history_select so the common roles authorize on the row's own
-- market_id instead of a correlated EXISTS against orders.
--
-- THE PROBLEM: the previous policy was a single EXISTS subquery evaluated once
-- per candidate row. On /dashboard that subplan ran 1,332 times for a 30-day
-- window, probing orders_pkey per row, and — because the check needs a column
-- from another table — it also defeated the index-only scan, forcing a heap
-- fetch for every row. Measured on the same 265-row result set:
--
--   join orders + old RLS   281 ms   13,017 buffers
--   no join  + old RLS       47 ms    7,689 buffers
--   no join  + RLS bypassed   4.3 ms    262 buffers
--
-- Dashboard queries were routinely 0.5–4.2 s (pg_stat_statements, 117-day
-- window) and repeatedly hit the 8 s statement_timeout on the `authenticated`
-- role, surfacing as a Server Components render error on /fr/dashboard.
--
-- EQUIVALENCE — the old policy was:
--
--   EXISTS (SELECT 1 FROM orders o
--           WHERE o.id = order_history.order_id
--             AND (   get_user_role() = 'super_admin'
--                  OR (get_user_role() = 'market_manager' AND o.market_id = get_user_market_id())
--                  OR (get_user_role() = 'agent'         AND o.assigned_to  = auth.uid())))
--
-- Branch by branch:
--   super_admin     — the EXISTS reduced to "the parent order exists". order_id
--                     is NOT NULL with an FK to orders, so that is always true:
--                     the subquery was pure overhead. Now plain `true`.
--   market_manager  — o.market_id is denormalized onto order_history.market_id
--                     by the set_order_history_market_id trigger, backfilled by
--                     20260819000001, and NOT NULL as of 20260822000001. Reading
--                     it locally is the same predicate without the join.
--   agent           — assigned_to lives only on orders and is mutable
--                     (reassignment), so it CANNOT be denormalized safely. This
--                     branch keeps the EXISTS. Agents are redirected away from
--                     /dashboard to /queue and read narrow per-order slices, so
--                     the subquery cost is not on any hot path.
--   any other role  — including warehouse_agent, which matched no branch before
--                     and still matches none. Deliberately preserved: warehouse
--                     agents see no order_history. (Note this differs from
--                     orders_select, which DOES grant warehouse_agent access to
--                     orders. Not a bug to fix here — changing it would widen
--                     access, which is out of scope for a performance fix.)
--
-- Net: identical visibility for every role, with the per-row subquery removed
-- from the two roles that actually load the dashboard.
-- ============================================================

DROP POLICY IF EXISTS "order_history_select" ON order_history;

CREATE POLICY "order_history_select"
  ON order_history FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (
      get_user_role() = 'market_manager'
      AND market_id = get_user_market_id()
    )
    OR (
      get_user_role() = 'agent'
      AND EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = order_history.order_id
          AND o.assigned_to = auth.uid()
      )
    )
  );
