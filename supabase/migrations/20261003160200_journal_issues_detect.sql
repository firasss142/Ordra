-- Journaux, phase 2 — problems (plans/journaux-redesign.md §3.2, rules R1–R12).
--
-- A problem is a CAUSE, not a line: 26 027 identical « Livrer Paye » rows are
-- one problem « 139 parcels stuck at Navex ». journal_detect() runs every
-- 5 minutes, recomputes what is wrong right now, and:
--   * opens a problem the first time its fingerprint appears,
--   * refreshes its figures while it is still true,
--   * CLOSES it by itself as soon as the rule stops firing — nobody has to
--     remember to tick « résolu »,
--   * reopens it if it comes back; a muted problem stays quiet until its date.
--
-- The text a person reads is NOT stored here: rule_key + params go to the
-- screen, which words them through next-intl (fr, and ar for parity).
--
-- RULES (each finding names its rule in rule_key)
--   job_failing        R1  a scheduled job or a run table fails ≥ 2 times in a row
--   connection_silent  R2  an active Darb account has not synced for 30 min
--   carrier_inactive   R2  an inactive carrier account still has parcels out
--   carrier_stuck      R3+R4  a carrier's statuses are unknown or refused
--                          (both causes in one problem, per carrier)
--   import_rows        R5  imported rows refused for more than 24 h
--   upload_failing     R6  ≥ 3 uploads refused in 1 h, per carrier and code
--   whatsapp_down      R9  the WhatsApp number is paused or lost its token
--   ads_no_orders      R10 ads are spending but no order arrived for 12 h
--   server_error       R11 the same server error ≥ 3 times in 24 h
--   login_failures     R12 ≥ 5 failed sign-ins on one account in 1 h
--   large_export       R12 an export of more than 1 000 rows in 24 h
-- R7 (bad webhook signature) and R8 (stuck runs) are not separate rules: no
-- signature failure is written anywhere yet, and stuck runs are closed as
-- failed by journal_reap_runs(), after which R1 sees them.

CREATE TABLE public.journal_issues (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint      TEXT NOT NULL UNIQUE,
  rule_key         TEXT NOT NULL,
  severity         TEXT NOT NULL CHECK (severity IN ('critical', 'warning')),
  system           TEXT NOT NULL,
  connection_id    UUID,
  market_id        UUID REFERENCES public.markets(id),
  params           JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrences      INT NOT NULL DEFAULT 1,
  affected_count   INT,
  impact_amount    NUMERIC,
  impact_currency  TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'muted')),
  resolved_at      TIMESTAMPTZ,
  muted_until      TIMESTAMPTZ,
  muted_by         UUID
);
CREATE INDEX journal_issues_status_idx ON public.journal_issues (status, severity);

ALTER TABLE public.journal_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "journal_issues_select_super_admin"
  ON public.journal_issues FOR SELECT TO authenticated
  USING ((SELECT public.get_user_role()) = 'super_admin');
REVOKE ALL ON public.journal_issues FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.journal_issues FROM authenticated;

