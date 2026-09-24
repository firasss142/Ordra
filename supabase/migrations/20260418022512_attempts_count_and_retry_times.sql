-- ============================================================
-- 20260418_attempts_count_and_retry_times.sql
--
-- Phase C + F of agent-queue rework:
--
-- 1. Add orders.attempts_count column — true source of truth for how many
--    times the customer was actually called. Fixes the "counter resets on
--    callback" bug where status alone encoded attempt number.
-- 2. Backfill attempts_count from order_history + current status.
-- 3. Seed attempt_retry_times setting (manager-configured time-of-day slots
--    for auto-retries) for every existing market. Default: 11:00, 14:00, 18:00.
-- 4. Rewrite no_response_with_auto_reject RPC to:
--      - Use attempts_count (increment atomically) instead of deriving from
--        current status.
--      - Emit exactly ONE status transition and ONE history row per call
--        (today the RPC emits two when a callback is scheduled).
-- ============================================================

-- 1. Column
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS attempts_count INTEGER NOT NULL DEFAULT 0;

-- 2. Backfill: max of (count of attempt_* history rows, attempt number encoded in current status)
WITH history_counts AS (
  SELECT
    order_id,
    COUNT(*) FILTER (WHERE status_to IN ('attempt_1', 'attempt_2', 'attempt_3')) AS hist_attempts
  FROM order_history
  GROUP BY order_id
),
status_num AS (
  SELECT
    id,
    CASE status
      WHEN 'attempt_1' THEN 1
      WHEN 'attempt_2' THEN 2
      WHEN 'attempt_3' THEN 3
      ELSE 0
    END AS status_attempts
  FROM orders
)
UPDATE orders o
SET attempts_count = GREATEST(
  COALESCE(hc.hist_attempts, 0),
  sn.status_attempts
)
FROM status_num sn
LEFT JOIN history_counts hc ON hc.order_id = sn.id
WHERE o.id = sn.id
  AND o.attempts_count = 0;

-- 3. Seed attempt_retry_times for every market that doesn't already have it.
INSERT INTO settings (market_id, key, value, updated_at)
SELECT
  m.id,
  'attempt_retry_times',
  '{"value": ["11:00", "14:00", "18:00"]}'::jsonb,
  NOW()
FROM markets m
WHERE NOT EXISTS (
  SELECT 1 FROM settings s
  WHERE s.market_id = m.id AND s.key = 'attempt_retry_times'
);

-- 4. Rewrite no_response_with_auto_reject
CREATE OR REPLACE FUNCTION no_response_with_auto_reject(
  p_order_id    UUID,
  p_next_attempt order_status,  -- kept for API compat; ignored, computed from attempts_count
  p_callback_at TIMESTAMPTZ DEFAULT NULL,
  p_actor_id    UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status   order_status;
  v_order_id         UUID;
  v_market_id        UUID;
  v_updated_at       TIMESTAMPTZ;
  v_new_attempts     INTEGER;
  v_max_attempts     INTEGER;
  v_final_status     order_status;
  v_history_id       UUID;
  v_note             TEXT;
  v_attempt_status   order_status;
BEGIN
  -- Lock row
  SELECT id, status, market_id, attempts_count
  INTO v_order_id, v_current_status, v_market_id, v_new_attempts
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Only allow from pre-confirm pool statuses
  IF v_current_status NOT IN ('assigned', 'attempt_1', 'attempt_2', 'attempt_3', 'callback_scheduled') THEN
    RAISE EXCEPTION 'invalid no-answer from status %', v_current_status;
  END IF;

  -- Increment attempts count (this is the real counter)
  v_new_attempts := v_new_attempts + 1;

  -- Read max_call_attempts from settings (value stored as {"value": N})
  SELECT COALESCE((value->>'value')::INTEGER, 3)
  INTO v_max_attempts
  FROM settings
  WHERE market_id = v_market_id AND key = 'max_call_attempts';

  IF v_max_attempts IS NULL THEN
    v_max_attempts := 3;
  END IF;

  -- Pick the attempt_N status for naming (capped at attempt_3)
  v_attempt_status := CASE
    WHEN v_new_attempts >= 3 THEN 'attempt_3'::order_status
    WHEN v_new_attempts = 2 THEN 'attempt_2'::order_status
    ELSE 'attempt_1'::order_status
  END;

  -- Decide final status based on attempts and callback
  IF v_new_attempts >= v_max_attempts THEN
    -- Auto-reject: single transition, single history row
    v_final_status := 'rejected';
    v_note := 'Auto-rejeté — tentative ' || v_new_attempts || ' (max ' || v_max_attempts || ' atteint)';

    UPDATE orders
    SET
      status = 'rejected',
      attempts_count = v_new_attempts,
      rejection_reason = 'injoignable',
      rejection_note = 'Auto-rejeté : tentatives maximum atteintes',
      callback_scheduled_at = NULL
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current_status, 'rejected'::order_status, NULL, 'system', v_note)
    RETURNING id INTO v_history_id;

  ELSIF p_callback_at IS NOT NULL THEN
    -- Callback scheduled: single transition to callback_scheduled, single history row
    v_final_status := 'callback_scheduled';
    v_note := 'Tentative ' || v_new_attempts || ' — rappel programmé';

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
    -- Pure attempt (no callback): single transition to attempt_N
    v_final_status := v_attempt_status;
    v_note := 'Tentative ' || v_new_attempts || ' — pas de réponse';

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
$$;
