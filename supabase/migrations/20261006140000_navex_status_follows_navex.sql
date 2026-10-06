-- Navex statuses follow Navex, forward only — the Darb model (20261004100300).
--
-- WHY. On 2026-10-06, 139 Navex parcels were stuck:
--   * 91 said « Livrer Paye » (delivered AND paid). Ordra did not know the word, so
--     they stayed in flight: 5 479 TND of revenue never counted.
--   * 48 said « Retour recu ». The poller called fulfill_order_transition(), which
--     only walks ONE step at a time (dispatched → deposit → in_transit → …) and knows
--     nothing from « à vérifier ». A carrier that skips a step is normal, so every
--     one of them was refused, every 10 minutes, for weeks.
--   fulfill_order_transition() also put stock back on « returned » itself, from the
--   order's first product only, before anyone had the parcel in hand.
--
-- NOW (owner's decision, 2026-10-06):
--   * any forward move is accepted (order_status_rank), never a backward one;
--   * a return announced by Navex goes to « to_be_returned »: the parcel appears in
--     Entrepôt › Rentrer and stock comes back only when the bench scans it
--     (scan_return_in: every product, the right site, damaged or not);
--   * « returned » and « cancelled » are never set here — the scan and the managers do.
-- fulfill_order_transition() is left as is for the manual fulfillment route.

CREATE OR REPLACE FUNCTION public.promote_navex_status(
  p_order_id  UUID,
  p_target    public.order_status,
  p_etat      TEXT,
  p_synced_at TIMESTAMPTZ DEFAULT now()
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current   public.order_status;
  v_code      TEXT;
  v_promoted  BOOLEAN;
  v_history   UUID;
  v_in_flight CONSTANT public.order_status[] := ARRAY[
    'uploaded', 'scanned', 'at_carrier', 'dispatched', 'deposit', 'unverified',
    'in_transit', 'out_for_delivery', 'delivery_delayed', 'returning'
  ]::public.order_status[];
BEGIN
  IF p_target NOT IN ('deposit', 'in_transit', 'unverified', 'delivered', 'to_be_returned') THEN
    RAISE EXCEPTION 'promote_navex_status cannot set %', p_target
      USING DETAIL = '{"code":"TARGET_NOT_ALLOWED"}';
  END IF;

  SELECT o.status, c.code INTO v_current, v_code
    FROM public.orders o LEFT JOIN public.carriers c ON c.id = o.carrier_id
   WHERE o.id = p_order_id
     FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id USING DETAIL = '{"code":"ORDER_NOT_FOUND"}';
  END IF;
  IF v_code IS DISTINCT FROM 'navex' THEN
    RAISE EXCEPTION 'promote_navex_status only applies to Navex orders (got %)', v_code
      USING DETAIL = '{"code":"WRONG_CARRIER"}';
  END IF;

  v_promoted := v_current <> p_target
    AND v_current = ANY (v_in_flight)
    AND public.order_status_rank(p_target) > public.order_status_rank(v_current);

  IF v_promoted THEN
    UPDATE public.orders
       SET status = p_target, carrier_status_slug = p_etat, carrier_status_synced_at = p_synced_at
     WHERE id = p_order_id;
    INSERT INTO public.order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current, p_target, NULL, 'system', 'Navex : ' || p_etat)
    RETURNING id INTO v_history;
  ELSE
    UPDATE public.orders
       SET carrier_status_slug = p_etat, carrier_status_synced_at = p_synced_at
     WHERE id = p_order_id;
  END IF;

  RETURN json_build_object(
    'order_id', p_order_id,
    'promoted', v_promoted,
    'status', CASE WHEN v_promoted THEN p_target ELSE v_current END,
    'history_id', v_history
  );
END $$;

REVOKE ALL ON FUNCTION public.promote_navex_status(UUID, public.order_status, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_navex_status(UUID, public.order_status, TEXT, TIMESTAMPTZ) TO service_role;
