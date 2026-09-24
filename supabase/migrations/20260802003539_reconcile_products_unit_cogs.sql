-- ============================================================
-- 20260819000003_reconcile_products_unit_cogs.sql
-- Reconcile the products COGS column name between migrations and production.
--
-- THE DRIFT: 001_initial_schema.sql creates `products.unit_cost`. Production
-- was renamed to `unit_cogs` via the Supabase dashboard and no migration ever
-- recorded it, so all 32 application files read `unit_cogs` while a database
-- rebuilt from migrations has `unit_cost`. Two migrations mention `unit_cogs`
-- but only in comments, which is why nothing has failed loudly.
--
-- Confirmed by replaying all migrations against a clean Postgres: the rebuilt
-- schema has `unit_cost`, so every P&L query would return undefined COGS.
--
-- Idempotent in both directions:
--   * production (already `unit_cogs`) -> no-op
--   * fresh rebuild (`unit_cost`)      -> renamed, matching production
--
-- Needed before the investor rollup, which joins products for COGS and must
-- resolve identically in both environments.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'unit_cost'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'unit_cogs'
  ) THEN
    ALTER TABLE products RENAME COLUMN unit_cost TO unit_cogs;
    RAISE NOTICE 'products.unit_cost renamed to unit_cogs';
  ELSE
    RAISE NOTICE 'products.unit_cogs already present — nothing to do';
  END IF;
END $$;

-- 003_rls_fixes.sql revoked the old column name from agents. Re-assert the
-- revoke under whichever name now exists so financial columns stay hidden.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'unit_cogs'
  ) THEN
    EXECUTE 'REVOKE SELECT (unit_cogs) ON products FROM authenticated';
  END IF;
END $$;
