-- ============================================================
-- Prospects → récupérer les ventes perdues — SQL à coller en production.
-- Généré depuis supabase/migrations/20261006100000…100500 (ne pas éditer à la main :
-- corriger la migration puis régénérer).
--
-- Quatre blocs, dans l'ordre, chacun enregistré dans schema_migrations :
--   1. sécurité des RPC de prospects (transaction) ;
--   2. deux valeurs d'enum lead_source — HORS transaction : une valeur ajoutée
--      ne peut pas être utilisée avant d'être validée ;
--   3. moteur (réglages, win-back, tick, répartition, cron), bureau, audience v2
--      (transaction) ;
--   4. écriture des Règles par le manager (transaction).
-- Rejouable : CREATE OR REPLACE, IF NOT EXISTS, unschedule avant schedule,
-- ON CONFLICT DO NOTHING sur schema_migrations.
-- ============================================================

BEGIN;

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

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261006100000', 'lead_rpcs_bind_actor') ON CONFLICT (version) DO NOTHING;



COMMIT;


-- ============================================================
-- 20261006100100_lead_source_recovery_values.sql
--
-- Deux nouvelles sources de prospects, créées par prospects_daily_tick :
--   rejected_order — un refus « rattrapable », N jours après le rejet ;
--   repeat_buyer   — un ancien client, N jours après sa livraison.
-- Seules dans leur fichier : une valeur d'enum ajoutée ne peut pas être
-- UTILISÉE dans la transaction qui l'ajoute.
-- ============================================================

ALTER TYPE public.lead_source ADD VALUE IF NOT EXISTS 'rejected_order';
ALTER TYPE public.lead_source ADD VALUE IF NOT EXISTS 'repeat_buyer';

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261006100100', 'lead_source_recovery_values') ON CONFLICT (version) DO NOTHING;



BEGIN;


