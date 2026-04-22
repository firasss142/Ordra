-- ============================================================
-- 013_unassigned_pool_index.sql
-- Partial index to optimize the unassigned order pool query.
-- Covers: status='new' AND assigned_to IS NULL per market.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_orders_unassigned
  ON orders(market_id, status)
  WHERE status = 'new' AND assigned_to IS NULL;
