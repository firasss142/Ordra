-- ============================================================
-- 20260422_follow_up_campaigns_rpcs.sql
-- RPC: bulk_create_campaign_follow_ups
-- Atomically inserts one follow-up per matched order into a
-- campaign. Skips orders that already have an active follow-up
-- (open/in_progress/escalated). Returns created/skipped counts.
-- ============================================================

CREATE OR REPLACE FUNCTION bulk_create_campaign_follow_ups(
  p_campaign_id  UUID,
  p_actor_id     UUID,
  p_actor_type   TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_campaign       follow_up_campaigns%ROWTYPE;
  v_filter         JSONB;
  v_market_id      UUID;
  v_created_count  INT := 0;
  v_skipped_count  INT := 0;
  v_order          RECORD;
  v_confirming_agent UUID;
  v_follow_up_id   UUID;
BEGIN
  IF p_actor_type NOT IN ('manager', 'super_admin') THEN
    RAISE EXCEPTION 'Only managers and super_admins can run campaigns';
  END IF;

  SELECT * INTO v_campaign
  FROM follow_up_campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF v_campaign.id IS NULL THEN
    RAISE EXCEPTION 'Campaign not found: %', p_campaign_id;
  END IF;

  v_filter    := v_campaign.filter_json;
  v_market_id := v_campaign.market_id;

  -- Iterate over orders matching the saved filter.
  -- Filter fields: status (array), date_from, date_to, city, product_id.
  FOR v_order IN
    SELECT o.id, o.market_id
    FROM orders o
    WHERE o.market_id = v_market_id
      AND (
        v_filter->>'status' IS NULL
        OR o.status::text = ANY(ARRAY(SELECT jsonb_array_elements_text(v_filter->'statuses')))
      )
      AND (v_filter->>'date_from' IS NULL OR o.created_at >= (v_filter->>'date_from')::timestamptz)
      AND (v_filter->>'date_to'   IS NULL OR o.created_at <= (v_filter->>'date_to')::timestamptz)
      AND (v_filter->>'city'      IS NULL OR o.customer_city = v_filter->>'city')
      AND (v_filter->>'product_id' IS NULL OR o.product_id::text = v_filter->>'product_id')
      -- Skip orders that already have an active follow-up
      AND NOT EXISTS (
        SELECT 1 FROM order_follow_ups fu
        WHERE fu.order_id = o.id
          AND fu.status IN ('open', 'in_progress', 'escalated')
      )
  LOOP
    -- Resolve confirming agent from order_history
    SELECT actor_id INTO v_confirming_agent
    FROM order_history
    WHERE order_id = v_order.id
      AND status_to = 'confirmed'
      AND actor_type = 'agent'
    ORDER BY created_at DESC
    LIMIT 1;

    INSERT INTO order_follow_ups (
      market_id, order_id, status, campaign_id,
      confirming_agent_id, created_by
    ) VALUES (
      v_market_id, v_order.id, 'open', p_campaign_id,
      v_confirming_agent, p_actor_id
    )
    RETURNING id INTO v_follow_up_id;

    -- Write initial entry
    INSERT INTO order_follow_up_entries (
      follow_up_id, status_from, status_to, note, actor_id, actor_type
    ) VALUES (
      v_follow_up_id, NULL, 'open',
      'Created via campaign', p_actor_id, p_actor_type
    );

    v_created_count := v_created_count + 1;
  END LOOP;

  -- Count skipped (matched filter but had active follow-up)
  SELECT COUNT(*) INTO v_skipped_count
  FROM orders o
  WHERE o.market_id = v_market_id
    AND (
      v_filter->>'status' IS NULL
      OR o.status::text = ANY(ARRAY(SELECT jsonb_array_elements_text(v_filter->'statuses')))
    )
    AND (v_filter->>'date_from' IS NULL OR o.created_at >= (v_filter->>'date_from')::timestamptz)
    AND (v_filter->>'date_to'   IS NULL OR o.created_at <= (v_filter->>'date_to')::timestamptz)
    AND (v_filter->>'city'      IS NULL OR o.customer_city = v_filter->>'city')
    AND (v_filter->>'product_id' IS NULL OR o.product_id::text = v_filter->>'product_id')
    AND EXISTS (
      SELECT 1 FROM order_follow_ups fu
      WHERE fu.order_id = o.id
        AND fu.status IN ('open', 'in_progress', 'escalated')
    );

  RETURN json_build_object(
    'campaign_id',    p_campaign_id,
    'created_count',  v_created_count,
    'skipped_count',  v_skipped_count
  );
END;
$$;
