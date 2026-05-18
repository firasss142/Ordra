-- ============================================================
-- 20260625000002_external_city_mappings_dexpress_destination.sql
-- Make external_city_mappings market-aware.
--
-- Originally `city_id` was NOT NULL — every mapping had to resolve to an OMS
-- cities row. But Libya's carrier is Dexpress, whose state list IS the
-- destination catalogue; a Libya mapping resolves to a dexpress_states row
-- (dexpress_state_id) and has NO city_id. The NOT NULL constraint made that
-- impossible to store.
--
-- This:
--   1. drops the NOT NULL on city_id
--   2. adds a CHECK so EXACTLY ONE destination is set — never both, never
--      neither. (city_id XOR dexpress_state_id)
--
-- Mirrors the mutual-exclusion the `orders` table already enforces between
-- orders.city_id and orders.dexpress_state_id.
-- ============================================================

ALTER TABLE external_city_mappings
  ALTER COLUMN city_id DROP NOT NULL;

ALTER TABLE external_city_mappings
  ADD CONSTRAINT external_city_mappings_one_destination
  CHECK (
    (city_id IS NOT NULL AND dexpress_state_id IS NULL)
    OR
    (city_id IS NULL AND dexpress_state_id IS NOT NULL)
  );
