-- Le voyage du colis, tel que Darb le raconte.
--
-- promote_darb_status ne connaissait que quatre slugs sur onze. Les six autres
-- ne changeaient rien, donc un colis restait « Scanné » de la remise jusqu'à la
-- livraison, puis sautait d'un coup à livré ou à retour. dispatched, deposit et
-- in_transit n'étaient jamais occupés par un colis Darb — d'où une salle de
-- contrôle séparée pour /in-delivery, qui n'en voyait aucun.
--
-- ON NE RECULE PAS UN STATUT. Darb réémet parfois un état antérieur (une
-- réservation rejouée après une affectation). Un rang par statut l'empêche ;
-- les allers-retours légitimes entre « retardé » et « en cours de livraison »
-- partagent le même rang et restent donc possibles dans les deux sens.
--
-- Et `received` cesse d'être un cul-de-sac : un colis revenu que le client veut
-- toujours repart vers l'agent. Sans cette porte il ne pouvait plus jamais
-- bouger, n'atteignait aucun statut terminal, ne recevait pas de terminal_at,
-- ne s'archivait jamais et disparaissait des dénominateurs de livraison.

CREATE OR REPLACE FUNCTION public.order_status_rank(p_status order_status)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'uploaded' THEN 10
    WHEN 'scanned' THEN 20
    WHEN 'at_carrier' THEN 30
    WHEN 'dispatched' THEN 30
    WHEN 'deposit' THEN 40
    WHEN 'unverified' THEN 45
    WHEN 'in_transit' THEN 50
    -- Même rang : retardé ↔ en livraison, dans les deux sens, sans recul.
    WHEN 'out_for_delivery' THEN 60
    WHEN 'delivery_delayed' THEN 60
    WHEN 'returning' THEN 70
    WHEN 'to_be_returned' THEN 80
    WHEN 'received' THEN 85
    WHEN 'delivered' THEN 90
    WHEN 'returned' THEN 90
    WHEN 'cancelled' THEN 90
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.promote_darb_status(
  p_order_id uuid, p_slug text, p_reference text DEFAULT NULL,
  p_synced_at timestamptz DEFAULT now(), p_actor_id uuid DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_current_status order_status;
  v_carrier_id UUID; v_carrier_code TEXT;
  v_target_status order_status;
  v_promoted BOOLEAN := FALSE;
  v_history_id UUID; v_updated_at TIMESTAMPTZ;
  v_in_flight CONSTANT order_status[] := ARRAY[
    'uploaded','scanned','at_carrier','dispatched','deposit','unverified',
    'in_transit','out_for_delivery','delivery_delayed','returning'
  ]::order_status[];
BEGIN
  SELECT status, carrier_id INTO v_current_status, v_carrier_id
  FROM orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id
      USING DETAIL = '{"code":"ORDER_NOT_FOUND"}';
  END IF;

  SELECT code INTO v_carrier_code FROM carriers WHERE id = v_carrier_id;

  IF v_carrier_code IS DISTINCT FROM 'darb_assabil' THEN
    RAISE EXCEPTION 'promote_darb_status only applies to Darb Assabil orders (got %)', v_carrier_code
      USING DETAIL = '{"code":"WRONG_CARRIER"}';
  END IF;

  v_target_status := CASE p_slug
    WHEN 'booked'     THEN 'at_carrier'::order_status        -- chez eux
    WHEN 'processing' THEN 'at_carrier'::order_status
    WHEN 'on-branch'  THEN 'in_transit'::order_status        -- centre de tri
    WHEN 'released'   THEN 'out_for_delivery'::order_status  -- sorti livrer
    WHEN 'resent'     THEN 'out_for_delivery'::order_status
    WHEN 'delayed'    THEN 'delivery_delayed'::order_status
    WHEN 'returning'  THEN 'returning'::order_status         -- pas recevable
    WHEN 'returned'   THEN 'to_be_returned'::order_status    -- recevable
    WHEN 'completed'  THEN 'delivered'::order_status
    WHEN 'cancelled'  THEN 'cancelled'::order_status
    ELSE NULL
  END;

  v_promoted := v_target_status IS NOT NULL
    AND v_current_status <> v_target_status
    AND v_current_status = ANY (v_in_flight)
    AND public.order_status_rank(v_target_status) >= public.order_status_rank(v_current_status);

  IF v_promoted THEN
    UPDATE orders
    SET status = v_target_status, carrier_status_slug = p_slug,
        carrier_status_synced_at = p_synced_at,
        tracking_number = COALESCE(p_reference, tracking_number)
    WHERE id = p_order_id RETURNING updated_at INTO v_updated_at;

    INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    VALUES (p_order_id, v_current_status, v_target_status, p_actor_id, 'system',
            'Darb Assabil carrier status: ' || p_slug)
    RETURNING id INTO v_history_id;
  ELSE
    UPDATE orders
    SET carrier_status_slug = p_slug, carrier_status_synced_at = p_synced_at,
        tracking_number = COALESCE(p_reference, tracking_number)
    WHERE id = p_order_id RETURNING updated_at INTO v_updated_at;
  END IF;

  RETURN json_build_object(
    'order_id', p_order_id, 'promoted', v_promoted,
    'status', CASE WHEN v_promoted THEN v_target_status ELSE v_current_status END,
    'slug', p_slug, 'tracking_number', p_reference,
    'updated_at', v_updated_at, 'history_id', v_history_id
  );
END;
$function$;

-- ── Le graphe des transitions apprend les quatre statuts ───────────────────

create or replace function public.transition_order_status(
  p_order_id uuid,
  p_new_status order_status,
  p_actor_id uuid default null,
  p_actor_type text default 'system',
  p_note text default null,
  p_rejection_reason rejection_reason default null,
  p_rejection_note text default null,
  p_callback_at timestamptz default null,
  p_scheduled_at timestamptz default null,
  p_scheduled_auto boolean default null,
  p_scheduled_carrier_id uuid default null,
  p_rejection_subreason text default null
)
returns json
language plpgsql
security definer
as $$
declare
  v_current_status order_status;
  v_order_id uuid;
  v_history_id uuid;
  v_updated_at timestamptz;
  v_valid boolean := false;
  v_from_carrier_warehouse boolean := false;
begin
  select
    id,
    status,
    coalesce(carrier_extra->>'fulfil_from_carrier_warehouse', 'false') = 'true'
  into v_order_id, v_current_status, v_from_carrier_warehouse
  from orders
  where id = p_order_id
  for update;

  if v_order_id is null then
    raise exception 'Order not found: %', p_order_id;
  end if;

  v_valid := case v_current_status
    when 'new' then p_new_status in ('pending', 'attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    when 'pending' then p_new_status in ('attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    when 'assigned' then p_new_status in ('attempt_1', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    when 'attempt_1' then p_new_status in ('attempt_2', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    when 'attempt_2' then p_new_status in ('attempt_3', 'callback_scheduled', 'confirmed', 'rejected', 'deleted')
    when 'attempt_3' then p_new_status in ('callback_scheduled', 'confirmed', 'rejected', 'deleted')
    when 'callback_scheduled' then p_new_status in ('attempt_1', 'attempt_2', 'attempt_3', 'confirmed', 'rejected', 'deleted')
    when 'confirmed' then p_new_status in (
      'attempt_1', 'attempt_2', 'attempt_3',
      'callback_scheduled', 'rejected',
      'uploaded', 'dispatch_scheduled', 'deleted'
    )
    when 'dispatch_scheduled' then p_new_status in ('uploaded', 'deleted')
    when 'uploaded' then
      p_new_status in ('scanned', 'deleted')
      or (p_new_status = 'dispatched' and v_from_carrier_warehouse)
    -- `uploaded` est le retour du dé-scan : le colis revient au banc.
    when 'scanned' then p_new_status in ('at_carrier', 'dispatched', 'uploaded', 'deleted')
    when 'at_carrier' then p_new_status in (
      'in_transit', 'out_for_delivery', 'delivery_delayed', 'unverified',
      'returning', 'to_be_returned', 'delivered', 'cancelled', 'deleted'
    )
    when 'dispatched' then p_new_status in ('deposit', 'in_transit', 'out_for_delivery', 'unverified', 'cancelled', 'deleted')
    when 'deposit' then p_new_status in ('in_transit', 'out_for_delivery', 'unverified', 'cancelled')
    when 'in_transit' then p_new_status in (
      'out_for_delivery', 'delivery_delayed', 'delivered', 'returning',
      'to_be_returned', 'unverified', 'cancelled'
    )
    when 'out_for_delivery' then p_new_status in (
      'delivery_delayed', 'in_transit', 'delivered', 'returning',
      'to_be_returned', 'unverified', 'cancelled'
    )
    when 'delivery_delayed' then p_new_status in (
      'out_for_delivery', 'in_transit', 'delivered', 'returning',
      'to_be_returned', 'unverified', 'cancelled'
    )
    when 'unverified' then p_new_status in (
      'dispatched', 'deposit', 'in_transit', 'out_for_delivery', 'delivery_delayed',
      'returning', 'to_be_returned', 'delivered', 'cancelled'
    )
    when 'returning' then p_new_status in ('to_be_returned', 'returned', 'cancelled')
    when 'to_be_returned' then p_new_status in ('returned', 'received', 'cancelled')
    -- Revenu et toujours voulu : le colis repart à l'agent pour un nouvel envoi.
    when 'received' then p_new_status in ('confirmed', 'cancelled', 'deleted')
    else false
  end;

  if not v_valid then
    raise exception 'invalid transition from % to %', v_current_status, p_new_status
      using detail = '{"code":"INVALID_TRANSITION"}';
  end if;

  if p_new_status = 'rejected' and p_rejection_reason is null then
    raise exception 'rejection_reason is required when transitioning to rejected';
  end if;

  -- `autre` is the escape hatch, and an escape hatch with no note is how 440
  -- orders ended up with an unknowable reason. The API layer already enforces
  -- this; the guard is repeated here so no future caller can skip it.
  if p_new_status = 'rejected'
     and p_rejection_reason = 'autre'
     and coalesce(btrim(p_rejection_note), '') = '' then
    raise exception 'rejection_note is required when rejection_reason is autre';
  end if;

  update orders
  set
    status = p_new_status,
    rejection_reason = case when p_new_status = 'rejected' then p_rejection_reason else rejection_reason end,
    rejection_note   = case when p_new_status = 'rejected' then p_rejection_note   else rejection_note end,
    rejection_subreason = case when p_new_status = 'rejected' then p_rejection_subreason else rejection_subreason end,
    callback_scheduled_at = case
      when p_new_status = 'callback_scheduled' then p_callback_at
      when v_current_status = 'callback_scheduled' then null
      else callback_scheduled_at
    end,
    scheduled_dispatch_at = case
      when p_new_status = 'dispatch_scheduled' then p_scheduled_at
      when v_current_status = 'dispatch_scheduled' then null
      else scheduled_dispatch_at
    end,
    scheduled_dispatch_auto = case
      when p_new_status = 'dispatch_scheduled' then coalesce(p_scheduled_auto, false)
      when v_current_status = 'dispatch_scheduled' then false
      else scheduled_dispatch_auto
    end,
    scheduled_dispatch_carrier_id = case
      when p_new_status = 'dispatch_scheduled' then p_scheduled_carrier_id
      when v_current_status = 'dispatch_scheduled' then null
      else scheduled_dispatch_carrier_id
    end
  where id = p_order_id
  returning updated_at into v_updated_at;

  insert into order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  values (p_order_id, v_current_status, p_new_status, p_actor_id, p_actor_type, p_note)
  returning id into v_history_id;

  return json_build_object(
    'order_id', p_order_id,
    'status', p_new_status,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
end;
$$;


grant execute on function public.transition_order_status(
  uuid, order_status, uuid, text, text, rejection_reason, text,
  timestamptz, timestamptz, boolean, uuid, text
) to authenticated, service_role;

-- ── « Remis » veut enfin dire quelque chose en Libye ────────────────────────
--
-- La case comptait les passages à `dispatched`, que Darb n'atteignait jamais :
-- elle affichait zéro depuis toujours. Les deux statuts sont acceptés pour que
-- la Tunisie ne change pas.

CREATE OR REPLACE FUNCTION public.get_warehouse_day_stats(p_market_id UUID DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tz TEXT := public.warehouse_market_tz(p_market_id);
  v_today TIMESTAMPTZ; v_yest TIMESTAMPTZ;
BEGIN
  v_today := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_yest  := v_today - INTERVAL '1 day';
  RETURN (
    SELECT json_build_object(
      'scanned_today',     COUNT(*) FILTER (WHERE status_to = 'scanned' AND created_at >= v_today),
      'scanned_yesterday', COUNT(*) FILTER (WHERE status_to = 'scanned' AND created_at >= v_yest AND created_at < v_today),
      'handed_today',      COUNT(*) FILTER (WHERE status_to IN ('at_carrier','dispatched') AND created_at >= v_today),
      'handed_yesterday',  COUNT(*) FILTER (WHERE status_to IN ('at_carrier','dispatched') AND created_at >= v_yest AND created_at < v_today),
      'returns_today',     COUNT(*) FILTER (WHERE status_to IN ('returned','received') AND status_from = 'to_be_returned' AND created_at >= v_today),
      'returns_yesterday', COUNT(*) FILTER (WHERE status_to IN ('returned','received') AND status_from = 'to_be_returned' AND created_at >= v_yest AND created_at < v_today)
    )
    FROM order_history
    WHERE created_at >= v_yest AND (p_market_id IS NULL OR market_id = p_market_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_warehouse_day_stats(UUID) TO PUBLIC;
