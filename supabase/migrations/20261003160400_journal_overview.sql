-- Journaux, phase 3 — Aperçu in one call: « est-ce que tout marche ? »
-- (prototypes/journaux-v2.html, the overview screen).
--
-- Returns { issues, systems, jobs, security, generated_at }.
--
-- SYSTEMS — one tile each, decided from the data, not a fixed list:
--   carrier:<id>  every carrier account that is active and used in the last
--                 30 days, or still holds parcels, or has a problem
--   shop:<id>     the (at most 3) shops that brought orders in 30 days
--   shops         every other active shop, as one calm tile
--   meta          the ad accounts            whatsapp  the business number
--   jobs          the scheduled jobs         app       Ordra itself
-- A tile's `state` is the worst open problem pointing at it, else what its
-- own activity says: ok · mute (nothing expected, with a reason) · off.
-- `bars` is 48 characters, one per hour, oldest first:
--   o worked · i ran, nothing new · f failed · m expected and absent · - not expected

CREATE OR REPLACE FUNCTION public.journal_hour_bars(p_at TIMESTAMPTZ[], p_s TEXT[], p_expect BOOLEAN)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT string_agg(COALESCE(
           (SELECT CASE WHEN bool_or(u.s = 'f') THEN 'f' WHEN bool_or(u.s = 'o') THEN 'o'
                        WHEN bool_or(u.s = 'i') THEN 'i' END
              FROM unnest(p_at, p_s) AS u(at, s)
             WHERE u.at >= h AND u.at < h + interval '1 hour'),
           CASE WHEN p_expect THEN 'm' ELSE '-' END), '' ORDER BY h)
    FROM generate_series(date_trunc('hour', now()) - interval '47 hours', date_trunc('hour', now()), interval '1 hour') AS h
$$;

CREATE OR REPLACE FUNCTION public.journal_overview()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_since48 TIMESTAMPTZ := date_trunc('hour', now()) - interval '47 hours';
  v_issues JSONB;
  v_systems JSONB := '[]'::jsonb;
  v_jobs JSONB;
  v_security JSONB;
  v_featured UUID[];
  r RECORD;
