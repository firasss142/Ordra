-- Make attempts_count converge with the status string on every attempt transition.
--
-- Two RPCs write to orders.status; this migration makes both consistent:
--
--   * transition_order_status now bumps attempts_count whenever it transitions
--     INTO an attempt status (attempt_1/2/3). All the agent endpoints — attempt,
--     callback, reject, confirm, schedule-dispatch, reopen — funnel through this
--     RPC and so far none of them touched the counter, leaving most orders at
--     attempts_count = 0 while status said attempt_2 or attempt_3. The UI's
--     post-call sheet reads attempts_count directly, which is why it showed
--     "Tentative 0/5" on orders whose card said "Tentative 2".
--
--   * no_response_with_auto_reject already increments, but its `+ 1` from a
--     drifted zero-count + status=attempt_2 order would push to count=1, status=
--     attempt_3 — undercounting and visually "resetting" the agent's progress.
--
-- The fix is the same in both: GREATEST(existing + 1, status_implied + 1). For
-- a clean attempt_2 / count=2 order the next attempt writes count=3 (existing+1
-- wins); for a drifted attempt_2 / count=0 order, count=3 also (status_implied
-- wins). Either way, after one click the row converges with the agent's view.

CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_order_id uuid,
  p_new_status order_status,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_actor_type text DEFAULT 'system'::text,
  p_note text DEFAULT NULL::text,
  p_rejection_reason rejection_reason DEFAULT NULL::rejection_reason,
  p_rejection_note text DEFAULT NULL::text,
  p_callback_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_scheduled_auto boolean DEFAULT NULL::boolean,
  p_scheduled_carrier_id uuid DEFAULT NULL::uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_current_status order_status;
  v_order_id UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
  v_valid BOOLEAN := false;
  v_status_implied INTEGER;
