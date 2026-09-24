-- Fusion: two orders from the same customer for DIFFERENT products become one
-- parcel, instead of one of them being deleted.
--
-- WHY THIS EXISTS
-- The basket split: someone orders A, then remembers B and orders again. Today
-- the only available action is to delete one, which throws the sale away.
--
-- WHY IT IS ONE RPC AND NOT TWO POSTGREST CALLS
-- A merge touches two orders plus N item rows. The existing item API needs an
-- explicit compensating delete because it cannot span a transaction (see the
-- comment in src/app/api/orders/[id]/items/route.ts). Half a merge would leave
-- a customer's product on a deleted order.
--
-- WHY IT IS NEVER AUTOMATIC
-- Of 187 same-phone/different-product pairs measured in Libya on 2026-09-17,
-- 96 had a DIFFERENT delivery address and 65 a different city. A shared phone
-- number is not a shared destination, so the surviving address is an argument
-- the caller must pass explicitly — this function will not guess it.

-- ---------------------------------------------------------------------------
-- 1. The candidates an agent may be offered
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: RLS on `orders` is the market isolation here, exactly as
-- the other read paths rely on it. Nothing is written.

CREATE OR REPLACE FUNCTION public.get_merge_candidates(
  p_order_id uuid,
  p_window_hours integer DEFAULT 24
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_src         orders%ROWTYPE;
  v_window      INTERVAL;
  v_candidates  jsonb;
BEGIN
  SELECT * INTO v_src FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', false, 'candidates', '[]'::jsonb);
  END IF;

  -- A zero window is how a market turns merging off entirely.
  IF coalesce(p_window_hours, 0) <= 0 THEN
    RETURN jsonb_build_object(
      'enabled', false, 'window_hours', 0, 'candidates', '[]'::jsonb);
  END IF;

  v_window := make_interval(secs => p_window_hours * 3600);

  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'id', o.id,
             'external_id', o.external_id,
             'status', o.status::TEXT,
             'created_at', o.created_at,
             'product_id', o.product_id,
             'product_name', o.product_name,
             'product_image_url', p.image_url,
             'quantity', o.quantity,
             'unit_price', o.unit_price,
             'total_price', o.total_price,
             'delivery_fee', o.delivery_fee,
             'customer_name', o.customer_name,
             'customer_address', o.customer_address,
             'customer_city', o.customer_city,
             'address_matches',
               lower(trim(coalesce(o.customer_address, '')))
                 = lower(trim(coalesce(v_src.customer_address, ''))),
             'city_matches',
               lower(trim(coalesce(o.customer_city, '')))
                 = lower(trim(coalesce(v_src.customer_city, '')))
           ) ORDER BY o.created_at DESC
         ), '[]'::jsonb)
    INTO v_candidates
  FROM orders o
  LEFT JOIN products p ON p.id = o.product_id
  WHERE o.market_id = v_src.market_id
    AND o.id <> v_src.id
    AND normalize_phone(o.customer_phone) = normalize_phone(v_src.customer_phone)
    AND normalize_phone(v_src.customer_phone) <> ''
    -- DIFFERENT product: the same product is the duplicate path, not this one.
    AND o.product_id IS DISTINCT FROM v_src.product_id
    AND o.status::TEXT IN ('pending','assigned','attempt_1','attempt_2',
                           'attempt_3','callback_scheduled')
    AND v_src.status::TEXT IN ('pending','assigned','attempt_1','attempt_2',
                               'attempt_3','callback_scheduled')
    AND o.created_at BETWEEN v_src.created_at - v_window
                         AND v_src.created_at + v_window;

  RETURN jsonb_build_object(
    'enabled', true,
    'window_hours', p_window_hours,
    'candidates', v_candidates
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_merge_candidates(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_merge_candidates(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The merge itself
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.merge_orders(
  p_survivor_id      uuid,
  p_absorbed_id      uuid,
  p_actor_id         uuid,
  p_customer_address text DEFAULT NULL,
  p_customer_city    text DEFAULT NULL,
  p_window_hours     integer DEFAULT 24,
  p_note             text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_role      TEXT;
  v_actor_market    UUID;
  v_actor_type      TEXT;
  v_survivor        orders%ROWTYPE;
  v_absorbed        orders%ROWTYPE;
  v_first_id        UUID;
  v_second_id       UUID;
  v_items_moved     INTEGER := 0;
  v_subtotal        NUMERIC(10,3);
  v_qty             INTEGER;
  v_total           NUMERIC(10,3);
  v_apply_surcharge BOOLEAN;
  v_market_code     TEXT;
  v_mergeable       TEXT[] := ARRAY['pending','assigned','attempt_1','attempt_2',
                                    'attempt_3','callback_scheduled'];
BEGIN
  -- 1. Actor guard, identical in shape to manual_delete_orders. A caller with
  --    no session cannot merge: auth.uid() is the identity, never a parameter.
  IF p_actor_id IS NULL OR auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT role, market_id INTO v_actor_role, v_actor_market
    FROM users WHERE id = p_actor_id;

  -- Agents are allowed here (unlike manual_delete_orders): they are the ones on
  -- the phone when the customer asks for both products. They are additionally
  -- required to own BOTH orders, checked below.
  IF NOT FOUND OR v_actor_role NOT IN ('super_admin','market_manager','agent') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_actor_type := CASE WHEN v_actor_role = 'agent' THEN 'agent' ELSE 'manager' END;

  IF p_survivor_id = p_absorbed_id THEN
    RAISE EXCEPTION 'Cannot merge an order into itself' USING ERRCODE = '22023';
  END IF;

  -- 2. The presence lock. MANDATORY and explicit: this function is SECURITY
  --    DEFINER, so it runs as the owner and the current_user-keyed guard
  --    trigger does NOT fire for its writes.
  PERFORM public.assert_order_unlocked(p_survivor_id, p_actor_id);
  PERFORM public.assert_order_unlocked(p_absorbed_id, p_actor_id);

  -- 3. Lock both rows in a stable order, so two agents merging the same pair in
  --    opposite directions cannot deadlock.
  v_first_id  := least(p_survivor_id, p_absorbed_id);
  v_second_id := greatest(p_survivor_id, p_absorbed_id);
  PERFORM 1 FROM orders WHERE id = v_first_id  FOR UPDATE;
  PERFORM 1 FROM orders WHERE id = v_second_id FOR UPDATE;

  SELECT * INTO v_survivor FROM orders WHERE id = p_survivor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_survivor_id USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_absorbed FROM orders WHERE id = p_absorbed_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_absorbed_id USING ERRCODE = 'P0002';
  END IF;

  -- 4. Gates, each with its own SQLSTATE so the API can name the refusal.
  IF v_survivor.market_id <> v_absorbed.market_id THEN
    RAISE EXCEPTION 'cross_market' USING ERRCODE = '42501';
  END IF;

  IF v_actor_role = 'market_manager'
     AND v_survivor.market_id IS DISTINCT FROM v_actor_market THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_actor_role = 'agent'
     AND (v_survivor.assigned_to IS DISTINCT FROM p_actor_id
          OR v_absorbed.assigned_to IS DISTINCT FROM p_actor_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF normalize_phone(v_survivor.customer_phone) = ''
     OR normalize_phone(v_survivor.customer_phone)
        <> normalize_phone(v_absorbed.customer_phone) THEN
    RAISE EXCEPTION 'phone_mismatch' USING ERRCODE = '23514';
  END IF;

  -- `confirmed` is deliberately EXCLUDED, though the duplicate dialog allows
  -- deleting it: a confirmed total was agreed with the customer by phone, and
  -- silently changing it is a different act from removing a duplicate they
  -- never knew about.
  IF NOT (v_survivor.status::TEXT = ANY(v_mergeable))
     OR NOT (v_absorbed.status::TEXT = ANY(v_mergeable)) THEN
    RAISE EXCEPTION 'status_not_mergeable' USING ERRCODE = '23514';
  END IF;

  IF coalesce(p_window_hours, 0) <= 0 THEN
    RAISE EXCEPTION 'merge_disabled' USING ERRCODE = '23514';
  END IF;

  IF abs(extract(epoch FROM (v_absorbed.created_at - v_survivor.created_at)))
     > p_window_hours * 3600 THEN
    RAISE EXCEPTION 'outside_window' USING ERRCODE = '23514';
  END IF;

  -- 5 + 6. Materialize both orders' flat columns into order_items when they
  --        have none. Intake never creates item rows, so without this the
  --        original product would vanish from a merged order.
  INSERT INTO order_items (order_id, product_id, product_name, variant_id,
                           variant_label, quantity, unit_price, line_total)
  SELECT o.id, o.product_id, o.product_name, NULL, o.variant_label,
         coalesce(o.quantity, 1), coalesce(o.unit_price, 0),
         round(coalesce(o.unit_price, 0) * coalesce(o.quantity, 1), 3)
    FROM orders o
   WHERE o.id IN (p_survivor_id, p_absorbed_id)
     AND o.product_name IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id);

  -- 7. Move the absorbed lines onto the survivor.
  UPDATE order_items SET order_id = p_survivor_id, updated_at = now()
   WHERE order_id = p_absorbed_id;
  GET DIAGNOSTICS v_items_moved = ROW_COUNT;

  -- 8. Recompute the total, mirroring computeOrderTotal exactly.
  SELECT coalesce(sum(line_total), 0), coalesce(sum(quantity), 0)
    INTO v_subtotal, v_qty
    FROM order_items WHERE order_id = p_survivor_id;

  -- The +10% online-card surcharge exists for the legacy Dexpress cash
  -- settlement. Darb Assabil bills cards natively, so applying it there would
  -- double-charge. Same rule as src/app/api/orders/[id]/route.ts.
  SELECT code INTO v_market_code FROM markets WHERE id = v_survivor.market_id;
  v_apply_surcharge := (v_market_code <> 'ly')
                       OR (v_survivor.dexpress_state_id IS NOT NULL);

  v_total := round(
    (CASE WHEN v_survivor.card_payment AND v_apply_surcharge
          THEN v_subtotal * 1.1 ELSE v_subtotal END)
    + coalesce(v_survivor.delivery_fee, 0), 3);

  -- 9. Update the survivor. ONE delivery fee — the survivor's — because one
  --    parcel goes out. orders.product_id deliberately KEEPS pointing at the
  --    survivor's original product: the scan RPCs and manual_delete_orders move
  --    stock by that column, and nulling it would break both. The multi-product
  --    stock gap is pre-existing (plans/warehouse-scan-run.md); this does not
  --    widen it.
  UPDATE orders
     SET total_price      = v_total,
         quantity         = v_qty,
         customer_address = coalesce(p_customer_address, customer_address),
         customer_city    = coalesce(p_customer_city, customer_city),
         updated_at       = now()
   WHERE id = p_survivor_id;

  -- 10. Soft-delete the absorbed order inline rather than via
  --     manual_delete_orders, whose role set excludes agents and which would
  --     re-assert the lock we already hold.
  UPDATE orders
     SET status = 'deleted'::public.order_status, updated_at = now()
   WHERE id = p_absorbed_id;

  -- 11. Two history rows, so the merge is legible from either side. The
  --     [merge:*] prefix is a machine-readable marker: the UI parses a token,
  --     never French prose that an Arabic locale or a copy edit would break.
  INSERT INTO order_history (order_id, status_from, status_to, actor_id,
                             actor_type, note)
  VALUES (
    p_absorbed_id, v_absorbed.status, 'deleted'::public.order_status, p_actor_id,
    v_actor_type,
    '[merge:into:' || p_survivor_id || '] Fusionnée dans la commande '
      || coalesce(v_survivor.external_id, '') || ' · ' || v_items_moved
      || ' ligne(s) transférée(s)' || coalesce(' · ' || p_note, '')
  );

  -- status_from = status_to records an event that is not a transition: the
  -- column is NOT NULL and there is no other way to say "nothing moved".
  INSERT INTO order_history (order_id, status_from, status_to, actor_id,
                             actor_type, note)
  VALUES (
    p_survivor_id, v_survivor.status, v_survivor.status, p_actor_id,
    v_actor_type,
    '[merge:from:' || p_absorbed_id || '] Commande '
      || coalesce(v_absorbed.external_id, '') || ' fusionnée ici · '
      || v_items_moved || ' ligne(s) ajoutée(s) · total ' || v_total
  );

  RETURN jsonb_build_object(
    'survivor_id', p_survivor_id,
    'absorbed_id', p_absorbed_id,
    'items_moved', v_items_moved,
    'new_total', v_total,
    'new_quantity', v_qty
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.merge_orders(uuid, uuid, uuid, text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_orders(uuid, uuid, uuid, text, text, integer, text) TO authenticated;

COMMENT ON FUNCTION public.merge_orders IS
  'Merges the absorbed order into the survivor: materializes both orders'' flat '
  'product columns into order_items, moves the lines, recomputes the total with '
  'ONE delivery fee, soft-deletes the absorbed order and writes a [merge:*] '
  'history row on each side. The surviving address is passed explicitly — over '
  'half of real merge candidates have two different addresses.';
