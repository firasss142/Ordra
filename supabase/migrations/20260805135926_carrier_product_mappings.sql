-- ============================================================
-- carrier_product_mappings
-- Explicit mapping: an OMS product (optionally a specific variant) ->
-- the carrier-side product ids for stock the carrier physically holds
-- in their own warehouse and fulfils on our behalf.
--
-- Darb Assabil case: their `POST /api/local/shipments` accepts a
-- top-level `warehouse` plus per-line `warehouseProduct` /
-- `warehouseProductVariant`. Those ids are theirs, not ours, so the
-- link has to be stored explicitly — name matching is unsafe (we carry
-- two "دميه ملاكمه حجم كبير" products at different prices).
--
-- Keyed on (carrier_id, product_id, product_variant_id): carrier_id
-- implies the market via carriers.market_id, so cross-market bleed is
-- impossible by construction, mirroring storefront_product_mappings.
-- RLS follows carriers (join through carrier_id -> carriers.market_id).
-- ============================================================

CREATE TABLE carrier_product_mappings (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id            UUID         NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  product_id            UUID         NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_variant_id    UUID         REFERENCES product_variants(id) ON DELETE SET NULL,
  -- carrier-side identifiers (Darb: warehouseProduct / warehouseProductVariant)
  external_product_id   TEXT         NOT NULL,
  external_variant_id   TEXT         NOT NULL,
  external_sku          TEXT,
  -- the carrier warehouse holding this stock (Darb: top-level `warehouse`)
  external_warehouse_id TEXT         NOT NULL,
  -- carrier-side sale price, used as the shipment line `amount`
  external_sale_price   NUMERIC(10,3),
  is_active             BOOLEAN      NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- One mapping per (carrier, product, variant). NULLS NOT DISTINCT so a
-- product-level mapping (variant NULL) cannot be duplicated — plain
-- UNIQUE treats NULLs as distinct and would allow silent duplicates.
CREATE UNIQUE INDEX idx_carrier_product_mappings_unique
  ON carrier_product_mappings (carrier_id, product_id, product_variant_id)
  NULLS NOT DISTINCT;

CREATE INDEX idx_carrier_product_mappings_carrier
  ON carrier_product_mappings(carrier_id);

CREATE INDEX idx_carrier_product_mappings_product
  ON carrier_product_mappings(product_id);

ALTER TABLE carrier_product_mappings ENABLE ROW LEVEL SECURITY;

-- SELECT: super_admin everywhere, others within their own market.
-- Agents need this to see whether warehouse fulfilment is available.
CREATE POLICY "carrier_product_mappings_select"
  ON carrier_product_mappings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM carriers c
      WHERE c.id = carrier_product_mappings.carrier_id
        AND (
          get_user_role() = 'super_admin'
          OR c.market_id = get_user_market_id()
        )
    )
  );

-- INSERT: super_admin, or market_manager within own market
CREATE POLICY "carrier_product_mappings_insert_sa_mm"
  ON carrier_product_mappings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM carriers c
      WHERE c.id = carrier_product_mappings.carrier_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND c.market_id = get_user_market_id())
        )
    )
    -- mapped product must belong to the same market as the carrier
    AND EXISTS (
      SELECT 1
      FROM products p
      JOIN carriers c ON c.id = carrier_product_mappings.carrier_id
      WHERE p.id = carrier_product_mappings.product_id
        AND p.market_id = c.market_id
    )
  );

-- UPDATE: super_admin, or market_manager within own market
CREATE POLICY "carrier_product_mappings_update_sa_mm"
  ON carrier_product_mappings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM carriers c
      WHERE c.id = carrier_product_mappings.carrier_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND c.market_id = get_user_market_id())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM carriers c
      WHERE c.id = carrier_product_mappings.carrier_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND c.market_id = get_user_market_id())
        )
    )
    AND EXISTS (
      SELECT 1
      FROM products p
      JOIN carriers c ON c.id = carrier_product_mappings.carrier_id
      WHERE p.id = carrier_product_mappings.product_id
        AND p.market_id = c.market_id
    )
  );

-- DELETE: super_admin, or market_manager within own market
CREATE POLICY "carrier_product_mappings_delete_sa_mm"
  ON carrier_product_mappings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM carriers c
      WHERE c.id = carrier_product_mappings.carrier_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND c.market_id = get_user_market_id())
        )
    )
  );
