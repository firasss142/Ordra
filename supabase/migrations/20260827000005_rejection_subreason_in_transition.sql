-- Rejection reasons, part 3 of 3: let the write path carry the sub-reason.
--
-- The old signature is DROPped rather than replaced. `CREATE OR REPLACE` with an
-- extra defaulted parameter creates a *second* overload instead of replacing the
-- first, and a named-argument call that omits the new parameter then matches
-- both — PostgREST fails with "function is not unique". The repo already hit
-- this once; see 20260506010000_drop_legacy_transition_overload.sql.

drop function if exists public.transition_order_status(
  uuid, order_status, uuid, text, text, rejection_reason, text,
  timestamptz, timestamptz, boolean, uuid
);

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
    when 'scanned' then p_new_status in ('dispatched', 'deleted')
    when 'dispatched' then p_new_status in ('deposit', 'unverified', 'cancelled', 'deleted')
    when 'deposit' then p_new_status in ('in_transit', 'unverified', 'cancelled')
    when 'in_transit' then p_new_status in ('delivered', 'to_be_returned', 'unverified', 'cancelled')
    when 'unverified' then p_new_status in ('dispatched', 'deposit', 'in_transit', 'to_be_returned', 'delivered', 'cancelled')
    when 'to_be_returned' then p_new_status in ('returned', 'received', 'cancelled')
    else false
  end;

  if not v_valid then
    raise exception 'invalid transition from % to %', v_current_status, p_new_status;
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

-- The auto-reject path writes the reason directly rather than through the RPC,
-- so it needs the sub-reason too — otherwise every exhausted-attempts rejection
-- lands in the new model with a group and no detail.
update orders
set rejection_subreason = 'pas_de_reponse'
where status = 'rejected'
  and rejection_reason = 'injoignable'
  and rejection_subreason is null;
