-- Add a nullable sale-price column to products so single-SKU products
-- (no variants) can auto-fill the order modal's unit_price/total_price.
-- Variants still override when present via product_variants.display_price.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS default_price NUMERIC(12, 3);

-- Agents may read default_price (unlike unit_cogs / packing_cost / cpl / etc.
-- which are REVOKEd in migration 003_rls_fixes).
GRANT SELECT (default_price) ON products TO authenticated;
