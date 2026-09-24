-- Follow-ups redesign: time-first ordering + resolution outcomes
-- Adds due_at (next contact schedule) and resolution_outcome (converted/lost)

ALTER TABLE order_follow_ups
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_outcome text
    CHECK (resolution_outcome IN ('converted', 'lost'));

-- Also add outcome to entries (tracks call attempt result for scheduling suggestions)
ALTER TABLE order_follow_up_entries
  ADD COLUMN IF NOT EXISTS outcome text
    CHECK (outcome IN ('voicemail', 'no_answer', 'busy', 'other'));

-- Agent personal queue: time-first sort (partial: skip resolved rows)
CREATE INDEX IF NOT EXISTS idx_order_follow_ups_agent_due
  ON order_follow_ups (confirming_agent_id, due_at ASC NULLS LAST)
  WHERE status NOT IN ('resolved');

-- Market manager view: time-first sort (partial: skip resolved rows)
CREATE INDEX IF NOT EXISTS idx_order_follow_ups_market_due
  ON order_follow_ups (market_id, due_at ASC NULLS LAST)
  WHERE status NOT IN ('resolved');

-- Manager accountability: overdue follow-ups grouped by agent
CREATE OR REPLACE FUNCTION follow_ups_overdue_by_agent(
  p_market_id UUID DEFAULT NULL
)
RETURNS TABLE(
  confirming_agent_id UUID,
  full_name            TEXT,
  overdue_count        BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    f.confirming_agent_id,
    u.full_name,
    COUNT(*)::BIGINT AS overdue_count
  FROM order_follow_ups f
  JOIN users u ON u.id = f.confirming_agent_id
  WHERE f.status NOT IN ('resolved')
    AND f.due_at < now()
    AND f.confirming_agent_id IS NOT NULL
    AND (p_market_id IS NULL OR f.market_id = p_market_id)
  GROUP BY f.confirming_agent_id, u.full_name
  ORDER BY overdue_count DESC;
$$;

GRANT EXECUTE ON FUNCTION follow_ups_overdue_by_agent(UUID) TO authenticated;
