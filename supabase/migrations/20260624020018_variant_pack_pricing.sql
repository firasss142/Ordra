-- ============================================================
-- 20260624000004_variant_pack_pricing.sql
-- Pack tiers: how many units a variant hands over, and what its price means.
--
-- RECONSTRUCTED FROM THE LIVE DATABASE on 2026-09-20.
--
-- This migration was applied to production on 2026-06-24 as
-- `variant_pack_pricing` (version 20260624020018) but its file was never
-- committed. The repo carried 287 migrations; production carried this one
-- more. A clean rebuild from the repo would therefore have produced a
-- `product_variants` table WITHOUT `units_per_pack` and `price_basis` —
-- two columns `ProductSheetPacks` reads on every agent call. The DDL below
-- was read back from `information_schema` and `pg_constraint`, so it
-- reproduces production exactly rather than approximating it.
--
-- Written idempotently (IF NOT EXISTS / DO block) so that re-running it
-- against production, where the columns already exist, is a no-op.
--
-- The two columns answer two different questions about one pack tier:
--   units_per_pack -> how many physical units leave the shelf for this tier.
--                     "Pack 2" of a single product is 2. Always >= 1.
--   price_basis    -> what `display_price` is quoting.
--                     'pack' -> the price is for the WHOLE tier (79 for two).
--                     'unit' -> the price is PER UNIT (39.5 each).
--                     An agent reading the sheet must not have to guess, and
--                     a storefront quoting per-unit must not be silently
--                     multiplied.
-- ============================================================

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS units_per_pack INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price_basis TEXT NOT NULL DEFAULT 'pack';

-- A tier that hands over zero units is not a tier. ADD CONSTRAINT has no
-- IF NOT EXISTS, hence the guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_variants_units_per_pack_check'
      AND conrelid = 'public.product_variants'::regclass
  ) THEN
    ALTER TABLE public.product_variants
      ADD CONSTRAINT product_variants_units_per_pack_check
      CHECK (units_per_pack >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_variants_price_basis_check'
      AND conrelid = 'public.product_variants'::regclass
  ) THEN
    ALTER TABLE public.product_variants
      ADD CONSTRAINT product_variants_price_basis_check
      CHECK (price_basis = ANY (ARRAY['pack'::text, 'unit'::text]));
  END IF;
END $$;

COMMENT ON COLUMN public.product_variants.units_per_pack IS
  'Physical units released per tier sold. "Pack 2" = 2. Always >= 1.';
COMMENT ON COLUMN public.product_variants.price_basis IS
  'What display_price quotes: ''pack'' = whole tier, ''unit'' = per unit.';
