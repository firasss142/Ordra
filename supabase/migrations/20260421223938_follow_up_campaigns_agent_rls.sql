-- ============================================================
-- 20260423_follow_up_campaigns_agent_rls.sql
-- Allow agents to read follow_up_campaigns in their own market.
-- Required so the campaign join on order_follow_ups resolves
-- correctly when an agent fetches their assigned follow-ups.
-- Agents can read but never write campaigns (managers only).
-- ============================================================

DROP POLICY IF EXISTS "follow_up_campaigns_select" ON follow_up_campaigns;

CREATE POLICY "follow_up_campaigns_select"
  ON follow_up_campaigns FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (
      get_user_role() IN ('market_manager', 'agent')
      AND market_id = get_user_market_id()
    )
  );
