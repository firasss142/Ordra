-- ============================================================
-- 20260418_agent_notifications.sql
--
-- Stage G: In-app notifications for agents when a callback or
-- scheduled attempt becomes due.
--
-- Table: agent_notifications
--   - Append-only per project convention
--   - kind: 'callback_due' | 'attempt_due'
--   - Unique partial index prevents duplicate unread notifications
--     for the same order+kind (idempotent cron runs)
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id   UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind       TEXT        NOT NULL CHECK (kind IN ('callback_due', 'attempt_due')),
  due_at     TIMESTAMPTZ NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency: only one unread notification per (order, kind) at a time
CREATE UNIQUE INDEX IF NOT EXISTS agent_notifications_unread_uniq
  ON agent_notifications (order_id, kind)
  WHERE read_at IS NULL;

-- Fast lookup by agent for unread count + bell dropdown
CREATE INDEX IF NOT EXISTS agent_notifications_agent_unread
  ON agent_notifications (agent_id, created_at DESC)
  WHERE read_at IS NULL;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE agent_notifications ENABLE ROW LEVEL SECURITY;

-- Agents can read their own notifications
CREATE POLICY "agent_notifications_select_own"
  ON agent_notifications
  FOR SELECT
  USING (agent_id = auth.uid());

-- Agents can mark their own notifications as read (UPDATE read_at only)
CREATE POLICY "agent_notifications_update_own"
  ON agent_notifications
  FOR UPDATE
  USING (agent_id = auth.uid());

-- Service role (cron/server) inserts notifications
-- (No INSERT policy needed for authenticated — service role bypasses RLS)

-- Allow Realtime replication for SELECT (required for channel subscriptions)
ALTER PUBLICATION supabase_realtime ADD TABLE agent_notifications;
