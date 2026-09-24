-- ============================================================
-- Allow agents to SELECT active products + variants in their own
-- market. They still can't read financial columns (unit_cogs,
-- packing_cost, confirmation_processing_cost, cpl,
-- damaged_return_count) — those are revoked via column-level GRANT
-- from migration 003_rls_fixes.
--
-- Rationale: order creation by agents (via New Order modal) needs
-- the product + variant picker to render for their market. The
-- 20260411211203_fix_rls_audit_findings migration over-tightened
-- the SELECT policy and blocked agents entirely.
-- ============================================================

DROP POLICY IF EXISTS "products_select" ON products;

CREATE POLICY "products_select"
  ON products FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (
      get_user_role() = 'market_manager'
      AND market_id = get_user_market_id()
    )
    OR (
      get_user_role() = 'agent'
      AND market_id = get_user_market_id()
      AND is_active = true
    )
  );

DROP POLICY IF EXISTS "product_variants_select" ON product_variants;

CREATE POLICY "product_variants_select"
  ON product_variants FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_variants.product_id
        AND (
          get_user_role() = 'super_admin'
          OR (
            get_user_role() = 'market_manager'
            AND p.market_id = get_user_market_id()
          )
          OR (
            get_user_role() = 'agent'
            AND p.market_id = get_user_market_id()
            AND p.is_active = true
            AND product_variants.is_active = true
          )
        )
    )
  );
