-- « Règles » du bureau Prospects : écrire la clé `prospect_recovery` (2026-10-06).
--
-- La politique d'écriture des réglages par les managers liste les clés une à
-- une ; celle-ci n'y est pas. Plutôt qu'élargir une politique générale, une
-- RPC étroite : un super_admin, ou le market_manager DE CE MARCHÉ, et rien
-- d'autre. La forme est validée côté route (lib/prospects/desk/rules.ts) ;
-- la base vérifie seulement que c'est un objet.
-- Historique dans settings_history, comme PATCH /api/settings/[marketId].

create or replace function public.set_prospect_recovery_settings(p_market_id uuid, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_market uuid;
  v_old jsonb;
begin
  if v_uid is null then
    raise exception 'set_prospect_recovery_settings: no session' using errcode = '42501';
  end if;
  select u.role::text, u.market_id into v_role, v_market
    from users u where u.id = v_uid and u.is_active and u.deleted_at is null;
  if v_role is null or not (v_role = 'super_admin' or (v_role = 'market_manager' and v_market = p_market_id)) then
    raise exception 'set_prospect_recovery_settings: forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_value) <> 'object' then
    raise exception 'set_prospect_recovery_settings: value must be an object' using errcode = '22023';
  end if;

  select s.value into v_old from settings s where s.market_id = p_market_id and s.key = 'prospect_recovery';

  insert into settings (market_id, key, value, updated_by, updated_at)
  values (p_market_id, 'prospect_recovery', p_value, v_uid, now())
  on conflict (market_id, key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  insert into settings_history (market_id, key, old_value, new_value, changed_by)
  values (p_market_id, 'prospect_recovery', v_old, p_value, v_uid);

  return public.prospect_recovery_settings(p_market_id);
end;
$$;

revoke execute on function public.set_prospect_recovery_settings(uuid, jsonb) from public, anon;
grant execute on function public.set_prospect_recovery_settings(uuid, jsonb) to authenticated;

comment on function public.set_prospect_recovery_settings(uuid, jsonb) is
  'Règles du bureau Prospects. super_admin ou market_manager du marché. Voir plans/prospects-recovery.md.';
