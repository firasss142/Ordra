-- ============================================================
-- 20260624000003_orders_mapping_columns.sql
-- Make storefront -> OMS mapping explicit and auditable on every order.
--
-- mapping_status records how well the webhook payload resolved to OMS
-- entities. It is NOT a lifecycle status: the order is still created as
-- 'pending' regardless, queue/transition logic is untouched. It only
-- drives the review surface in the /mappings admin UI.
--   mapped       -> product AND city both resolved confidently
--   needs_review -> at least one resolved by a weak/ambiguous path
--   unmatched    -> at least one could not be resolved at all
--
-- The external_* columns persist the raw storefront identifiers so an
-- admin can create a mapping later and back-fill, and so resolution is
-- reproducible/debuggable without re-parsing raw_payload.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS mapping_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (mapping_status IN ('mapped', 'needs_review', 'unmatched')),
  ADD COLUMN IF NOT EXISTS product_variant_id UUID
    REFERENCES product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_product_id TEXT,
  ADD COLUMN IF NOT EXISTS external_variant_id TEXT,
  ADD COLUMN IF NOT EXISTS external_city_id TEXT,
  ADD COLUMN IF NOT EXISTS external_route_id TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT;

-- Review surface: orders that still need a human to resolve a mapping.
-- Partial index keeps it small (most orders are 'mapped').
CREATE INDEX IF NOT EXISTS idx_orders_mapping_review
  ON orders(market_id, created_at DESC)
  WHERE mapping_status <> 'mapped';

-- Back-resolution: when a mapping row is created, find existing orders
-- carrying that external variant id so they can be back-filled.
CREATE INDEX IF NOT EXISTS idx_orders_external_variant
  ON orders(storefront_id, external_variant_id)
  WHERE external_variant_id IS NOT NULL;

-- Existing rows predate the resolver. They were matched (if at all) by
-- the old SKU/name path; product_id may be set or null. Mark rows that
-- already have a product_id as 'needs_review' (matched, but not via an
-- explicit mapping) and the rest stay 'unmatched'. This makes the
-- /mappings backlog reflect reality on day one rather than claiming
-- every historical order is cleanly mapped.
UPDATE orders
  SET mapping_status = 'needs_review'
  WHERE product_id IS NOT NULL;
