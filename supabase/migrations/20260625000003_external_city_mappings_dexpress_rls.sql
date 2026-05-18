-- ============================================================
-- 20260625000003_external_city_mappings_dexpress_rls.sql
-- Make the external_city_mappings RLS policies market-aware.
--
-- The original policies (migration 20260624000002) all gated on
--   EXISTS (SELECT 1 FROM cities c WHERE c.id = external_city_mappings.city_id ...)
-- That works for Tunisia mappings (which carry a city_id) but BLOCKS every
-- operation on a Libya/Dexpress mapping — those have city_id = NULL, so the
-- EXISTS is never true. Result: the Dexpress bind 500s, and Dexpress-bound
-- rows are invisible to SELECT.
--
-- A Dexpress-bound mapping (dexpress_state_id IS NOT NULL) is by definition a
-- Libya mapping. So the rule per row is:
--   - city_id set        → check via cities.market_id (unchanged Tunisia path)
--   - dexpress_state_id set → it's Libya: super_admin always, or a
--                             market_manager whose market is Libya.
--
-- LY_MARKET_ID is a fixed seed UUID (see src/lib/markets.ts); referencing it
-- here keeps the policy self-contained without a markets-table lookup.
-- ============================================================

DROP POLICY IF EXISTS "external_city_mappings_select"          ON external_city_mappings;
DROP POLICY IF EXISTS "external_city_mappings_insert_sa_mm"     ON external_city_mappings;
DROP POLICY IF EXISTS "external_city_mappings_update_sa_mm"     ON external_city_mappings;
DROP POLICY IF EXISTS "external_city_mappings_delete_sa_mm"     ON external_city_mappings;

-- A reusable predicate, inlined per policy:
--   super_admin                                              → always
--   city_id set    AND market_manager owns that city's market
--   dexpress row   AND market_manager owns the Libya market

-- SELECT
CREATE POLICY "external_city_mappings_select"
  ON external_city_mappings FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (
      city_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM cities c
        WHERE c.id = external_city_mappings.city_id
          AND c.market_id = get_user_market_id()
      )
    )
    OR (
      dexpress_state_id IS NOT NULL
      AND get_user_market_id() = '00000000-0000-0000-0000-000000000002'
    )
  );

-- INSERT
CREATE POLICY "external_city_mappings_insert_sa_mm"
  ON external_city_mappings FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (
      get_user_role() = 'market_manager'
      AND city_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM cities c
        WHERE c.id = external_city_mappings.city_id
          AND c.market_id = get_user_market_id()
      )
    )
    OR (
      get_user_role() = 'market_manager'
      AND dexpress_state_id IS NOT NULL
      AND get_user_market_id() = '00000000-0000-0000-0000-000000000002'
    )
  );

-- UPDATE
CREATE POLICY "external_city_mappings_update_sa_mm"
  ON external_city_mappings FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (
      get_user_role() = 'market_manager'
      AND city_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM cities c
        WHERE c.id = external_city_mappings.city_id
          AND c.market_id = get_user_market_id()
      )
    )
    OR (
      get_user_role() = 'market_manager'
      AND dexpress_state_id IS NOT NULL
      AND get_user_market_id() = '00000000-0000-0000-0000-000000000002'
    )
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (
      get_user_role() = 'market_manager'
      AND city_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM cities c
        WHERE c.id = external_city_mappings.city_id
          AND c.market_id = get_user_market_id()
      )
    )
    OR (
      get_user_role() = 'market_manager'
      AND dexpress_state_id IS NOT NULL
      AND get_user_market_id() = '00000000-0000-0000-0000-000000000002'
    )
  );

-- DELETE
CREATE POLICY "external_city_mappings_delete_sa_mm"
  ON external_city_mappings FOR DELETE
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (
      get_user_role() = 'market_manager'
      AND city_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM cities c
        WHERE c.id = external_city_mappings.city_id
          AND c.market_id = get_user_market_id()
      )
    )
    OR (
      get_user_role() = 'market_manager'
      AND dexpress_state_id IS NOT NULL
      AND get_user_market_id() = '00000000-0000-0000-0000-000000000002'
    )
  );
