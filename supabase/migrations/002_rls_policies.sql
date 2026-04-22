-- ============================================================
-- 002_rls_policies.sql
-- RLS helper functions, enable RLS on all 12 tables, policies
-- ============================================================

-- ============================================================
-- HELPER FUNCTIONS (SECURITY DEFINER — bypass RLS for lookups)
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION get_user_market_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT market_id FROM users WHERE id = auth.uid();
$$;

-- ============================================================
-- ENABLE RLS — all 12 tables
-- ============================================================

ALTER TABLE markets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE storefronts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE carriers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_spend         ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- markets
-- Everyone reads. Only super_admin writes.
-- ============================================================

CREATE POLICY "markets_read_all"
  ON markets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "markets_write_super_admin"
  ON markets FOR ALL
  TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

-- ============================================================
-- users
-- SA: all rows. MM: own market only. Agent: self only.
-- ============================================================

CREATE POLICY "users_select"
  ON users FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR id = auth.uid()
  );

CREATE POLICY "users_insert_super_admin"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "users_update_super_admin"
  ON users FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "users_delete_super_admin"
  ON users FOR DELETE
  TO authenticated
  USING (get_user_role() = 'super_admin');

-- ============================================================
-- settings
-- SA: all. MM+Agent: own market read-only.
-- ============================================================

CREATE POLICY "settings_select"
  ON settings FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR market_id = get_user_market_id()
  );

CREATE POLICY "settings_write_super_admin"
  ON settings FOR ALL
  TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

-- ============================================================
-- storefronts
-- SA: all. MM+Agent: own market read-only.
-- ============================================================

CREATE POLICY "storefronts_select"
  ON storefronts FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR market_id = get_user_market_id()
  );

CREATE POLICY "storefronts_write_super_admin"
  ON storefronts FOR ALL
  TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

-- ============================================================
-- carriers
-- SA: all. MM+Agent: own market read-only.
-- ============================================================

CREATE POLICY "carriers_select"
  ON carriers FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR market_id = get_user_market_id()
  );

CREATE POLICY "carriers_write_super_admin"
  ON carriers FOR ALL
  TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

-- ============================================================
-- products
-- SA: all. MM+Agent: own market.
-- ============================================================

CREATE POLICY "products_select"
  ON products FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR market_id = get_user_market_id()
  );

CREATE POLICY "products_insert_sa_mm"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

CREATE POLICY "products_update_sa_mm"
  ON products FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

CREATE POLICY "products_delete_sa_mm"
  ON products FOR DELETE
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

-- ============================================================
-- product_variants
-- Follows products (join through product_id → products.market_id)
-- ============================================================

CREATE POLICY "product_variants_select"
  ON product_variants FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_variants.product_id
        AND (
          get_user_role() = 'super_admin'
          OR p.market_id = get_user_market_id()
        )
    )
  );

CREATE POLICY "product_variants_insert_sa_mm"
  ON product_variants FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_variants.product_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND p.market_id = get_user_market_id())
        )
    )
  );

CREATE POLICY "product_variants_update_sa_mm"
  ON product_variants FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_variants.product_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND p.market_id = get_user_market_id())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_variants.product_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND p.market_id = get_user_market_id())
        )
    )
  );

CREATE POLICY "product_variants_delete_sa_mm"
  ON product_variants FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_variants.product_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND p.market_id = get_user_market_id())
        )
    )
  );

-- ============================================================
-- orders
-- SA: all. MM: own market. Agent: own assigned_to only.
-- ============================================================

CREATE POLICY "orders_select"
  ON orders FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (get_user_role() = 'agent' AND assigned_to = auth.uid())
  );

CREATE POLICY "orders_insert_system_mm_sa"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('super_admin', 'market_manager')
    OR market_id = get_user_market_id()
  );

CREATE POLICY "orders_update"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (get_user_role() = 'agent' AND assigned_to = auth.uid())
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (get_user_role() = 'agent' AND assigned_to = auth.uid())
  );

CREATE POLICY "orders_delete_super_admin"
  ON orders FOR DELETE
  TO authenticated
  USING (get_user_role() = 'super_admin');

-- ============================================================
-- order_history — APPEND-ONLY
-- Read follows order access. Insert for authenticated. NO update/delete.
-- ============================================================

CREATE POLICY "order_history_select"
  ON order_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_history.order_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND o.market_id = get_user_market_id())
          OR (get_user_role() = 'agent' AND o.assigned_to = auth.uid())
        )
    )
  );

CREATE POLICY "order_history_insert"
  ON order_history FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- NO update policy. NO delete policy. Append-only enforced.

-- ============================================================
-- inventory_log — APPEND-ONLY
-- SA: all. MM+Agent: own market (via product_id → products.market_id).
-- ============================================================

CREATE POLICY "inventory_log_select"
  ON inventory_log FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = inventory_log.product_id
        AND p.market_id = get_user_market_id()
    )
  );

CREATE POLICY "inventory_log_insert"
  ON inventory_log FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = inventory_log.product_id
        AND p.market_id = get_user_market_id()
    )
  );

-- NO update policy. NO delete policy. Append-only enforced.

-- ============================================================
-- assignment_rules
-- SA: all. MM: own market.
-- ============================================================

CREATE POLICY "assignment_rules_select"
  ON assignment_rules FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR market_id = get_user_market_id()
  );

CREATE POLICY "assignment_rules_write_sa"
  ON assignment_rules FOR ALL
  TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "assignment_rules_update_mm"
  ON assignment_rules FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  WITH CHECK (get_user_role() = 'market_manager' AND market_id = get_user_market_id());

-- ============================================================
-- ad_spend
-- SA: all. MM: own market.
-- ============================================================

CREATE POLICY "ad_spend_select"
  ON ad_spend FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR market_id = get_user_market_id()
  );

CREATE POLICY "ad_spend_insert_sa_mm"
  ON ad_spend FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

CREATE POLICY "ad_spend_update_sa_mm"
  ON ad_spend FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

CREATE POLICY "ad_spend_delete_sa_mm"
  ON ad_spend FOR DELETE
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );
