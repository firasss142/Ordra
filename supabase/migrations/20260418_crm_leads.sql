-- ============================================================
-- 20260418_crm_leads.sql
-- CRM Lead Management — pre-order funnel
-- Enums, leads + lead_history tables, indexes, RLS policies.
-- RPCs (transition_lead_status, assign_lead, convert_lead_to_order)
-- will ship in a follow-up migration alongside their TDD tests.
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE lead_status AS ENUM (
  'new',
  'assigned',
  'attempt_1',
  'attempt_2',
  'attempt_3',
  'callback_scheduled',
  'qualified',
  'won',
  'lost',
  'archived'
);

CREATE TYPE lead_source AS ENUM (
  'manual_call',
  'facebook_comment',
  'facebook_dm',
  'instagram_dm',
  'whatsapp',
  'tiktok_comment',
  'other'
);

CREATE TYPE lead_lost_reason AS ENUM (
  'not_interested',
  'price',
  'unreachable',
  'competitor',
  'duplicate',
  'wrong_number',
  'spam',
  'autre'
);

-- ============================================================
-- TABLE: leads
-- ============================================================

CREATE TABLE leads (
  id                     UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id              UUID              NOT NULL REFERENCES markets(id),
  source                 lead_source       NOT NULL,
  source_external_id     TEXT,
  source_platform        TEXT,
  status                 lead_status       NOT NULL DEFAULT 'new',
  customer_name          TEXT              NOT NULL,
  customer_phone         TEXT              NOT NULL,
  customer_city          TEXT,
  customer_address       TEXT,
  product_interest_id    UUID              REFERENCES products(id),
  product_interest_note  TEXT,
  notes                  TEXT,
  assigned_to            UUID              REFERENCES users(id),
  callback_scheduled_at  TIMESTAMPTZ,
  lost_reason            lead_lost_reason,
  lost_note              TEXT,
  converted_order_id     UUID              REFERENCES orders(id),
  raw_payload            JSONB,
  created_at             TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ       NOT NULL DEFAULT now(),

  CONSTRAINT chk_leads_lost_reason CHECK (
    (status = 'lost' AND lost_reason IS NOT NULL)
    OR (status <> 'lost')
  ),
  CONSTRAINT chk_leads_lost_note CHECK (
    (lost_reason = 'autre' AND lost_note IS NOT NULL AND length(trim(lost_note)) > 0)
    OR (lost_reason IS DISTINCT FROM 'autre')
  ),
  CONSTRAINT chk_leads_won_order CHECK (
    (status = 'won' AND converted_order_id IS NOT NULL)
    OR (status <> 'won')
  )
);

-- Indexes mirror orders
CREATE INDEX idx_leads_market_status   ON leads (market_id, status);
CREATE INDEX idx_leads_assigned_to     ON leads (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_leads_callback        ON leads (callback_scheduled_at) WHERE status = 'callback_scheduled';
CREATE INDEX idx_leads_agent_queue     ON leads (assigned_to, status, callback_scheduled_at, created_at);
CREATE INDEX idx_leads_converted_order ON leads (converted_order_id) WHERE converted_order_id IS NOT NULL;

-- Webhook idempotency — same (platform, external_id) cannot be ingested twice
CREATE UNIQUE INDEX uq_leads_source_external
  ON leads (source_platform, source_external_id)
  WHERE source_external_id IS NOT NULL;

CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: lead_history — APPEND-ONLY
-- ============================================================

CREATE TABLE lead_history (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID         NOT NULL REFERENCES leads(id),
  status_from  lead_status,
  status_to    lead_status  NOT NULL,
  actor_id     UUID         REFERENCES users(id),
  actor_type   TEXT         NOT NULL CHECK (actor_type IN ('system', 'agent', 'manager')),
  note         TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
  -- NO updated_at — append-only
);

CREATE INDEX idx_lead_history_lead_id ON lead_history (lead_id);

-- ============================================================
-- RLS — enable + policies (mirrors orders + order_history)
-- ============================================================

ALTER TABLE leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_history   ENABLE ROW LEVEL SECURITY;

-- leads: SA all. MM own market. Agent only own assigned_to.
CREATE POLICY "leads_select"
  ON leads FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (get_user_role() = 'agent' AND assigned_to = auth.uid())
  );

-- INSERT: SA, MM-in-market, Agent-in-market (agents can create leads from inbound calls)
CREATE POLICY "leads_insert"
  ON leads FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() IN ('market_manager', 'agent') AND market_id = get_user_market_id())
  );

CREATE POLICY "leads_update"
  ON leads FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (get_user_role() = 'agent' AND assigned_to = auth.uid())
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
    OR (get_user_role() = 'agent' AND assigned_to = auth.uid())
  );

CREATE POLICY "leads_delete_super_admin"
  ON leads FOR DELETE
  TO authenticated
  USING (get_user_role() = 'super_admin');

-- lead_history: read follows lead access, insert open, no update/delete.
CREATE POLICY "lead_history_select"
  ON lead_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leads l
      WHERE l.id = lead_history.lead_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND l.market_id = get_user_market_id())
          OR (get_user_role() = 'agent' AND l.assigned_to = auth.uid())
        )
    )
  );

-- Tightened per rls-reviewer (Phase 5): caller must have access to the parent lead.
-- RPCs bypass this via SECURITY DEFINER (expected). Direct REST inserts from
-- authenticated clients are filtered to leads the caller can already read.
CREATE POLICY "lead_history_insert"
  ON lead_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leads l
      WHERE l.id = lead_history.lead_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND l.market_id = get_user_market_id())
          OR (get_user_role() = 'agent' AND l.assigned_to = auth.uid())
        )
    )
  );

-- NO update policy. NO delete policy. Append-only enforced.
