-- ============================================================
-- 20261003000004_pg_cron_availability_reset.sql
--
-- À minuit LOCAL, personne n'est prêt. Chaque service commence par une
-- déclaration explicite, et les commandes intouchées d'hier retournent au pool
-- au lieu de dormir dans la file de quelqu'un qui ne reviendra peut-être pas.
--
-- POURQUOI HORAIRE ET NON DEUX CRONS UTC FIXES
--   La Tunisie (UTC+1) et la Libye (UTC+2) ne passent pas minuit au même
--   instant. '0 23 * * *' et '0 22 * * *' seraient justes aujourd'hui et faux
--   le jour où l'une des deux rétablit l'heure d'été — sans que rien
--   n'échoue. src/lib/dates/market-day.ts a fait le même choix pour la même
--   raison : on demande le fuseau à la base plutôt que de figer un décalage.
--
-- POURQUOI :22
--   Libre de toutes les séries existantes (`* * * * *`, */5, */10, */15,
--   4-59/15 → :04 :19 :34 :49, 8-59/15 → :08 :23 :38 :53, et `7 * * * *`).
--   docs/notifications-cron.md demande de conserver cet étalement.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reset_agent_availability_daily()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market    RECORD;
  v_tz        TEXT;
  v_day_start TIMESTAMPTZ;
  v_agents    INT;
  v_out       JSONB := '[]'::jsonb;
BEGIN
  FOR v_market IN SELECT id FROM markets WHERE is_active LOOP
    v_tz        := market_tz(v_market.id);
    v_day_start := (date_trunc('day', now() AT TIME ZONE v_tz)) AT TIME ZONE v_tz;

    -- Uniquement pendant la première heure du jour local.
    IF now() - v_day_start >= interval '1 hour' THEN
      CONTINUE;
    END IF;

    -- Idempotence, et elle est nécessaire : sans elle, un agent qui se remet
    -- prêt à 00h20 serait éteint au tick de 01h. Une seule réinitialisation
    -- système par marché et par jour local. Sert l'index partiel
    -- idx_agent_availability_log_daily_reset.
    IF EXISTS (
      SELECT 1 FROM agent_availability_log l
       WHERE l.market_id = v_market.id
         AND l.actor_type = 'system'
         AND l.reason = 'daily_reset'
         AND l.created_at >= v_day_start
    ) THEN
      CONTINUE;
    END IF;

    -- Une seule instruction : toutes les CTE voient le MÊME instantané, donc
    -- `victims` lit la liste des agents prêts d'AVANT que `turned_off` ne les
    -- éteigne. Les CTE modifiantes s'exécutent même si rien ne les référence.
    WITH victims AS (
      SELECT o.id AS order_id, o.market_id, o.assigned_to AS agent_id
        FROM orders o
        JOIN users u ON u.id = o.assigned_to
       WHERE o.market_id = v_market.id
         AND u.role = 'agent'
         AND u.is_available
         AND o.status = 'pending'
         AND o.callback_scheduled_at IS NULL
         AND o.attempts_count = 0
         -- On n'honore délibérément PAS order_presence ici : à minuit local
         -- personne ne tient une fiche ouverte, et respecter un verrou
         -- résiduel laisserait une commande attachée à un agent désormais
         -- indisponible.
       FOR UPDATE OF o
    ),
    released AS (
      UPDATE orders o
         SET assigned_to = NULL,
             status = 'pending',
             callback_scheduled_at = NULL
        FROM victims v
       WHERE o.id = v.order_id
      RETURNING o.id
    ),
    logged AS (
      INSERT INTO order_history
        (order_id, market_id, status_from, status_to, actor_id, actor_type, note)
      SELECT v.order_id, v.market_id,
             'pending'::order_status, 'pending'::order_status,
             NULL,        -- actor_id FK vers users : le système n'en a pas
             'system',    -- order_history.actor_type : system|agent|manager
             'Réinitialisation quotidienne — commande rendue au pool'
        FROM victims v
      RETURNING order_id
    ),
    per_agent AS (
      SELECT agent_id, count(*)::int AS n FROM victims GROUP BY agent_id
    ),
    turned_off AS (
      UPDATE users u
         SET is_available = false, available_since = NULL
       WHERE u.market_id = v_market.id
         AND u.role = 'agent'
         AND u.is_available
      RETURNING u.id, u.market_id
    )
    INSERT INTO agent_availability_log
      (user_id, market_id, is_available, changed_by, actor_type, reason, released_count)
    SELECT t.id, t.market_id, false, NULL, 'system', 'daily_reset', COALESCE(pa.n, 0)
      FROM turned_off t
      LEFT JOIN per_agent pa ON pa.agent_id = t.id;

    GET DIAGNOSTICS v_agents = ROW_COUNT;

    v_out := v_out || jsonb_build_object(
      'market_id', v_market.id, 'tz', v_tz, 'agents_reset', v_agents);
  END LOOP;

  RETURN jsonb_build_object('at', now(), 'markets', v_out);
END;
$$;

COMMENT ON FUNCTION public.reset_agent_availability_daily() IS
  'Remet tous les agents à « pas prêt » à minuit dans le fuseau du marché et '
  'rend au pool leurs commandes intouchées. Horaire, avec garde d''idempotence '
  'sur agent_availability_log. Exposée à super_admin via '
  'POST /api/team/availability/reset pour rattrapage manuel (leçon du F5 '
  'investisseur : un planning bloqué doit toujours pouvoir être relancé).';

GRANT EXECUTE ON FUNCTION public.reset_agent_availability_daily() TO service_role;

-- Idiome du dépôt : désinscrire puis réinscrire, par jobname.
DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'agent-availability-reset-hourly';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'agent-availability-reset-hourly',
  '22 * * * *',
  $$SELECT public.reset_agent_availability_daily();$$
);
