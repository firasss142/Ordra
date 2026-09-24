-- NOTE (2026-09-20) : CONCURRENTLY retiré pour que la base soit RECONSTRUCTIBLE.
-- `supabase db reset` applique les migrations dans un pipeline transactionnel, et
-- CREATE INDEX CONCURRENTLY y est interdit (SQLSTATE 25001) : la reconstruction
-- s'arrêtait ici. L'index produit est STRICTEMENT le même ; CONCURRENTLY ne
-- change que le verrouillage pendant la création, ce qui n'a de sens que sur une
-- table déjà en service — pas sur une base vide qu'on rebâtit. Ces index sont
-- déjà en place en production, où ils ont bien été créés sans verrou bloquant.
-- ============================================================
-- 019_performance_indexes.sql
-- Add missing indexes identified during performance audit
-- ============================================================

-- order_history (actor_id, created_at) — team route queries:
--   .in("actor_id", agentIds).gte("created_at", ...).lte("created_at", ...)
CREATE INDEX IF NOT EXISTS idx_order_history_actor_created
  ON order_history (actor_id, created_at)
  WHERE actor_id IS NOT NULL;

-- orders (market_id, created_at) — date-range queries on orders list page
--   and profitability routes: .eq("market_id", ...).gte("created_at", ...).lte("created_at", ...)
CREATE INDEX IF NOT EXISTS idx_orders_market_created
  ON orders (market_id, created_at);

-- ad_spend (market_id, period_start, period_end) — profitability date-range queries:
--   .eq("market_id", ...).lte("period_start", toDate).gte("period_end", fromDate)
CREATE INDEX IF NOT EXISTS idx_ad_spend_market_period
  ON ad_spend (market_id, period_start, period_end);
