-- Adds reschedule_callback RPC so agents/managers can update callback_scheduled_at
-- on an order that's already in callback_scheduled status. The status transition
-- engine forbids callback_scheduled -> callback_scheduled, so the only way to
-- update the time was previously to leave the status and come back, which is
-- both wrong (it would write spurious history rows) and clunky.
--
-- This RPC writes a single history row with status_from = status_to =
-- callback_scheduled and a note recording the new callback time. order_history
-- remains append-only.

create or replace function public.reschedule_callback(
  p_order_id uuid,
  p_callback_at timestamptz,
  p_actor_id uuid,
  p_actor_type text default 'agent'
)
returns json
language plpgsql
security definer
as $$
declare
  v_current_status order_status;
  v_updated_at timestamptz;
  v_history_id uuid;
  v_note text;
begin
  select status into v_current_status
  from orders
  where id = p_order_id
  for update;

  if v_current_status is null then
    raise exception 'Order not found: %', p_order_id;
  end if;

  if v_current_status <> 'callback_scheduled' then
    raise exception 'reschedule_callback requires status = callback_scheduled, got %', v_current_status;
  end if;

  update orders
  set callback_scheduled_at = p_callback_at
  where id = p_order_id
  returning updated_at into v_updated_at;

  v_note := 'Rappel reprogramme pour ' || to_char(p_callback_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI');

  insert into order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  values (p_order_id, 'callback_scheduled'::order_status, 'callback_scheduled'::order_status, p_actor_id, p_actor_type, v_note)
  returning id into v_history_id;

  -- Auto-resolve any open callback_due for this order: the old due moment is no
  -- longer relevant. A fresh notification will fire when the new time elapses.
  update agent_notifications
  set read_at = now()
  where order_id = p_order_id and kind = 'callback_due' and read_at is null;

  return json_build_object(
    'order_id', p_order_id,
    'status', 'callback_scheduled',
    'callback_at', p_callback_at,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
end;
$$;

grant execute on function public.reschedule_callback(uuid, timestamptz, uuid, text) to authenticated, service_role;
