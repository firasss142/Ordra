-- One sheet's cursor, written without touching the others.
--
-- Every Google Sheets cursor of a market lives in ONE settings row
-- (key 'google_sheets_sync_state', value { "<storefront_id>": { "last_row": N } }).
-- The app used to read that whole object, change one key and write it all back.
-- With several Converty accounts in a market, a sync draining account A rewrote
-- the object after every row from a copy taken before account B was connected —
-- erasing B's starting row, so B's next tick read from row 1 and poured its
-- whole history into the queue as new orders.
--
-- jsonb_set inside one UPDATE (or the INSERT of the first key) is evaluated
-- against the row as it is under the row lock: two writers on different keys
-- can no longer undo each other.
--
-- Called by the server with the service role only.
create or replace function public.set_sheet_cursor(
  p_market_id uuid,
  p_storefront_id uuid,
  p_last_row integer
) returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.settings (market_id, key, value, updated_at)
  values (
    p_market_id,
    'google_sheets_sync_state',
    jsonb_build_object(p_storefront_id::text, jsonb_build_object('last_row', p_last_row)),
    now()
  )
  on conflict (market_id, key) do update
    set value = jsonb_set(
          case when jsonb_typeof(public.settings.value) = 'object' then public.settings.value else '{}'::jsonb end,
          array[p_storefront_id::text],
          jsonb_build_object('last_row', p_last_row),
          true
        ),
        updated_at = now();
$$;

revoke all on function public.set_sheet_cursor(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.set_sheet_cursor(uuid, uuid, integer) to service_role;
