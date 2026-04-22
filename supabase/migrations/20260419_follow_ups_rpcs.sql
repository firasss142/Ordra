-- ============================================================
-- 20260419_follow_ups_rpcs.sql
-- Atomic RPCs for follow-up management: create (with confirming
-- agent resolved from order_history) and transition status.
-- ============================================================

-- ============================================================
-- RPC: create_order_follow_up
-- Resolves confirming_agent_id from order_history, inserts
-- follow-up + initial entry in one transaction. Fails if the
-- order already has a follow-up (UNIQUE on order_id) or isn't
-- in a post-confirmation status.
-- ============================================================

CREATE OR REPLACE FUNCTION create_order_follow_up(
  p_order_id           UUID,
  p_actor_id           UUID,
  p_actor_type         TEXT,
  p_delivery_man_phone TEXT DEFAULT NULL,
  p_description        TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order              orders%ROWTYPE;
  v_confirming_agent   UUID;
  v_follow_up_id       UUID;
  v_entry_id           UUID;
  v_updated_at         TIMESTAMPTZ;
BEGIN
  IF p_actor_type NOT IN ('system', 'agent', 'manager', 'super_admin') THEN
    RAISE EXCEPTION 'invalid actor_type: %', p_actor_type;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Post-confirmation only
  IF v_order.status NOT IN ('confirmed', 'dispatching', 'dispatched', 'deposit', 'in_transit', 'to_be_returned') THEN
    RAISE EXCEPTION 'Order must be post-confirmation to open a follow-up (current status=%)', v_order.status;
  END IF;

  -- Resolve confirming agent: latest order_history row where status_to='confirmed' AND actor_type='agent'
  SELECT actor_id INTO v_confirming_agent
  FROM order_history
  WHERE order_id = p_order_id
    AND status_to = 'confirmed'
    AND actor_type = 'agent'
  ORDER BY created_at DESC
  LIMIT 1;

  -- v_confirming_agent may be NULL (e.g. order confirmed by manager/system).
  -- That's OK — agents just won't see it, managers/super_admin will.

  INSERT INTO order_follow_ups (
    market_id, order_id, status, delivery_man_phone, description,
    confirming_agent_id, created_by
  )
  VALUES (
    v_order.market_id, p_order_id, 'open', p_delivery_man_phone, p_description,
    v_confirming_agent, p_actor_id
  )
  RETURNING id, updated_at INTO v_follow_up_id, v_updated_at;

  INSERT INTO order_follow_up_entries (follow_up_id, status_from, status_to, note, actor_id, actor_type)
  VALUES (v_follow_up_id, NULL, 'open', 'Follow-up created', p_actor_id, p_actor_type)
  RETURNING id INTO v_entry_id;

  RETURN json_build_object(
    'follow_up_id',        v_follow_up_id,
    'order_id',            p_order_id,
    'status',              'open',
    'confirming_agent_id', v_confirming_agent,
    'updated_at',          v_updated_at,
    'entry_id',            v_entry_id
  );
END;
$$;

-- ============================================================
-- RPC: transition_follow_up_status
-- Validates transition graph, updates status + resolved_at,
-- writes append-only entry.
--
-- Graph:
--   open         → in_progress, resolved, escalated
--   in_progress  → open, resolved, escalated
--   escalated    → in_progress, resolved
--   resolved     → in_progress   (reopen)
-- ============================================================

CREATE OR REPLACE FUNCTION transition_follow_up_status(
  p_follow_up_id  UUID,
  p_new_status    follow_up_status,
  p_actor_id      UUID,
  p_actor_type    TEXT,
  p_note          TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status follow_up_status;
  v_follow_up_id   UUID;
  v_entry_id       UUID;
  v_updated_at     TIMESTAMPTZ;
  v_valid          BOOLEAN := false;
BEGIN
  IF p_actor_type NOT IN ('system', 'agent', 'manager', 'super_admin') THEN
    RAISE EXCEPTION 'invalid actor_type: %', p_actor_type;
  END IF;

  SELECT id, status INTO v_follow_up_id, v_current_status
  FROM order_follow_ups
  WHERE id = p_follow_up_id
  FOR UPDATE;

  IF v_follow_up_id IS NULL THEN
    RAISE EXCEPTION 'Follow-up not found: %', p_follow_up_id;
  END IF;

  IF v_current_status = p_new_status THEN
    RAISE EXCEPTION 'follow-up is already in status %', p_new_status;
  END IF;

  v_valid := CASE v_current_status
    WHEN 'open'        THEN p_new_status IN ('in_progress', 'resolved', 'escalated')
    WHEN 'in_progress' THEN p_new_status IN ('open', 'resolved', 'escalated')
    WHEN 'escalated'   THEN p_new_status IN ('in_progress', 'resolved')
    WHEN 'resolved'    THEN p_new_status IN ('in_progress')
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'invalid follow-up transition from % to %', v_current_status, p_new_status;
  END IF;

  UPDATE order_follow_ups
  SET
    status      = p_new_status,
    resolved_at = CASE
                    WHEN p_new_status = 'resolved' THEN now()
                    WHEN p_new_status <> 'resolved' AND v_current_status = 'resolved' THEN NULL
                    ELSE resolved_at
                  END
  WHERE id = p_follow_up_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_follow_up_entries (follow_up_id, status_from, status_to, note, actor_id, actor_type)
  VALUES (p_follow_up_id, v_current_status, p_new_status, p_note, p_actor_id, p_actor_type)
  RETURNING id INTO v_entry_id;

  RETURN json_build_object(
    'follow_up_id', p_follow_up_id,
    'status',       p_new_status,
    'updated_at',   v_updated_at,
    'entry_id',     v_entry_id
  );
END;
$$;
