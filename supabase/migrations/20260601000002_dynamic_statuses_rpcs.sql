-- ============================================================
-- 20260601000002_dynamic_statuses_rpcs.sql
-- Companion to 20260601000001_dynamic_statuses_and_campaigns_rehome.sql.
--
-- RPCs for:
--   rpc_transition_lead_status        — validates against status_configs
--   rpc_transition_follow_up_status   — validates against status_configs
--   rpc_run_prospect_campaign         — spawns prospects from an order filter,
--                                        idempotent via uq_leads_campaign_source_order
--
-- Shipped separately from 20260601000001 because the campaign RPC uses
-- 'campaign'::lead_source, which cannot be referenced in the same
-- transaction as the ALTER TYPE ... ADD VALUE that introduces it.
-- ============================================================

CREATE OR REPLACE FUNCTION rpc_transition_lead_status(
  p_lead_id          UUID,
  p_new_status_key   TEXT,
  p_actor_id         UUID DEFAULT NULL,
  p_actor_type       TEXT DEFAULT 'system',
  p_note             TEXT DEFAULT NULL,
  p_lost_reason      lead_lost_reason DEFAULT NULL,
  p_lost_note        TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead             leads%ROWTYPE;
  v_current_config   status_configs%ROWTYPE;
  v_target_config    status_configs%ROWTYPE;
  v_history_id       UUID;
  v_updated_at       TIMESTAMPTZ;
BEGIN
  IF p_actor_type NOT IN ('system', 'agent', 'manager') THEN
    RAISE EXCEPTION 'invalid actor_type: %', p_actor_type;
  END IF;

  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'Lead not found: %', p_lead_id;
  END IF;

  SELECT * INTO v_current_config
  FROM status_configs
  WHERE market_id = v_lead.market_id AND scope = 'prospect' AND key = v_lead.status_key;
  IF v_current_config.id IS NULL THEN
    RAISE EXCEPTION 'No status config found for market=% scope=prospect key=%',
      v_lead.market_id, v_lead.status_key;
  END IF;

  SELECT * INTO v_target_config
  FROM status_configs
  WHERE market_id = v_lead.market_id AND scope = 'prospect' AND key = p_new_status_key;
  IF v_target_config.id IS NULL THEN
    RAISE EXCEPTION 'Unknown prospect status key for market: %', p_new_status_key;
  END IF;

  IF p_new_status_key = 'won' THEN
    RAISE EXCEPTION 'cannot transition to won via rpc_transition_lead_status; use convert_lead_to_order';
  END IF;

  IF NOT (v_current_config.allowed_transitions ? p_new_status_key) THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_lead.status_key, p_new_status_key;
  END IF;

  IF p_new_status_key = 'lost' AND p_lost_reason IS NULL THEN
    RAISE EXCEPTION 'lost_reason is required when transitioning to lost';
  END IF;
  IF p_lost_reason = 'autre' AND (p_lost_note IS NULL OR length(trim(p_lost_note)) = 0) THEN
    RAISE EXCEPTION 'lost_note is required when lost_reason is autre';
  END IF;

  UPDATE leads
  SET
    status_key  = p_new_status_key,
    lost_reason = CASE WHEN p_new_status_key = 'lost' THEN p_lost_reason ELSE lost_reason END,
    lost_note   = CASE WHEN p_new_status_key = 'lost' THEN p_lost_note   ELSE lost_note   END
  WHERE id = p_lead_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (
    p_lead_id,
    v_lead.status_key::lead_status,
    p_new_status_key::lead_status,
    p_actor_id,
    p_actor_type,
    p_note
  )
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'lead_id',    p_lead_id,
    'status_key', p_new_status_key,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION rpc_transition_follow_up_status(
  p_follow_up_id     UUID,
  p_new_status_key   TEXT,
  p_actor_id         UUID,
  p_actor_type       TEXT,
  p_note             TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_follow_up        order_follow_ups%ROWTYPE;
  v_current_config   status_configs%ROWTYPE;
  v_target_config    status_configs%ROWTYPE;
  v_entry_id         UUID;
  v_updated_at       TIMESTAMPTZ;
BEGIN
  IF p_actor_type NOT IN ('system', 'agent', 'manager', 'super_admin') THEN
    RAISE EXCEPTION 'invalid actor_type: %', p_actor_type;
  END IF;

  SELECT * INTO v_follow_up FROM order_follow_ups WHERE id = p_follow_up_id FOR UPDATE;
  IF v_follow_up.id IS NULL THEN
    RAISE EXCEPTION 'Follow-up not found: %', p_follow_up_id;
  END IF;

  IF v_follow_up.status_key = p_new_status_key THEN
    RAISE EXCEPTION 'follow-up is already in status %', p_new_status_key;
  END IF;

  SELECT * INTO v_current_config
  FROM status_configs
  WHERE market_id = v_follow_up.market_id AND scope = 'follow_up' AND key = v_follow_up.status_key;
  IF v_current_config.id IS NULL THEN
    RAISE EXCEPTION 'No status config found for market=% scope=follow_up key=%',
      v_follow_up.market_id, v_follow_up.status_key;
  END IF;

  SELECT * INTO v_target_config
  FROM status_configs
  WHERE market_id = v_follow_up.market_id AND scope = 'follow_up' AND key = p_new_status_key;
  IF v_target_config.id IS NULL THEN
    RAISE EXCEPTION 'Unknown follow-up status key for market: %', p_new_status_key;
  END IF;

  IF NOT (v_current_config.allowed_transitions ? p_new_status_key) THEN
    RAISE EXCEPTION 'invalid follow-up transition from % to %', v_follow_up.status_key, p_new_status_key;
  END IF;

  UPDATE order_follow_ups
  SET
    status_key  = p_new_status_key,
    resolved_at = CASE
                    WHEN v_target_config.is_terminal THEN now()
                    WHEN NOT v_target_config.is_terminal AND v_current_config.is_terminal THEN NULL
                    ELSE resolved_at
                  END
  WHERE id = p_follow_up_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_follow_up_entries (follow_up_id, status_from, status_to, note, actor_id, actor_type)
  VALUES (
    p_follow_up_id,
    v_follow_up.status_key::follow_up_status,
    p_new_status_key::follow_up_status,
    p_note,
    p_actor_id,
    p_actor_type
  )
  RETURNING id INTO v_entry_id;

  RETURN json_build_object(
    'follow_up_id', p_follow_up_id,
    'status_key',   p_new_status_key,
    'updated_at',   v_updated_at,
    'entry_id',     v_entry_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION rpc_run_prospect_campaign(
  p_campaign_id  UUID,
  p_actor_id     UUID,
  p_actor_type   TEXT DEFAULT 'manager'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campaign        follow_up_campaigns%ROWTYPE;
  v_initial_key     TEXT;
  v_inserted        INT := 0;
  v_skipped         INT := 0;
  v_order_statuses  TEXT[];
  v_date_from       TIMESTAMPTZ;
  v_date_to         TIMESTAMPTZ;
  v_product_id      UUID;
  v_city            TEXT;
BEGIN
  IF p_actor_type NOT IN ('system', 'agent', 'manager', 'super_admin') THEN
    RAISE EXCEPTION 'invalid actor_type: %', p_actor_type;
  END IF;

  SELECT * INTO v_campaign FROM follow_up_campaigns WHERE id = p_campaign_id;
  IF v_campaign.id IS NULL THEN
    RAISE EXCEPTION 'Campaign not found: %', p_campaign_id;
  END IF;

  SELECT key INTO v_initial_key
  FROM status_configs
  WHERE market_id = v_campaign.market_id
    AND scope = 'prospect'
    AND is_initial = true;
  IF v_initial_key IS NULL THEN
    RAISE EXCEPTION 'No initial prospect status configured for market %', v_campaign.market_id;
  END IF;

  v_order_statuses := COALESCE(
    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_campaign.filter_json->'order_statuses') AS x),
    ARRAY['delivered']::TEXT[]
  );
  v_date_from  := (v_campaign.filter_json->>'date_from')::timestamptz;
  v_date_to    := (v_campaign.filter_json->>'date_to')::timestamptz;
  v_product_id := (v_campaign.filter_json->>'product_id')::uuid;
  v_city       := v_campaign.filter_json->>'city';

  WITH matched AS (
    SELECT o.*
    FROM orders o
    WHERE o.market_id = v_campaign.market_id
      AND o.status::text = ANY(v_order_statuses)
      AND (v_date_from IS NULL OR o.created_at >= v_date_from)
      AND (v_date_to   IS NULL OR o.created_at <= v_date_to)
      AND (v_product_id IS NULL OR o.product_id = v_product_id)
      AND (v_city IS NULL OR o.customer_city = v_city)
  ),
  inserted AS (
    INSERT INTO leads (
      market_id, source, status_key, customer_name, customer_phone,
      customer_city, customer_address, campaign_id, source_order_id, raw_payload
    )
    SELECT
      m.market_id, 'campaign'::lead_source, v_initial_key, m.customer_name, m.customer_phone,
      m.customer_city, m.customer_address, p_campaign_id, m.id,
      jsonb_build_object(
        'campaign_id', p_campaign_id,
        'campaign_name', v_campaign.name,
        'source_order_id', m.id,
        'spawned_at', now()
      )
    FROM matched m
    ON CONFLICT (campaign_id, source_order_id) WHERE campaign_id IS NOT NULL AND source_order_id IS NOT NULL
    DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  SELECT COUNT(*) INTO v_skipped
  FROM orders o
  WHERE o.market_id = v_campaign.market_id
    AND o.status::text = ANY(v_order_statuses)
    AND (v_date_from IS NULL OR o.created_at >= v_date_from)
    AND (v_date_to   IS NULL OR o.created_at <= v_date_to)
    AND (v_product_id IS NULL OR o.product_id = v_product_id)
    AND (v_city IS NULL OR o.customer_city = v_city)
    AND EXISTS (
      SELECT 1 FROM leads l
      WHERE l.campaign_id = p_campaign_id AND l.source_order_id = o.id
    );
  v_skipped := v_skipped - v_inserted;

  RETURN json_build_object(
    'campaign_id', p_campaign_id,
    'inserted',    v_inserted,
    'skipped',     v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_transition_lead_status(UUID, TEXT, UUID, TEXT, TEXT, lead_lost_reason, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_transition_follow_up_status(UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_run_prospect_campaign(UUID, UUID, TEXT) TO authenticated;
