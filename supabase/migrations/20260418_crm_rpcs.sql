-- ============================================================
-- 20260418_crm_rpcs.sql
-- Atomic RPCs for lead management: transition, assign, unassign, convert.
-- Mirror pattern from 004_order_rpcs.sql.
-- ============================================================

-- ============================================================
-- RPC: transition_lead_status
-- Validates transition, updates status, writes append-only history.
-- `won` is explicitly forbidden here — it must go via convert_lead_to_order.
-- ============================================================

CREATE OR REPLACE FUNCTION transition_lead_status(
  p_lead_id    UUID,
  p_new_status lead_status,
  p_actor_id   UUID DEFAULT NULL,
  p_actor_type TEXT DEFAULT 'system',
  p_note       TEXT DEFAULT NULL,
  p_lost_reason lead_lost_reason DEFAULT NULL,
  p_lost_note   TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status lead_status;
  v_lead_id UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
  v_valid BOOLEAN := false;
BEGIN
  IF p_new_status = 'won' THEN
    RAISE EXCEPTION 'cannot transition to won via transition_lead_status; use convert_lead_to_order';
  END IF;

  SELECT id, status INTO v_lead_id, v_current_status
  FROM leads
  WHERE id = p_lead_id
  FOR UPDATE;

  IF v_lead_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found: %', p_lead_id;
  END IF;

  v_valid := CASE v_current_status
    WHEN 'new' THEN p_new_status IN ('assigned', 'archived')
    WHEN 'assigned' THEN p_new_status IN ('attempt_1', 'callback_scheduled', 'qualified', 'lost', 'archived')
    WHEN 'attempt_1' THEN p_new_status IN ('attempt_2', 'callback_scheduled', 'qualified', 'lost', 'archived')
    WHEN 'attempt_2' THEN p_new_status IN ('attempt_3', 'callback_scheduled', 'qualified', 'lost', 'archived')
    WHEN 'attempt_3' THEN p_new_status IN ('callback_scheduled', 'qualified', 'lost', 'archived')
    WHEN 'callback_scheduled' THEN p_new_status IN ('attempt_1', 'attempt_2', 'attempt_3', 'qualified', 'lost', 'archived')
    WHEN 'qualified' THEN p_new_status IN ('lost', 'archived')
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_current_status, p_new_status;
  END IF;

  IF p_new_status = 'lost' AND p_lost_reason IS NULL THEN
    RAISE EXCEPTION 'lost_reason is required when transitioning to lost';
  END IF;

  IF p_lost_reason = 'autre' AND (p_lost_note IS NULL OR length(trim(p_lost_note)) = 0) THEN
    RAISE EXCEPTION 'lost_note is required when lost_reason is autre';
  END IF;

  UPDATE leads
  SET
    status = p_new_status,
    lost_reason = CASE WHEN p_new_status = 'lost' THEN p_lost_reason ELSE lost_reason END,
    lost_note   = CASE WHEN p_new_status = 'lost' THEN p_lost_note   ELSE lost_note   END
  WHERE id = p_lead_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_lead_id, v_current_status, p_new_status, p_actor_id, p_actor_type, p_note)
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'lead_id',    p_lead_id,
    'status',     p_new_status,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$$;

-- ============================================================
-- RPC: assign_lead
-- Assigns/reassigns a lead. If status is 'new', transitions to 'assigned'.
-- Verifies agent is active and in same market.
-- ============================================================

CREATE OR REPLACE FUNCTION assign_lead(
  p_lead_id    UUID,
  p_agent_id   UUID,
  p_actor_id   UUID,
  p_actor_type TEXT DEFAULT 'manager'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status lead_status;
  v_lead_id UUID;
  v_lead_market UUID;
  v_agent_market UUID;
  v_new_status lead_status;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
BEGIN
  IF p_actor_type NOT IN ('system', 'agent', 'manager') THEN
    RAISE EXCEPTION 'invalid actor_type: %', p_actor_type;
  END IF;

  SELECT id, status, market_id INTO v_lead_id, v_current_status, v_lead_market
  FROM leads
  WHERE id = p_lead_id
  FOR UPDATE;

  IF v_lead_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found: %', p_lead_id;
  END IF;

  IF v_current_status IN ('won', 'lost', 'archived') THEN
    RAISE EXCEPTION 'Cannot assign terminal lead (status=%)', v_current_status;
  END IF;

  SELECT market_id INTO v_agent_market
  FROM users
  WHERE id = p_agent_id
    AND role = 'agent'
    AND is_active = true;

  IF v_agent_market IS NULL THEN
    RAISE EXCEPTION 'Agent not found or inactive: %', p_agent_id;
  END IF;

  IF v_agent_market != v_lead_market THEN
    RAISE EXCEPTION 'Agent market does not match lead market';
  END IF;

  IF v_current_status = 'new' THEN
    v_new_status := 'assigned';
  ELSE
    v_new_status := v_current_status;
  END IF;

  UPDATE leads
  SET assigned_to = p_agent_id, status = v_new_status
  WHERE id = p_lead_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (
    p_lead_id, v_current_status, v_new_status, p_actor_id, p_actor_type,
    CASE WHEN v_current_status = 'new' THEN 'Assigned to agent' ELSE 'Reassigned to agent' END
  )
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'lead_id',     p_lead_id,
    'status',      v_new_status,
    'assigned_to', p_agent_id,
    'updated_at',  v_updated_at,
    'history_id',  v_history_id
  );
