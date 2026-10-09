-- Journaux v2 — thresholds become settings, three new rules
-- (plans/journal-detection-and-settings-v2.md §B–§E). Needs 20261006120000.
--
-- Every number journal_detect() used was written in its body (30 min, ≥ 3 in
-- 1 h, 12 h…). They now live in journal_rule_settings, edited at Réglages ›
-- Surveillance by the super_admin, and each rule can be switched off (its open
-- problem then closes at the next pass, like any problem whose cause is gone).
-- Defaults equal the old hard-coded values, so nothing changes until someone
-- edits a row.
--
-- New rules:
--   external_failing  R13 an outside service (Darb, Navex, Meta, WhatsApp…) fails ≥ N times in M min
--   browser_error     R14 a page crashes ≥ N times, or for ≥ U people, in H h
--   job_hanging       R15 a job is abandoned (stuck « en cours ») ≥ N times in D days
-- server_error now ignores browser crashes and carries the recorded cause.

CREATE TABLE IF NOT EXISTS public.journal_rule_settings (
  rule_key    TEXT PRIMARY KEY,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  params      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES public.users(id)
);

ALTER TABLE public.journal_rule_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "journal_rule_settings_select_super_admin" ON public.journal_rule_settings;
CREATE POLICY "journal_rule_settings_select_super_admin"
  ON public.journal_rule_settings FOR SELECT TO authenticated
  USING ((SELECT public.get_user_role()) = 'super_admin');
DROP POLICY IF EXISTS "journal_rule_settings_update_super_admin" ON public.journal_rule_settings;
CREATE POLICY "journal_rule_settings_update_super_admin"
  ON public.journal_rule_settings FOR UPDATE TO authenticated
  USING ((SELECT public.get_user_role()) = 'super_admin')
  WITH CHECK ((SELECT public.get_user_role()) = 'super_admin');
REVOKE ALL ON public.journal_rule_settings FROM anon;
REVOKE INSERT, DELETE, TRUNCATE ON public.journal_rule_settings FROM authenticated;
-- The key and the row's identity never change from the screen: only these two.
REVOKE UPDATE ON public.journal_rule_settings FROM authenticated;
GRANT UPDATE (enabled, params, updated_at, updated_by) ON public.journal_rule_settings TO authenticated;

INSERT INTO public.journal_rule_settings (rule_key, params) VALUES
  ('job_failing',       '{"failures": 2}'),
  ('job_hanging',       '{"count": 2, "days": 7}'),
  ('connection_silent', '{"minutes": 30}'),
  ('carrier_inactive',  '{"stale_days": 7}'),
  ('carrier_stuck',     '{"hours": 24}'),
  ('import_rows',       '{"hours": 24}'),
  ('upload_failing',    '{"count": 3, "minutes": 60}'),
  ('external_failing',  '{"count": 3, "minutes": 60}'),
  ('whatsapp_down',     '{}'),
  ('ads_no_orders',     '{"hours": 12}'),
  ('server_error',      '{"count": 3, "hours": 24}'),
  ('browser_error',     '{"count": 3, "users": 2, "hours": 24}'),
  ('login_failures',    '{"count": 5, "minutes": 60}'),
  ('large_export',      '{"rows": 1000}')
ON CONFLICT (rule_key) DO NOTHING;

-- Who changed a threshold, and from what: the same audit as every setting.
DROP TRIGGER IF EXISTS trg_journal_rule_settings_journal ON public.journal_rule_settings;
CREATE TRIGGER trg_journal_rule_settings_journal AFTER INSERT OR UPDATE OR DELETE ON public.journal_rule_settings
  FOR EACH ROW EXECUTE FUNCTION public.journal_row_change('', 'updated_at,updated_by', 'rule_key', '');

-- A threshold, or its default when the row or the key is missing / not a number.
CREATE OR REPLACE FUNCTION public.journal_rule_num(p_rule TEXT, p_key TEXT, p_default NUMERIC)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT CASE WHEN jsonb_typeof(s.params -> p_key) = 'number' AND (s.params ->> p_key)::NUMERIC > 0
                 THEN (s.params ->> p_key)::NUMERIC END
       FROM public.journal_rule_settings s WHERE s.rule_key = p_rule),
    p_default)
