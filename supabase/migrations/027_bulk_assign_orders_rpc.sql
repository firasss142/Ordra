-- Atomic bulk assignment: assigns all orders to an agent in one transaction.
-- Raises an exception (and rolls back) if ANY order cannot be assigned.
CREATE OR REPLACE FUNCTION bulk_assign_orders(
  p_order_ids    UUID[],
  p_agent_id     UUID,
  p_actor_id     UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id UUID;
BEGIN
  FOREACH v_order_id IN ARRAY p_order_ids LOOP
    -- assign_order raises on failure, which rolls back the whole transaction
    PERFORM assign_order(v_order_id, p_agent_id, p_actor_id, 'manager');
  END LOOP;

  RETURN json_build_object('assigned', array_length(p_order_ids, 1));
END;
$$;
