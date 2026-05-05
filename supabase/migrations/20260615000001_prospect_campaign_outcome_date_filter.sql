-- Prospect campaign date filters now target the outcome transition date
-- (delivered/returned in order_history), not the original order creation date.
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
  v_campaign        prospect_campaigns%ROWTYPE;
  v_initial_key     TEXT;
  v_matched         INT := 0;
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

  SELECT * INTO v_campaign FROM prospect_campaigns WHERE id = p_campaign_id;
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
      AND (v_product_id IS NULL OR o.product_id = v_product_id)
      AND (v_city IS NULL OR o.customer_city = v_city)
      AND EXISTS (
        SELECT 1
        FROM order_history oh
        WHERE oh.order_id = o.id
          AND oh.status_to::text = o.status::text
          AND oh.status_to::text = ANY(v_order_statuses)
          AND (v_date_from IS NULL OR oh.created_at >= v_date_from)
          AND (v_date_to   IS NULL OR oh.created_at <= v_date_to)
      )
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
        'source_outcome', m.status::text,
        'spawned_at', now()
      )
    FROM matched m
    ON CONFLICT (campaign_id, source_order_id) WHERE campaign_id IS NOT NULL AND source_order_id IS NOT NULL
    DO NOTHING
    RETURNING id
  )
  SELECT
    (SELECT COUNT(*) FROM matched),
    (SELECT COUNT(*) FROM inserted)
  INTO v_matched, v_inserted;

  v_skipped := v_matched - v_inserted;

  RETURN json_build_object(
    'campaign_id', p_campaign_id,
    'inserted',    v_inserted,
    'skipped',     v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_run_prospect_campaign(UUID, UUID, TEXT) TO authenticated;
