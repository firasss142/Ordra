-- ============================================================
-- 20260927000002_rls_initplan_delivery_joins.sql
-- Hoist the RLS helper calls out of the per-row filter on the tables the
-- delivery worklist joins. Same predicate, same truth table, same rows —
-- evaluated once per query instead of once per row.
--
-- WHY. `orders_select` already wraps its helpers as `(SELECT get_user_role())`,
-- which Postgres hoists into an InitPlan. The tables it joins were never given
-- the same treatment, and EXPLAIN on the worklist under a real manager JWT
-- shows the difference plainly:
--
--   orders     helpers in InitPlan, evaluated once          ~5 ms
--   customers  Filter: get_user_role() ...   loops=200     ~28 ms
--   users      Filter: get_user_role() ...   loops=200     ~23 ms
--   carriers   Filter: get_user_role() ...   seq scan
--
-- Over the whole RPC that was the difference between 59 ms as owner (no RLS)
-- and 786 ms under a manager JWT. The risk-inlining in 20260927000001 removed
-- ~276 ms of function calls; this removes the larger remainder.
--
-- WHY IT IS SAFE. get_user_role() and get_user_market_id() are both STABLE and
-- take no arguments, so within one statement they cannot return two different
-- answers; hoisting them changes when they are evaluated, never what they
-- return. No policy gains or loses a branch below — each USING expression is
-- the existing one with `f()` rewritten as `(SELECT f())`. Market isolation is
-- unchanged, and supabase/tests/ asserts it still holds under a real JWT.
--
-- delivery_actions is included deliberately even though it holds 0 rows today:
-- its policy runs a correlated EXISTS against orders per row, and the worklist
-- joins it four times per parcel. Left alone it becomes the next bottleneck as
-- soon as agents start logging calls.
-- ============================================================

-- ── customers ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS customers_select ON public.customers;
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR market_id = (SELECT public.get_user_market_id())
  );

-- ── users ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR ((SELECT public.get_user_role()) = 'market_manager'
        AND market_id = (SELECT public.get_user_market_id()))
    OR id = (SELECT auth.uid())
  );

-- ── carriers ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS carriers_select ON public.carriers;
CREATE POLICY carriers_select ON public.carriers
  FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR market_id = (SELECT public.get_user_market_id())
  );

-- ── delivery_zone_stats ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS delivery_zone_stats_select ON public.delivery_zone_stats;
CREATE POLICY delivery_zone_stats_select ON public.delivery_zone_stats
  FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR market_id = (SELECT public.get_user_market_id())
  );

-- ── delivery_actions ────────────────────────────────────────────────────────
-- The agent branch keeps its ownership EXISTS: an agent may read actions only
-- on orders assigned to them. Only the helper calls move.
DROP POLICY IF EXISTS delivery_actions_select ON public.delivery_actions;
CREATE POLICY delivery_actions_select ON public.delivery_actions
  FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR ((SELECT public.get_user_role()) = 'market_manager'
        AND market_id = (SELECT public.get_user_market_id()))
    OR ((SELECT public.get_user_role()) = 'agent'
        AND market_id = (SELECT public.get_user_market_id())
        AND EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.id = delivery_actions.order_id
            AND o.assigned_to = (SELECT auth.uid())
        ))
  );
