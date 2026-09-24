-- ============================================================
-- 20260422_follow_up_campaigns.sql
-- Callback Campaigns: named outreach batches that pull matching
-- orders into Follow-Ups as a tagged cohort.
--
-- Key changes:
--   1. New table: follow_up_campaigns
--   2. ADD campaign_id FK on order_follow_ups
--   3. Drop UNIQUE(order_id) → replace with partial unique index
--      so an order can be re-engaged once its prior follow-up resolves
--   4. RLS for campaigns table (SA all, MM own market, agents no access)
-- ============================================================

-- ============================================================
-- TABLE: follow_up_campaigns
-- ============================================================

CREATE TABLE follow_up_campaigns (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id    UUID        NOT NULL REFERENCES markets(id),
  name         TEXT        NOT NULL,
  filter_json  JSONB       NOT NULL,
  created_by   UUID        REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_follow_up_campaigns_market_name UNIQUE (market_id, name)
);

CREATE INDEX idx_follow_up_campaigns_market
  ON follow_up_campaigns (market_id, created_at DESC);

-- ============================================================
-- Extend order_follow_ups with campaign_id
-- ============================================================

ALTER TABLE order_follow_ups
  ADD COLUMN campaign_id UUID REFERENCES follow_up_campaigns(id);

CREATE INDEX idx_order_follow_ups_campaign
  ON order_follow_ups (campaign_id)
  WHERE campaign_id IS NOT NULL;

-- ============================================================
-- Replace global UNIQUE on order_id with a partial unique index:
-- at most one ACTIVE follow-up per order at a time.
-- Once resolved/archived, the same order can join a new campaign.
-- ============================================================

ALTER TABLE order_follow_ups
  DROP CONSTRAINT uq_order_follow_ups_order_id;

CREATE UNIQUE INDEX uq_order_follow_ups_order_id_active
  ON order_follow_ups (order_id)
  WHERE status IN ('open', 'in_progress', 'escalated');

-- ============================================================
-- RLS for follow_up_campaigns
-- ============================================================

ALTER TABLE follow_up_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follow_up_campaigns_select"
  ON follow_up_campaigns FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

CREATE POLICY "follow_up_campaigns_insert"
  ON follow_up_campaigns FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

CREATE POLICY "follow_up_campaigns_update"
  ON follow_up_campaigns FOR UPDATE
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

CREATE POLICY "follow_up_campaigns_delete_super_admin"
  ON follow_up_campaigns FOR DELETE
  TO authenticated
  USING (get_user_role() = 'super_admin');
