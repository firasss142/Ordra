-- ============================================================
-- 20260616000001_no_response_allow_pending.sql
-- Fix: allow no_response_with_auto_reject to start from `pending`.
--
-- The 20260505_no_response_actor_type.sql migration sorts AFTER
-- 20260505233818_pending_assignment_model.sql (since '_' > digits in
-- the timestamp suffix), so its version of no_response_with_auto_reject
-- overwrites the one that already accepted `pending`. As a result, the
-- agent's "Pas de réponse" action on a brand-new pending order raises
-- 'invalid no-answer from status pending', the route returns 500, and
-- the client shows "Erreur réseau".
--
-- Re-create the function with `pending` (and the legacy `assigned`)
-- included in the accepted starting statuses.
-- ============================================================

CREATE OR REPLACE FUNCTION no_response_with_auto_reject(
  p_order_id    UUID,
  p_next_attempt public.order_status,
  p_callback_at TIMESTAMPTZ DEFAULT NULL,
  p_actor_id    UUID DEFAULT NULL,
  p_actor_type  TEXT DEFAULT 'agent'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status   public.order_status;
  v_order_id         UUID;
  v_market_id        UUID;
  v_updated_at       TIMESTAMPTZ;
  v_new_attempts     INTEGER;
  v_max_attempts     INTEGER;
  v_final_status     public.order_status;
  v_history_id       UUID;
  v_note             TEXT;
  v_attempt_status   public.order_status;
BEGIN
  SELECT id, status, market_id, attempts_count
  INTO v_order_id, v_current_status, v_market_id, v_new_attempts
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_current_status NOT IN ('pending', 'assigned', 'attempt_1', 'attempt_2', 'attempt_3', 'callback_scheduled') THEN
    RAISE EXCEPTION 'invalid no-answer from status %', v_current_status;
  END IF;

  v_new_attempts := v_new_attempts + 1;

  SELECT COALESCE((value->>'value')::INTEGER, 3)
  INTO v_max_attempts
  FROM settings
  WHERE market_id = v_market_id AND key = 'max_call_attempts';

  IF v_max_attempts IS NULL THEN
    v_max_attempts := 3;
  END IF;

  v_attempt_status := CASE
    WHEN v_new_attempts >= 3 THEN 'attempt_3'::public.order_status
    WHEN v_new_attempts = 2 THEN 'attempt_2'::public.order_status
    ELSE 'attempt_1'::public.order_status
  END;

  IF v_new_attempts >= v_max_attempts THEN
    v_final_status := 'rejected';
    v_note := 'Auto-rejete - tentative ' || v_new_attempts || ' (max ' || v_max_attempts || ' atteint)';

    UPDATE orders
    SET
      status = 'rejected',
      attempts_count = v_new_attempts,
      rejection_reason = 'injoignable',
      rejection_note = 'Auto-rejete : tentatives maximum atteintes',
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
$$;