BEGIN
  SELECT id, status INTO v_order_id, v_current_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  v_valid := CASE v_current_status
    WHEN 'new' THEN p_new_status IN ('pending', 'attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'pending' THEN p_new_status IN ('attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'assigned' THEN p_new_status IN ('attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'attempt_1' THEN p_new_status IN ('attempt_2', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'attempt_2' THEN p_new_status IN ('attempt_3', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'attempt_3' THEN p_new_status IN ('callback_scheduled', 'confirmed', 'rejected', 'deleted')
    WHEN 'callback_scheduled' THEN p_new_status IN ('attempt_1', 'attempt_2', 'attempt_3', 'confirmed', 'rejected', 'deleted')
    WHEN 'confirmed' THEN p_new_status IN (
      'attempt_1', 'attempt_2', 'attempt_3',
      'callback_scheduled', 'rejected',
      'uploaded', 'dispatch_scheduled', 'deleted'
    )
    WHEN 'dispatch_scheduled' THEN p_new_status IN ('uploaded', 'deleted')
    WHEN 'uploaded' THEN p_new_status IN ('scanned', 'deleted')
    WHEN 'scanned' THEN p_new_status IN ('dispatched', 'deleted')
    WHEN 'dispatched' THEN p_new_status IN ('deposit', 'unverified', 'cancelled', 'deleted')
    WHEN 'deposit' THEN p_new_status IN ('in_transit', 'unverified', 'cancelled')
    WHEN 'in_transit' THEN p_new_status IN ('delivered', 'to_be_returned', 'unverified', 'cancelled')
    WHEN 'unverified' THEN p_new_status IN ('dispatched', 'deposit', 'in_transit', 'to_be_returned', 'delivered', 'cancelled')
    WHEN 'to_be_returned' THEN p_new_status IN ('returned', 'received', 'cancelled')
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_current_status, p_new_status;
  END IF;

  IF p_new_status = 'rejected' AND p_rejection_reason IS NULL THEN
    RAISE EXCEPTION 'rejection_reason is required when transitioning to rejected';
  END IF;

  v_status_implied := CASE p_new_status
    WHEN 'attempt_1' THEN 1
    WHEN 'attempt_2' THEN 2
    WHEN 'attempt_3' THEN 3
    ELSE NULL
  END;

  UPDATE orders
  SET
    status = p_new_status,
    -- Bump attempts_count only when stepping INTO an attempt status. Use
    -- GREATEST so a drifted row (status=attempt_2 / count=0) converges in one
    -- click instead of restarting at 1.
    attempts_count = CASE
      WHEN v_status_implied IS NULL THEN attempts_count
      ELSE GREATEST(COALESCE(attempts_count, 0) + 1, v_status_implied)
    END,
    rejection_reason = CASE WHEN p_new_status = 'rejected' THEN p_rejection_reason ELSE rejection_reason END,
    rejection_note   = CASE WHEN p_new_status = 'rejected' THEN p_rejection_note   ELSE rejection_note END,
    callback_scheduled_at = CASE
      WHEN p_new_status = 'callback_scheduled' THEN p_callback_at
      WHEN v_current_status = 'callback_scheduled' THEN NULL
      ELSE callback_scheduled_at
    END,
    scheduled_dispatch_at = CASE
      WHEN p_new_status = 'dispatch_scheduled' THEN p_scheduled_at
      WHEN v_current_status = 'dispatch_scheduled' THEN NULL
      ELSE scheduled_dispatch_at
    END,
    scheduled_dispatch_auto = CASE
      WHEN p_new_status = 'dispatch_scheduled' THEN COALESCE(p_scheduled_auto, false)
      WHEN v_current_status = 'dispatch_scheduled' THEN false
      ELSE scheduled_dispatch_auto
    END,
    scheduled_dispatch_carrier_id = CASE
      WHEN p_new_status = 'dispatch_scheduled' THEN p_scheduled_carrier_id
      WHEN v_current_status = 'dispatch_scheduled' THEN NULL
      ELSE scheduled_dispatch_carrier_id
    END
  WHERE id = p_order_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, v_current_status, p_new_status, p_actor_id, p_actor_type, p_note)
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', p_new_status,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$function$;


-- 4-arg legacy overload of no_response_with_auto_reject (kept in sync; dead in
-- the app but harmless and avoids overload-resolution surprises).
CREATE OR REPLACE FUNCTION public.no_response_with_auto_reject(
  p_order_id uuid,
  p_next_attempt order_status,
  p_callback_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_actor_id uuid DEFAULT NULL::uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_current_status   order_status;
  v_order_id         UUID;
  v_market_id        UUID;
  v_updated_at       TIMESTAMPTZ;
  v_existing_count   INTEGER;
  v_status_implied   INTEGER;
  v_new_attempts     INTEGER;
  v_max_attempts     INTEGER;
  v_final_status     order_status;
  v_history_id       UUID;
  v_note             TEXT;
  v_attempt_status   order_status;
BEGIN
  SELECT id, status, market_id, COALESCE(attempts_count, 0)
  INTO v_order_id, v_current_status, v_market_id, v_existing_count
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_current_status NOT IN (
    'pending', 'assigned', 'attempt_1', 'attempt_2', 'attempt_3',
    'callback_scheduled', 'confirmed'
  ) THEN
    RAISE EXCEPTION 'invalid no-answer from status %', v_current_status;
  END IF;

  v_status_implied := CASE v_current_status
    WHEN 'attempt_1' THEN 1
    WHEN 'attempt_2' THEN 2
    WHEN 'attempt_3' THEN 3
    ELSE 0
  END;

  -- Converge drifted rows in one click: a status=attempt_2 / count=0 row
  -- jumps to count=3, not count=1.
  v_new_attempts := GREATEST(v_existing_count + 1, v_status_implied + 1);

  SELECT COALESCE(
    CASE
      WHEN jsonb_typeof(value) = 'object' THEN NULLIF(value->>'value', '')::INTEGER
      WHEN jsonb_typeof(value) IN ('number', 'string') THEN NULLIF(value #>> '{}', '')::INTEGER
      ELSE NULL
    END,
    3
  )
  INTO v_max_attempts
  FROM settings
  WHERE market_id = v_market_id AND key = 'max_call_attempts';

  IF v_max_attempts IS NULL OR v_max_attempts < 1 THEN
    v_max_attempts := 3;
  END IF;

  v_attempt_status := CASE LEAST(v_new_attempts, 3)
    WHEN 3 THEN 'attempt_3'::order_status
    WHEN 2 THEN 'attempt_2'::order_status
    ELSE      'attempt_1'::order_status
  END;

  IF v_new_attempts > v_max_attempts THEN
    v_final_status := 'rejected';
    v_note := 'Auto-rejete - tentative ' || v_new_attempts || ' (max ' || v_max_attempts || ' depasse)';

    UPDATE orders
    SET
      status = 'rejected',
      attempts_count = v_new_attempts,
      rejection_reason = 'injoignable',
      rejection_note = 'Auto-rejete : tentatives maximum depassees',
      callback_scheduled_at = NULL
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current_status, 'rejected'::order_status, NULL, 'system', v_note)
    RETURNING id INTO v_history_id;

  ELSIF p_callback_at IS NOT NULL THEN
    v_final_status := 'callback_scheduled';
    v_note := 'Tentative ' || v_new_attempts || ' - rappel programme';

    UPDATE orders
    SET
      status = 'callback_scheduled',
      attempts_count = v_new_attempts,
      callback_scheduled_at = p_callback_at
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current_status, 'callback_scheduled'::order_status, p_actor_id, 'agent', v_note)
    RETURNING id INTO v_history_id;

  ELSE
    v_final_status := v_attempt_status;
    v_note := 'Tentative ' || v_new_attempts || ' - pas de reponse';

    UPDATE orders
    SET
      status = v_attempt_status,
      attempts_count = v_new_attempts,
      callback_scheduled_at = NULL
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current_status, v_attempt_status, p_actor_id, 'agent', v_note)
    RETURNING id INTO v_history_id;
  END IF;

  RETURN json_build_object(
    'order_id',       p_order_id,
    'new_status',     v_final_status,
    'auto_rejected',  v_final_status = 'rejected',
    'attempt_number', v_new_attempts,
    'attempts_count', v_new_attempts,
    'updated_at',     v_updated_at,
    'history_id',     v_history_id
  );
