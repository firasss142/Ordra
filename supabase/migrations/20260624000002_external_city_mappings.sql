-- ============================================================
-- external_city_mappings
-- Maps a storefront platform's external city identifier
-- (e.g. Buybox numeric city_id) -> OMS cities.id, and optionally
-- carries the carrier routing hint (Dexpress state / route id).
--
-- Keyed on (platform, external_city_id): a platform's city catalog
-- is platform-wide, not per-storefront. The resolved OMS city has its
-- own market_id; the webhook resolver asserts that market matches the
-- storefront's market and otherwise flags the order for review.
--
-- dexpress_state_id is INTEGER to match dexpress_states.id (INTEGER PK)
-- and orders.dexpress_state_id (INTEGER).
-- ============================================================

CREATE TABLE external_city_mappings (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            TEXT         NOT NULL,
  external_city_id    TEXT         NOT NULL,
  external_city_name  TEXT,
  city_id             UUID         NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  dexpress_state_id   INTEGER      REFERENCES dexpress_states(id) ON DELETE SET NULL,
  external_route_id   TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (platform, external_city_id)
);

CREATE INDEX idx_external_city_mappings_city ON external_city_mappings(city_id);

ALTER TABLE external_city_mappings ENABLE ROW LEVEL SECURITY;

-- SELECT: super_admin everywhere; others see mappings whose resolved
-- city is in their own market.
CREATE POLICY "external_city_mappings_select"
  ON external_city_mappings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM cities c
      WHERE c.id = external_city_mappings.city_id
        AND (
          get_user_role() = 'super_admin'
          OR c.market_id = get_user_market_id()
        )
    )
  );

-- INSERT: super_admin, or market_manager when the resolved city is in
-- their own market.
CREATE POLICY "external_city_mappings_insert_sa_mm"
  ON external_city_mappings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cities c
      WHERE c.id = external_city_mappings.city_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND c.market_id = get_user_market_id())
        )
    )
  );

-- UPDATE: super_admin, or market_manager when the resolved city is in
-- their own market.
CREATE POLICY "external_city_mappings_update_sa_mm"
  ON external_city_mappings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM cities c
      WHERE c.id = external_city_mappings.city_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND c.market_id = get_user_market_id())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cities c
      WHERE c.id = external_city_mappings.city_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND c.market_id = get_user_market_id())
        )
    )
  );

-- DELETE: super_admin, or market_manager when the resolved city is in
-- their own market.
CREATE POLICY "external_city_mappings_delete_sa_mm"
  ON external_city_mappings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM cities c
      WHERE c.id = external_city_mappings.city_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND c.market_id = get_user_market_id())
        )
    )
  );
