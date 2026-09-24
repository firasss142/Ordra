-- ============================================================
-- 20260425_follow_ups_perf.sql
-- Suivi de commande (follow-ups) performance pack
--   1. Keyset pagination index on (market_id, updated_at DESC, id DESC).
--   2. Composite index for status-filtered Kanban columns.
--   3. All-markets index for super_admin scans.
--   4. follow_ups_status_counts RPC for accurate KPI totals in a single round-trip.
-- ============================================================

-- Keyset-cursor index for /api/follow-ups list (scoped to a market).
CREATE INDEX IF NOT EXISTS idx_order_follow_ups_market_updated
  ON order_follow_ups (market_id, updated_at DESC, id DESC);

-- Status-filtered Kanban column index. Four column fetches per page load hit
-- this path; keeping status in the leading trio lets each column seek directly.
CREATE INDEX IF NOT EXISTS idx_order_follow_ups_market_status_updated
  ON order_follow_ups (market_id, status, updated_at DESC, id DESC);

-- super_admin "All markets" variant — no market predicate.
CREATE INDEX IF NOT EXISTS idx_order_follow_ups_updated
  ON order_follow_ups (updated_at DESC, id DESC);

-- ============================================================
-- RPC: follow_ups_status_counts
-- Returns the per-status counts in a single GROUP BY query.
-- NULL filters = no filter. RLS still applies (SECURITY INVOKER).
-- ============================================================

CREATE OR REPLACE FUNCTION follow_ups_status_counts(
  p_market_id UUID DEFAULT NULL,
  p_agent_id  UUID DEFAULT NULL,
  p_campaign_id UUID DEFAULT NULL
)
RETURNS TABLE(status follow_up_status, count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT status, COUNT(*)::BIGINT
  FROM order_follow_ups
  WHERE (p_market_id IS NULL OR market_id = p_market_id)
    AND (p_agent_id IS NULL OR confirming_agent_id = p_agent_id)
    AND (p_campaign_id IS NULL OR campaign_id = p_campaign_id)
  GROUP BY status;
$$;

GRANT EXECUTE ON FUNCTION follow_ups_status_counts(UUID, UUID, UUID) TO authenticated;
