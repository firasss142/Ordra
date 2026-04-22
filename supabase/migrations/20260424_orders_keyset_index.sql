-- Orders list page — keyset pagination support.
-- The new /api/orders/list endpoint orders by (created_at DESC, id DESC) and
-- paginates via a (created_at, id) cursor. This composite index makes the
-- cursor seek O(log n) per market, independent of offset depth.
CREATE INDEX IF NOT EXISTS idx_orders_keyset
  ON orders (market_id, created_at DESC, id DESC);

-- Fast ILIKE search on customer_name and customer_phone for the quick-bar
-- search input (matches phone fragments, partial names). Trigram GIN is the
-- standard pg approach for fuzzy substring match without full-text setup.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_orders_customer_name_trgm
  ON orders USING gin (customer_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_customer_phone_trgm
  ON orders USING gin (customer_phone gin_trgm_ops);

-- external_id is often used to paste a storefront order id into search.
-- Partial index skips NULLs to keep the index small.
CREATE INDEX IF NOT EXISTS idx_orders_external_id_trgm
  ON orders USING gin (external_id gin_trgm_ops)
  WHERE external_id IS NOT NULL;
