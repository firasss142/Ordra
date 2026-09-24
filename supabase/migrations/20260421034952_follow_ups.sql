-- ============================================================
-- 20260419_follow_ups.sql
-- Order Follow-up / Suivi de commande — sidecar coordination log
-- for post-confirmation orders (agent ↔ client ↔ delivery man).
--
-- One follow-up per order (UNIQUE on order_id) + append-only entries.
-- Agent access gated by confirming_agent_id (snapshotted from order_history
-- at creation so RLS stays a single-row check).
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE follow_up_status AS ENUM (
  'open',
  'in_progress',
  'resolved',
  'escalated'
);

-- ============================================================
-- TABLE: order_follow_ups
-- ============================================================

CREATE TABLE order_follow_ups (
  id                   UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id            UUID              NOT NULL REFERENCES markets(id),
  order_id             UUID              NOT NULL REFERENCES orders(id),
  status               follow_up_status  NOT NULL DEFAULT 'open',
  delivery_man_phone   TEXT,
  description          TEXT,
  confirming_agent_id  UUID              REFERENCES users(id),
  resolved_at          TIMESTAMPTZ,
  created_by           UUID              REFERENCES users(id),
  created_at           TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ       NOT NULL DEFAULT now(),

  CONSTRAINT uq_order_follow_ups_order_id UNIQUE (order_id),

  CONSTRAINT chk_follow_ups_resolved_at CHECK (
    (status IN ('resolved') AND resolved_at IS NOT NULL)
    OR (status NOT IN ('resolved'))
  )
);

CREATE INDEX idx_order_follow_ups_market_status     ON order_follow_ups (market_id, status);
CREATE INDEX idx_order_follow_ups_agent_status      ON order_follow_ups (confirming_agent_id, status) WHERE confirming_agent_id IS NOT NULL;
CREATE INDEX idx_order_follow_ups_order_id          ON order_follow_ups (order_id);

CREATE TRIGGER trg_order_follow_ups_updated_at
  BEFORE UPDATE ON order_follow_ups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: order_follow_up_entries — APPEND-ONLY
-- ============================================================

CREATE TABLE order_follow_up_entries (
  id             UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  follow_up_id   UUID               NOT NULL REFERENCES order_follow_ups(id) ON DELETE CASCADE,
  status_from    follow_up_status,
  status_to      follow_up_status,
  note           TEXT,
  actor_id       UUID               REFERENCES users(id),
  actor_type     TEXT               NOT NULL CHECK (actor_type IN ('system', 'agent', 'manager', 'super_admin')),
  created_at     TIMESTAMPTZ        NOT NULL DEFAULT now()
  -- NO updated_at — append-only
);

CREATE INDEX idx_order_follow_up_entries_follow_up_id ON order_follow_up_entries (follow_up_id, created_at DESC);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE order_follow_ups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_follow_up_entries   ENABLE ROW LEVEL SECURITY;

-- order_follow_ups: SA all. MM own market. Agent where confirming_agent_id = auth.uid().
CREATE POLICY "order_follow_ups_select"
  ON order_follow_ups FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (get_user_role() = 'agent' AND confirming_agent_id = auth.uid())
  );

CREATE POLICY "order_follow_ups_insert"
  ON order_follow_ups FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (get_user_role() = 'agent' AND market_id = get_user_market_id() AND confirming_agent_id = auth.uid())
  );

CREATE POLICY "order_follow_ups_update"
  ON order_follow_ups FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (get_user_role() = 'agent' AND confirming_agent_id = auth.uid())
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (get_user_role() = 'agent' AND confirming_agent_id = auth.uid())
  );

CREATE POLICY "order_follow_ups_delete_super_admin"
  ON order_follow_ups FOR DELETE
  TO authenticated
  USING (get_user_role() = 'super_admin');

-- order_follow_up_entries: read/insert follow parent access. No update/delete.
CREATE POLICY "order_follow_up_entries_select"
  ON order_follow_up_entries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM order_follow_ups f
      WHERE f.id = order_follow_up_entries.follow_up_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND f.market_id = get_user_market_id())
          OR (get_user_role() = 'agent' AND f.confirming_agent_id = auth.uid())
        )
    )
  );

CREATE POLICY "order_follow_up_entries_insert"
  ON order_follow_up_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM order_follow_ups f
      WHERE f.id = order_follow_up_entries.follow_up_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND f.market_id = get_user_market_id())
          OR (get_user_role() = 'agent' AND f.confirming_agent_id = auth.uid())
        )
    )
  );

-- NO update policy. NO delete policy. Append-only enforced.
