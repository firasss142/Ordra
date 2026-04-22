-- ============================================================
-- 009_fix_rls_agent_status_restriction.sql
-- Fix: orders_select and orders_update agent branches had no status restriction.
--
-- Root cause: multiple permissive SELECT policies combine with OR in Postgres.
-- The broad orders_select policy granted agents access to ALL statuses
-- (dispatched, delivered, returned, rejected, etc.), overriding the narrower
-- agent_queue_own_orders policy which was effectively dead code.
--
-- Fix: recreate both policies with a status restriction on the agent branch.
-- Drop agent_queue_own_orders (now redundant).
-- ============================================================

DROP POLICY IF EXISTS "orders_select" ON orders;
CREATE POLICY "orders_select" ON orders
  FOR SELECT
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (
      get_user_role() = 'agent'
      AND assigned_to = auth.uid()
      AND status IN ('assigned','attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed')
    )
  );

DROP POLICY IF EXISTS "orders_update" ON orders;
CREATE POLICY "orders_update" ON orders
  FOR UPDATE
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (
      get_user_role() = 'agent'
      AND assigned_to = auth.uid()
      AND status IN ('assigned','attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed')
    )
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (
      get_user_role() = 'agent'
      AND assigned_to = auth.uid()
      AND status IN ('assigned','attempt_1','attempt_2','attempt_3','callback_scheduled','confirmed')
    )
  );

-- agent_queue_own_orders is now redundant (identical to orders_select agent branch).
-- Drop to avoid confusion.
DROP POLICY IF EXISTS "agent_queue_own_orders" ON orders;