BEGIN
  PERFORM public.journal_assert_super_admin();

  -- ── problems ──
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.id, 'rule', i.rule_key, 'severity', i.severity, 'system', i.system,
           'params', i.params, 'first_seen', i.first_seen, 'last_seen', i.last_seen,
           'affected', i.affected_count, 'amount', i.impact_amount, 'currency', i.impact_currency,
           'status', i.status, 'muted_until', i.muted_until, 'market', m.code)
         ORDER BY (i.status = 'muted'), (i.severity <> 'critical'), i.impact_amount DESC NULLS LAST,
                  i.affected_count DESC NULLS LAST, i.first_seen), '[]'::jsonb)
    INTO v_issues
    FROM public.journal_issues i
    LEFT JOIN public.markets m ON m.id = i.market_id
   WHERE i.status IN ('open', 'muted');

  -- ── carriers ──
  FOR r IN
    SELECT c.id, c.name, c.code, c.is_active, m.code AS market,
           (SELECT count(*) FROM public.orders o
             WHERE o.carrier_id = c.id AND o.status = ANY (public.journal_in_flight_statuses())) AS parcels,
           CASE WHEN c.code = 'darb_assabil'
                THEN (SELECT max(COALESCE(d.finished_at, d.started_at)) FROM public.darb_sync_runs d
                       WHERE d.carrier_id = c.id AND d.status IN ('succeeded', 'partial'))
                ELSE GREATEST(
                       (SELECT max(j.finished_at) FROM public.job_runs j WHERE j.job = 'poll-carriers' AND j.status IN ('succeeded', 'partial')),
                       (SELECT max(l.created_at) FROM public.carrier_event_log l WHERE l.carrier_code = c.code))
           END AS last_at,
           EXISTS (SELECT 1 FROM public.orders o WHERE o.carrier_id = c.id AND o.updated_at > now() - interval '30 days') AS used,
           (SELECT jsonb_agg(i.id) FROM public.journal_issues i
             WHERE i.status = 'open' AND (i.connection_id = c.id OR i.system = 'carrier:' || c.id)) AS issue_ids,
           (SELECT max(CASE i.severity WHEN 'critical' THEN 2 ELSE 1 END) FROM public.journal_issues i
             WHERE i.status = 'open' AND (i.connection_id = c.id OR i.system = 'carrier:' || c.id)) AS worst
      FROM public.carriers c JOIN public.markets m ON m.id = c.market_id
     ORDER BY m.code DESC, c.name
  LOOP
    CONTINUE WHEN NOT ((r.is_active AND (r.used OR r.code = 'darb_assabil')) OR r.parcels > 0 OR r.worst IS NOT NULL);
    v_systems := v_systems || jsonb_build_object(
      'id', 'carrier:' || r.id, 'family', 'carrier', 'kind', r.code, 'name', r.name, 'market', r.market,
      'state', CASE WHEN r.worst = 2 THEN 'fail' WHEN r.worst = 1 THEN 'warn'
                    WHEN NOT r.is_active THEN 'off' ELSE 'ok' END,
      'reason', CASE WHEN r.worst IS NOT NULL THEN 'issue'
                     WHEN NOT r.is_active THEN 'disabled' ELSE 'in_service' END,
      'last_at', r.last_at,
      'detail', jsonb_build_object('parcels', r.parcels),
      'issue_ids', COALESCE(r.issue_ids, '[]'::jsonb),
      'bars', CASE WHEN r.code = 'darb_assabil' THEN (
                SELECT public.journal_hour_bars(
                         array_agg(d.started_at),
                         array_agg(CASE WHEN d.status = 'failed' THEN 'f' ELSE 'o' END),
                         r.is_active)
                  FROM public.darb_sync_runs d
                 WHERE d.carrier_id = r.id AND d.started_at >= v_since48 AND d.status <> 'running') END);
  END LOOP;

  -- ── shops: the busiest three get their own tile ──
  SELECT array_agg(x.id) INTO v_featured FROM (
    SELECT s.id FROM public.storefronts s
      JOIN public.orders o ON o.storefront_id = s.id AND o.created_at > now() - interval '30 days'
     WHERE s.is_active
     GROUP BY s.id ORDER BY count(*) DESC LIMIT 3) x;

  FOR r IN
    SELECT s.id, s.name, s.platform, m.code AS market, m.id AS market_id,
           (SELECT max(o.created_at) FROM public.orders o WHERE o.storefront_id = s.id) AS last_order,
           (SELECT count(*) FROM public.orders o WHERE o.storefront_id = s.id AND o.created_at > now() - interval '24 hours') AS orders_24h,
           (SELECT COALESCE(sum(a.amount), 0) FROM public.ad_spend a
             WHERE a.market_id = s.market_id AND a.is_active AND a.period_end >= current_date - 1) AS spend_2d,
           (SELECT max(a.period_end) FROM public.ad_spend a
             WHERE a.market_id = s.market_id AND a.is_active AND a.amount > 0) AS last_spend_day,
           (SELECT jsonb_agg(i.id) FROM public.journal_issues i WHERE i.status = 'open' AND i.system = 'shop:' || s.id) AS issue_ids,
           (SELECT max(CASE i.severity WHEN 'critical' THEN 2 ELSE 1 END) FROM public.journal_issues i
             WHERE i.status = 'open' AND i.system = 'shop:' || s.id) AS worst
      FROM public.storefronts s JOIN public.markets m ON m.id = s.market_id
     WHERE s.id = ANY (COALESCE(v_featured, '{}'))
  LOOP
    v_systems := v_systems || jsonb_build_object(
      'id', 'shop:' || r.id, 'family', 'intake', 'kind', r.platform, 'name', r.name, 'market', r.market,
      'state', CASE WHEN r.worst = 2 THEN 'fail' WHEN r.worst = 1 THEN 'warn'
                    WHEN r.last_order > now() - interval '24 hours' THEN 'ok' ELSE 'mute' END,
      'reason', CASE WHEN r.worst IS NOT NULL THEN 'issue'
                     WHEN r.last_order > now() - interval '24 hours' THEN 'receiving'
                     WHEN r.spend_2d = 0 THEN 'ads_stopped' ELSE 'calm' END,
      'last_at', r.last_order,
      'detail', jsonb_build_object('orders_24h', r.orders_24h, 'ads_until', r.last_spend_day),
      'issue_ids', COALESCE(r.issue_ids, '[]'::jsonb),
      'bars', (SELECT public.journal_hour_bars(array_agg(e.at), array_agg(e.s), FALSE)
                 FROM (SELECT o.created_at AS at, 'o' AS s FROM public.orders o
                        WHERE o.storefront_id = r.id AND o.created_at >= v_since48
                       UNION ALL
                       SELECT q.started_at, CASE WHEN q.status = 'failed' THEN 'f' ELSE 'i' END
                         FROM public.sheet_sync_runs q
                        WHERE q.storefront_id = r.id AND q.started_at >= v_since48 AND q.status <> 'running') e));
  END LOOP;

  v_systems := v_systems || COALESCE((
    SELECT jsonb_build_object(
      'id', 'shops', 'family', 'intake', 'kind', 'shops', 'name', NULL, 'market', NULL,
      'state', CASE WHEN bool_or(w.worst = 2) THEN 'fail' WHEN bool_or(w.worst = 1) THEN 'warn'
                    WHEN max(w.last_order) > now() - interval '24 hours' THEN 'ok' ELSE 'mute' END,
      'reason', CASE WHEN bool_or(w.worst IS NOT NULL) THEN 'issue'
                     WHEN max(w.last_order) > now() - interval '24 hours' THEN 'receiving' ELSE 'calm' END,
      'last_at', max(w.last_order),
      'detail', jsonb_build_object('count', count(DISTINCT w.id),
                                   'webhook_at', max(w.last_webhook),
                                   'orders_24h', COALESCE(sum(w.orders_24h), 0)),
      'issue_ids', COALESCE(jsonb_agg(w.issue_id) FILTER (WHERE w.issue_id IS NOT NULL), '[]'::jsonb),
      'bars', NULL)
      FROM (
        SELECT s.id, s.last_webhook_received_at AS last_webhook,
               (SELECT max(o.created_at) FROM public.orders o WHERE o.storefront_id = s.id) AS last_order,
               (SELECT count(*) FROM public.orders o WHERE o.storefront_id = s.id AND o.created_at > now() - interval '24 hours') AS orders_24h,
               i.id AS issue_id,
               CASE i.severity WHEN 'critical' THEN 2 WHEN 'warning' THEN 1 END AS worst
          FROM public.storefronts s
          LEFT JOIN public.journal_issues i ON i.status = 'open' AND i.system = 'shop:' || s.id
         WHERE s.is_active AND NOT (s.id = ANY (COALESCE(v_featured, '{}')))
      ) w
    HAVING count(*) > 0), '[]'::jsonb);

  -- ── Meta ──
  IF EXISTS (SELECT 1 FROM public.meta_ad_accounts WHERE is_active) THEN
    v_systems := v_systems || (
      SELECT jsonb_build_object(
        'id', 'meta', 'family', 'ads', 'kind', 'meta', 'name', 'Meta',
        'market', CASE WHEN count(DISTINCT a.market_id) = 1 THEN (SELECT code FROM public.markets WHERE id = min(a.market_id::TEXT)::UUID) END,
        -- hourly sync: nothing good for 3 hours is a silence worth a look
        'state', CASE WHEN bool_or(i.severity = 'critical') THEN 'fail' WHEN bool_or(i.id IS NOT NULL) THEN 'warn'
                      WHEN COALESCE((SELECT max(s.started_at) FROM public.ad_sync_runs s WHERE s.status = 'succeeded'),
                                    '-infinity') < now() - interval '3 hours' THEN 'warn'
                      ELSE 'ok' END,
        'reason', CASE WHEN bool_or(i.id IS NOT NULL) THEN 'issue'
                       WHEN COALESCE((SELECT max(s.started_at) FROM public.ad_sync_runs s WHERE s.status = 'succeeded'),
                                     '-infinity') < now() - interval '3 hours' THEN 'silent'
                       ELSE 'in_service' END,
        'last_at', (SELECT max(COALESCE(s.finished_at, s.started_at)) FROM public.ad_sync_runs s WHERE s.status = 'succeeded'),
        'detail', jsonb_build_object('accounts', count(DISTINCT a.id)),
        'issue_ids', COALESCE(jsonb_agg(DISTINCT i.id) FILTER (WHERE i.id IS NOT NULL), '[]'::jsonb),
        'bars', (SELECT public.journal_hour_bars(array_agg(s.started_at),
                          array_agg(CASE WHEN s.status = 'failed' THEN 'f' ELSE 'o' END), TRUE)
                   FROM public.ad_sync_runs s WHERE s.started_at >= v_since48 AND s.status IN ('succeeded', 'partial', 'failed')))
        FROM public.meta_ad_accounts a
        LEFT JOIN public.journal_issues i ON i.status = 'open' AND i.system = 'meta'
       WHERE a.is_active);
  END IF;

  -- ── WhatsApp ──
  v_systems := v_systems || COALESCE((
    SELECT jsonb_build_object(
      'id', 'whatsapp', 'family', 'msg', 'kind', 'whatsapp', 'name', 'WhatsApp',
      'market', CASE WHEN count(*) = 1 THEN (SELECT code FROM public.markets WHERE id = min(w.market_id::TEXT)::UUID) END,
      'state', CASE WHEN bool_or(w.status IN ('paused', 'auth_failed')) THEN 'fail' ELSE 'ok' END,
      'reason', CASE WHEN bool_or(w.status IN ('paused', 'auth_failed')) THEN 'issue' ELSE 'in_service' END,
      'last_at', max(w.last_webhook_at),
      'detail', jsonb_build_object('numbers', count(*)),
      'issue_ids', COALESCE((SELECT jsonb_agg(i.id) FROM public.journal_issues i WHERE i.status = 'open' AND i.system = 'whatsapp'), '[]'::jsonb),
      'bars', NULL)
      FROM public.whatsapp_configs w
    HAVING count(*) > 0),
    jsonb_build_object('id', 'whatsapp', 'family', 'msg', 'kind', 'whatsapp', 'name', 'WhatsApp', 'market', NULL,
                       'state', 'off', 'reason', 'not_connected', 'last_at', NULL, 'detail', '{}'::jsonb,
                       'issue_ids', '[]'::jsonb, 'bars', NULL));

  -- ── jobs: cron's own verdict, corrected by what the run tables say ──
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'job', j.jobname, 'schedule', j.schedule,
           'last_at', lr.start_time, 'cron_status', lr.status,
           'state', CASE WHEN fi.id IS NOT NULL THEN 'fail'
                         WHEN lr.status = 'failed' THEN 'warn'
                         WHEN lr.status IS NULL THEN 'mute' ELSE 'ok' END,
           'issue_id', fi.id,
           'result', res.result)
         ORDER BY (fi.id IS NULL), j.jobname), '[]'::jsonb)
    INTO v_jobs
    FROM cron.job j
    LEFT JOIN (VALUES
      ('darb-sync-10min', 'darb-sync'), ('google-sheets-sync', 'sheets-sync'), ('meta-ads-sync', 'meta-sync'),
      ('investor-rollup-15min', 'investor-rollup'), ('investor-rollup-nightly', 'investor-rollup'),
      ('whatsapp-outbox-1min', 'whatsapp-outbox'), ('darb-rates-harvest-nightly', 'darb-rates'),
      ('carrier-polling-10min', 'poll-carriers'), ('dispatch-scheduled-5min', 'dispatch-scheduled')
    ) AS map(jobname, run_key) ON map.jobname = j.jobname
    LEFT JOIN LATERAL (
      SELECT d.start_time, d.status FROM cron.job_run_details d
       WHERE d.jobid = j.jobid AND d.status IN ('succeeded', 'failed')
       ORDER BY d.runid DESC LIMIT 1
    ) lr ON TRUE
    LEFT JOIN LATERAL (
      SELECT i.id FROM public.journal_issues i
       WHERE i.status = 'open' AND i.rule_key = 'job_failing'
         AND (i.params ->> 'job' = j.jobname OR i.params ->> 'job' = map.run_key)
       LIMIT 1
    ) fi ON TRUE
    LEFT JOIN LATERAL (
      SELECT CASE map.run_key
        WHEN 'darb-sync' THEN (SELECT jsonb_build_object('status', d.status, 'seen', d.shipments_seen, 'changed', d.orders_promoted)
                                 FROM public.darb_sync_runs d WHERE d.status <> 'running' ORDER BY d.started_at DESC LIMIT 1)
        WHEN 'sheets-sync' THEN (SELECT jsonb_build_object('status', s.status, 'changed', s.rows_imported)
                                   FROM public.sheet_sync_runs s WHERE s.status <> 'running' ORDER BY s.started_at DESC LIMIT 1)
        WHEN 'meta-sync' THEN (SELECT jsonb_build_object('status', s.status, 'rows', s.rows_upserted)
                                 FROM public.ad_sync_runs s WHERE s.status <> 'running' ORDER BY s.started_at DESC LIMIT 1)
        WHEN 'investor-rollup' THEN (SELECT jsonb_build_object('status', s.status, 'seen', s.orders_scanned, 'changed', s.facts_changed)
                                       FROM public.investor_rollup_runs s WHERE s.status <> 'running' ORDER BY s.started_at DESC LIMIT 1)
        WHEN 'whatsapp-outbox' THEN (SELECT jsonb_build_object('status', s.status, 'changed', s.sent, 'failed', s.failed)
                                       FROM public.whatsapp_outbox_runs s WHERE s.status <> 'running' ORDER BY s.started_at DESC LIMIT 1)
        WHEN 'darb-rates' THEN (SELECT jsonb_build_object('status', s.status, 'changed', s.succeeded)
                                  FROM public.darb_rate_harvest_runs s WHERE s.status <> 'running' ORDER BY s.started_at DESC LIMIT 1)
        WHEN 'poll-carriers' THEN (SELECT jsonb_build_object('status', s.status, 'changed', s.changed) || s.counters
                                     FROM public.job_runs s WHERE s.job = 'poll-carriers' AND s.status <> 'running' ORDER BY s.started_at DESC LIMIT 1)
        WHEN 'dispatch-scheduled' THEN (SELECT jsonb_build_object('status', s.status, 'changed', s.changed) || s.counters
                                          FROM public.job_runs s WHERE s.job = 'dispatch-scheduled' AND s.status <> 'running' ORDER BY s.started_at DESC LIMIT 1)
      END AS result
    ) res ON TRUE
   WHERE j.active;

  v_systems := v_systems || jsonb_build_object(
    'id', 'jobs', 'family', 'auto', 'kind', 'jobs', 'name', NULL, 'market', NULL,
    'state', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_jobs) e WHERE e ->> 'state' = 'fail') THEN 'fail' ELSE 'ok' END,
    'reason', 'jobs', 'last_at', NULL,
    'detail', jsonb_build_object('total', jsonb_array_length(v_jobs),
                                 'failing', (SELECT count(*) FROM jsonb_array_elements(v_jobs) e WHERE e ->> 'state' = 'fail')),
    'issue_ids', COALESCE((SELECT jsonb_agg(e -> 'issue_id') FROM jsonb_array_elements(v_jobs) e WHERE e ->> 'issue_id' IS NOT NULL), '[]'::jsonb),
    'bars', NULL);

  -- ── Ordra itself ──
  SELECT jsonb_build_object(
           'errors', (SELECT count(*) FROM public.app_errors WHERE occurred_at > now() - interval '24 hours'),
           'logins', (SELECT count(*) FROM public.audit_events WHERE action = 'auth.login' AND occurred_at > now() - interval '24 hours'),
           'login_failures', (SELECT count(*) FROM public.audit_events WHERE action = 'auth.login_failed' AND occurred_at > now() - interval '24 hours'),
           'exports', (SELECT count(*) FROM public.audit_events WHERE action LIKE 'export.%' AND occurred_at > now() - interval '24 hours'),
           'role_changes', (SELECT count(*) FROM public.audit_events WHERE entity_type = 'users'
                              AND (changes ? 'role' OR changes ? 'market_id') AND occurred_at > now() - interval '24 hours'),
           'repeated', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'params', i.params, 'affected', i.affected_count))
                                   FROM public.journal_issues i WHERE i.status = 'open' AND i.rule_key = 'server_error'), '[]'::jsonb))
    INTO v_security;

  v_systems := v_systems || jsonb_build_object(
    'id', 'app', 'family', 'app', 'kind', 'app', 'name', 'Ordra', 'market', NULL,
    'state', CASE WHEN EXISTS (SELECT 1 FROM public.journal_issues i WHERE i.status = 'open' AND i.system = 'app' AND i.severity = 'critical') THEN 'fail'
                  WHEN EXISTS (SELECT 1 FROM public.journal_issues i WHERE i.status = 'open' AND i.system = 'app') THEN 'warn'
                  ELSE 'ok' END,
    'reason', 'app', 'last_at', NULL,
    'detail', v_security - 'repeated',
    'issue_ids', COALESCE((SELECT jsonb_agg(i.id) FROM public.journal_issues i WHERE i.status = 'open' AND i.system = 'app'), '[]'::jsonb),
    'bars', NULL);

  RETURN jsonb_build_object('issues', v_issues, 'systems', v_systems, 'jobs', v_jobs,
                            'security', v_security, 'generated_at', now());
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journal_overview() TO authenticated;
