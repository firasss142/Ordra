-- Auto-rejection (attempts exhausted) writes the reason with a direct UPDATE
-- rather than through transition_order_status, so part 3 did not reach it.
-- Without this, every auto-rejected order lands in the new model with a group
-- and no detail — reintroducing exactly the information loss the taxonomy
-- change exists to stop.
--
-- Only the two UPDATE statements in the exhausted-attempts branch change; the
-- rest of the body is carried over from 20260827000002 unchanged.

create or replace function public.no_response_with_auto_reject(
  p_order_id uuid,
  p_next_attempt order_status,
  p_callback_at timestamptz default null,
  p_actor_id uuid default null,
  p_actor_type text default 'agent'
)
returns json
language plpgsql
security definer
as $$
declare
  v_current_status public.order_status;
  v_order_id       uuid;
  v_market_id      uuid;
  v_updated_at     timestamptz;
  v_new_attempts   integer;
  v_max_attempts   integer;
  v_final_status   public.order_status;
  v_history_id     uuid;
  v_note           text;
  v_attempt_status public.order_status;
  v_retry_at       timestamptz;
begin
  select id, status, market_id, coalesce(attempts_count, 0)
  into v_order_id, v_current_status, v_market_id, v_new_attempts
  from orders where id = p_order_id for update;

  if v_order_id is null then
    raise exception 'Order not found: %', p_order_id;
  end if;

  if v_current_status not in (
    'pending', 'assigned', 'attempt_1', 'attempt_2', 'attempt_3',
    'callback_scheduled', 'confirmed'
  ) then
    raise exception 'invalid no-answer from status %', v_current_status;
  end if;

  v_new_attempts := v_new_attempts + 1;

  select coalesce(
    case
      when jsonb_typeof(value) = 'object' then nullif(value->>'value', '')::integer
      when jsonb_typeof(value) in ('number', 'string') then nullif(value #>> '{}', '')::integer
      else null
    end, 3)
  into v_max_attempts
  from settings
  where market_id = v_market_id and key = 'max_call_attempts';

  if v_max_attempts is null or v_max_attempts < 1 then
    v_max_attempts := 3;
  end if;

  v_attempt_status := case
    when v_new_attempts >= 3 then 'attempt_3'::public.order_status
    when v_new_attempts = 2 then 'attempt_2'::public.order_status
    else 'attempt_1'::public.order_status
  end;

  if v_new_attempts > v_max_attempts then
    v_final_status := 'rejected';
    v_note := 'Auto-rejete - tentative ' || v_new_attempts || ' (max ' || v_max_attempts || ' depasse)';

    update orders set
      status = 'rejected',
      attempts_count = v_new_attempts,
      rejection_reason = 'injoignable',
      rejection_subreason = 'pas_de_reponse',
      rejection_note = 'Auto-rejete : tentatives maximum depassees',
      callback_scheduled_at = null
    where id = p_order_id
    returning updated_at into v_updated_at;

    insert into order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    values (p_order_id, v_current_status, 'rejected'::public.order_status, null, 'system', v_note)
    returning id into v_history_id;

  elsif p_callback_at is not null then
    v_final_status := 'callback_scheduled';
    v_note := 'Tentative ' || v_new_attempts || ' - rappel programme';

    update orders set
      status = 'callback_scheduled',
      attempts_count = v_new_attempts,
      callback_scheduled_at = p_callback_at
    where id = p_order_id
    returning updated_at into v_updated_at;

    insert into order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    values (p_order_id, v_current_status, 'callback_scheduled'::public.order_status, p_actor_id, p_actor_type, v_note)
    returning id into v_history_id;

  else
    v_final_status := v_attempt_status;
    v_retry_at := public.next_retry_slot(v_market_id);
    v_note := 'Tentative ' || v_new_attempts || ' - pas de reponse';

    update orders set
      status = v_attempt_status,
      attempts_count = v_new_attempts,
      callback_scheduled_at = v_retry_at
    where id = p_order_id
    returning updated_at into v_updated_at;

    insert into order_history (order_id, status_from, status_to, actor_id, actor_type, note)
    values (p_order_id, v_current_status, v_attempt_status, p_actor_id, p_actor_type, v_note)
    returning id into v_history_id;
  end if;

  return json_build_object(
    'order_id',       p_order_id,
    'new_status',     v_final_status,
    'auto_rejected',  v_final_status = 'rejected',
    'attempt_number', v_new_attempts,
    'attempts_count', v_new_attempts,
    'retry_at',       v_retry_at,
    'updated_at',     v_updated_at,
    'history_id',     v_history_id
  );
end;
$$;
