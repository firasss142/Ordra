-- Optimize customer phone search on orders. Same pattern as
-- 20260418_crm_customer_phone_index.sql — composite B-tree probe
-- instead of partial scan when filtering by (market_id, phone).
CREATE INDEX IF NOT EXISTS idx_orders_market_phone
  ON orders (market_id, customer_phone);
