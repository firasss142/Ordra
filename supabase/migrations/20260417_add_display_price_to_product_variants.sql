-- Add display_price column to product_variants.
-- This column already exists in production (added via Supabase dashboard).
-- This migration makes local schema match remote.
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS display_price NUMERIC(12, 3) NOT NULL DEFAULT 0;
