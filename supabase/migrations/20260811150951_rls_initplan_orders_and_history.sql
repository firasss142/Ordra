-- ============================================================
-- 20260829000003_rls_initplan_orders_and_history.sql
-- Stop the orders / order_history RLS policies re-evaluating the auth helpers
-- once per row.
--
-- WHY: get_user_role() and get_user_market_id() are SECURITY DEFINER STABLE
-- functions whose body is `SELECT ... FROM users WHERE id = auth.uid()`. Called
-- bare in a policy predicate, Postgres evaluates them PER ROW — so every scan of
-- orders runs one users lookup per row per branch of the OR. orders_select has
-- four branches.
--
-- Measured on this database, full scan of orders (7,035 rows), same predicate:
--     bare get_user_role()      1,251.150 ms   42,889 shared buffers
--     (select get_user_role())      4.571 ms      792 shared buffers
-- 274x faster, 54x fewer buffers. Wrapping in a scalar subquery turns each call
-- into an InitPlan evaluated exactly once per statement (visible in the plan as
-- "InitPlan 1..7" feeding the Seq Scan filter).
--
-- This is Supabase's own documented remedy for the `auth_rls_initplan` advisor,
-- which currently fires on orders, order_history and leads (35 warnings total
-- across the schema). This migration fixes the two on the agent's hot path;
-- leads and the rest are deliberately left for a follow-up so this change stays
-- reviewable.
--
-- SEMANTICS ARE UNCHANGED. `(select f())` is equivalent to `f()` for a STABLE
-- function within a single statement — STABLE guarantees a constant result for
-- the duration of the statement, which is exactly what makes hoisting legal.
-- No branch, role, column or comparison is altered; the predicates below are the
-- current ones from pg_policies with `(select ...)` wrappers added and nothing
-- else. Diff them against the previous definitions in
-- 20260505233818_pending_assignment_model.sql (orders_select),
-- 20260506000000_uploaded_status_model.sql (orders_update),
-- 003_rls_fixes.sql (orders_insert_sa_mm), 002_rls_policies.sql
-- (orders_delete_super_admin) and 20260822000002_order_history_select_rls_market_id.sql
-- (order_history_select).
--
-- NOTE on order_history_select: the agent branch keeps its correlated EXISTS
-- against orders, because order_history has no assigned_to column and the
-- denormalised market_id added by 20260822000002 only serves the manager branch.
-- The per-row EXISTS is a PK-driven index probe and is not the dominant cost;
-- the repeated get_user_role() calls were.
--
-- NON-GOALS: no table, column, index or function is touched. No policy is added
-- or removed — each is dropped and recreated with an identical predicate. RLS
-- stays enabled throughout; DROP + CREATE of a single policy inside one
-- transaction never leaves the table unprotected.
-- ============================================================

BEGIN;

-- ---------------- orders ----------------

DROP POLICY IF EXISTS "orders_select" ON orders;
CREATE POLICY "orders_select" ON orders FOR SELECT TO authenticated
USING (
  (select get_user_role()) = 'super_admin'
  OR ((select get_user_role()) = 'market_manager' AND market_id = (select get_user_market_id()))
  OR ((select get_user_role()) = 'agent' AND assigned_to = (select auth.uid()))
  OR ((select get_user_role()) = 'warehouse_agent' AND market_id = (select get_user_market_id()))
);

DROP POLICY IF EXISTS "orders_update" ON orders;
CREATE POLICY "orders_update" ON orders FOR UPDATE TO authenticated
USING (
  (select get_user_role()) = 'super_admin'
  OR ((select get_user_role()) = 'market_manager' AND market_id = (select get_user_market_id()))
  OR (
    (select get_user_role()) = 'agent'
    AND assigned_to = (select auth.uid())
    AND status = ANY (ARRAY[
      'pending'::order_status, 'assigned'::order_status,
      'attempt_1'::order_status, 'attempt_2'::order_status, 'attempt_3'::order_status,
      'callback_scheduled'::order_status, 'confirmed'::order_status,
      'dispatch_scheduled'::order_status, 'uploaded'::order_status
    ])
  )
)
WITH CHECK (
  (select get_user_role()) = 'super_admin'
  OR ((select get_user_role()) = 'market_manager' AND market_id = (select get_user_market_id()))
  OR (
    (select get_user_role()) = 'agent'
    AND assigned_to = (select auth.uid())
    AND status = ANY (ARRAY[
      'pending'::order_status, 'assigned'::order_status,
      'attempt_1'::order_status, 'attempt_2'::order_status, 'attempt_3'::order_status,
      'callback_scheduled'::order_status, 'confirmed'::order_status,
      'dispatch_scheduled'::order_status, 'uploaded'::order_status
    ])
  )
);

DROP POLICY IF EXISTS "orders_insert_system_mm_sa" ON orders;
CREATE POLICY "orders_insert_system_mm_sa" ON orders FOR INSERT TO authenticated
WITH CHECK (
  (select get_user_role()) = ANY (ARRAY['super_admin'::text, 'market_manager'::text])
  OR market_id = (select get_user_market_id())
);

DROP POLICY IF EXISTS "orders_delete_super_admin" ON orders;
CREATE POLICY "orders_delete_super_admin" ON orders FOR DELETE TO authenticated
USING ((select get_user_role()) = 'super_admin');

-- ---------------- order_history ----------------

DROP POLICY IF EXISTS "order_history_select" ON order_history;
CREATE POLICY "order_history_select" ON order_history FOR SELECT TO authenticated
USING (
  (select get_user_role()) = 'super_admin'
  OR ((select get_user_role()) = 'market_manager' AND market_id = (select get_user_market_id()))
  OR (
    (select get_user_role()) = 'agent'
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_history.order_id
        AND o.assigned_to = (select auth.uid())
    )
  )
);

COMMIT;
