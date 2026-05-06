-- ============================================================
-- 20260617000001_drop_products_cpl.sql
-- Remove products.cpl. Per-product ad spend is now derived from
-- ad_spend rows scoped to the product (ad_spend.product_id = X).
-- The product profitability API computes totalAdSpend at read time
-- by summing matching ad_spend.amount, so a stored CPL on the
-- product is no longer needed.
--
-- The 003_rls_fixes.sql REVOKE on (cpl, ...) is harmless once the
-- column is dropped, so we don't need to rewrite it.
-- ============================================================

ALTER TABLE products DROP COLUMN IF EXISTS cpl;
