-- ============================================================
-- 20260605000001_alert_acknowledgements.sql
-- Acknowledge / snooze state for /dashboard/alerts.
--
-- Alerts themselves are *derived* at query time from orders / products /
-- users — they are not stored rows. This table persists the operator
-- actions on them (ack / snooze) keyed by a deterministic alert_key of the
-- form `${type}:${entity_id}`. When the underlying condition clears, the
-- alert disappears; the ack row becomes historical (alert_history feed).
-- ============================================================

CREATE TABLE alert_acknowledgements (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       UUID          REFERENCES markets(id),
  alert_key       TEXT          NOT NULL,
  alert_type      TEXT          NOT NULL,
  entity_id       TEXT          NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  snoozed_until   TIMESTAMPTZ,
  actor_id        UUID          NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_alert_ack_market_key UNIQUE (market_id, alert_key),
  CONSTRAINT chk_alert_ack_has_state CHECK (
    acknowledged_at IS NOT NULL OR snoozed_until IS NOT NULL
  )
);

CREATE INDEX idx_alert_ack_market_type ON alert_acknowledgements (market_id, alert_type);
CREATE INDEX idx_alert_ack_snoozed_until ON alert_acknowledgements (snoozed_until) WHERE snoozed_until IS NOT NULL;
CREATE INDEX idx_alert_ack_created_at ON alert_acknowledgements (created_at DESC);

CREATE TRIGGER trg_alert_ack_updated_at
  BEFORE UPDATE ON alert_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- RLS — super_admin reads/writes all; market_manager reads/writes own market.
-- Agents / warehouse_agents have no access.
-- ============================================================

ALTER TABLE alert_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY alert_ack_select_super_admin
  ON alert_acknowledgements
  FOR SELECT
  USING (get_user_role() = 'super_admin');

CREATE POLICY alert_ack_select_market_manager
  ON alert_acknowledgements
  FOR SELECT
  USING (
    get_user_role() = 'market_manager'
    AND market_id = get_user_market_id()
  );

CREATE POLICY alert_ack_insert_super_admin
  ON alert_acknowledgements
  FOR INSERT
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY alert_ack_insert_market_manager
  ON alert_acknowledgements
  FOR INSERT
  WITH CHECK (
    get_user_role() = 'market_manager'
    AND market_id = get_user_market_id()
  );

CREATE POLICY alert_ack_update_super_admin
  ON alert_acknowledgements
  FOR UPDATE
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY alert_ack_update_market_manager
  ON alert_acknowledgements
  FOR UPDATE
  USING (
    get_user_role() = 'market_manager'
    AND market_id = get_user_market_id()
  )
  WITH CHECK (
    get_user_role() = 'market_manager'
    AND market_id = get_user_market_id()
  );

CREATE POLICY alert_ack_delete_super_admin
  ON alert_acknowledgements
  FOR DELETE
  USING (get_user_role() = 'super_admin');

CREATE POLICY alert_ack_delete_market_manager
  ON alert_acknowledgements
  FOR DELETE
  USING (
    get_user_role() = 'market_manager'
    AND market_id = get_user_market_id()
  );
