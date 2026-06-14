-- Admin/manager recovery of a soft-deleted order.
-- Deletion is a soft delete (manual_delete_orders sets status='deleted'); the
-- row is never removed. This function reverses that for orders that were NOT
-- scanned at deletion.
--
-- Recovery target is always 'pending': an order deleted from 'uploaded' had its
-- carrier shipment voided (see lib/orders/manual-delete.ts), so it cannot be
-- restored to 'uploaded' — it must re-enter the queue and be re-confirmed +
-- re-uploaded. 'pending' is the only safe re-entry point for every non-scanned
-- case.
--
-- Orders deleted from 'scanned' are REJECTED: manual_delete_orders restored
-- their stock (+qty), so recovering them would desync stock. The caller must
-- handle 23514 and surface a clear message.

CREATE OR REPLACE FUNCTION public.recover_deleted_order(
  p_order_id UUID,
  p_actor_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role TEXT;
  v_actor_market_id UUID;
  v_status public.order_status;
  v_market_id UUID;
  v_deleted_from public.order_status;
BEGIN
  IF p_actor_id IS NULL OR auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT role, market_id
    INTO v_actor_role, v_actor_market_id
    FROM public.users
   WHERE id = p_actor_id;

  IF NOT FOUND OR v_actor_role NOT IN ('super_admin', 'market_manager') THEN
    RAISE EXCEPTION 'Forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT status, market_id
    INTO v_status, v_market_id
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role = 'market_manager' AND v_market_id IS DISTINCT FROM v_actor_market_id THEN
    RAISE EXCEPTION 'Forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF v_status <> 'deleted' THEN
    RAISE EXCEPTION 'Order % is not deleted (status %)', p_order_id, v_status
      USING ERRCODE = '23514';
  END IF;

  -- The status the order was deleted FROM is the status_from of the most recent
  -- history row that landed on 'deleted'. If that was 'scanned', stock was
  -- restored by manual_delete_orders and we must not recover (would desync).
  SELECT status_from
    INTO v_deleted_from
    FROM public.order_history
   WHERE order_id = p_order_id
     AND status_to = 'deleted'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_deleted_from = 'scanned' THEN
    RAISE EXCEPTION 'Order % was scanned when deleted and cannot be recovered (stock was restored)', p_order_id
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.orders
     SET status = 'pending'::public.order_status,
         updated_at = NOW()
   WHERE id = p_order_id;

  INSERT INTO public.order_history (
    order_id,
    status_from,
    status_to,
    actor_id,
    actor_type,
    note
  )
  VALUES (
    p_order_id,
    'deleted'::public.order_status,
    'pending'::public.order_status,
    p_actor_id,
    'manager',
    COALESCE(p_note, 'Commande restaurée')
  );

  RETURN json_build_object(
    'recovered', true,
    'order_id', p_order_id,
    'status', 'pending'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.recover_deleted_order(UUID, UUID, TEXT) TO authenticated;
