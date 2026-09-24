-- Stock integrity lockdown: only super_admin can INSERT/UPDATE/DELETE products
-- and product_variants directly. Market managers lose their previous own-market
-- write rights. The is_active toggle is carved out via toggle_product_active()
-- SECURITY DEFINER RPC (see 20260422_toggle_product_active_rpc.sql) so MM and
-- warehouse_agent can still activate/deactivate products.
--
-- SELECT policies are left unchanged — read access for each role remains the
-- same.

DROP POLICY IF EXISTS "products_insert_sa_mm" ON products;
DROP POLICY IF EXISTS "products_update_sa_mm" ON products;
DROP POLICY IF EXISTS "products_delete_sa_mm" ON products;

CREATE POLICY "products_insert_sa"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "products_update_sa"
  ON products FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "products_delete_sa"
  ON products FOR DELETE
  TO authenticated
  USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "product_variants_insert_sa_mm" ON product_variants;
DROP POLICY IF EXISTS "product_variants_update_sa_mm" ON product_variants;

CREATE POLICY "product_variants_insert_sa"
  ON product_variants FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "product_variants_update_sa"
  ON product_variants FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');
