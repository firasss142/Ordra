-- Wire up the auto-retry slot that has been configured but never used.
--
-- `attempt_retry_times` (default 11:00 / 14:00 / 18:00) has been a manager-
-- facing setting since 20260418, and both markets have it set. Nothing ever
-- read it: `no_response_with_auto_reject` explicitly wrote
-- `callback_scheduled_at = NULL` on the attempt branch. Consequences:
--
--   * every attempt_1/2/3 order in the database carries a null retry time, so
--   * the `attempt_due` half of run_notifications_check() has never inserted a
--     single row — agent_notifications contains only callback_due.
--
-- Now an unanswered call schedules its own next try at the next configured
-- slot. Nothing else changes: `sortAgentQueue` and `presentAgentStatus` both
-- gate their callback handling on `status = 'callback_scheduled'`, so an
-- attempt row carrying a time keeps its ordering and its amber pill.

-- ── Next configured retry slot, in the market's local time ───────────────
create or replace function public.next_retry_slot(
  p_market_id uuid,
  p_now timestamptz default now()
)
returns timestamptz
language plpgsql
stable
security definer
as $$
declare
  v_raw       jsonb;
  v_slots     text[];
  v_tz        text;
  v_local_now timestamp;
  v_candidate timestamp;
  v_slot      text;
begin
  -- The markets table has no timezone column, so the mapping lives here.
  -- If a third market is ever added this is the line that must grow.
  select case code when 'ly' then 'Africa/Tripoli' else 'Africa/Tunis' end
    into v_tz
  from markets where id = p_market_id;

  v_tz := coalesce(v_tz, 'Africa/Tunis');

  select case
           when jsonb_typeof(value) = 'object' then value->'value'
           else value
         end
    into v_raw
  from settings
  where market_id = p_market_id and key = 'attempt_retry_times';

  if v_raw is null or jsonb_typeof(v_raw) <> 'array' or jsonb_array_length(v_raw) = 0 then
    -- Same fallback the TypeScript helper used: two hours out.
    return p_now + interval '2 hours';
  end if;

  select array_agg(t order by t) into v_slots
  from jsonb_array_elements_text(v_raw) as t
  where t ~ '^([0-1][0-9]|2[0-3]):[0-5][0-9]$';

  if v_slots is null or array_length(v_slots, 1) = 0 then
    return p_now + interval '2 hours';
  end if;

  v_local_now := p_now at time zone v_tz;

  foreach v_slot in array v_slots loop
    v_candidate := date_trunc('day', v_local_now) + v_slot::time;
    if v_candidate > v_local_now then
      return v_candidate at time zone v_tz;
    end if;
  end loop;

  -- Every slot for today has passed — take tomorrow's first.
  return (date_trunc('day', v_local_now) + interval '1 day' + v_slots[1]::time)
         at time zone v_tz;
end;
$$;

grant execute on function public.next_retry_slot(uuid, timestamptz) to authenticated, service_role;

-- ── Stamp it on the attempt branch (5-arg overload, /no-answer) ──────────
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

-- ── The 4-arg overload (/no-response) delegates rather than duplicating ──
-- Two copies of this body drifted once already; this one now has a single
-- implementation to disagree with.
create or replace function public.no_response_with_auto_reject(
  p_order_id uuid,
  p_next_attempt order_status,
  p_callback_at timestamptz default null,
  p_actor_id uuid default null
)
returns json
language plpgsql
security definer
as $$
begin
  return public.no_response_with_auto_reject(
    p_order_id, p_next_attempt, p_callback_at, p_actor_id, 'agent'
  );
end;
$$;

grant execute on function public.no_response_with_auto_reject(uuid, order_status, timestamptz, uuid, text)
  to authenticated, service_role;
grant execute on function public.no_response_with_auto_reject(uuid, order_status, timestamptz, uuid)
  to authenticated, service_role;