END;
$function$;


-- 5-arg current overload (the one the app actually calls).
CREATE OR REPLACE FUNCTION public.no_response_with_auto_reject(
  p_order_id uuid,
  p_next_attempt order_status,
  p_callback_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_actor_type text DEFAULT 'agent'::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_current_status   public.order_status;
  v_order_id         UUID;
  v_market_id        UUID;
  v_updated_at       TIMESTAMPTZ;
  v_existing_count   INTEGER;
  v_status_implied   INTEGER;
  v_new_attempts     INTEGER;
  v_max_attempts     INTEGER;
  v_final_status     public.order_status;
  v_history_id       UUID;
  v_note             TEXT;
  v_attempt_status   public.order_status;
BEGIN
  SELECT id, status, market_id, COALESCE(attempts_count, 0)
  INTO v_order_id, v_current_status, v_market_id, v_existing_count
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_current_status NOT IN (
    'pending', 'assigned', 'attempt_1', 'attempt_2', 'attempt_3',
    'callback_scheduled', 'confirmed'
  ) THEN
    RAISE EXCEPTION 'invalid no-answer from status %', v_current_status;
  END IF;

  v_status_implied := CASE v_current_status
    WHEN 'attempt_1' THEN 1
    WHEN 'attempt_2' THEN 2
    WHEN 'attempt_3' THEN 3
    ELSE 0
  END;

  v_new_attempts := GREATEST(v_existing_count + 1, v_status_implied + 1);

  SELECT COALESCE(
    CASE
      WHEN jsonb_typeof(value) = 'object' THEN NULLIF(value->>'value', '')::INTEGER
      WHEN jsonb_typeof(value) IN ('number', 'string') THEN NULLIF(value #>> '{}', '')::INTEGER
      ELSE NULL
    END,
    3
  )
  INTO v_max_attempts
  FROM settings
  WHERE market_id = v_market_id AND key = 'max_call_attempts';

  IF v_max_attempts IS NULL OR v_max_attempts < 1 THEN
    v_max_attempts := 3;
  END IF;

  v_attempt_status := CASE LEAST(v_new_attempts, 3)
    WHEN 3 THEN 'attempt_3'::public.order_status
    WHEN 2 THEN 'attempt_2'::public.order_status
    ELSE      'attempt_1'::public.order_status
  END;

  IF v_new_attempts > v_max_attempts THEN
    v_final_status := 'rejected';
    v_note := 'Auto-rejete - tentative ' || v_new_attempts || ' (max ' || v_max_attempts || ' depasse)';

    UPDATE orders
    SET
      status = 'rejected',
      attempts_count = v_new_attempts,
      rejection_reason = 'injoignable',
      rejection_note = 'Auto-rejete : tentatives maximum depassees',
      callback_scheduled_at = NULL
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current_status, 'rejected'::public.order_status, NULL, 'system', v_note)
    RETURNING id INTO v_history_id;

  ELSIF p_callback_at IS NOT NULL THEN
    v_final_status := 'callback_scheduled';
    v_note := 'Tentative ' || v_new_attempts || ' - rappel programme';

    UPDATE orders
    SET
      status = 'callback_scheduled',
      attempts_count = v_new_attempts,
      callback_scheduled_at = p_callback_at
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current_status, 'callback_scheduled'::public.order_status, p_actor_id, p_actor_type, v_note)
    RETURNING id INTO v_history_id;

  ELSE
    v_final_status := v_attempt_status;
    v_note := 'Tentative ' || v_new_attempts || ' - pas de reponse';

    UPDATE orders
    SET
      status = v_attempt_status,
      attempts_count = v_new_attempts,
      callback_scheduled_at = NULL
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current_status, v_attempt_status, p_actor_id, p_actor_type, v_note)
    RETURNING id INTO v_history_id;
  END IF;

  RETURN json_build_object(
    'order_id',       p_order_id,
    'new_status',     v_final_status,
    'auto_rejected',  v_final_status = 'rejected',
    'attempt_number', v_new_attempts,
    'attempts_count', v_new_attempts,
    'updated_at',     v_updated_at,
    'history_id',     v_history_id
  );
END;
$function$;
