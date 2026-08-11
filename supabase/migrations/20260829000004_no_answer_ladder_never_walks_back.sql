-- ============================================================
-- 20260829000004_no_answer_ladder_never_walks_back.sql
-- Stop "Pas de réponse" moving an order BACKWARDS down the attempt ladder.
--
-- WHY: no_response_with_auto_reject derives the next status from
-- attempts_count alone:
--     v_new_attempts   := coalesce(attempts_count, 0) + 1;
--     v_attempt_status := case when v_new_attempts >= 3 then 'attempt_3' ...
-- and then writes it with a RAW `update orders set status = ...`, bypassing
-- transition_order_status and its validator entirely. When status and
-- attempts_count disagree — which is the common case, not the edge case — the
-- counter wins and the order walks back up the funnel.
--
-- Reproduced on production data before writing this migration (in a rolled-back
-- transaction, on a real assigned order):
--     status_before = attempt_3, attempts_count = 0
--     no_response_with_auto_reject(...) -> {"new_status": "attempt_1",
--                                           "attempt_number": 1}
-- The agent sees the card jump from "Tentative 3" back to "Tentative 1",
-- order_history records an illegal attempt_3 -> attempt_1 edge, the customer is
-- called twice more than the ladder allows, and auto-reject fires that many
-- clicks late.
--
-- LIVE EXPOSURE at the time of writing: 131 assigned orders are one click away
--     attempt_2 with attempts_count = 0 : 64 assigned
--     attempt_3 with attempts_count = 0 : 67 assigned
-- No backwards row exists yet, so this is armed rather than exploded. (The
-- desync itself predates this function: 20260827000002_stamp_next_retry_slot.sql
-- reverted the guard that 20260620000006_attempts_count_single_source_of_truth.sql
-- had put in place.)
--
-- THE FIX: let the status floor the counter. The ladder may stand still or go
-- up, never down.
--     v_status_implied := attempt_N -> N, anything else -> 0
--     v_new_attempts   := greatest(existing_count + 1, v_status_implied + 1)
-- For the healthy case (status and counter agree) this is identical to the old
-- arithmetic, so well-formed orders are unaffected: attempt_2/count=2 still
-- gives 3. For a desynced order it now advances from where the STATUS says the
-- agent actually is — attempt_3/count=0 gives 4, which correctly trips
-- auto-reject at max_attempts=3 instead of restarting the ladder.
--
-- ALSO: drop the 4-argument overload. It is a pure delegating wrapper
--     return public.no_response_with_auto_reject(p_order_id, p_next_attempt,
--                                                p_callback_at, p_actor_id, 'agent');
-- so removing it changes no behaviour, but its existence makes a 4-named-arg
-- call ambiguous — PostgREST answers PGRST203 / HTTP 300, which
-- api/orders/[id]/no-response/route.ts:84-91 does not special-case, so that
-- route 500s unconditionally. With one candidate left it resolves against the
-- default p_actor_type. Verified no client reaches it: the UI calls
-- /api/orders/[id]/no-answer (PostCallActionSheet.tsx:379), which already
-- passes p_actor_type and so binds the 5-arg form today.
--
-- NOT DONE HERE: p_next_attempt is dead — the body never reads it, and
-- no-answer/route.ts:85 passes the literal 'attempt_1', which makes the caller
-- look like it decides something it does not. Removing it is a signature change
-- and needs the route updated in the same deploy, so it is left for a follow-up
-- rather than smuggled into a correctness fix.
--
-- NON-GOALS: no backfill of the 131 desynced rows. Their attempts_count is
-- wrong but their status is right, and the status is what the agent and every
-- queue predicate read; this change makes the next click resynchronise them
-- upward. A blind `attempts_count = status_digit` UPDATE would also overwrite
-- the 50 rows where the counter is legitimately AHEAD of the status
-- (attempt_3 with counts of 4, 5, 6, 8, 9 — orders that exhausted retries).
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.no_response_with_auto_reject(
  uuid, order_status, timestamptz, uuid
);

CREATE OR REPLACE FUNCTION public.no_response_with_auto_reject(
  p_order_id uuid,
  p_next_attempt order_status,
  p_callback_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_actor_type text DEFAULT 'agent'::text
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_current_status public.order_status;
  v_order_id       uuid;
  v_market_id      uuid;
  v_updated_at     timestamptz;
  v_new_attempts   integer;
  v_status_implied integer;
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

  -- The status is the floor. attempts_count is a denormalised counter that has
  -- drifted on 131 live rows; the status is what the agent has actually been
  -- shown and worked. Taking the max means the ladder can hold or climb but
  -- never descend, and for a consistent order it is exactly the old arithmetic.
  v_status_implied := case v_current_status
    when 'attempt_1' then 1
    when 'attempt_2' then 2
    when 'attempt_3' then 3
    else 0
  end;
  v_new_attempts := greatest(v_new_attempts + 1, v_status_implied + 1);

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
$function$;

COMMIT;
