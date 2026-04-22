-- ============================================================
-- 019_performance_indexes.sql
-- Add missing indexes identified during performance audit
-- ============================================================

-- order_history (actor_id, created_at) — team route queries:
--   .in("actor_id", agentIds).gte("created_at", ...).lte("created_at", ...)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_history_actor_created
  ON order_history (actor_id, created_at)
  WHERE actor_id IS NOT NULL;

-- orders (market_id, created_at) — date-range queries on orders list page
--   and profitability routes: .eq("market_id", ...).gte("created_at", ...).lte("created_at", ...)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_market_created
  ON orders (market_id, created_at);

-- ad_spend (market_id, period_start, period_end) — profitability date-range queries:
--   .eq("market_id", ...).lte("period_start", toDate).gte("period_end", fromDate)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ad_spend_market_period
  ON ad_spend (market_id, period_start, period_end);