-- ============================================================
-- 20261006100200_prospect_recovery_engine.sql
--
-- Prospects → récupérer les ventes perdues (plans/prospects-recovery.md, phase 2).
--
-- Ordra crée les prospects lui-même et les répartit :
--   • prospect_recovery_settings(market)  — les règles du marché, défauts fusionnés ;
--   • leads_create_winback                — déplacé sur le chemin du RETOUR
--     (returning / to_be_returned / returned, le premier atteint) : en Libye, aucun
--     colis n'atteint plus `returned` depuis le 2026-09-14, le win-back ne partait jamais ;
--   • prospects_daily_tick(market)        — crée les refus rattrapables et les anciens
--     clients, ferme ce qui doit l'être, rend au pool ce qui dort, remplit les dossiers ;
--   • prospects_distribute_now(market)    — « Répartir maintenant », pour le manager ;
--   • prospect_tick_log                   — une ligne par marché et par jour local ;
--   • pg_cron 'prospects-daily-tick-hourly' à :37, qui n'agit qu'à l'heure locale réglée.
--
-- RÉGLAGES — clé `prospect_recovery` par marché, lue par setting_scalar comme
-- toutes les autres (nue ou enveloppée { value }, cf. 20261003120000). Forme :
--   { enabled, rej:{on,delay_days,subreasons[]}, ret:{on}, old:{on,after_days},
--     dist:{hour,file_cap,release_days,max_tries} }
-- Contrat TypeScript : src/lib/prospects/desk/types.ts (RecoverySettings).
--
-- DATES — un rejet et une livraison se datent par order_history (status_to,
-- created_at), jamais par orders.updated_at (touché en masse).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Réglages
-- ------------------------------------------------------------
-- Lecture interne, sans garde : les déclencheurs et le cron l'appellent sous
-- n'importe quelle identité (agent qui rejette, synchro Darb…).
CREATE OR REPLACE FUNCTION public._prospect_recovery_settings(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  d      JSONB;
  o      JSONB;
  v_raw  JSONB;
BEGIN
  SELECT code INTO v_code FROM markets WHERE id = p_market_id;

  d := jsonb_build_object(
    'enabled', coalesce(v_code = 'ly', false),
    'rej', jsonb_build_object(
      'on', true,
      'delay_days', 3,
      'subreasons', jsonb_build_array('pas_de_reponse', 'raccroche', 'numero_hors_service',
                                      'changement_avis', 'prix_eleve', 'produit_non_voulu')),
    'ret', jsonb_build_object('on', true),
    'old', jsonb_build_object('on', true, 'after_days', 30),
    'dist', jsonb_build_object('hour', 9, 'file_cap', 15, 'release_days', 3, 'max_tries', 3)
  );

  SELECT s.value INTO v_raw
    FROM settings s
   WHERE s.market_id = p_market_id AND s.key = 'prospect_recovery';

  IF v_raw IS NULL THEN
    RETURN d;
  END IF;

  -- Nue ou enveloppée : setting_scalar rend le texte de l'objet dans les deux cas.
  BEGIN
    o := setting_scalar(v_raw)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    o := NULL;
  END;
  IF o IS NULL OR jsonb_typeof(o) <> 'object' THEN
    RETURN d;
  END IF;

  RETURN jsonb_build_object(
    'enabled', CASE WHEN jsonb_typeof(o -> 'enabled') = 'boolean'
                    THEN (o ->> 'enabled')::boolean ELSE (d ->> 'enabled')::boolean END,
    'rej',  (d -> 'rej')  || CASE WHEN jsonb_typeof(o -> 'rej')  = 'object' THEN o -> 'rej'  ELSE '{}'::jsonb END,
    'ret',  (d -> 'ret')  || CASE WHEN jsonb_typeof(o -> 'ret')  = 'object' THEN o -> 'ret'  ELSE '{}'::jsonb END,
    'old',  (d -> 'old')  || CASE WHEN jsonb_typeof(o -> 'old')  = 'object' THEN o -> 'old'  ELSE '{}'::jsonb END,
    'dist', (d -> 'dist') || CASE WHEN jsonb_typeof(o -> 'dist') = 'object' THEN o -> 'dist' ELSE '{}'::jsonb END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._prospect_recovery_settings(UUID) FROM PUBLIC, anon, authenticated;

-- Lecture publique : super_admin ou market_manager du marché (les agents n'en
-- ont pas l'usage). Sans session (service role) : permis.
CREATE OR REPLACE FUNCTION public.prospect_recovery_settings(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM lead_rpc_guard(NULL, p_market_id);
  RETURN _prospect_recovery_settings(p_market_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prospect_recovery_settings(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospect_recovery_settings(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. Journal du tick
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospect_tick_log (
  market_id UUID        NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  ran_on    DATE        NOT NULL,
  ran_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  result    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (market_id, ran_on)
);

ALTER TABLE public.prospect_tick_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prospect_tick_log_select ON public.prospect_tick_log;
CREATE POLICY prospect_tick_log_select ON public.prospect_tick_log
  FOR SELECT TO authenticated
  USING (
    (SELECT get_user_role()) = 'super_admin'
    OR ((SELECT get_user_role()) = 'market_manager' AND market_id = (SELECT get_user_market_id()))
  );

REVOKE ALL ON public.prospect_tick_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.prospect_tick_log TO authenticated;
GRANT ALL ON public.prospect_tick_log TO service_role;

-- ------------------------------------------------------------
-- 3. Win-back sur le chemin du retour
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leads_create_winback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_reason   text;
  v_disabled boolean;
  v_settings jsonb;
  v_agent    uuid;
begin
  -- Le moment d'ENTRER sur le chemin du retour, quel que soit le premier pas :
  -- returning / to_be_returned (Libye, Darb) ou returned (Tunisie). Un colis
  -- qui avance de returning à to_be_returned ne crée pas un second prospect.
  if new.status::text not in ('returning', 'to_be_returned', 'returned')
     or old.status::text in ('returning', 'to_be_returned', 'returned') then
    return new;
  end if;

  -- Un prospect n'arrête jamais une mise à jour de commande (synchro Darb,
  -- scan de retour) : toute erreur ici devient un avertissement.
  begin
    -- L'ancien interrupteur reste honoré.
    select coalesce(public.setting_scalar(s.value)::boolean, false)
      into v_disabled
      from public.settings s
     where s.market_id = new.market_id
       and s.key = 'lead_winback_disabled'
     limit 1;

    if coalesce(v_disabled, false) then
      return new;
    end if;

    v_settings := public._prospect_recovery_settings(new.market_id);
    if not coalesce((v_settings ->> 'enabled')::boolean, false)
       or not coalesce((v_settings -> 'ret' ->> 'on')::boolean, false) then
      return new;
    end if;

    -- Une seule fois par colis.
    if exists (select 1 from public.leads l
                where l.source_order_id = new.id and l.source = 'winback'::public.lead_source) then
      return new;
    end if;

    -- La dernière remarque du livreur qui dit quelque chose ; à défaut, le
    -- libellé de l'événement.
    select coalesce(nullif(btrim(e.remarks), ''), e.description_ar, e.description_en)
      into v_reason
      from public.darb_timeline_events e
     where e.order_id = new.id
       and coalesce(nullif(btrim(e.remarks), ''), e.description_ar, e.description_en) is not null
     order by e.occurred_at desc nulls last
     limit 1;

    -- À l'agent qui a confirmé la commande, s'il est encore un agent actif.
    select u.id into v_agent
      from public.users u
     where u.id = new.assigned_to
       and u.role = 'agent'
       and u.is_active
       and u.deleted_at is null
       and u.market_id = new.market_id;

    insert into public.leads (
      market_id, source, source_order_id, status,
      customer_name, customer_phone, customer_city, customer_address,
      product_interest_id, assigned_to, return_reason, notes
    ) values (
      new.market_id, 'winback'::public.lead_source, new.id,
      case when v_agent is null then 'new'::public.lead_status else 'assigned'::public.lead_status end,
      coalesce(new.customer_name, 'Client'), new.customer_phone, new.customer_city, new.customer_address,
      new.product_id, v_agent, v_reason, null
    );
  exception when others then
    raise warning 'leads_create_winback: order % skipped (%: %)', new.id, sqlstate, sqlerrm;
  end;

  return new;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.leads_create_winback() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_create_winback ON public.orders;
CREATE TRIGGER trg_orders_create_winback
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.leads_create_winback();

-- ------------------------------------------------------------
-- 4. Répartition (étape f, partagée par le tick et « Répartir maintenant »)
-- ------------------------------------------------------------
-- p_avoid : { lead_id: agent_id } — un prospect que le tick vient de reprendre
-- à un agent ne lui est pas rendu dans la même passe.
CREATE OR REPLACE FUNCTION public._prospects_distribute(p_market_id UUID, p_avoid JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s          JSONB := _prospect_recovery_settings(p_market_id);
  v_cap        INT;
  v_has_shares BOOLEAN;
  v_ids        UUID[];
  v_rooms      INT[];
  v_total      INT;
  v_assigned   INT := 0;
  v_pool_left  INT;
  v_idx        INT;
  v_best       INT;
  v_avoid      UUID;
  r            RECORD;
  i            INT;
BEGIN
  v_cap := greatest(coalesce((v_s -> 'dist' ->> 'file_cap')::int, 15), 0);

  -- Une seule répartition à la fois par marché (le tick et le bouton).
  PERFORM pg_advisory_xact_lock(hashtext('prospects_distribute'), hashtext(p_market_id::text));

  SELECT EXISTS (SELECT 1 FROM agent_distribution_shares WHERE market_id = p_market_id)
    INTO v_has_shares;

  -- « Disponible » = agent actif avec une part dans la distribution des commandes
  -- (personne n'utilise l'interrupteur Disponible en Libye) ; si le marché n'a
  -- aucune part, tous les agents actifs.
  SELECT coalesce(array_agg(a.id ORDER BY a.id), '{}'),
         coalesce(array_agg(a.room ORDER BY a.id), '{}')
    INTO v_ids, v_rooms
    FROM (
      SELECT u.id,
             greatest(v_cap - (SELECT count(*)::int FROM leads l
                                WHERE l.assigned_to = u.id
                                  AND l.market_id = p_market_id
                                  AND l.status NOT IN ('won', 'lost', 'archived')
                                  AND l.converted_order_id IS NULL), 0) AS room
        FROM users u
       WHERE u.role = 'agent' AND u.is_active AND u.deleted_at IS NULL
         AND u.market_id = p_market_id
         AND (NOT v_has_shares OR EXISTS (
               SELECT 1 FROM agent_distribution_shares s
                WHERE s.market_id = p_market_id AND s.agent_id = u.id AND s.share_pct > 0))
    ) a;

  v_total := coalesce((SELECT sum(x) FROM unnest(v_rooms) x), 0);

  IF v_total > 0 THEN
    FOR r IN
      SELECT l.id, l.status, o.assigned_to AS src_agent
        FROM leads l
        LEFT JOIN orders o ON o.id = l.source_order_id
        LEFT JOIN prospect_campaigns c ON c.id = l.campaign_id
       WHERE l.market_id = p_market_id
         AND l.assigned_to IS NULL
         AND l.status NOT IN ('won', 'lost', 'archived')
         AND l.converted_order_id IS NULL
         -- Une liste WhatsApp envoyée par l'API n'est pas un dossier d'appels.
         AND NOT (coalesce(c.channel, 'call') = 'wa' AND coalesce(c.wa_sender, 'agent') = 'api')
       ORDER BY
         CASE
           WHEN l.source = 'winback' THEN 0
           WHEN l.source = 'rejected_order' THEN 1
           WHEN l.status = 'callback_scheduled' AND l.callback_scheduled_at <= now() THEN 2
           WHEN l.source = 'repeat_buyer' THEN 3
           ELSE 4
         END,
         l.created_at, l.id
       FOR UPDATE OF l SKIP LOCKED
    LOOP
      EXIT WHEN v_total <= 0;
      v_avoid := nullif(p_avoid ->> r.id::text, '')::uuid;

      -- L'agent de la commande d'origine d'abord, s'il a de la place.
      v_idx := NULL;
      IF r.src_agent IS NOT NULL AND r.src_agent IS DISTINCT FROM v_avoid THEN
        v_idx := array_position(v_ids, r.src_agent);
        IF v_idx IS NOT NULL AND v_rooms[v_idx] <= 0 THEN
          v_idx := NULL;
        END IF;
      END IF;

      -- Sinon celui qui a le plus de place (égalité : le plus petit id).
      IF v_idx IS NULL THEN
        v_best := 0;
        FOR i IN 1 .. coalesce(array_length(v_ids, 1), 0) LOOP
          IF v_rooms[i] > v_best AND v_ids[i] IS DISTINCT FROM v_avoid THEN
            v_best := v_rooms[i];
            v_idx := i;
          END IF;
        END LOOP;
      END IF;

      CONTINUE WHEN v_idx IS NULL;

      UPDATE leads
         SET assigned_to = v_ids[v_idx],
             status = CASE WHEN r.status = 'new' THEN 'assigned'::lead_status ELSE r.status END
       WHERE id = r.id;

      -- Même convention que bulk_assign_leads.
      INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
      VALUES (r.id, r.status,
              CASE WHEN r.status = 'new' THEN 'assigned'::lead_status ELSE r.status END,
              NULL, 'system', 'Assigned to agent');

      v_rooms[v_idx] := v_rooms[v_idx] - 1;
      v_total := v_total - 1;
      v_assigned := v_assigned + 1;
    END LOOP;
  END IF;

  SELECT count(*)::int INTO v_pool_left
    FROM leads l
    LEFT JOIN prospect_campaigns c ON c.id = l.campaign_id
   WHERE l.market_id = p_market_id
     AND l.assigned_to IS NULL
     AND l.status NOT IN ('won', 'lost', 'archived')
     AND l.converted_order_id IS NULL
     AND NOT (coalesce(c.channel, 'call') = 'wa' AND coalesce(c.wa_sender, 'agent') = 'api');

  RETURN jsonb_build_object('assigned', v_assigned, 'pool_left', v_pool_left);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._prospects_distribute(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Le tick quotidien
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospects_daily_tick(p_market_id UUID, p_force BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s           JSONB := _prospect_recovery_settings(p_market_id);
  v_tz          TEXT  := coalesce(market_tz(p_market_id), 'UTC');
  v_today       DATE  := (now() AT TIME ZONE v_tz)::date;
  v_hour        INT   := extract(hour FROM now() AT TIME ZONE v_tz)::int;
  v_delay       INT;
  v_after       INT;
  v_release     INT;
  v_tries       INT;
  v_subs        TEXT[];
  v_attempts    lead_status[];
  v_avoid       JSONB := '{}'::jsonb;
  v_dist        JSONB;
  v_created_rej INT := 0;
  v_created_old INT := 0;
  v_closed_re   INT := 0;
  v_closed_un   INT := 0;
  v_released    INT := 0;
  v_result      JSONB;
BEGIN
  v_result := jsonb_build_object('created_rej', 0, 'created_old', 0, 'closed_reordered', 0,
                                 'closed_unreachable', 0, 'released', 0, 'assigned', 0,
                                 'skipped_reason', NULL);

  IF NOT coalesce((v_s ->> 'enabled')::boolean, false) THEN
    RETURN v_result || jsonb_build_object('skipped_reason', 'disabled');
  END IF;

  IF NOT p_force AND v_hour <> coalesce((v_s -> 'dist' ->> 'hour')::int, 9) THEN
    RETURN v_result || jsonb_build_object('skipped_reason', 'not_hour');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('prospects_daily_tick'), hashtext(p_market_id::text));

  IF NOT p_force AND EXISTS (SELECT 1 FROM prospect_tick_log
                              WHERE market_id = p_market_id AND ran_on = v_today) THEN
    RETURN v_result || jsonb_build_object('skipped_reason', 'already_ran');
  END IF;

  v_delay   := greatest(coalesce((v_s -> 'rej'  ->> 'delay_days')::int, 3), 0);
  v_after   := greatest(coalesce((v_s -> 'old'  ->> 'after_days')::int, 30), 1);
  v_release := greatest(coalesce((v_s -> 'dist' ->> 'release_days')::int, 3), 1);
  v_tries   := least(greatest(coalesce((v_s -> 'dist' ->> 'max_tries')::int, 3), 1), 3);
  SELECT coalesce(array_agg(x), '{}') INTO v_subs
    FROM jsonb_array_elements_text(coalesce(v_s -> 'rej' -> 'subreasons', '[]'::jsonb)) x;
  SELECT array_agg(('attempt_' || n)::lead_status) INTO v_attempts
    FROM generate_series(v_tries, 3) n;

  -- a. Refus rattrapables : rejetés il y a [delay, delay+7] jours, pour un
  --    sous-motif de la liste.
  IF coalesce((v_s -> 'rej' ->> 'on')::boolean, false) AND cardinality(v_subs) > 0 THEN
    WITH h AS (
      SELECT oh.order_id, max(oh.created_at) AS rejected_at
        FROM order_history oh
       WHERE oh.status_to = 'rejected'
         AND oh.created_at >= now() - make_interval(days => v_delay + 7)
       GROUP BY oh.order_id
    ),
    due AS (
      SELECT o.id, o.customer_name, o.customer_phone, o.customer_city, o.customer_address,
             o.product_id, o.rejection_subreason, o.customer_id, h.rejected_at,
             normalize_phone(o.customer_phone) AS ph
        FROM h
        JOIN orders o ON o.id = h.order_id
       WHERE o.market_id = p_market_id
         AND o.status = 'rejected'
         AND o.rejection_subreason = ANY (v_subs)
         AND h.rejected_at < now() - make_interval(days => v_delay)
         AND normalize_phone(o.customer_phone) <> ''
    ),
    kept AS (
      SELECT DISTINCT ON (d.ph) d.*
        FROM due d
       WHERE NOT EXISTS (SELECT 1 FROM orders o2
                          WHERE o2.market_id = p_market_id
                            AND normalize_phone(o2.customer_phone) = d.ph
                            AND o2.created_at > d.rejected_at)
         AND NOT EXISTS (SELECT 1 FROM leads l
                          WHERE l.market_id = p_market_id
                            AND normalize_phone(l.customer_phone) = d.ph
                            AND l.status NOT IN ('won', 'lost', 'archived'))
         AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.source_order_id = d.id)
         AND NOT EXISTS (SELECT 1 FROM customers c
                          WHERE c.market_id = p_market_id
                            AND (c.id = d.customer_id OR c.phone_normalized = d.ph)
                            AND c.risk_class = 'risk')
       ORDER BY d.ph, d.rejected_at DESC
    ),
    ins AS (
      INSERT INTO leads (market_id, source, status, customer_name, customer_phone,
                         customer_city, customer_address, product_interest_id,
                         source_order_id, return_reason, raw_payload)
      SELECT p_market_id, 'rejected_order'::lead_source, 'new'::lead_status,
             coalesce(nullif(btrim(k.customer_name), ''), 'Client'), k.customer_phone,
             k.customer_city, k.customer_address, k.product_id,
             k.id, k.rejection_subreason,
             jsonb_build_object('origin', 'prospects_daily_tick', 'rejected_at', k.rejected_at)
        FROM kept k
      RETURNING 1
    )
    SELECT count(*)::int INTO v_created_rej FROM ins;
  END IF;

  -- b. Anciens clients : dernière livraison il y a [after, after+7] jours,
  --    rien commandé depuis, pas de relance « re-achat » en 90 jours.
  IF coalesce((v_s -> 'old' ->> 'on')::boolean, false) THEN
    WITH h AS (
      SELECT oh.order_id, max(oh.created_at) AS delivered_at
        FROM order_history oh
       WHERE oh.status_to = 'delivered'
         AND oh.created_at >= now() - make_interval(days => v_after + 7)
       GROUP BY oh.order_id
    ),
    due AS (
      SELECT o.id, o.created_at, o.customer_name, o.customer_phone, o.customer_city,
             o.customer_address, o.product_id, o.customer_id, h.delivered_at,
             normalize_phone(o.customer_phone) AS ph
        FROM h
        JOIN orders o ON o.id = h.order_id
       WHERE o.market_id = p_market_id
         AND o.status = 'delivered'
         AND h.delivered_at < now() - make_interval(days => v_after)
         AND normalize_phone(o.customer_phone) <> ''
    ),
    kept AS (
      SELECT DISTINCT ON (d.ph) d.*
        FROM due d
       WHERE NOT EXISTS (
               -- Rien de plus récent : ni commande passée après, ni autre
               -- commande livrée après celle-ci.
               SELECT 1 FROM orders o2
                WHERE o2.market_id = p_market_id
                  AND normalize_phone(o2.customer_phone) = d.ph
                  AND o2.id <> d.id
                  AND (o2.created_at > d.created_at
                       OR EXISTS (SELECT 1 FROM order_history h2
                                   WHERE h2.order_id = o2.id
                                     AND h2.status_to = 'delivered'
                                     AND h2.created_at > d.delivered_at)))
         AND NOT EXISTS (SELECT 1 FROM leads l
                          WHERE l.market_id = p_market_id
                            AND normalize_phone(l.customer_phone) = d.ph
                            AND l.source = 'repeat_buyer'
                            AND l.created_at > now() - interval '90 days')
         AND NOT EXISTS (SELECT 1 FROM leads l
                          WHERE l.market_id = p_market_id
                            AND normalize_phone(l.customer_phone) = d.ph
                            AND l.status NOT IN ('won', 'lost', 'archived'))
         AND NOT EXISTS (SELECT 1 FROM customers c
                          WHERE c.market_id = p_market_id
                            AND (c.id = d.customer_id OR c.phone_normalized = d.ph)
                            AND c.risk_class = 'risk')
       ORDER BY d.ph, d.delivered_at DESC
    ),
    ins AS (
      INSERT INTO leads (market_id, source, status, customer_name, customer_phone,
                         customer_city, customer_address, product_interest_id,
                         source_order_id, raw_payload)
      SELECT p_market_id, 'repeat_buyer'::lead_source, 'new'::lead_status,
             coalesce(nullif(btrim(k.customer_name), ''), 'Client'), k.customer_phone,
             k.customer_city, k.customer_address, k.product_id, k.id,
             jsonb_build_object('origin', 'prospects_daily_tick', 'delivered_at', k.delivered_at)
        FROM kept k
      RETURNING 1
    )
    SELECT count(*)::int INTO v_created_old FROM ins;
  END IF;

  -- c. Le client a recommandé seul : on ne l'appelle pas.
  WITH victims AS (
    SELECT l.id, l.status
      FROM leads l
     WHERE l.market_id = p_market_id
       AND l.status NOT IN ('won', 'lost', 'archived')
       AND l.converted_order_id IS NULL
       AND normalize_phone(l.customer_phone) <> ''
       AND EXISTS (SELECT 1 FROM orders o
                    WHERE o.market_id = p_market_id
                      AND normalize_phone(o.customer_phone) = normalize_phone(l.customer_phone)
                      AND o.created_at > l.created_at)
     FOR UPDATE OF l
  ),
  upd AS (
    UPDATE leads l
       SET status = 'lost', lost_reason = 'autre', lost_note = 'a recommandé seul'
      FROM victims v
     WHERE l.id = v.id
    RETURNING l.id
  ),
  logged AS (
    INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
    SELECT v.id, v.status, 'lost', NULL, 'system', 'a recommandé seul'
      FROM victims v
    RETURNING 1
  )
  SELECT count(*)::int INTO v_closed_re FROM upd;

  -- d. Injoignable : max_tries tentatives, rien depuis un jour.
  WITH victims AS (
    SELECT l.id, l.status
      FROM leads l
     WHERE l.market_id = p_market_id
       AND l.status = ANY (v_attempts)
       AND l.converted_order_id IS NULL
       AND coalesce((SELECT max(h.created_at) FROM lead_history h WHERE h.lead_id = l.id),
                    l.updated_at) < now() - interval '1 day'
     FOR UPDATE OF l
  ),
  upd AS (
    UPDATE leads l
       SET status = 'lost', lost_reason = 'unreachable', lost_note = NULL
      FROM victims v
     WHERE l.id = v.id
    RETURNING l.id
  ),
  logged AS (
    INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
    SELECT v.id, v.status, 'lost', NULL, 'system', 'Injoignable après ' || v_tries || ' tentatives'
      FROM victims v
    RETURNING 1
  )
  SELECT count(*)::int INTO v_closed_un FROM upd;

  -- e. Intouché depuis release_days jours → retour au pool.
  WITH victims AS (
    SELECT l.id, l.status, l.assigned_to
      FROM leads l
     WHERE l.market_id = p_market_id
       AND l.assigned_to IS NOT NULL
       AND l.status IN ('new', 'assigned')
       AND l.converted_order_id IS NULL
       AND greatest(l.created_at,
                    coalesce((SELECT max(h.created_at) FROM lead_history h WHERE h.lead_id = l.id),
                             l.created_at)) < now() - make_interval(days => v_release)
     FOR UPDATE OF l
  ),
  upd AS (
    UPDATE leads l SET assigned_to = NULL
      FROM victims v
     WHERE l.id = v.id
    RETURNING l.id
  ),
  logged AS (
    INSERT INTO lead_history (lead_id, status_from, status_to, actor_id, actor_type, note)
    SELECT v.id, v.status, v.status, NULL, 'system',
           'Rendu au pool : intouché depuis ' || v_release || ' jours'
      FROM victims v
    RETURNING 1
  )
  SELECT count(*)::int, coalesce(jsonb_object_agg(v.id::text, v.assigned_to::text), '{}'::jsonb)
    INTO v_released, v_avoid
    FROM victims v
   WHERE EXISTS (SELECT 1 FROM upd WHERE upd.id = v.id);

  -- f. Remplir les dossiers.
  v_dist := _prospects_distribute(p_market_id, v_avoid);

  v_result := jsonb_build_object(
    'created_rej',        v_created_rej,
    'created_old',        v_created_old,
    'closed_reordered',   v_closed_re,
    'closed_unreachable', v_closed_un,
    'released',           v_released,
    'assigned',           coalesce((v_dist ->> 'assigned')::int, 0),
    'skipped_reason',     NULL
  );

  INSERT INTO prospect_tick_log (market_id, ran_on, ran_at, result)
  VALUES (p_market_id, v_today, now(), v_result || jsonb_build_object('forced', p_force))
  ON CONFLICT (market_id, ran_on)
  DO UPDATE SET ran_at = EXCLUDED.ran_at, result = EXCLUDED.result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prospects_daily_tick(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospects_daily_tick(UUID, BOOLEAN) TO service_role;

-- Le cron : chaque marché actif, une erreur dans l'un n'arrête pas l'autre.
CREATE OR REPLACE FUNCTION public.prospects_daily_tick_all()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m   RECORD;
  v_out JSONB := '[]'::jsonb;
BEGIN
  FOR v_m IN SELECT id FROM markets WHERE is_active ORDER BY id LOOP
    BEGIN
      v_out := v_out || jsonb_build_object('market_id', v_m.id,
                                           'result', prospects_daily_tick(v_m.id, false));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'prospects_daily_tick(%) failed: % %', v_m.id, SQLSTATE, SQLERRM;
      v_out := v_out || jsonb_build_object('market_id', v_m.id, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('at', now(), 'markets', v_out);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prospects_daily_tick_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospects_daily_tick_all() TO service_role;

-- ------------------------------------------------------------
-- 6. « Répartir maintenant » — étape f seule, pour le manager
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospects_distribute_now(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'lead_rpc: no session' USING ERRCODE = '42501';
  END IF;
  PERFORM lead_rpc_guard(NULL, p_market_id);  -- super_admin ou manager du marché
  RETURN _prospects_distribute(p_market_id, '{}'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prospects_distribute_now(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospects_distribute_now(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 7. pg_cron — horaire à :37, n'agit qu'à l'heure locale réglée (dist.hour)
--    :37 est libre de toutes les séries existantes (docs/notifications-cron.md).
-- ------------------------------------------------------------
DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'prospects-daily-tick-hourly';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'prospects-daily-tick-hourly',
  '37 * * * *',
  $$SELECT public.prospects_daily_tick_all();$$
);

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261006100200', 'prospect_recovery_engine') ON CONFLICT (version) DO NOTHING;

-- ============================================================
-- 20261006100300_get_prospect_desk.sql
--
-- get_prospect_desk(market, month, tz) — les FAITS du bureau Prospects du
-- manager. Le contrat est src/lib/prospects/desk/types.ts (DeskFacts) : chaque
-- chiffre est défini ici, une fois, et nommé là-bas. La page est construite en
-- TypeScript à partir de ces faits.
--
-- DÉFINITIONS
--   Mois            : le mois civil de p_month dans p_tz, [1er 00:00, 1er suivant 00:00).
--   Source          : leads.source → rej (rejected_order) · ret (winback) ·
--                     old (repeat_buyer) · camp (tout le reste) — sourceOf().
--   État            : stateOf() — converted_order_id ou won → won ; lost/archived →
--                     lost ; new/assigned → to_call ; le reste → in_progress.
--   Ouvert          : status hors (won, lost, archived) et converted_order_id NULL.
--   « Ramené »      : une commande créée depuis un prospect (leads.converted_order_id).
--   Livré dans le mois : commande ramenée, au statut delivered, dont la dernière
--                     transition order_history → delivered tombe dans le mois.
--                     Revenu = orders.total_price SEULEMENT. Une seule définition
--                     pour hero, sources et agents : les sources somment au hero.
--   converted       : commandes ramenées CRÉÉES dans le mois, quel que soit le statut ;
--                     on_road / not_shipped / returned les découpent par statut actuel.
--   Agent d'une commande ramenée : orders.assigned_to, à défaut leads.assigned_to.
--   called_today    : prospects distincts sur lesquels l'agent a écrit une issue
--                     d'appel (attempt_*, callback_scheduled, qualified, won, lost)
--                     aujourd'hui, jour local p_tz.
--   pool            : prospects ouverts sans agent, hors listes WhatsApp envoyées
--                     par l'API (la répartition ne les donne à personne, voir
--                     _prospects_distribute) — sinon la ligne « à faire » ne
--                     s'éteindrait jamais.
--
-- SÉCURITÉ — SECURITY DEFINER avec garde explicite (super_admin, ou
-- market_manager du marché ; lead_rpc_guard). INVOKER ne suffirait pas : la
-- page doit compter les prospects de TOUS les agents et lire users,
-- agent_distribution_shares et order_history, et ces lectures sous RLS
-- dépendraient de politiques qu'on ne contrôle pas ici. Une seule porte, testée.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_prospect_desk(p_market_id UUID, p_month DATE, p_tz TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz       TEXT := coalesce(nullif(p_tz, ''), market_tz(p_market_id), 'UTC');
  v_m_from   DATE := date_trunc('month', coalesce(p_month, (now() AT TIME ZONE coalesce(nullif(p_tz, ''), 'UTC'))::date))::date;
  v_from     TIMESTAMPTZ;
  v_to       TIMESTAMPTZ;
  v_pfrom    TIMESTAMPTZ;
  v_today    TIMESTAMPTZ;
  v_s        JSONB;
  v_release  INT;
  v_out      JSONB;
BEGIN
  PERFORM lead_rpc_guard(NULL, p_market_id);

  v_from    := v_m_from::timestamp AT TIME ZONE v_tz;
  v_to      := (v_m_from + interval '1 month')::timestamp AT TIME ZONE v_tz;
  v_pfrom   := (v_m_from - interval '1 month')::timestamp AT TIME ZONE v_tz;
  v_today   := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_s       := _prospect_recovery_settings(p_market_id);
  v_release := greatest(coalesce((v_s -> 'dist' ->> 'release_days')::int, 3), 1);

  WITH
  lm AS (
    SELECT l.id, l.source, l.status, l.assigned_to, l.converted_order_id, l.created_at,
           l.callback_scheduled_at, l.campaign_id,
           CASE l.source::text
             WHEN 'rejected_order' THEN 'rej'
             WHEN 'winback'        THEN 'ret'
             WHEN 'repeat_buyer'   THEN 'old'
             ELSE 'camp' END AS src,
           CASE
             WHEN l.converted_order_id IS NOT NULL OR l.status = 'won' THEN 'won'
             WHEN l.status IN ('lost', 'archived') THEN 'lost'
             WHEN l.status IN ('new', 'assigned') THEN 'to_call'
             ELSE 'in_progress' END AS state
      FROM leads l
     WHERE l.market_id = p_market_id
  ),
  open_l AS (
    SELECT * FROM lm WHERE state IN ('to_call', 'in_progress')
  ),
  -- Les commandes ramenées, avec leur date de livraison si elle existe.
  conv AS (
    SELECT o.id, o.status::text AS status, o.total_price, o.created_at,
           coalesce(o.assigned_to, lm.assigned_to) AS agent_id,
           lm.src,
           (SELECT max(h.created_at) FROM order_history h
             WHERE h.order_id = o.id AND h.status_to = 'delivered') AS delivered_at
      FROM lm
      JOIN orders o ON o.id = lm.converted_order_id
     WHERE o.market_id = p_market_id
  ),
  dlv AS (
    SELECT * FROM conv
     WHERE status = 'delivered' AND delivered_at >= v_from AND delivered_at < v_to
  ),
  conv_m AS (
    SELECT * FROM conv WHERE created_at >= v_from AND created_at < v_to
  ),
  hero AS (
    SELECT jsonb_build_object(
      'delivered',      (SELECT count(*) FROM dlv),
      'revenue',        (SELECT coalesce(sum(total_price), 0) FROM dlv),
      'converted',      (SELECT count(*) FROM conv_m),
      'on_road',        (SELECT count(*) FROM conv_m WHERE status IN
                          ('uploaded', 'dispatching', 'scanned', 'at_carrier', 'dispatched', 'deposit',
                           'in_transit', 'out_for_delivery', 'delivery_delayed', 'unverified')),
      'not_shipped',    (SELECT count(*) FROM conv_m WHERE status IN
                          ('pending', 'new', 'assigned', 'attempt_1', 'attempt_2', 'attempt_3',
                           'callback_scheduled', 'confirmed', 'dispatch_scheduled')),
      'returned',       (SELECT count(*) FROM conv_m WHERE status IN
                          ('returning', 'to_be_returned', 'returned', 'received')),
      'prev_delivered', (SELECT count(*) FROM conv
                          WHERE status = 'delivered' AND delivered_at >= v_pfrom AND delivered_at < v_from)
    ) AS j
  ),
  srcs AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'key',         k.src,
             'created',     coalesce(c.created, 0),
             'to_call',     coalesce(c.to_call, 0),
             'in_progress', coalesce(c.in_progress, 0),
             'won',         coalesce(c.won, 0),
             'lost',        coalesce(c.lost, 0),
             'delivered',   coalesce(d.n, 0),
             'revenue',     coalesce(d.revenue, 0)
           ) ORDER BY k.ord), '[]'::jsonb) AS j
      FROM (VALUES ('rej', 1), ('ret', 2), ('old', 3), ('camp', 4)) k(src, ord)
      LEFT JOIN (
        SELECT src,
               count(*)                                      AS created,
               count(*) FILTER (WHERE state = 'to_call')     AS to_call,
               count(*) FILTER (WHERE state = 'in_progress') AS in_progress,
               count(*) FILTER (WHERE state = 'won')         AS won,
               count(*) FILTER (WHERE state = 'lost')        AS lost
          FROM lm
         WHERE created_at >= v_from AND created_at < v_to
         GROUP BY src
      ) c ON c.src = k.src
      LEFT JOIN (
        SELECT src, count(*) AS n, sum(total_price) AS revenue FROM dlv GROUP BY src
      ) d ON d.src = k.src
  ),
  has_shares AS (
    SELECT EXISTS (SELECT 1 FROM agent_distribution_shares WHERE market_id = p_market_id) AS v
  ),
  ag AS (
    SELECT u.id, u.full_name, u.color, u.last_seen_at
      FROM users u
     WHERE u.market_id = p_market_id AND u.role = 'agent' AND u.is_active AND u.deleted_at IS NULL
  ),
  last_touch AS (
    SELECT o.id, greatest(o.created_at,
                          coalesce((SELECT max(h.created_at) FROM lead_history h WHERE h.lead_id = o.id),
                                   o.created_at)) AS at
      FROM open_l o
     WHERE o.assigned_to IS NOT NULL
  ),
  called AS (
    SELECT h.actor_id, count(DISTINCT h.lead_id) AS n
      FROM lead_history h
      JOIN lm ON lm.id = h.lead_id
     WHERE h.created_at >= v_today
       AND h.actor_id IS NOT NULL
       AND h.status_to IN ('attempt_1', 'attempt_2', 'attempt_3', 'callback_scheduled',
                           'qualified', 'won', 'lost')
     GROUP BY h.actor_id
  ),
  agents AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id',              a.id,
             'name',            coalesce(a.full_name, ''),
             'color',           a.color,
             'last_seen_at',    a.last_seen_at,
             'in_rotation',     (NOT hs.v) OR EXISTS (
                                  SELECT 1 FROM agent_distribution_shares s
                                   WHERE s.market_id = p_market_id AND s.agent_id = a.id AND s.share_pct > 0),
             'file_open',       (SELECT count(*) FROM open_l o WHERE o.assigned_to = a.id),
             'called_today',    coalesce((SELECT c.n FROM called c WHERE c.actor_id = a.id), 0),
             'late_callbacks',  (SELECT count(*) FROM open_l o
                                  WHERE o.assigned_to = a.id AND o.status = 'callback_scheduled'
                                    AND o.callback_scheduled_at < now()),
             'stale',           (SELECT count(*) FROM open_l o JOIN last_touch t ON t.id = o.id
                                  WHERE o.assigned_to = a.id
                                    AND t.at < now() - make_interval(days => v_release)),
             'converted_month', (SELECT count(*) FROM conv_m c WHERE c.agent_id = a.id),
             'delivered_month', (SELECT count(*) FROM dlv d WHERE d.agent_id = a.id),
             'revenue_month',   (SELECT coalesce(sum(d.total_price), 0) FROM dlv d WHERE d.agent_id = a.id)
           ) ORDER BY a.full_name, a.id), '[]'::jsonb) AS j
      FROM ag a, has_shares hs
  ),
  pool AS (
    SELECT count(*) AS n,
           floor(extract(epoch FROM (now() - min(o.created_at))) / 86400)::int AS oldest
      FROM open_l o
      LEFT JOIN prospect_campaigns c ON c.id = o.campaign_id
     WHERE o.assigned_to IS NULL
       AND NOT (coalesce(c.channel, 'call') = 'wa' AND coalesce(c.wa_sender, 'agent') = 'api')
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'month',        jsonb_build_object('from', to_char(v_m_from, 'YYYY-MM-DD'),
                                       'to',   to_char((v_m_from + interval '1 month' - interval '1 day')::date, 'YYYY-MM-DD')),
    'settings',     v_s,
    'last_tick_at', (SELECT max(t.ran_at) FROM prospect_tick_log t WHERE t.market_id = p_market_id),
    'hero',         (SELECT j FROM hero),
    'sources',      (SELECT j FROM srcs),
    'agents',       (SELECT j FROM agents),
    'pool',         (SELECT jsonb_build_object('open', n, 'oldest_days', oldest) FROM pool),
    'open_total',   (SELECT count(*) FROM open_l)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_prospect_desk(UUID, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prospect_desk(UUID, DATE, TEXT) TO authenticated, service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261006100300', 'get_prospect_desk') ON CONFLICT (version) DO NOTHING;

-- ============================================================
-- 20261006100400_campaign_audience_v2.sql
--
-- « Nouvelle liste » (plans/prospects-recovery.md, round 3–4) — l'audience
-- d'une liste gagne trois clés de filter_json, sans changer le sens d'aucune
-- clé existante (les campagnes déjà lancées se recalculent à l'identique) :
--
--   rejection_subreasons : text[]  — orders.rejection_subreason ∈ liste
--                                    (les sous-motifs configurables ; la clé
--                                    rejection_reasons garde les GROUPES).
--   product_windows      : [{product_id, from, to}] — chaque produit peut porter
--                          ses propres dates : une commande de ce produit ne
--                          compte que si sa transition vers l'issue tombe dans
--                          SA fenêtre (from / to absents = ouverts). Un produit
--                          sans fenêtre garde date_from / date_to. Les produits
--                          nommés ici s'ajoutent à product_ids (s'il est absent,
--                          ce sont eux qui forment la liste des produits).
--   guards.no_order_after_outcome : boolean — exclut (excluded_by =
--                          'recentlyOrdered', le compteur que l'aperçu affiche
--                          déjà) le client qui a passé N'IMPORTE QUELLE commande
--                          sur le marché après sa dernière issue retenue
--                          (last_outcome_at). Le commutateur « Seulement ceux qui
--                          n'ont pas recommandé ».
--
-- order_statuses compare en texte : 'returning' et 'to_be_returned' marchent
-- déjà (testé dans supabase/tests/prospect_recovery_test.sql).
--
-- Et une colonne : prospect_campaigns.offer_product_ids — une liste peut
-- proposer UN OU PLUSIEURS produits. Additive ; les droits de table et la
-- politique d'insertion des managers la couvrent déjà.
-- ============================================================

ALTER TABLE public.prospect_campaigns
  ADD COLUMN IF NOT EXISTS offer_product_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.prospect_campaigns.offer_product_ids IS
  'Produits proposés par la liste (un ou plusieurs). Lu côté TypeScript pour montrer à l''agent quoi proposer.';

CREATE OR REPLACE FUNCTION public.campaign_audience_rows(p_market_id uuid, p_filter jsonb)
 RETURNS TABLE(customer_phone text, customer_name text, customer_city text, customer_address text, source_order_id uuid, last_outcome_at timestamp with time zone, best_basket numeric, delivered integer, returned integer, total_orders integer, excluded_by text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with windows as (
  -- Une fenêtre par produit ; la dernière l'emporte si un produit est nommé deux fois.
  select distinct on ((w->>'product_id')::uuid)
         (w->>'product_id')::uuid           as product_id,
         nullif(w->>'from', '')::timestamptz as w_from,
         nullif(w->>'to', '')::timestamptz   as w_to
  from jsonb_array_elements(
         case when jsonb_typeof(p_filter->'product_windows') = 'array'
              then p_filter->'product_windows' else '[]'::jsonb end
       ) with ordinality as t(w, n)
  where w->>'product_id' is not null
  order by (w->>'product_id')::uuid, n desc
),
params as (
  select
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(p_filter->'order_statuses') as x),
      array['delivered']
    )                                                        as order_statuses,
    (p_filter->>'date_from')::timestamptz                    as date_from,
    (p_filter->>'date_to')::timestamptz                      as date_to,
    -- Le composeur ecrit product_ids ; les campagnes d'avant portent product_id.
    -- Les produits a fenetre s'y ajoutent.
    (select case when base is null and win is null then null
                 else array(select distinct u from unnest(coalesce(base, '{}') || coalesce(win, '{}')) u)
            end
       from (select
               coalesce(
                 (select array_agg(x::uuid) from jsonb_array_elements_text(p_filter->'product_ids') as x),
                 case when p_filter->>'product_id' is not null
                      then array[(p_filter->>'product_id')::uuid] end
               ) as base,
               (select array_agg(product_id) from windows) as win
            ) s
    )                                                        as product_ids,
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(p_filter->'cities') as x),
      case when p_filter->>'city' is not null
           then array[p_filter->>'city'] end
    )                                                        as cities,
    (p_filter->'recency_days'->>'from')::int                 as recency_from,
    (p_filter->'recency_days'->>'to')::int                   as recency_to,
    (p_filter->>'basket_min')::numeric                       as basket_min,
    (p_filter->'order_count'->>'op')                         as count_op,
    (p_filter->'order_count'->>'n')::int                     as count_n,
    (p_filter->'returns'->>'mode')                           as returns_mode,
    (p_filter->'returns'->>'rate')::numeric                  as returns_rate,
    (select array_agg(x) from jsonb_array_elements_text(p_filter->'rejection_reasons') as x)
                                                             as rejection_reasons,
    (select array_agg(x) from jsonb_array_elements_text(p_filter->'rejection_subreasons') as x)
                                                             as rejection_subreasons,
    (select array_agg(x::uuid) from jsonb_array_elements_text(p_filter->'agent_ids') as x)
                                                             as agent_ids,
    (p_filter->'guards'->>'not_ordered_days')::int           as guard_ordered_days,
    (p_filter->'guards'->>'not_in_campaign_days')::int       as guard_campaign_days,
    coalesce((p_filter->'guards'->>'not_lost_not_interested')::boolean, false)
                                                             as guard_lost_ni,
    coalesce((p_filter->'guards'->>'no_order_after_outcome')::boolean, false)
                                                             as guard_no_order_after,
    coalesce((p_filter->'limit'->>'sort'), 'oldest')         as limit_sort,
    (p_filter->'limit'->>'n')::int                           as limit_n
),
-- Les commandes qui portent l'issue voulue, datees par la transition vers
-- cette issue et non par leur creation : une commande livree hier peut avoir
-- ete passee il y a trois mois. Un produit a fenetre se date dans SA fenetre.
matched_orders as (
  select o.id, o.customer_phone, o.customer_name, o.customer_city, o.customer_address,
         o.total_price, o.product_id, o.assigned_to, o.status,
         (select max(oh.created_at) from order_history oh
           where oh.order_id = o.id
             and oh.status_to::text = o.status::text
             and oh.status_to::text = any(p.order_statuses)) as outcome_at
  from orders o
  cross join params p
  left join windows w on w.product_id = o.product_id
  where o.market_id = p_market_id
    and o.status::text = any(p.order_statuses)
    and (p.product_ids is null or o.product_id = any(p.product_ids))
    and (p.cities is null or o.customer_city = any(p.cities))
    and (p.basket_min is null or o.total_price >= p.basket_min)
    and (p.agent_ids is null or o.assigned_to = any(p.agent_ids))
    and (p.rejection_reasons is null
         or o.rejection_reason::text = any(p.rejection_reasons))
    and (p.rejection_subreasons is null
         or o.rejection_subreason = any(p.rejection_subreasons))
    and exists (
      select 1 from order_history oh
      where oh.order_id = o.id
        and oh.status_to::text = o.status::text
        and oh.status_to::text = any(p.order_statuses)
        and ((case when w.product_id is not null then w.w_from else p.date_from end) is null
             or oh.created_at >= (case when w.product_id is not null then w.w_from else p.date_from end))
        and ((case when w.product_id is not null then w.w_to else p.date_to end) is null
             or oh.created_at <= (case when w.product_id is not null then w.w_to else p.date_to end))
    )
),
-- Une campagne s'adresse a des personnes, pas a des commandes : un client qui
-- a achete trois fois ne doit etre appele qu'une fois.
grouped as (
  select m.customer_phone,
         min(m.customer_name)    as customer_name,
         min(m.customer_city)    as customer_city,
         min(m.customer_address) as customer_address,
         max(m.outcome_at)       as last_outcome_at,
         max(m.total_price)      as best_basket,
         (array_agg(m.id order by m.outcome_at desc nulls last))[1] as source_order_id
  from matched_orders m
  where m.customer_phone is not null and m.customer_phone <> ''
  group by m.customer_phone
),
-- L'historique complet du client sur ce marche, pour les conditions qui
-- parlent de lui plutot que d'une commande.
history as (
  select o.customer_phone,
         (count(*) filter (where o.status = 'delivered'))::int as delivered,
         (count(*) filter (where o.status = 'returned'))::int  as returned,
         count(*)::int                                         as total_orders
  from orders o
  where o.market_id = p_market_id and o.customer_phone is not null
  group by o.customer_phone
),
filtered as (
  select g.*, h.delivered, h.returned, h.total_orders
  from grouped g
  join history h on h.customer_phone = g.customer_phone, params p
  where
    -- Recence : il y a combien de jours la derniere commande retenue ?
    (p.recency_from is null or
       extract(epoch from (now() - g.last_outcome_at)) / 86400
         between p.recency_from and p.recency_to)
    -- Nombre de commandes du client, toutes issues confondues.
    and (p.count_op is null or
         case p.count_op
           when 'gte' then h.total_orders >= p.count_n
           when 'eq'  then h.total_orders =  p.count_n
           when 'lte' then h.total_orders <= p.count_n
           else true
         end)
    -- Historique de retours.
    and (p.returns_mode is null or
         case p.returns_mode
           when 'none' then h.returned = 0
           when 'any'  then h.returned > 0
           when 'rateAtMost' then
             h.total_orders = 0 or
             (h.returned::numeric / h.total_orders) * 100 <= p.returns_rate
           else true
         end)
),
-- Les garde-fous, evalues dans l'ordre de la maquette : chaque client n'est
-- ecarte qu'une fois, par la premiere raison qui s'applique.
judged as (
  select f.*,
    case
      when exists (
        select 1 from leads l
        where l.market_id = p_market_id
          and l.customer_phone = f.customer_phone
          and l.status not in ('won', 'lost', 'archived')
      ) then 'openLead'
      when p.guard_ordered_days is not null and exists (
        select 1 from orders o
        where o.market_id = p_market_id
          and o.customer_phone = f.customer_phone
          and o.created_at > now() - make_interval(days => p.guard_ordered_days)
      ) then 'recentlyOrdered'
      -- A recommande apres sa derniere issue retenue : meme compteur.
      when p.guard_no_order_after and f.last_outcome_at is not null and exists (
        select 1 from orders o
        where o.market_id = p_market_id
          and o.customer_phone = f.customer_phone
          and o.created_at > f.last_outcome_at
      ) then 'recentlyOrdered'
      when p.guard_campaign_days is not null and exists (
        select 1 from leads l
        where l.market_id = p_market_id
          and l.customer_phone = f.customer_phone
          and l.campaign_id is not null
          and l.created_at > now() - make_interval(days => p.guard_campaign_days)
      ) then 'recentCampaign'
      when p.guard_lost_ni and exists (
        select 1 from leads l
        where l.market_id = p_market_id
          and l.customer_phone = f.customer_phone
          and l.status = 'lost'
          and l.lost_reason = 'not_interested'
      ) then 'lostNotInterested'
      else null
    end as excluded_by
  from filtered f, params p
),
ranked as (
  select j.*,
         row_number() over (
           order by
             case when p.limit_sort = 'newest' then j.last_outcome_at end desc nulls last,
             case when p.limit_sort = 'basket' then j.best_basket end desc nulls last,
             case when p.limit_sort = 'oldest' then j.last_outcome_at end asc nulls last
         ) as rn
  from judged j, params p
  where j.excluded_by is null
)
-- Les exclus sont renvoyes eux aussi, avec leur motif : l'apercu les compte,
-- l'execution les ignore en filtrant sur excluded_by is null.
select customer_phone, customer_name, customer_city, customer_address,
       source_order_id, last_outcome_at, best_basket,
       delivered, returned, total_orders, excluded_by
from judged
where excluded_by is not null
union all
select r.customer_phone, r.customer_name, r.customer_city, r.customer_address,
       r.source_order_id, r.last_outcome_at, r.best_basket,
       r.delivered, r.returned, r.total_orders, null::text
from ranked r, params p
where r.rn <= coalesce(p.limit_n, 100000);
$function$;

-- INVOKER (sous RLS) : anon n'a rien à y faire.
REVOKE EXECUTE ON FUNCTION public.campaign_audience_rows(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.preview_campaign_audience(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_audience_rows(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_campaign_audience(uuid, jsonb) TO authenticated, service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261006100400', 'campaign_audience_v2') ON CONFLICT (version) DO NOTHING;



COMMIT;



-- ============================================================
-- 20261006100500_set_prospect_recovery_settings.sql
-- ============================================================
BEGIN;
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

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261006100500', 'set_prospect_recovery_settings') ON CONFLICT (version) DO NOTHING;
COMMIT;



-- Vérification : 6 lignes, le job cron, et aucune RPC du domaine ouverte à anon.

SELECT version, name FROM supabase_migrations.schema_migrations WHERE version BETWEEN '20261006100000' AND '20261006100500' ORDER BY version;

SELECT jobname, schedule FROM cron.job WHERE jobname = 'prospects-daily-tick-hourly';

SELECT p.oid::regprocedure AS anon_can_execute FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE') AND (p.proname LIKE '%lead%' OR p.proname LIKE '%prospect%');
