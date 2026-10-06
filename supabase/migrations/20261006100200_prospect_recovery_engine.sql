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
