-- Dedicated manual delete path for admin/manager "Annuler".
-- This intentionally writes status='deleted'. Carrier-side cancellations keep
-- using status='cancelled'.

CREATE OR REPLACE FUNCTION public.manual_delete_orders(
  p_order_ids UUID[],
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
  v_order_ids UUID[];
  v_order_id UUID;
  v_status public.order_status;
  v_market_id UUID;
  v_product_id UUID;
  v_quantity INTEGER;
  v_current_stock INTEGER;
  v_new_stock INTEGER;
  v_deleted_count INTEGER := 0;
  v_stock_restored_count INTEGER := 0;
  v_allowed_statuses public.order_status[] := ARRAY[
    'pending',
    'assigned',
    'attempt_1',
    'attempt_2',
    'attempt_3',
    'callback_scheduled',
    'confirmed',
    'dispatch_scheduled',
    'uploaded',
    'scanned'
  ]::public.order_status[];
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

  SELECT ARRAY(SELECT DISTINCT unnest(p_order_ids))
    INTO v_order_ids;

  IF v_order_ids IS NULL OR cardinality(v_order_ids) = 0 THEN
    RAISE EXCEPTION 'manual_delete_orders requires at least one order id'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_order_id IN ARRAY v_order_ids LOOP
    SELECT status, market_id, product_id, quantity
      INTO v_status, v_market_id, v_product_id, v_quantity
      FROM public.orders
     WHERE id = v_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order % not found', v_order_id
        USING ERRCODE = 'P0002';
    END IF;

    IF v_actor_role = 'market_manager' AND v_market_id IS DISTINCT FROM v_actor_market_id THEN
      RAISE EXCEPTION 'Forbidden'
        USING ERRCODE = '42501';
    END IF;

    IF NOT (v_status = ANY(v_allowed_statuses)) THEN
      RAISE EXCEPTION 'Order % cannot be manually deleted from status %', v_order_id, v_status
        USING ERRCODE = '23514';
    END IF;

    IF v_status = 'scanned' THEN
      IF v_product_id IS NULL THEN
        RAISE EXCEPTION 'Order % has no product for stock restoration', v_order_id
          USING ERRCODE = '23502';
      END IF;

      SELECT current_stock
        INTO v_current_stock
        FROM public.products
       WHERE id = v_product_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found for order %', v_product_id, v_order_id
          USING ERRCODE = 'P0002';
      END IF;

      v_new_stock := v_current_stock + COALESCE(v_quantity, 0);

      UPDATE public.products
         SET current_stock = v_new_stock,
             updated_at = NOW()
       WHERE id = v_product_id;

      INSERT INTO public.inventory_log (
        product_id,
        order_id,
        change,
        reason,
        balance_after,
        is_damaged,
        actor_id,
        note
      )
      VALUES (
        v_product_id,
        v_order_id,
        COALESCE(v_quantity, 0),
        'manual_delete_reversal',
        v_new_stock,
        false,
        p_actor_id,
        COALESCE(p_note, 'Suppression manuelle: restauration stock')
      );

      v_stock_restored_count := v_stock_restored_count + 1;
    END IF;

    UPDATE public.orders
       SET status = 'deleted'::public.order_status,
           updated_at = NOW()
     WHERE id = v_order_id;

    INSERT INTO public.order_history (
      order_id,
      status_from,
      status_to,
      actor_id,
      actor_type,
      note
    )
    VALUES (
      v_order_id,
      v_status,
      'deleted'::public.order_status,
      p_actor_id,
      'manager',
      COALESCE(p_note, 'Suppression manuelle')
    );

    v_deleted_count := v_deleted_count + 1;
  END LOOP;

  RETURN json_build_object(
    'deleted', v_deleted_count,
    'stock_restored', v_stock_restored_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.manual_delete_orders(UUID[], UUID, TEXT) TO authenticated;
