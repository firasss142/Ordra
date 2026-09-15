-- Répartir le stock de prospects en un seul appel (2026-09-15).
--
-- Mesuré en production le jour où ceci a été écrit : 1 984 prospects sur 1 992
-- n'ont aucun agent. Personne ne les voit, personne ne les appelle. Vider ce
-- stock est le premier travail du manager sur la console.
--
-- assign_lead() traite un prospect à la fois. Répartir la Tunisie ferait 1 694
-- allers-retours vers une base située à ~130 ms. Cette fonction fait le même
-- travail, avec les mêmes garde-fous, en une seule transaction.
--
-- Les règles reproduites depuis assign_lead(), une par une :
--   1. un prospect au statut terminal (won, lost, archived) n'est pas assigné
--   2. l'agent doit exister, être actif, et appartenir au marché du prospect
--   3. le statut `new` devient `assigned` ; tout autre statut est conservé
--   4. chaque assignation écrit une ligne dans lead_history (append-only)
--
-- SECURITY DEFINER comme assign_lead : la fonction écrit dans lead_history,
-- que les politiques RLS interdisent en écriture directe. Le marché du lot est
-- donc vérifié explicitement ci-dessous, puisque RLS ne le fera pas.
--
-- Tout tient dans une seule instruction CTE plutôt que des tables temporaires :
-- une fonction appelée deux fois dans la même session ne peut pas entrer en
-- collision avec ses propres tables, et le verrou ne dure que l'instruction.

create or replace function public.bulk_assign_leads(
  p_market_id uuid,
  -- [{"lead_id": uuid, "agent_id": uuid}, …] — le plan calculé par
  -- src/lib/prospects/distribution.ts, que le manager vient de valider.
  p_assignments jsonb,
  p_actor_id uuid,
  p_actor_type text default 'manager'
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requested int := 0;
  v_result    json;
begin
  if p_actor_type not in ('system', 'agent', 'manager', 'super_admin') then
    raise exception 'invalid actor_type: %', p_actor_type;
  end if;

  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'p_assignments must be a json array';
  end if;

  select count(*) into v_requested
  from jsonb_array_elements(p_assignments);

  if v_requested = 0 then
    return json_build_object('assigned', 0, 'skipped', 0, 'by_agent', '[]'::json);
  end if;

  with wanted as (
    -- Dédupliqué : un prospect nommé deux fois dans le même plan serait
    -- assigné deux fois et écrirait deux lignes d'historique.
    select distinct on (lead_id) lead_id, agent_id
    from jsonb_to_recordset(p_assignments) as x(lead_id uuid, agent_id uuid)
    where lead_id is not null and agent_id is not null
    order by lead_id
  ),
  eligible as (
    -- Ce qui passe les quatre garde-fous.
    select w.lead_id,
           w.agent_id,
           l.status as status_from,
           case when l.status = 'new' then 'assigned'::lead_status else l.status end as status_to,
           l.assigned_to as previous_agent
    from wanted w
    join leads l on l.id = w.lead_id
    join users u on u.id = w.agent_id
    where l.market_id = p_market_id
      and l.status not in ('won', 'lost', 'archived')
      and u.role = 'agent'
      and u.is_active
      and u.market_id = l.market_id
  ),
  moved as (
    update leads l
       set assigned_to = e.agent_id,
           status      = e.status_to
      from eligible e
     where l.id = e.lead_id
    returning l.id
  ),
  logged as (
    -- lead_history est append-only par déclencheur : on ajoute, on ne corrige
    -- jamais. La note distingue une première assignation d'une réassignation,
    -- exactement comme assign_lead.
    insert into lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
    select e.lead_id, e.status_from, e.status_to, p_actor_id, p_actor_type,
           case when e.previous_agent is null
                then 'Assigned to agent'
                else 'Reassigned to agent' end
      from eligible e
    returning lead_id
  ),
  per_agent as (
    select agent_id, count(*)::int as n from eligible group by agent_id
  )
  select json_build_object(
           'assigned', (select count(*) from moved),
           'skipped',  v_requested - (select count(*) from moved),
           -- Ce que la console affiche après coup, agent par agent.
           'by_agent', coalesce(
             (select json_agg(json_build_object('agent_id', agent_id, 'n', n) order by n desc)
                from per_agent), '[]'::json)
         )
    into v_result;

  return v_result;
end;
$$;

comment on function public.bulk_assign_leads(uuid, jsonb, uuid, text) is
  'Assigne un lot de prospects en une transaction, avec les garde-fous de assign_lead. Voir plans/prospects-manager-console.md.';

grant execute on function public.bulk_assign_leads(uuid, jsonb, uuid, text) to authenticated;
