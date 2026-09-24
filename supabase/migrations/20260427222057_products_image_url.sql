-- Add a thumbnail URL to products so the orders list can show product imagery.
-- Nullable; existing rows are unaffected. The orders list query left-joins
-- products(image_url) and the UI falls back to a letter-avatar when null.

ALTER TABLE products ADD COLUMN image_url TEXT NULL;

COMMENT ON COLUMN products.image_url IS
  'Public URL or storage path for product thumbnail. ~256px, 1:1 aspect recommended.';