-- Parcels a carrier still holds: past the warehouse, not yet terminal.
CREATE OR REPLACE FUNCTION public.journal_in_flight_statuses()
RETURNS public.order_status[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY['scanned', 'at_carrier', 'dispatched', 'deposit', 'in_transit', 'out_for_delivery',
               'delivery_delayed', 'unverified', 'returning', 'to_be_returned']::public.order_status[]
$$;

-- How many of the newest runs failed in a row, given statuses newest first.
CREATE OR REPLACE FUNCTION public.journal_fail_streak(p_statuses TEXT[])
RETURNS INT LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_n INT := 0;
  v_s TEXT;
BEGIN
  FOREACH v_s IN ARRAY COALESCE(p_statuses, '{}') LOOP
    EXIT WHEN v_s <> 'failed';
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.journal_detect()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reaped INT;
  v_opened INT;
  v_resolved INT;
BEGIN
  v_reaped := public.journal_reap_runs();

  CREATE TEMP TABLE IF NOT EXISTS journal_findings (
    fingerprint TEXT PRIMARY KEY, rule_key TEXT, severity TEXT, system TEXT,
    connection_id UUID, market_id UUID, params JSONB, since TIMESTAMPTZ,
    affected_count INT, impact_amount NUMERIC, impact_currency TEXT
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.journal_findings;

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
   WHERE j.active AND s.streak >= 2;

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
   WHERE r.streak >= 2;

  -- R2a · an active Darb account that stopped syncing (cadence 10 min → 30 min).
  INSERT INTO pg_temp.journal_findings
  SELECT 'silent:' || c.id, 'connection_silent', 'critical', 'carrier:' || c.id, c.id, c.market_id,
         jsonb_build_object('name', c.name, 'last', last.started_at),
         last.started_at, NULL, NULL, NULL
    FROM public.carriers c
    LEFT JOIN LATERAL (SELECT max(started_at) AS started_at FROM public.darb_sync_runs WHERE carrier_id = c.id) last ON TRUE
   WHERE c.code = 'darb_assabil' AND c.is_active
     AND (last.started_at IS NULL OR last.started_at < now() - interval '30 minutes')
  ON CONFLICT (fingerprint) DO NOTHING;

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
             count(*) FILTER (WHERE o.updated_at < now() - interval '7 days') AS no_news
        FROM public.orders o
       WHERE o.carrier_id = c.id AND o.status = ANY (public.journal_in_flight_statuses())
    ) x ON x.n > 0
   WHERE NOT c.is_active;

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
           WHERE COALESCE(l.last_seen_at, l.created_at) > now() - interval '24 hours'
             AND ((l.outcome = 'ignored' AND l.outcome_reason LIKE 'unknown%')
               OR (l.outcome = 'error' AND l.outcome_reason LIKE 'invalid transition%'))
             AND (o.id IS NULL OR o.status NOT IN ('delivered', 'returned', 'cancelled', 'deleted', 'rejected'))
           GROUP BY l.carrier_code, l.outcome_reason
        ) k
       GROUP BY k.carrier_code
    ) g;

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
         AND r.created_at < now() - interval '24 hours'
    ) x ON x.n > 0;

  -- R6 · uploads refused in a burst.
  INSERT INTO pg_temp.journal_findings
  SELECT 'upload:' || COALESCE(c.connection_id::TEXT, c.system) || ':' || COALESCE(c.error_code, '-'),
         'upload_failing', 'warning', COALESCE('carrier:' || c.connection_id, 'carrier:' || c.system),
         c.connection_id, (array_agg(c.market_id))[1],
         jsonb_build_object('system', c.system, 'code', c.error_code,
                            'message', (array_agg(c.message ORDER BY c.occurred_at DESC))[1]),
         min(c.occurred_at), count(*)::INT, NULL, NULL
    FROM public.integration_calls c
   WHERE c.operation = 'upload' AND c.status <> 'ok' AND c.occurred_at > now() - interval '1 hour'
   GROUP BY c.connection_id, c.system, c.error_code
  HAVING count(*) >= 3;

  -- R9 · WhatsApp number paused or token lost.
  INSERT INTO pg_temp.journal_findings
  SELECT 'whatsapp:' || w.id, 'whatsapp_down', 'critical', 'whatsapp', w.id, w.market_id,
         jsonb_build_object('status', w.status, 'reason', left(w.status_reason, 200), 'phone', w.display_phone),
         w.updated_at, NULL, NULL, NULL
    FROM public.whatsapp_configs w
   WHERE w.status IN ('paused', 'auth_failed');

  -- R10 · ads spending, no order for 12 h.
  INSERT INTO pg_temp.journal_findings
  SELECT 'ads-no-orders:' || m.id, 'ads_no_orders', 'warning', 'shops', NULL, m.id,
         jsonb_build_object('market', m.code, 'spend', sp.amount, 'last_order', lo.at),
         lo.at, NULL, sp.amount, m.currency
    FROM public.markets m
    JOIN LATERAL (SELECT sum(a.amount) AS amount FROM public.ad_spend a
                   WHERE a.market_id = m.id AND a.is_active AND a.period_end >= current_date - 1) sp ON sp.amount > 0
    JOIN LATERAL (SELECT max(o.created_at) AS at FROM public.orders o WHERE o.market_id = m.id) lo ON TRUE
   WHERE m.is_active AND (lo.at IS NULL OR lo.at < now() - interval '12 hours');

  -- R11 · Ordra's own server error, repeated.
  INSERT INTO pg_temp.journal_findings
  SELECT 'server:' || e.fingerprint, 'server_error', 'critical', 'app', NULL, NULL,
         jsonb_build_object('route', (array_agg(e.route))[1], 'method', (array_agg(e.method))[1],
                            'status', (array_agg(e.status ORDER BY e.occurred_at DESC))[1],
                            'code', (array_agg(e.error_code ORDER BY e.occurred_at DESC))[1],
                            'message', (array_agg(e.message ORDER BY e.occurred_at DESC))[1],
                            'last', max(e.occurred_at)),
         (SELECT min(e2.occurred_at) FROM public.app_errors e2
           WHERE e2.fingerprint = e.fingerprint AND e2.occurred_at > now() - interval '30 days'),
         count(*)::INT, NULL, NULL
    FROM public.app_errors e
   WHERE e.occurred_at > now() - interval '24 hours'
   GROUP BY e.fingerprint
  HAVING count(*) >= 3;

  -- R12 · sign-in failures on one account, and large exports.
  INSERT INTO pg_temp.journal_findings
  SELECT 'login:' || a.entity_label, 'login_failures', 'warning', 'app', NULL, NULL,
         jsonb_build_object('account', a.entity_label, 'last', max(a.occurred_at)),
         min(a.occurred_at), count(*)::INT, NULL, NULL
    FROM public.audit_events a
   WHERE a.action = 'auth.login_failed' AND a.occurred_at > now() - interval '1 hour'
   GROUP BY a.entity_label
  HAVING count(*) >= 5;

  INSERT INTO pg_temp.journal_findings
  SELECT 'export:' || a.id, 'large_export', 'warning', 'app', NULL, a.market_id,
         jsonb_build_object('action', a.action, 'rows', (a.context ->> 'rows')::INT,
                            'actor', u.full_name, 'at', a.occurred_at),
         a.occurred_at, (a.context ->> 'rows')::INT, NULL, NULL
    FROM public.audit_events a
    LEFT JOIN public.users u ON u.id = a.actor_id
   WHERE a.action LIKE 'export.%' AND a.occurred_at > now() - interval '24 hours'
     AND COALESCE((a.context ->> 'rows')::INT, 0) > 1000;

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

-- Mute a problem for N days (the « Ignorer 7 jours » button). super_admin only.
CREATE OR REPLACE FUNCTION public.journal_issue_mute(p_issue_id UUID, p_days INT DEFAULT 7)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'réservé au super_admin' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN
    RAISE EXCEPTION 'durée invalide' USING ERRCODE = '22023';
  END IF;
  UPDATE public.journal_issues
     SET status = 'muted', muted_until = now() + make_interval(days => p_days), muted_by = auth.uid()
   WHERE id = p_issue_id AND status <> 'resolved';
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_issue_mute(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journal_issue_mute(UUID, INT) TO authenticated;

SELECT cron.schedule('journal-detect-5min', '*/5 * * * *', $$ SELECT public.journal_detect(); $$);
