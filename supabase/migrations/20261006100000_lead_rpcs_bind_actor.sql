-- ============================================================
-- 20261006100000_lead_rpcs_bind_actor.sql
--
-- SÉCURITÉ — les RPC de prospects faisaient confiance à l'appelant.
--
-- Vérifié en production le 2026-10-05 : bulk_assign_leads, assign_lead,
-- unassign_lead, convert_lead_to_order, rpc_run_prospect_campaign et
-- rpc_transition_lead_status sont SECURITY DEFINER, exécutables par
-- `authenticated`, sans aucun contrôle de auth.uid(), du rôle ou du marché.
-- Elles écrivaient l'acteur et le marché envoyés par le client. N'importe
-- quel utilisateur connecté (agent, entrepôt, investisseur) pouvait réassigner
-- des prospects dans l'autre marché, forger l'historique, ou CRÉER DES
-- COMMANDES (convert_lead_to_order).
--
-- LE CORRECTIF
--   Quand auth.uid() n'est pas NULL (un utilisateur connecté) :
--     • l'acteur effectif est auth.uid() — un p_actor_id différent est refusé ;
--     • le type d'acteur écrit dans l'historique découle du rôle (agent →
--       'agent', sinon 'manager') : un agent ne signe plus « system » ;
--     • le rôle et le marché sont lus dans users (actif, non supprimé) :
--         assigner / désassigner / lancer une campagne → super_admin, ou
--           market_manager du marché visé ; chaque prospect et chaque agent
--           cible doit appartenir à ce marché ;
--         convertir / changer de statut → super_admin, market_manager du
--           marché du prospect, ou l'agent à qui il est assigné.
--   Quand auth.uid() est NULL (service role, cron, déclencheurs) : inchangé.
--   Refus : SQLSTATE 42501, message préfixé « lead_rpc: ».
--
-- CREATE OR REPLACE partout, signatures inchangées : les ACL sont
-- conservées (un DROP + CREATE les rouvrirait à PUBLIC). On ré-affirme quand
-- même le REVOKE de PUBLIC/anon.
--
-- AU PASSAGE
--   • bulk_assign_leads acceptait p_actor_type = 'super_admin' et l'écrivait
--     dans lead_history, dont le CHECK n'admet que system|agent|manager : la
--     répartition lancée par un super_admin échouait toujours (23514). Le
--     type d'historique est maintenant 'manager' pour un super_admin.
--   • transition_lead_status (l'ancienne version à enum) n'a plus aucun
--     appelant dans src/ : retirée à authenticated plutôt que réparée.
-- ============================================================

-- ------------------------------------------------------------
-- Le garde commun. Rend le rôle de l'appelant, ou NULL sans session.
--   p_actor_id  : l'acteur annoncé par l'appelant (peut être NULL)
--   p_market_id : le marché visé
--   p_assignee  : l'agent à qui le prospect est assigné (pour la règle agent)
--   p_allow_agent : TRUE si l'agent assigné a le droit d'agir
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_rpc_guard(
  p_actor_id    UUID,
  p_market_id   UUID,
  p_assignee    UUID    DEFAULT NULL,
  p_allow_agent BOOLEAN DEFAULT FALSE
) RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_role   TEXT;
  v_market UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;  -- service role / cron : comportement historique
  END IF;

  IF p_actor_id IS NOT NULL AND p_actor_id <> v_uid THEN
    RAISE EXCEPTION 'lead_rpc: actor_mismatch — p_actor_id must be the caller'
      USING ERRCODE = '42501';
  END IF;

  SELECT u.role, u.market_id INTO v_role, v_market
    FROM users u
   WHERE u.id = v_uid AND u.is_active AND u.deleted_at IS NULL;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'lead_rpc: caller is not an active user' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'super_admin' THEN
    RETURN v_role;
  END IF;

  IF v_role = 'market_manager' AND v_market = p_market_id THEN
    RETURN v_role;
  END IF;

  IF p_allow_agent AND v_role = 'agent' AND v_market = p_market_id
     AND p_assignee IS NOT DISTINCT FROM v_uid AND p_assignee IS NOT NULL THEN
    RETURN v_role;
  END IF;

  RAISE EXCEPTION 'lead_rpc: forbidden — % may not act on this market''s prospects', v_role
    USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lead_rpc_guard(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- assign_lead
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_lead(p_lead_id uuid, p_agent_id uuid, p_actor_id uuid, p_actor_type text DEFAULT 'manager'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_current_status lead_status;
  v_lead_id UUID;
  v_lead_market UUID;
  v_agent_market UUID;
  v_new_status lead_status;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
  v_role TEXT;
  v_actor_id UUID := p_actor_id;
  v_actor_type TEXT := p_actor_type;
BEGIN
  IF p_actor_type NOT IN ('system', 'agent', 'manager') THEN
    RAISE EXCEPTION 'invalid actor_type: %', p_actor_type;
  END IF;

  SELECT id, status, market_id INTO v_lead_id, v_current_status, v_lead_market
  FROM leads
  WHERE id = p_lead_id
  FOR UPDATE;

  IF v_lead_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found: %', p_lead_id;
  END IF;

  v_role := lead_rpc_guard(p_actor_id, v_lead_market);
  IF v_role IS NOT NULL THEN
    v_actor_id := auth.uid();
    v_actor_type := 'manager';
  END IF;

  IF v_current_status IN ('won', 'lost', 'archived') THEN
    RAISE EXCEPTION 'Cannot assign terminal lead (status=%)', v_current_status;
  END IF;

  SELECT market_id INTO v_agent_market
  FROM users
  WHERE id = p_agent_id
    AND role = 'agent'
    AND is_active = true;

  IF v_agent_market IS NULL THEN
    RAISE EXCEPTION 'Agent not found or inactive: %', p_agent_id;
  END IF;

  IF v_agent_market != v_lead_market THEN
    RAISE EXCEPTION 'Agent market does not match lead market';
  END IF;

  IF v_current_status = 'new' THEN
    v_new_status := 'assigned';
  ELSE
    v_new_status := v_current_status;
  END IF;

  UPDATE leads
  SET assigned_to = p_agent_id, status = v_new_status
  WHERE id = p_lead_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (
    p_lead_id, v_current_status, v_new_status, v_actor_id, v_actor_type,
    CASE WHEN v_current_status = 'new' THEN 'Assigned to agent' ELSE 'Reassigned to agent' END
  )
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'lead_id',     p_lead_id,
    'status',      v_new_status,
    'assigned_to', p_agent_id,
    'updated_at',  v_updated_at,
    'history_id',  v_history_id
  );
END;
$function$;

-- ------------------------------------------------------------
-- unassign_lead (même trou, même famille : appelée par /api/leads/[id]/assign)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unassign_lead(p_lead_id uuid, p_actor_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_current_status lead_status;
  v_lead_id UUID;
  v_lead_market UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
  v_actor_id UUID := p_actor_id;
BEGIN
  SELECT id, status, market_id INTO v_lead_id, v_current_status, v_lead_market
  FROM leads
  WHERE id = p_lead_id
  FOR UPDATE;

  IF v_lead_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found: %', p_lead_id;
  END IF;

  IF lead_rpc_guard(p_actor_id, v_lead_market) IS NOT NULL THEN
    v_actor_id := auth.uid();
  END IF;

  IF v_current_status IN ('won', 'lost', 'archived') THEN
    RAISE EXCEPTION 'Cannot unassign terminal lead (status=%)', v_current_status;
  END IF;

  UPDATE leads
  SET assigned_to = NULL
  WHERE id = p_lead_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_lead_id, v_current_status, v_current_status, v_actor_id, 'manager', 'Unassigned from agent')
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'lead_id',     p_lead_id,
    'status',      v_current_status,
    'assigned_to', NULL,
    'updated_at',  v_updated_at,
    'history_id',  v_history_id
  );
END;
$function$;

-- ------------------------------------------------------------
-- bulk_assign_leads
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_assign_leads(p_market_id uuid, p_assignments jsonb, p_actor_id uuid, p_actor_type text DEFAULT 'manager'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_requested int := 0;
  v_result    json;
  v_role      text;
  v_actor_id  uuid := p_actor_id;
  -- lead_history n'admet que system|agent|manager.
  v_hist_type text := case when p_actor_type = 'super_admin' then 'manager' else p_actor_type end;
begin
  if p_actor_type not in ('system', 'agent', 'manager', 'super_admin') then
    raise exception 'invalid actor_type: %', p_actor_type;
  end if;

  v_role := lead_rpc_guard(p_actor_id, p_market_id);
  if v_role is not null then
    v_actor_id  := auth.uid();
    v_hist_type := 'manager';
  end if;

  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'p_assignments must be a json array';
  end if;

  select count(*) into v_requested
  from jsonb_array_elements(p_assignments);

  if v_requested = 0 then
    return json_build_object('assigned', 0, 'skipped', 0, 'by_agent', '[]'::json);
  end if;

  -- Un appelant connecté n'assigne que dans SON marché : un prospect ou un
  -- agent d'un autre marché dans le plan est un refus franc, pas un « ignoré ».
  if v_role is not null and exists (
    select 1
      from jsonb_to_recordset(p_assignments) as x(lead_id uuid, agent_id uuid)
      left join leads l on l.id = x.lead_id
      left join users u on u.id = x.agent_id
     where (x.lead_id is not null and l.market_id is distinct from p_market_id)
        or (x.agent_id is not null and u.market_id is distinct from p_market_id)
  ) then
    raise exception 'lead_rpc: forbidden — every lead and every agent must belong to the market'
      using errcode = '42501';
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
    select e.lead_id, e.status_from, e.status_to, v_actor_id, v_hist_type,
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
$function$;

-- ------------------------------------------------------------
-- convert_lead_to_order
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_lead_to_order(p_lead_id uuid, p_actor_id uuid, p_product_id uuid, p_product_name text, p_variant_label text, p_quantity integer, p_unit_price numeric, p_total_price numeric, p_customer_name text, p_customer_phone text, p_customer_address text, p_customer_city text, p_customer_note text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_lead            leads%ROWTYPE;
  v_new_order_id    UUID;
  v_order_updated   TIMESTAMPTZ;
  v_lead_updated    TIMESTAMPTZ;
  v_lead_history_id UUID;
  v_order_history_id UUID;
  v_storefront_id   UUID;
  v_external_id     TEXT;
  v_actor_id        UUID := p_actor_id;
  v_actor_type      TEXT := 'agent';
  v_role            TEXT;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive';
  END IF;
  IF p_total_price IS NULL OR p_total_price < 0 THEN
    RAISE EXCEPTION 'total_price must be non-negative';
  END IF;

  -- Lock lead
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id FOR UPDATE;

  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'Lead not found: %', p_lead_id;
  END IF;

  v_role := lead_rpc_guard(p_actor_id, v_lead.market_id, v_lead.assigned_to, TRUE);
  IF v_role IS NOT NULL THEN
    v_actor_id := auth.uid();
    v_actor_type := CASE WHEN v_role = 'agent' THEN 'agent' ELSE 'manager' END;
  END IF;

  IF v_lead.status <> 'qualified' THEN
    RAISE EXCEPTION 'lead must be in status qualified to convert (current=%)', v_lead.status;
  END IF;

  IF v_lead.converted_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'lead already converted (order_id=%)', v_lead.converted_order_id;
  END IF;

  -- Find any active storefront in the lead's market to satisfy orders FK.
  -- If none exists, fail loudly — market must have at least one storefront seeded.
  SELECT id INTO v_storefront_id
  FROM storefronts
  WHERE market_id = v_lead.market_id AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_storefront_id IS NULL THEN
    RAISE EXCEPTION 'no active storefront in market % — cannot attribute converted order', v_lead.market_id;
  END IF;

  v_external_id := 'lead:' || p_lead_id::text;

  -- Create order at status=confirmed, assigned to same agent as lead
  INSERT INTO orders (
    market_id, storefront_id, external_id, external_platform,
    status,
    customer_name, customer_phone, customer_address, customer_city, customer_note,
    product_id, product_name, variant_label, quantity, unit_price, total_price,
    assigned_to,
    raw_payload
  )
  VALUES (
    v_lead.market_id, v_storefront_id, v_external_id, 'lead_conversion',
    'confirmed',
    p_customer_name, p_customer_phone, p_customer_address, p_customer_city, p_customer_note,
    p_product_id, p_product_name, p_variant_label, p_quantity, p_unit_price, p_total_price,
    v_lead.assigned_to,
    jsonb_build_object('lead_id', p_lead_id, 'source', v_lead.source)
  )
  RETURNING id, updated_at INTO v_new_order_id, v_order_updated;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (v_new_order_id, NULL, 'confirmed', v_actor_id, v_actor_type, 'Created from lead conversion')
  RETURNING id INTO v_order_history_id;

  -- Transition lead → won, set converted_order_id
  UPDATE leads
  SET status = 'won', converted_order_id = v_new_order_id
  WHERE id = p_lead_id
  RETURNING updated_at INTO v_lead_updated;

  INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_lead_id, 'qualified', 'won', v_actor_id, v_actor_type, 'Converted to order ' || v_new_order_id::text)
  RETURNING id INTO v_lead_history_id;

  RETURN json_build_object(
    'lead_id',          p_lead_id,
    'order_id',         v_new_order_id,
    'lead_status',      'won',
    'order_status',     'confirmed',
    'lead_updated_at',  v_lead_updated,
    'order_updated_at', v_order_updated,
    'lead_history_id',  v_lead_history_id,
    'order_history_id', v_order_history_id
  );
END;
$function$;

-- ------------------------------------------------------------
-- rpc_run_prospect_campaign
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_run_prospect_campaign(p_campaign_id uuid, p_actor_id uuid, p_actor_type text DEFAULT 'manager'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_campaign     prospect_campaigns%ROWTYPE;
  v_initial_key  text;
  v_inserted     int := 0;
  v_matched      int := 0;
begin
  if p_actor_type not in ('system', 'agent', 'manager', 'super_admin') then
    raise exception 'invalid actor_type: %', p_actor_type;
  end if;

  select * into v_campaign from prospect_campaigns where id = p_campaign_id;
  if v_campaign.id is null then
    raise exception 'Campaign not found: %', p_campaign_id;
  end if;

  perform lead_rpc_guard(p_actor_id, v_campaign.market_id);

  select key into v_initial_key
  from status_configs
  where market_id = v_campaign.market_id
    and scope = 'prospect'
    and is_initial = true;
  if v_initial_key is null then
    raise exception 'No initial prospect status configured for market %', v_campaign.market_id;
  end if;

  -- La même audience que celle affichée, recalculée au moment de l'exécution :
  -- entre l'aperçu et la validation, un client a pu commander ou un agent a pu
  -- ouvrir une fiche, et il ne doit pas être appelé pour autant.
  with audience as (
    select * from public.campaign_audience_rows(v_campaign.market_id, v_campaign.filter_json)
    where excluded_by is null
  ),
  inserted as (
    insert into leads (
      market_id, source, status_key, customer_name, customer_phone,
      customer_city, customer_address, campaign_id, source_order_id, raw_payload
    )
    select
      v_campaign.market_id, 'campaign'::lead_source, v_initial_key,
      coalesce(a.customer_name, 'Client'), a.customer_phone,
      a.customer_city, a.customer_address,
      p_campaign_id, a.source_order_id,
      jsonb_build_object(
        'campaign_id',     p_campaign_id,
        'campaign_name',   v_campaign.name,
        'source_order_id', a.source_order_id,
        'channel',         v_campaign.channel,
        'spawned_at',      now()
      )
    from audience a
    on conflict (campaign_id, source_order_id)
      where campaign_id is not null and source_order_id is not null
    do nothing
    returning id
  )
  select (select count(*) from audience), (select count(*) from inserted)
    into v_matched, v_inserted;

  return json_build_object(
    'campaign_id', p_campaign_id,
    'inserted',    v_inserted,
    'skipped',     v_matched - v_inserted
  );
end;
$function$;

-- ------------------------------------------------------------
-- rpc_transition_lead_status
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_transition_lead_status(p_lead_id uuid, p_new_status_key text, p_actor_id uuid DEFAULT NULL::uuid, p_actor_type text DEFAULT 'system'::text, p_note text DEFAULT NULL::text, p_lost_reason lead_lost_reason DEFAULT NULL::lead_lost_reason, p_lost_note text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lead             leads%ROWTYPE;
  v_current_config   status_configs%ROWTYPE;
  v_target_config    status_configs%ROWTYPE;
  v_history_id       UUID;
  v_updated_at       TIMESTAMPTZ;
  v_role             TEXT;
  v_actor_id         UUID := p_actor_id;
  v_actor_type       TEXT := p_actor_type;
BEGIN
  IF p_actor_type NOT IN ('system', 'agent', 'manager') THEN
    RAISE EXCEPTION 'invalid actor_type: %', p_actor_type;
  END IF;

  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'Lead not found: %', p_lead_id;
  END IF;

  v_role := lead_rpc_guard(p_actor_id, v_lead.market_id, v_lead.assigned_to, TRUE);
  IF v_role IS NOT NULL THEN
    v_actor_id := auth.uid();
    v_actor_type := CASE WHEN v_role = 'agent' THEN 'agent' ELSE 'manager' END;
  END IF;

  SELECT * INTO v_current_config
  FROM status_configs
  WHERE market_id = v_lead.market_id AND scope = 'prospect' AND key = v_lead.status_key;
  IF v_current_config.id IS NULL THEN
    RAISE EXCEPTION 'No status config found for market=% scope=prospect key=%',
      v_lead.market_id, v_lead.status_key;
  END IF;

  SELECT * INTO v_target_config
  FROM status_configs
  WHERE market_id = v_lead.market_id AND scope = 'prospect' AND key = p_new_status_key;
  IF v_target_config.id IS NULL THEN
    RAISE EXCEPTION 'Unknown prospect status key for market: %', p_new_status_key;
  END IF;

  IF p_new_status_key = 'won' THEN
    RAISE EXCEPTION 'cannot transition to won via rpc_transition_lead_status; use convert_lead_to_order';
  END IF;

  IF NOT (v_current_config.allowed_transitions ? p_new_status_key) THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_lead.status_key, p_new_status_key;
  END IF;

  IF p_new_status_key = 'lost' AND p_lost_reason IS NULL THEN
    RAISE EXCEPTION 'lost_reason is required when transitioning to lost';
  END IF;
  IF p_lost_reason = 'autre' AND (p_lost_note IS NULL OR length(trim(p_lost_note)) = 0) THEN
    RAISE EXCEPTION 'lost_note is required when lost_reason is autre';
  END IF;

  UPDATE leads
  SET
    status_key  = p_new_status_key,
    lost_reason = CASE WHEN p_new_status_key = 'lost' THEN p_lost_reason ELSE lost_reason END,
    lost_note   = CASE WHEN p_new_status_key = 'lost' THEN p_lost_note   ELSE lost_note   END
  WHERE id = p_lead_id
  RETURNING updated_at INTO v_updated_at;

  INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (
    p_lead_id,
    v_lead.status_key::lead_status,
    p_new_status_key::lead_status,
    v_actor_id,
    v_actor_type,
    p_note
  )
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'lead_id',    p_lead_id,
    'status_key', p_new_status_key,
    'updated_at', v_updated_at,
    'history_id', v_history_id
  );
END;
$function$;

-- ------------------------------------------------------------
-- Privilèges. CREATE OR REPLACE garde l'ACL ; on la ré-affirme.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.assign_lead(uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unassign_lead(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bulk_assign_leads(uuid, jsonb, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.convert_lead_to_order(uuid, uuid, uuid, text, text, integer, numeric, numeric, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_run_prospect_campaign(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_transition_lead_status(uuid, text, uuid, text, text, lead_lost_reason, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.assign_lead(uuid, uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unassign_lead(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_assign_leads(uuid, jsonb, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_order(uuid, uuid, uuid, text, text, integer, numeric, numeric, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_run_prospect_campaign(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_transition_lead_status(uuid, text, uuid, text, text, lead_lost_reason, text) TO authenticated, service_role;

-- L'ancienne transition à enum : plus aucun appelant, et le même trou.
REVOKE EXECUTE ON FUNCTION public.transition_lead_status(uuid, lead_status, uuid, text, text, lead_lost_reason, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_lead_status(uuid, lead_status, uuid, text, text, lead_lost_reason, text) TO service_role;
