-- ============================================================
-- 008_fix_carriers_api_key_encrypted.sql
-- Add api_key_encrypted column to carriers table.
-- The TypeScript CarrierConfig type and adapter code (navex.ts, dexpress.ts)
-- reference this column but it was never added to the DB
-- (only api_credentials jsonb existed from the initial schema).
-- ============================================================

ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT;