$$;

CREATE OR REPLACE FUNCTION public.journal_rule_on(p_rule TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE((SELECT s.enabled FROM public.journal_rule_settings s WHERE s.rule_key = p_rule), TRUE)
$$;

REVOKE EXECUTE ON FUNCTION public.journal_rule_num(TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.journal_rule_on(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.journal_detect()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reaped INT;
  v_opened INT;
  v_resolved INT;
  -- thresholds, from public.journal_rule_settings (Réglages › Surveillance)
  v_fail_streak  INT     := public.journal_rule_num('job_failing', 'failures', 2)::INT;
  v_silent_min   INT     := public.journal_rule_num('connection_silent', 'minutes', 30)::INT;
  v_stale_days   INT     := public.journal_rule_num('carrier_inactive', 'stale_days', 7)::INT;
  v_stuck_h      INT     := public.journal_rule_num('carrier_stuck', 'hours', 24)::INT;
  v_import_h     INT     := public.journal_rule_num('import_rows', 'hours', 24)::INT;
  v_upload_n     INT     := public.journal_rule_num('upload_failing', 'count', 3)::INT;
  v_upload_min   INT     := public.journal_rule_num('upload_failing', 'minutes', 60)::INT;
  v_ext_n        INT     := public.journal_rule_num('external_failing', 'count', 3)::INT;
  v_ext_min      INT     := public.journal_rule_num('external_failing', 'minutes', 60)::INT;
  v_ads_h        INT     := public.journal_rule_num('ads_no_orders', 'hours', 12)::INT;
  v_server_n     INT     := public.journal_rule_num('server_error', 'count', 3)::INT;
  v_server_h     INT     := public.journal_rule_num('server_error', 'hours', 24)::INT;
  v_browser_n    INT     := public.journal_rule_num('browser_error', 'count', 3)::INT;
  v_browser_u    INT     := public.journal_rule_num('browser_error', 'users', 2)::INT;
  v_browser_h    INT     := public.journal_rule_num('browser_error', 'hours', 24)::INT;
  v_hang_n       INT     := public.journal_rule_num('job_hanging', 'count', 2)::INT;
  v_hang_d       INT     := public.journal_rule_num('job_hanging', 'days', 7)::INT;
  v_login_n      INT     := public.journal_rule_num('login_failures', 'count', 5)::INT;
  v_login_min    INT     := public.journal_rule_num('login_failures', 'minutes', 60)::INT;
  v_export_rows  INT     := public.journal_rule_num('large_export', 'rows', 1000)::INT;
BEGIN
  v_reaped := public.journal_reap_runs();

  CREATE TEMP TABLE IF NOT EXISTS journal_findings (
    fingerprint TEXT PRIMARY KEY, rule_key TEXT, severity TEXT, system TEXT,
    connection_id UUID, market_id UUID, params JSONB, since TIMESTAMPTZ,
    affected_count INT, impact_amount NUMERIC, impact_currency TEXT
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.journal_findings;

  IF public.journal_rule_on('job_failing') THEN
  -- R1a · pg_cron jobs whose SQL itself fails (archiving, commissions, …).
  -- HTTP-invoked jobs always « succeed » here; their truth is in R1b.
  INSERT INTO pg_temp.journal_findings
  SELECT 'job:cron:' || j.jobname, 'job_failing', 'critical', 'jobs', NULL, NULL,
         jsonb_build_object('job', j.jobname, 'failures', s.streak,
                            'message', left(s.last_message, 300), 'kind', 'cron'),
         s.since, s.streak, NULL, NULL
    FROM cron.job j
    JOIN LATERAL (
      SELECT public.journal_fail_streak(array_agg(d.status ORDER BY d.start_time DESC)) AS streak,
             (array_agg(d.return_message ORDER BY d.start_time DESC))[1] AS last_message,
             NULL::TIMESTAMPTZ AS since
        FROM (SELECT status, return_message, start_time
                FROM cron.job_run_details
               WHERE jobid = j.jobid AND status IN ('succeeded', 'failed')
                 AND start_time > now() - interval '60 days'
               ORDER BY start_time DESC LIMIT 100) d
    ) s ON TRUE
   WHERE j.active AND s.streak >= v_fail_streak;

  -- since = start of the failing streak
  UPDATE pg_temp.journal_findings f
     SET since = (SELECT min(d.start_time) FROM (
                    SELECT d.start_time FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
                     WHERE j.jobname = f.params ->> 'job' AND d.status IN ('succeeded', 'failed')
                       AND d.start_time > now() - interval '60 days'
                     ORDER BY d.start_time DESC LIMIT (f.params ->> 'failures')::INT) d)
   WHERE f.rule_key = 'job_failing' AND f.params ->> 'kind' = 'cron';

  -- R1b · run tables: the job ran, and did not do its work.
  INSERT INTO pg_temp.journal_findings
  SELECT 'job:' || r.job || ':' || COALESCE(r.conn::TEXT, '-'), 'job_failing', 'critical',
         r.system, r.conn, r.market,
         jsonb_build_object('job', r.job, 'failures', r.streak, 'message', left(r.msg, 300), 'kind', 'run', 'name', r.name),
         r.since, r.streak, NULL, NULL
    FROM (
      SELECT 'darb-sync' AS job, 'carrier:' || c.id AS system, c.id AS conn, c.market_id AS market, c.name,
             x.streak, x.msg, x.since
        FROM public.carriers c
        JOIN LATERAL (
          SELECT public.journal_fail_streak(array_agg(status ORDER BY started_at DESC)) AS streak,
                 (array_agg(error_message ORDER BY started_at DESC))[1] AS msg,
                 min(started_at) FILTER (WHERE status = 'failed') AS since
            FROM (SELECT status, error_message, started_at FROM public.darb_sync_runs
                   WHERE carrier_id = c.id ORDER BY started_at DESC LIMIT 50) d
        ) x ON TRUE
       WHERE c.code = 'darb_assabil' AND c.is_active
      UNION ALL
      SELECT 'sheets-sync', 'shop:' || s.id, s.id, s.market_id, s.name, x.streak, x.msg, x.since
        FROM public.storefronts s
        JOIN LATERAL (
          SELECT public.journal_fail_streak(array_agg(status ORDER BY started_at DESC)) AS streak,
                 (array_agg(error ORDER BY started_at DESC))[1] AS msg,
                 min(started_at) FILTER (WHERE status = 'failed') AS since
            FROM (SELECT status, error, started_at FROM public.sheet_sync_runs
                   WHERE storefront_id = s.id AND status <> 'skipped_locked'
                   ORDER BY started_at DESC LIMIT 50) d
        ) x ON TRUE
       WHERE s.is_active
      UNION ALL
      SELECT 'meta-sync', 'meta', NULL, a.market_id, a.account_name, x.streak, x.msg, x.since
        FROM public.meta_ad_accounts a
        JOIN LATERAL (
          SELECT public.journal_fail_streak(array_agg(status ORDER BY started_at DESC)) AS streak,
                 (array_agg(error ORDER BY started_at DESC))[1] AS msg,
                 min(started_at) FILTER (WHERE status = 'failed') AS since
            FROM (SELECT status, error, started_at FROM public.ad_sync_runs
                   WHERE ad_account_id = a.ad_account_id AND status <> 'skipped_locked'
                   ORDER BY started_at DESC LIMIT 50) d
        ) x ON TRUE
       WHERE a.is_active
      UNION ALL
      SELECT k.job, 'jobs', NULL, NULL, NULL, x.streak, x.msg, x.since
        FROM (VALUES ('investor-rollup'), ('whatsapp-outbox'), ('darb-rates'), ('poll-carriers'), ('dispatch-scheduled')) k(job)
        JOIN LATERAL (
          SELECT public.journal_fail_streak(array_agg(status ORDER BY started_at DESC)) AS streak,
                 (array_agg(msg ORDER BY started_at DESC))[1] AS msg,
                 min(started_at) FILTER (WHERE status = 'failed') AS since
            FROM (
              SELECT status, error AS msg, started_at FROM public.investor_rollup_runs
               WHERE k.job = 'investor-rollup' AND status <> 'skipped_locked'
              UNION ALL
              SELECT status, error, started_at FROM public.whatsapp_outbox_runs
               WHERE k.job = 'whatsapp-outbox' AND status <> 'skipped_locked'
              UNION ALL
              SELECT status, notes, started_at FROM public.darb_rate_harvest_runs
               WHERE k.job = 'darb-rates'
              UNION ALL
              SELECT status, error, started_at FROM public.job_runs
               WHERE job = k.job AND status <> 'skipped'
              ORDER BY started_at DESC LIMIT 50
            ) d
        ) x ON TRUE
    ) r
   WHERE r.streak >= v_fail_streak;
  END IF;

  IF public.journal_rule_on('connection_silent') THEN
  -- R2a · an active Darb account that stopped syncing (cadence 10 min → 30 min).
  INSERT INTO pg_temp.journal_findings
  SELECT 'silent:' || c.id, 'connection_silent', 'critical', 'carrier:' || c.id, c.id, c.market_id,
         jsonb_build_object('name', c.name, 'last', last.started_at),
         last.started_at, NULL, NULL, NULL
    FROM public.carriers c
    LEFT JOIN LATERAL (SELECT max(started_at) AS started_at FROM public.darb_sync_runs WHERE carrier_id = c.id) last ON TRUE
   WHERE c.code = 'darb_assabil' AND c.is_active
     AND (last.started_at IS NULL OR last.started_at < now() - make_interval(mins => v_silent_min))
  ON CONFLICT (fingerprint) DO NOTHING;
  END IF;

  IF public.journal_rule_on('carrier_inactive') THEN
  -- R2b · an account switched off while parcels are still out with it.
  INSERT INTO pg_temp.journal_findings
  SELECT 'inactive:' || c.id, 'carrier_inactive', 'warning', 'carrier:' || c.id, c.id, c.market_id,
         jsonb_build_object('name', c.name,
                            'off_at', (SELECT max(e.occurred_at) FROM public.audit_events e
                                        WHERE e.entity_type = 'carriers' AND e.entity_id = c.id::TEXT
                                          AND e.changes -> 'is_active' ->> 1 = 'false'),
                            'no_news', x.no_news),
         x.oldest, x.n, x.amount, m.currency
    FROM public.carriers c
    JOIN public.markets m ON m.id = c.market_id
    JOIN LATERAL (
      SELECT count(*) AS n, sum(o.total_price) AS amount, min(o.updated_at) AS oldest,
             count(*) FILTER (WHERE o.updated_at < now() - make_interval(days => v_stale_days)) AS no_news
        FROM public.orders o
       WHERE o.carrier_id = c.id AND o.status = ANY (public.journal_in_flight_statuses())
    ) x ON x.n > 0
   WHERE NOT c.is_active;
  END IF;

  IF public.journal_rule_on('carrier_stuck') THEN
  -- R3 + R4 · statuses a carrier sends that Ordra refuses or does not know.
  INSERT INTO pg_temp.journal_findings
  SELECT 'stuck:' || g.carrier_code, 'carrier_stuck', 'critical',
         COALESCE('carrier:' || g.carrier_id, 'carrier:' || g.carrier_code), g.carrier_id, g.market_id,
         jsonb_build_object('carrier', g.carrier_code, 'name', g.name, 'causes', g.causes),
         g.since, g.parcels, g.amount, g.currency
    FROM (
      SELECT k.carrier_code,
             (array_agg(k.carrier_id) FILTER (WHERE k.carrier_id IS NOT NULL))[1] AS carrier_id,
             (array_agg(k.market_id) FILTER (WHERE k.market_id IS NOT NULL))[1] AS market_id,
             (array_agg(k.name) FILTER (WHERE k.name IS NOT NULL))[1] AS name,
             (array_agg(k.currency) FILTER (WHERE k.currency IS NOT NULL))[1] AS currency,
             sum(k.parcels)::INT AS parcels, sum(k.amount) AS amount, min(k.since) AS since,
             jsonb_agg(jsonb_build_object('reason', k.reason, 'parcels', k.parcels, 'amount', k.amount)
                       ORDER BY k.amount DESC NULLS LAST) AS causes
        FROM (
          SELECT l.carrier_code, l.outcome_reason AS reason,
                 (array_agg(o.carrier_id) FILTER (WHERE o.carrier_id IS NOT NULL))[1] AS carrier_id,
                 (array_agg(o.market_id) FILTER (WHERE o.market_id IS NOT NULL))[1] AS market_id,
                 (array_agg(c.name) FILTER (WHERE c.name IS NOT NULL))[1] AS name,
                 (array_agg(m.currency) FILTER (WHERE m.currency IS NOT NULL))[1] AS currency,
                 count(DISTINCT l.tracking_number) AS parcels,
                 (SELECT sum(o2.total_price) FROM public.orders o2
                   WHERE o2.id = ANY (array_agg(DISTINCT l.order_id))
                     AND o2.status NOT IN ('delivered', 'returned', 'cancelled', 'deleted', 'rejected')) AS amount,
                 min(l.created_at) AS since
            FROM public.carrier_event_log l
            LEFT JOIN public.orders o ON o.id = l.order_id
            LEFT JOIN public.carriers c ON c.id = o.carrier_id
            LEFT JOIN public.markets m ON m.id = o.market_id
           WHERE COALESCE(l.last_seen_at, l.created_at) > now() - make_interval(hours => v_stuck_h)
             AND ((l.outcome = 'ignored' AND l.outcome_reason LIKE 'unknown%')
               OR (l.outcome = 'error' AND l.outcome_reason LIKE 'invalid transition%'))
             AND (o.id IS NULL OR o.status NOT IN ('delivered', 'returned', 'cancelled', 'deleted', 'rejected'))
           GROUP BY l.carrier_code, l.outcome_reason
        ) k
       GROUP BY k.carrier_code
    ) g;
  END IF;

  IF public.journal_rule_on('import_rows') THEN
  -- R5 · imported rows refused and left aside for more than a day.
  INSERT INTO pg_temp.journal_findings
  SELECT 'import:' || s.id, 'import_rows', 'warning', 'shop:' || s.id, s.id, s.market_id,
         jsonb_build_object('name', s.name, 'platform', s.platform, 'message', x.top_message),
         x.since, x.n, NULL, NULL
    FROM public.storefronts s
    JOIN LATERAL (
      SELECT count(DISTINCT r.row_index)::INT AS n, min(r.created_at) AS since,
             mode() WITHIN GROUP (ORDER BY r.message) AS top_message
        FROM public.sheet_sync_failed_rows r
       WHERE r.storefront_id = s.id AND r.resolved_at IS NULL
         AND r.created_at < now() - make_interval(hours => v_import_h)
    ) x ON x.n > 0;
  END IF;

  IF public.journal_rule_on('upload_failing') THEN
  -- R6 · uploads refused in a burst.
  INSERT INTO pg_temp.journal_findings
  SELECT 'upload:' || COALESCE(c.connection_id::TEXT, c.system) || ':' || COALESCE(c.error_code, '-'),
         'upload_failing', 'warning', COALESCE('carrier:' || c.connection_id, 'carrier:' || c.system),
         c.connection_id, (array_agg(c.market_id))[1],
         jsonb_build_object('system', c.system, 'code', c.error_code,
                            'message', (array_agg(c.message ORDER BY c.occurred_at DESC))[1]),
         min(c.occurred_at), count(*)::INT, NULL, NULL
    FROM public.integration_calls c
   WHERE c.operation = 'upload' AND c.status <> 'ok' AND c.occurred_at > now() - make_interval(mins => v_upload_min)
   GROUP BY c.connection_id, c.system, c.error_code
  HAVING count(*) >= v_upload_n;
  END IF;

  IF public.journal_rule_on('whatsapp_down') THEN
  -- R9 · WhatsApp number paused or token lost.
  INSERT INTO pg_temp.journal_findings
  SELECT 'whatsapp:' || w.id, 'whatsapp_down', 'critical', 'whatsapp', w.id, w.market_id,
         jsonb_build_object('status', w.status, 'reason', left(w.status_reason, 200), 'phone', w.display_phone),
         w.updated_at, NULL, NULL, NULL
    FROM public.whatsapp_configs w
   WHERE w.status IN ('paused', 'auth_failed');
  END IF;

  IF public.journal_rule_on('ads_no_orders') THEN
  -- R10 · ads spending, no order for 12 h.
  INSERT INTO pg_temp.journal_findings
  SELECT 'ads-no-orders:' || m.id, 'ads_no_orders', 'warning', 'shops', NULL, m.id,
         jsonb_build_object('market', m.code, 'spend', sp.amount, 'last_order', lo.at),
         lo.at, NULL, sp.amount, m.currency
    FROM public.markets m
    JOIN LATERAL (SELECT sum(a.amount) AS amount FROM public.ad_spend a
                   WHERE a.market_id = m.id AND a.is_active AND a.period_end >= current_date - 1) sp ON sp.amount > 0
    JOIN LATERAL (SELECT max(o.created_at) AS at FROM public.orders o WHERE o.market_id = m.id) lo ON TRUE
   WHERE m.is_active AND (lo.at IS NULL OR lo.at < now() - make_interval(hours => v_ads_h));
  END IF;

  IF public.journal_rule_on('server_error') THEN
  -- R11 · Ordra's own server error, repeated.
  INSERT INTO pg_temp.journal_findings
  SELECT 'server:' || e.fingerprint, 'server_error', 'critical', 'app', NULL, NULL,
         jsonb_build_object('route', (array_agg(e.route))[1], 'method', (array_agg(e.method))[1],
                            'status', (array_agg(e.status ORDER BY e.occurred_at DESC))[1],
                            'code', (array_agg(e.error_code ORDER BY e.occurred_at DESC))[1],
                            'message', (array_agg(e.message ORDER BY e.occurred_at DESC))[1],
                            'cause_kind', (array_agg(e.cause_kind ORDER BY e.occurred_at DESC))[1],
                            'cause_code', (array_agg(e.cause_code ORDER BY e.occurred_at DESC))[1],
                            'cause_target', (array_agg(e.cause_target ORDER BY e.occurred_at DESC))[1],
                            'cause_detail', (array_agg(e.cause_detail ORDER BY e.occurred_at DESC))[1],
                            'users', count(DISTINCT e.actor_id),
                            'last', max(e.occurred_at)),
         (SELECT min(e2.occurred_at) FROM public.app_errors e2
           WHERE e2.fingerprint = e.fingerprint AND e2.occurred_at > now() - interval '30 days'),
         count(*)::INT, NULL, NULL
    FROM public.app_errors e
   WHERE e.occurred_at > now() - make_interval(hours => v_server_h)
     AND e.source = 'server'
   GROUP BY e.fingerprint
  HAVING count(*) >= v_server_n;
  END IF;

  IF public.journal_rule_on('login_failures') THEN
  -- R12 · sign-in failures on one account, and large exports.
  INSERT INTO pg_temp.journal_findings
  -- grouped by the account key (hash of the full address), never by the
  -- masked label: `ag•••@oms.local` is agent1.tn and agent2.tn at once.
  SELECT 'login:' || COALESCE(a.entity_id, a.entity_label), 'login_failures', 'warning', 'app', NULL, NULL,
         jsonb_build_object('account', max(a.entity_label), 'last', max(a.occurred_at)),
         min(a.occurred_at), count(*)::INT, NULL, NULL
    FROM public.audit_events a
   WHERE a.action = 'auth.login_failed' AND a.occurred_at > now() - make_interval(mins => v_login_min)
   GROUP BY COALESCE(a.entity_id, a.entity_label)
  HAVING count(*) >= v_login_n;
  END IF;

  IF public.journal_rule_on('large_export') THEN
  INSERT INTO pg_temp.journal_findings
  SELECT 'export:' || a.id, 'large_export', 'warning', 'app', NULL, a.market_id,
         jsonb_build_object('action', a.action, 'rows', (a.context ->> 'rows')::INT,
                            'actor', u.full_name, 'at', a.occurred_at),
         a.occurred_at, (a.context ->> 'rows')::INT, NULL, NULL
    FROM public.audit_events a
    LEFT JOIN public.users u ON u.id = a.actor_id
   WHERE a.action LIKE 'export.%' AND a.occurred_at > now() - interval '24 hours'
     AND COALESCE((a.context ->> 'rows')::INT, 0) > v_export_rows;
  END IF;

  -- R13 · an outside service failing (Darb, Navex, Meta, WhatsApp…), any call
  -- except upload, which R6 already watches. Failures only are recorded, at
  -- most one per minute per server instance (src/lib/journal/external-fetch.ts).
  IF public.journal_rule_on('external_failing') THEN
  INSERT INTO pg_temp.journal_findings
  SELECT 'ext:' || c.system || ':' || c.operation || ':' || COALESCE(c.http_status::TEXT, c.error_code, '-'),
         'external_failing', 'warning',
         CASE WHEN c.system IN ('meta', 'whatsapp') THEN c.system
              ELSE COALESCE('carrier:' || (array_agg(c.connection_id) FILTER (WHERE c.connection_id IS NOT NULL))[1], 'carrier:' || c.system) END,
         (array_agg(c.connection_id) FILTER (WHERE c.connection_id IS NOT NULL))[1],
         (array_agg(c.market_id) FILTER (WHERE c.market_id IS NOT NULL))[1],
         jsonb_build_object('system', c.system, 'operation', c.operation, 'http_status', c.http_status,
                            'code', (array_agg(c.error_code ORDER BY c.occurred_at DESC))[1],
                            'message', (array_agg(c.message ORDER BY c.occurred_at DESC))[1],
                            'last', max(c.occurred_at)),
         min(c.occurred_at), count(*)::INT, NULL, NULL
    FROM public.integration_calls c
   WHERE c.operation <> 'upload' AND c.status <> 'ok'
     AND c.occurred_at > now() - make_interval(mins => v_ext_min)
   GROUP BY c.system, c.operation, c.http_status, COALESCE(c.http_status::TEXT, c.error_code, '-')
  HAVING count(*) >= v_ext_n
  ON CONFLICT (fingerprint) DO NOTHING;
  END IF;

  -- R14 · a page that crashes in people's browsers (src/app/[locale]/error.tsx).
  IF public.journal_rule_on('browser_error') THEN
  INSERT INTO pg_temp.journal_findings
  SELECT 'browser:' || e.fingerprint, 'browser_error', 'warning', 'app', NULL, NULL,
         jsonb_build_object('page', (array_agg(e.route))[1],
                            'message', (array_agg(e.message ORDER BY e.occurred_at DESC))[1],
                            'cause_kind', 'code',
                            'cause_code', (array_agg(e.cause_code ORDER BY e.occurred_at DESC))[1],
                            'cause_target', (array_agg(e.cause_target ORDER BY e.occurred_at DESC))[1],
                            'cause_detail', (array_agg(e.cause_detail ORDER BY e.occurred_at DESC))[1],
                            'users', count(DISTINCT e.actor_id),
                            'last', max(e.occurred_at)),
         min(e.occurred_at), count(*)::INT, NULL, NULL
    FROM public.app_errors e
   WHERE e.source = 'browser' AND e.occurred_at > now() - make_interval(hours => v_browser_h)
   GROUP BY e.fingerprint
  HAVING count(*) >= v_browser_n OR count(DISTINCT e.actor_id) >= v_browser_u;
  END IF;

  -- R15 · a job that keeps hanging. journal_reap_runs() closes a run stuck
  -- « en cours » as failed, but the runs in between succeed, so R1's streak
  -- never reaches 2: poll-carriers hung at 04:30 three nights running unseen.
  IF public.journal_rule_on('job_hanging') THEN
  INSERT INTO pg_temp.journal_findings
  SELECT 'hang:' || h.job, 'job_hanging', 'warning', 'jobs', NULL, NULL,
         jsonb_build_object('job', h.job, 'n', h.n, 'last', h.last,
                            'hours', h.hours),
         h.first, h.n, NULL, NULL
    FROM (
      SELECT x.job, count(*)::INT AS n, min(x.at) AS first, max(x.at) AS last,
             string_agg(DISTINCT to_char(x.at AT TIME ZONE 'Africa/Tripoli', 'HH24:MI'), ', ') AS hours
        FROM (
          SELECT r.job, r.started_at AS at FROM public.job_runs r
           WHERE r.status = 'failed' AND r.error LIKE 'abandonné%'
          UNION ALL
          SELECT 'darb-sync', d.started_at FROM public.darb_sync_runs d
           WHERE d.status = 'failed' AND d.error_message LIKE 'abandonné%'
          UNION ALL
          SELECT 'sheets-sync', s.started_at FROM public.sheet_sync_runs s
           WHERE s.status = 'failed' AND s.error LIKE 'abandonné%'
          UNION ALL
          SELECT 'meta-sync', a.started_at FROM public.ad_sync_runs a
           WHERE a.status = 'failed' AND a.error LIKE 'abandonné%'
          UNION ALL
          SELECT 'whatsapp-outbox', w.started_at FROM public.whatsapp_outbox_runs w
           WHERE w.status = 'failed' AND w.error LIKE 'abandonné%'
        ) x
       WHERE x.at > now() - make_interval(days => v_hang_d)
       GROUP BY x.job
    ) h
   WHERE h.n >= v_hang_n;
  END IF;

  -- ── apply ────────────────────────────────────────────────────────────────
  INSERT INTO public.journal_issues AS i (
    fingerprint, rule_key, severity, system, connection_id, market_id, params,
    first_seen, last_seen, affected_count, impact_amount, impact_currency
  )
  SELECT f.fingerprint, f.rule_key, f.severity, f.system, f.connection_id, f.market_id, f.params,
         COALESCE(f.since, now()), now(), f.affected_count, f.impact_amount, f.impact_currency
    FROM pg_temp.journal_findings f
  ON CONFLICT (fingerprint) DO UPDATE SET
    rule_key        = EXCLUDED.rule_key,
    severity        = EXCLUDED.severity,
    system          = EXCLUDED.system,
    connection_id   = EXCLUDED.connection_id,
    market_id       = EXCLUDED.market_id,
    params          = EXCLUDED.params,
    last_seen       = now(),
    occurrences     = i.occurrences + 1,
    affected_count  = EXCLUDED.affected_count,
    impact_amount   = EXCLUDED.impact_amount,
    impact_currency = EXCLUDED.impact_currency,
    first_seen      = CASE WHEN i.status = 'resolved' THEN EXCLUDED.first_seen ELSE i.first_seen END,
    resolved_at     = NULL,
    status          = CASE
                        WHEN i.status = 'muted' AND i.muted_until > now() THEN 'muted'
                        ELSE 'open'
                      END,
    muted_until     = CASE WHEN i.status = 'muted' AND i.muted_until > now() THEN i.muted_until END;
  GET DIAGNOSTICS v_opened = ROW_COUNT;

  UPDATE public.journal_issues i
     SET status = 'resolved', resolved_at = now(), muted_until = NULL
   WHERE i.status IN ('open', 'muted')
     AND NOT EXISTS (SELECT 1 FROM pg_temp.journal_findings f WHERE f.fingerprint = i.fingerprint);
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN jsonb_build_object('reaped', v_reaped, 'current', v_opened, 'resolved', v_resolved);
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_detect() FROM PUBLIC, anon, authenticated;
