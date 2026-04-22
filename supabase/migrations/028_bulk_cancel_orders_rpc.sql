-- Atomically cancels multiple orders. Rolls back all if any order is in a terminal status
-- or if any individual cancellation fails.

CREATE OR REPLACE FUNCTION bulk_cancel_orders(
  p_order_ids  UUID[],
  p_actor_id   UUID,
  p_note       TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id UUID;
  v_current_status TEXT;
  terminal_statuses TEXT[] := ARRAY['delivered', 'returned', 'rejected', 'cancelled'];
BEGIN
  FOREACH v_order_id IN ARRAY p_order_ids LOOP
    -- Verify order exists and is not terminal
    SELECT status INTO v_current_status
    FROM orders
    WHERE id = v_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order % not found', v_order_id;
    END IF;

    IF v_current_status = ANY(terminal_statuses) THEN
      RAISE EXCEPTION 'Order % is in terminal status % and cannot be cancelled', v_order_id, v_current_status;
    END IF;

    -- Cancel the order
    UPDATE orders
    SET status = 'cancelled', updated_at = NOW()
    WHERE id = v_order_id;

    -- Append history row
    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (v_order_id, v_current_status, 'cancelled', p_actor_id, 'manager', p_note);
  END LOOP;

  RETURN json_build_object('cancelled', array_length(p_order_ids, 1));
END;
$$;
