-- ============================================================
-- 20260421_warehouse_rls.sql
-- RLS policies for warehouse_agent + label_prints table
--
-- Strategy:
--   * warehouse_agent is treated like market_manager for label_prints
--     and gets SELECT on orders in own market (any status).
--   * products / inventory_log / order_history existing policies already
--     cover super_admin and market_manager; we extend them to accept
--     warehouse_agent for own-market reads.
-- ============================================================

-- ------------------------------------------------------------
-- label_prints — new table, enable RLS + policies
-- ------------------------------------------------------------
ALTER TABLE label_prints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "label_prints_select"
  ON label_prints FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR market_id = get_user_market_id()
  );

CREATE POLICY "label_prints_insert"
  ON label_prints FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('super_admin', 'market_manager', 'warehouse_agent')
    AND (
      get_user_role() = 'super_admin'
      OR market_id = get_user_market_id()
    )
    AND printed_by = auth.uid()
  );

-- Append-only: no UPDATE or DELETE policy.

-- ------------------------------------------------------------
-- orders — extend SELECT policy to allow warehouse_agent own-market read
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "orders_select" ON orders;
CREATE POLICY "orders_select"
  ON orders FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (get_user_role() = 'agent' AND assigned_to = auth.uid())
    OR (get_user_role() = 'warehouse_agent' AND market_id = get_user_market_id())
  );

-- ------------------------------------------------------------
-- products — extend SELECT policy
-- ------------------------------------------------------------
-- The existing products_select policy already allows super_admin,
-- market_manager, and agent to read own-market products. Recreate it
-- to include warehouse_agent.
DO $$
DECLARE
  pol_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'products' AND policyname = 'products_select'
  ) INTO pol_exists;

  IF pol_exists THEN
    EXECUTE 'DROP POLICY "products_select" ON products';
  END IF;
END $$;

CREATE POLICY "products_select"
  ON products FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR market_id = get_user_market_id()
  );

-- ------------------------------------------------------------
-- inventory_log — already scoped by market via products join; no change.
-- order_history — already scoped via orders policy which now includes
--   warehouse_agent; no change.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Grant execute on new RPCs
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION scan_order_out(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION scan_return_in(UUID, UUID, BOOLEAN) TO authenticated;