END;
$$;

-- ============================================================
-- RPC: unassign_lead
-- Clears assigned_to. Writes history entry. Rejects terminal leads.
-- ============================================================

CREATE OR REPLACE FUNCTION unassign_lead(
  p_lead_id  UUID,
  p_actor_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status lead_status;
  v_lead_id UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
BEGIN
  SELECT id, status INTO v_lead_id, v_current_status
  FROM leads
  WHERE id = p_lead_id
  FOR UPDATE;

  IF v_lead_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found: %', p_lead_id;
  END IF;

  IF v_current_status IN ('won', 'lost', 'archived') THEN
    RAISE EXCEPTION 'Cannot unassign terminal lead (status=%)', v_current_status;
  END IF;

  UPDATE leads
  SET assigned_to = NULL
  WHERE id = p_lead_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_lead_id, v_current_status, v_current_status, p_actor_id, 'manager', 'Unassigned from agent')
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'lead_id',     p_lead_id,
    'status',      v_current_status,
    'assigned_to', NULL,
    'updated_at',  v_updated_at,
    'history_id',  v_history_id
  );
END;
$$;

-- ============================================================
-- RPC: convert_lead_to_order
-- Atomically: create order (status=confirmed), transition lead→won,
-- set converted_order_id, write history on both tables.
-- Lead must be in status 'qualified' and not already converted.
-- Uses a placeholder storefront/external_id since orders table requires them.
-- ============================================================

CREATE OR REPLACE FUNCTION convert_lead_to_order(
  p_lead_id          UUID,
  p_actor_id         UUID,
  p_product_id       UUID,
  p_product_name     TEXT,
  p_variant_label    TEXT,
  p_quantity         INTEGER,
  p_unit_price       NUMERIC(10,3),
  p_total_price      NUMERIC(10,3),
  p_customer_name    TEXT,
  p_customer_phone   TEXT,
  p_customer_address TEXT,
  p_customer_city    TEXT,
  p_customer_note    TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lead            leads%ROWTYPE;
  v_new_order_id    UUID;
  v_order_updated   TIMESTAMPTZ;
  v_lead_updated    TIMESTAMPTZ;
  v_lead_history_id UUID;
  v_order_history_id UUID;
  v_storefront_id   UUID;
  v_external_id     TEXT;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive';
  END IF;
  IF p_total_price IS NULL OR p_total_price < 0 THEN
    RAISE EXCEPTION 'total_price must be non-negative';
  END IF;

  -- Lock lead
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id FOR UPDATE;

  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'Lead not found: %', p_lead_id;
  END IF;

  IF v_lead.status <> 'qualified' THEN
    RAISE EXCEPTION 'lead must be in status qualified to convert (current=%)', v_lead.status;
  END IF;

  IF v_lead.converted_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'lead already converted (order_id=%)', v_lead.converted_order_id;
  END IF;

  -- Find any active storefront in the lead's market to satisfy orders FK.
  -- If none exists, fail loudly — market must have at least one storefront seeded.
  SELECT id INTO v_storefront_id
  FROM storefronts
  WHERE market_id = v_lead.market_id AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_storefront_id IS NULL THEN
    RAISE EXCEPTION 'no active storefront in market % — cannot attribute converted order', v_lead.market_id;
  END IF;

  v_external_id := 'lead:' || p_lead_id::text;

  -- Create order at status=confirmed, assigned to same agent as lead
  INSERT INTO orders (
    market_id, storefront_id, external_id, external_platform,
    status,
    customer_name, customer_phone, customer_address, customer_city, customer_note,
    product_id, product_name, variant_label, quantity, unit_price, total_price,
    assigned_to,
    raw_payload
  )
  VALUES (
    v_lead.market_id, v_storefront_id, v_external_id, 'lead_conversion',
    'confirmed',
    p_customer_name, p_customer_phone, p_customer_address, p_customer_city, p_customer_note,
    p_product_id, p_product_name, p_variant_label, p_quantity, p_unit_price, p_total_price,
    v_lead.assigned_to,
    jsonb_build_object('lead_id', p_lead_id, 'source', v_lead.source)
  )
  RETURNING id, updated_at INTO v_new_order_id, v_order_updated;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (v_new_order_id, NULL, 'confirmed', p_actor_id, 'agent', 'Created from lead conversion')
  RETURNING id INTO v_order_history_id;

  -- Transition lead → won, set converted_order_id
  UPDATE leads
  SET status = 'won', converted_order_id = v_new_order_id
  WHERE id = p_lead_id
  RETURNING updated_at INTO v_lead_updated;

  INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_lead_id, 'qualified', 'won', p_actor_id, 'agent', 'Converted to order ' || v_new_order_id::text)
  RETURNING id INTO v_lead_history_id;

  RETURN json_build_object(
    'lead_id',          p_lead_id,
    'order_id',         v_new_order_id,
    'lead_status',      'won',
    'order_status',     'confirmed',
    'lead_updated_at',  v_lead_updated,
    'order_updated_at', v_order_updated,
    'lead_history_id',  v_lead_history_id,
    'order_history_id', v_order_history_id
  );
END;
$$;
