-- ============================================================
-- 20260816000003_carriers_unique_per_account.sql
-- Allow MULTIPLE accounts of the same carrier within one market.
--
-- The original carriers table had UNIQUE (market_id, code), which assumed at
-- most one carrier per (market, adapter code). That blocks running two logins
-- of the same carrier in one market — e.g. a second Darb Assabil account in
-- Libya (same code `darb_assabil`, different api_key/account_id).
--
-- Relax to UNIQUE (market_id, code, name): same carrier can appear more than
-- once per market as long as each has a distinct display name (which is what
-- agents use to tell the accounts apart in the upload picker). The dispatch
-- path already targets a specific carriers.id, so nothing else changes.
--
-- Strictly more permissive than the old key (every old row was already unique
-- on (market_id, code), hence also on (market_id, code, name)) — no existing
-- row can violate it. Idempotent: drops the old key by lookup (it is
-- auto-named) and adds the new one only if absent.
-- ============================================================

DO $$
DECLARE
  cname TEXT;
BEGIN
  -- Drop the old (market_id, code) unique constraint, whatever it's named.
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'carriers'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (market_id, code)';
  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE carriers DROP CONSTRAINT ' || quote_ident(cname);
  END IF;

  -- Add the per-account unique (market_id, code, name) if not already present.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'carriers'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (market_id, code, name)'
  ) THEN
    ALTER TABLE carriers
      ADD CONSTRAINT carriers_market_id_code_name_key UNIQUE (market_id, code, name);
  END IF;
END $$;
