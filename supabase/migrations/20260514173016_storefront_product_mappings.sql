-- ============================================================
-- storefront_product_mappings
-- Explicit mapping: a storefront's external variant id -> OMS product
-- (and optionally a specific product_variant). Replaces fragile
-- SKU/name string matching as the primary product resolution path.
--
-- Keyed on (storefront_id, external_variant_id): storefront_id implies
-- the market, so cross-market bleed is impossible by construction, and
-- two storefronts in the same market can reuse a variant id independently.
-- RLS follows storefronts (join through storefront_id -> storefronts.market_id).
-- ============================================================

CREATE TABLE storefront_product_mappings (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  storefront_id        UUID         NOT NULL REFERENCES storefronts(id) ON DELETE CASCADE,
  external_variant_id  TEXT         NOT NULL,
  external_product_id  TEXT,
  product_id           UUID         NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_variant_id   UUID         REFERENCES product_variants(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (storefront_id, external_variant_id)
);

CREATE INDEX idx_storefront_product_mappings_product
  ON storefront_product_mappings(product_id);

ALTER TABLE storefront_product_mappings ENABLE ROW LEVEL SECURITY;

-- SELECT: super_admin everywhere, others within their own market
CREATE POLICY "storefront_product_mappings_select"
  ON storefront_product_mappings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM storefronts s
      WHERE s.id = storefront_product_mappings.storefront_id
        AND (
          get_user_role() = 'super_admin'
          OR s.market_id = get_user_market_id()
        )
    )
  );

-- INSERT: super_admin, or market_manager within own market
CREATE POLICY "storefront_product_mappings_insert_sa_mm"
  ON storefront_product_mappings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM storefronts s
      WHERE s.id = storefront_product_mappings.storefront_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND s.market_id = get_user_market_id())
        )
    )
    -- mapped product must belong to the same market as the storefront
    AND EXISTS (
      SELECT 1
      FROM products p
      JOIN storefronts s ON s.id = storefront_product_mappings.storefront_id
      WHERE p.id = storefront_product_mappings.product_id
        AND p.market_id = s.market_id
    )
  );

-- UPDATE: super_admin, or market_manager within own market
CREATE POLICY "storefront_product_mappings_update_sa_mm"
  ON storefront_product_mappings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM storefronts s
      WHERE s.id = storefront_product_mappings.storefront_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND s.market_id = get_user_market_id())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM storefronts s
      WHERE s.id = storefront_product_mappings.storefront_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND s.market_id = get_user_market_id())
        )
    )
    AND EXISTS (
      SELECT 1
      FROM products p
      JOIN storefronts s ON s.id = storefront_product_mappings.storefront_id
      WHERE p.id = storefront_product_mappings.product_id
        AND p.market_id = s.market_id
    )
  );

-- DELETE: super_admin, or market_manager within own market
CREATE POLICY "storefront_product_mappings_delete_sa_mm"
  ON storefront_product_mappings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM storefronts s
      WHERE s.id = storefront_product_mappings.storefront_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND s.market_id = get_user_market_id())
        )
    )
  );
