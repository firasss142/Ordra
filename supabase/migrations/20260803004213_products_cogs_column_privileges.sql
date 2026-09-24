-- ============================================================
-- 20260819000007_products_cogs_column_privileges.sql
-- Tighten COGS exposure where it is safe to, and record why the rest cannot be
-- done with column privileges at all.
--
-- ── WHAT 20260819000003 CLAIMED, AND WHY IT IS A NO-OP ────────────────────
-- That migration ends with
--     REVOKE SELECT (unit_cogs) ON products FROM authenticated;
-- commented as re-asserting that "financial columns stay hidden". It changes
-- nothing. `authenticated` holds TABLE-level SELECT on products (production
-- relacl: `authenticated=arwdDxtm/postgres`), and PostgreSQL does not strip a
-- table-level privilege through a column-level REVOKE. Verified in production:
--     has_column_privilege('authenticated','products','unit_cogs','SELECT') = true
--     pg_attribute.attacl for unit_cogs                                    = NULL
--
-- ── WHY THE OBVIOUS FIX IS WRONG ──────────────────────────────────────────
-- Dropping the table grant and re-granting column-by-column DOES make the
-- revoke bite — but it bites everyone. Supabase authenticates every signed-in
-- user as the SAME `authenticated` role and separates them with RLS POLICIES,
-- not roles. A column privilege therefore cannot distinguish an agent from a
-- market_manager, and managers legitimately need COGS: /api/inventory/summary,
-- lib/dashboard/summary.ts and the products pages all read unit_cogs through
-- the cookie-session client. Revoking from `authenticated` breaks those pages
-- for the very people entitled to the data.
--
-- Hiding COGS from agents specifically needs one of:
--   * moving those reads to the service-role client (they are already
--     server-side route handlers, so this is the cheap option), or
--   * a SECURITY DEFINER RPC that filters columns by the caller's role, or
--   * a role-filtered view that agents read instead of the base table.
-- All three are application changes, not grant changes, and are deliberately
-- left out of this migration rather than half-done inside it.
--
-- ── WHAT THIS MIGRATION ACTUALLY DOES ─────────────────────────────────────
-- Removes the financial columns from `anon`, which is the one role with no
-- business case for them at all. Safe, and real: `anon` currently holds the
-- same blanket table grant.
-- ============================================================

DO $$
DECLARE
  col        TEXT;
  financial  TEXT[] := ARRAY['unit_cogs', 'packing_cost', 'confirmation_processing_cost'];
  grants     TEXT[] := '{}';
BEGIN
  -- Only columns that actually exist, so this stays correct if products gains
  -- or loses a financial field later.
  FOR col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
    ORDER BY ordinal_position
  LOOP
    IF NOT (col = ANY (financial)) THEN
      grants := grants || quote_ident(col);
    END IF;
  END LOOP;

  -- A column-level REVOKE cannot cut through a table-level grant, so the
  -- table-level grant has to go first.
  EXECUTE 'REVOKE SELECT ON products FROM anon';
  EXECUTE format('GRANT SELECT (%s) ON products TO anon', array_to_string(grants, ', '));
END $$;

-- Fail loudly rather than shipping the same silent no-op twice.
DO $$
BEGIN
  IF has_column_privilege('anon', 'products', 'unit_cogs', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon can still SELECT products.unit_cogs';
  END IF;
  IF NOT has_column_privilege('anon', 'products', 'name', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon lost SELECT on products.name';
  END IF;
  -- Asserted, not fixed: see the header. Managers read COGS through this role.
  IF NOT has_column_privilege('authenticated', 'products', 'unit_cogs', 'SELECT') THEN
    RAISE WARNING 'authenticated cannot read products.unit_cogs — dashboard and inventory summaries will fail';
  END IF;
  RAISE NOTICE 'products COGS columns hidden from anon; authenticated intentionally unchanged';
END $$;
