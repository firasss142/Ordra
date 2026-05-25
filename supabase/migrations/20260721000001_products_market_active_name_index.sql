-- Speeds up product picker queries (WHERE market_id = ? AND is_active = true ORDER BY name).
-- Used by /api/products/search on every order-detail open across all roles.
CREATE INDEX IF NOT EXISTS idx_products_market_active_name
  ON products (market_id, is_active, name);
