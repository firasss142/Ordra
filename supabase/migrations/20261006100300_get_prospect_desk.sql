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
