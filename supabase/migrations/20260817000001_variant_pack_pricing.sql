-- Variant pack/pricing model.
--
-- Splits the overloaded `product_variants.quantity` into two explicit concepts
-- so that revenue, stock deduction, and COGS are computed consistently across
-- every order-intake path (manual route, webhook, order_items):
--
--   units_per_pack — physical units contained in ONE unit of this variant.
--                    Drives stock deduction (orders.quantity) and the COGS
--                    multiplier. Example: "2 pieces for 89" → units_per_pack = 2.
--
--   price_basis    — how `display_price` is interpreted when building line
--                    revenue:
--                      'pack' → display_price is the whole-pack price
--                               (customer pays 89 for the 2-piece pack).
--                      'unit' → display_price is the per-piece price.
--
-- The legacy `quantity` column is retained (deprecated) so any in-flight reader
-- keeps working during rollout; a later migration drops it once all readers use
-- units_per_pack.

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS units_per_pack INTEGER NOT NULL DEFAULT 1
    CHECK (units_per_pack >= 1);

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS price_basis TEXT NOT NULL DEFAULT 'pack'
    CHECK (price_basis IN ('pack', 'unit'));

-- Backfill: today `quantity` already plays the pack-size role on the manual
-- order path, so carry it over verbatim. (No-op when the table is empty.)
UPDATE product_variants
SET units_per_pack = quantity
WHERE units_per_pack IS DISTINCT FROM quantity;

COMMENT ON COLUMN product_variants.quantity IS
  'DEPRECATED — superseded by units_per_pack. Retained during rollout; do not read in new code.';
COMMENT ON COLUMN product_variants.units_per_pack IS
  'Physical units contained in one unit of this variant (pack size). Drives stock deduction and COGS multiplier.';
COMMENT ON COLUMN product_variants.price_basis IS
  'How display_price is interpreted for revenue: ''pack'' = whole-pack price, ''unit'' = per-piece price.';
