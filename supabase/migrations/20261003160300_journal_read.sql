-- Journaux, phase 3 — what the screen reads (plans/journaux-redesign.md §3.3).
--
--   journal_overview()        Aperçu: problems, one tile per system, the job
--                             list, the security counters — one round trip
--   journal_feed(...)         Historique: ONE stream (systèmes externes, équipe,
--                             automatique, sécurité et erreurs), keyset-paged
--   journal_routine(...)      routine passes per day (« 312 passages sans
--                             changement »): counted, never listed
--   journal_order_trace(id)   everything that happened to one order, in order
--   journal_find_order(q)     order number / tracking number → order ids
--   journal_counts()          the sidebar badge
--
-- All SECURITY DEFINER with the super_admin check INSIDE: Journaux is the
-- administrator's (decided with Réglages), and the sources span tables whose
-- own RLS would otherwise each need a policy. Rows carry KEYS and PARAMS, never
-- sentences: the screen words them through next-intl.
--
-- A FEED ROW: (at, id, family, kind, severity, actor, market, order, params,
-- ref). `family` is the chip it belongs to (ext | team | auto | sec),
-- `severity` is NULL for normal work — success carries no colour — and `ref`
-- names the panel a click opens. Series (« 7 tentatives ») are merged by the
-- screen (src/lib/journal/series.ts), not here, so paging stays exact.
--
-- PAGING. Each source is cut to p_limit rows AFTER the chip / problems-only /
-- market filters, then the union is cut again: the top N of a union is the top
-- N of the sources' top N's, which is only true if every filter is applied
-- inside each source. Hence the repetition below.

-- ── helpers ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.journal_try_jsonb(p TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p IS NULL OR left(ltrim(p), 1) <> '{' THEN RETURN NULL; END IF;
  RETURN p::JSONB;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

-- What an order_history row IS. One definition, used by the feed and the trace
-- (the « order_history_typed » view of the plan, as a function).
CREATE OR REPLACE FUNCTION public.journal_order_history_kind(
  p_actor_type TEXT, p_from public.order_status, p_to public.order_status, p_note TEXT
)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_note LIKE 'Order received via%' OR p_note LIKE 'Mapping needs review%' THEN 'order.received'
    WHEN p_note LIKE 'Reassigned to agent%' THEN 'order.reassigned'
    WHEN p_note ILIKE 'R_ouvert%' OR p_note ILIKE 'Réouvert%' THEN 'order.reopened'
    WHEN p_note LIKE '%a repris la%' THEN 'order.taken_over'
    WHEN p_from = p_to AND left(ltrim(COALESCE(p_note, '')), 1) = '{' THEN 'order.edited'
    WHEN p_actor_type = 'system' AND p_note LIKE 'Téléchargé chez transporteur%' THEN 'order.auto_uploaded'
    WHEN p_actor_type = 'system' AND p_note LIKE 'Auto-rejet%' THEN 'order.auto_rejected'
    WHEN p_actor_type = 'system' AND (p_note ILIKE '%carrier status%' OR p_to IN (
           'at_carrier', 'dispatched', 'deposit', 'in_transit', 'out_for_delivery', 'delivery_delayed',
           'unverified', 'returning', 'to_be_returned', 'received', 'delivered', 'returned'))
      THEN 'carrier.status'
    WHEN p_to = 'scanned' THEN 'order.scanned'
    ELSE 'order.status'
  END
$$;

CREATE OR REPLACE FUNCTION public.journal_assert_super_admin()
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Journaux : réservé au super_admin' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.journal_assert_super_admin() FROM PUBLIC, anon, authenticated;

-- Failed-run lookups for the feed, on tables that grow by the minute.
CREATE INDEX IF NOT EXISTS whatsapp_outbox_runs_failed_idx ON public.whatsapp_outbox_runs (started_at DESC) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS investor_rollup_runs_failed_idx ON public.investor_rollup_runs (started_at DESC) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS ad_sync_runs_started_idx        ON public.ad_sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS sheet_sync_runs_started_idx     ON public.sheet_sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS settings_history_changed_idx    ON public.settings_history (changed_at DESC);
CREATE INDEX IF NOT EXISTS lead_history_created_idx        ON public.lead_history (created_at DESC);
CREATE INDEX IF NOT EXISTS customer_feedback_events_created_idx ON public.customer_feedback_events (created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_actions_created_idx    ON public.delivery_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_log_created_idx       ON public.inventory_log (created_at DESC);
CREATE INDEX IF NOT EXISTS agent_commission_ledger_created_idx ON public.agent_commission_ledger (created_at DESC);
CREATE INDEX IF NOT EXISTS investor_deal_statements_created_idx ON public.investor_deal_statements (created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_delivery_log_created_idx ON public.webhook_delivery_log (created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- journal_feed
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.journal_feed(
  p_before      TIMESTAMPTZ DEFAULT NULL,
  p_before_id   TEXT DEFAULT NULL,
  p_limit       INT DEFAULT 150,
  p_family      TEXT DEFAULT NULL,
  p_only_issues BOOLEAN DEFAULT FALSE,
  p_market      UUID DEFAULT NULL
)
RETURNS TABLE (
  at TIMESTAMPTZ, id TEXT, family TEXT, kind TEXT, severity TEXT,
  actor_id UUID, actor_name TEXT, actor_role TEXT,
  market_id UUID, order_id UUID, order_ref TEXT, params JSONB, ref TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_before TIMESTAMPTZ := COALESCE(p_before, now() + interval '1 minute');
  v_bid TEXT := COALESCE(p_before_id, '~');
  v_n INT := LEAST(GREATEST(COALESCE(p_limit, 150), 1), 500);
BEGIN
  PERFORM public.journal_assert_super_admin();

  RETURN QUERY
  WITH ev AS (
    -- ── order_history: statuses, edits, reassignments, carrier promotions ──
    (SELECT * FROM (
      SELECT oh.created_at AS at, 'oh:' || oh.id AS id,
             CASE WHEN k.kind = 'carrier.status' THEN 'ext'
                  WHEN oh.actor_type = 'system' THEN 'auto' ELSE 'team' END AS family,
             k.kind, NULL::TEXT AS severity,
             oh.actor_id, u.full_name AS actor_name, u.role AS actor_role,
             o.market_id, oh.order_id, o.external_id AS order_ref,
             jsonb_strip_nulls(jsonb_build_object(
               'from', oh.status_from, 'to', oh.status_to,
               'carrier', c.name, 'amount', o.total_price, 'currency', m.currency,
               'fields', CASE WHEN k.kind = 'order.edited'
                              THEN (SELECT jsonb_agg(f) FROM jsonb_object_keys(public.journal_try_jsonb(oh.note)) f) END,
               'reason', CASE WHEN oh.status_to = 'rejected' THEN o.rejection_reason END
             )) AS params,
             'order:' || oh.order_id AS ref
        FROM public.order_history oh
        CROSS JOIN LATERAL (SELECT public.journal_order_history_kind(oh.actor_type, oh.status_from, oh.status_to, oh.note) AS kind) k
        JOIN public.orders o ON o.id = oh.order_id
        LEFT JOIN public.users u ON u.id = oh.actor_id
        LEFT JOIN public.carriers c ON c.id = o.carrier_id
        LEFT JOIN public.markets m ON m.id = o.market_id
       WHERE oh.created_at <= v_before
         AND k.kind <> 'order.received'
         AND (p_market IS NULL OR o.market_id = p_market)
    ) x
     WHERE (x.at, x.id) < (v_before, v_bid)
       AND (p_family IS NULL OR x.family = p_family) AND NOT p_only_issues
     ORDER BY x.at DESC, x.id DESC LIMIT v_n)

    UNION ALL
    -- ── delivery follow-up actions ──
    (SELECT da.created_at, 'da:' || da.id, 'team', 'delivery.' || da.action_type, NULL,
            da.actor_id, u.full_name, u.role, da.market_id, da.order_id, o.external_id,
            jsonb_strip_nulls(jsonb_build_object('outcome', da.outcome, 'channel', da.channel)),
            'order:' || da.order_id
       FROM public.delivery_actions da
       LEFT JOIN public.orders o ON o.id = da.order_id
       LEFT JOIN public.users u ON u.id = da.actor_id
      WHERE (da.created_at, 'da:' || da.id) < (v_before, v_bid)
        AND (p_family IS NULL OR p_family = 'team') AND NOT p_only_issues
        AND (p_market IS NULL OR da.market_id = p_market)
      ORDER BY 1 DESC, 2 DESC LIMIT v_n)

    UNION ALL
    -- ── stock movements other than the scan itself (order_history has it) ──
    (SELECT * FROM (
      SELECT il.created_at AS at, 'il:' || il.id AS id,
             CASE WHEN il.actor_id IS NULL THEN 'auto' ELSE 'team' END AS family,
             'stock.' || il.reason AS kind, NULL::TEXT AS severity,
             il.actor_id, u.full_name, u.role, p.market_id, il.order_id, o.external_id,
             jsonb_strip_nulls(jsonb_build_object('change', il.change, 'balance', il.balance_after,
               'product', p.name, 'variant', v.label, 'site', w.name_fr, 'damaged', NULLIF(il.is_damaged, FALSE))),
             CASE WHEN il.order_id IS NOT NULL THEN 'order:' || il.order_id END AS ref
        FROM public.inventory_log il
        JOIN public.products p ON p.id = il.product_id
        LEFT JOIN public.product_variants v ON v.id = il.variant_id
        LEFT JOIN public.warehouses w ON w.id = il.warehouse_id
        LEFT JOIN public.orders o ON o.id = il.order_id
        LEFT JOIN public.users u ON u.id = il.actor_id
       WHERE il.created_at <= v_before AND il.reason <> 'scanned'
         AND (p_market IS NULL OR p.market_id = p_market)
    ) x
     WHERE (x.at, x.id) < (v_before, v_bid)
       AND (p_family IS NULL OR x.family = p_family) AND NOT p_only_issues
     ORDER BY x.at DESC, x.id DESC LIMIT v_n)

    UNION ALL
    -- ── Prospects ──
    (SELECT lh.created_at, 'lh:' || lh.id, CASE WHEN lh.actor_id IS NULL THEN 'auto' ELSE 'team' END,
            'lead.status', NULL, lh.actor_id, u.full_name, u.role, l.market_id, NULL::UUID, NULL::TEXT,
            jsonb_strip_nulls(jsonb_build_object('from', lh.status_from, 'to', lh.status_to)),
            NULL::TEXT
       FROM public.lead_history lh
       JOIN public.leads l ON l.id = lh.lead_id
       LEFT JOIN public.users u ON u.id = lh.actor_id
      WHERE (lh.created_at, 'lh:' || lh.id) < (v_before, v_bid)
        AND (p_family IS NULL OR p_family = CASE WHEN lh.actor_id IS NULL THEN 'auto' ELSE 'team' END)
        AND NOT p_only_issues
        AND (p_market IS NULL OR l.market_id = p_market)
      ORDER BY 1 DESC, 2 DESC LIMIT v_n)

    UNION ALL
    -- ── Voix du client ──
    (SELECT fe.created_at, 'fe:' || fe.id, 'team', 'feedback.' || fe.kind, NULL,
            fe.actor_id, u.full_name, u.role, fe.market_id, f.order_id, o.external_id,
            jsonb_strip_nulls(jsonb_build_object('category', f.category)), NULL::TEXT
       FROM public.customer_feedback_events fe
       JOIN public.customer_feedback f ON f.id = fe.feedback_id
       LEFT JOIN public.orders o ON o.id = f.order_id
       LEFT JOIN public.users u ON u.id = fe.actor_id
      WHERE (fe.created_at, 'fe:' || fe.id) < (v_before, v_bid)
        AND (p_family IS NULL OR p_family = 'team') AND NOT p_only_issues
        AND (p_market IS NULL OR fe.market_id = p_market)
      ORDER BY 1 DESC, 2 DESC LIMIT v_n)

    UNION ALL
    -- ── settings, one row per person · market · minute ──
    (SELECT * FROM (
      SELECT max(sh.changed_at) AS at,
             'sh:' || COALESCE(sh.changed_by::TEXT, '-') || ':' || COALESCE(sh.market_id::TEXT, '-') || ':' ||
               to_char(date_trunc('minute', sh.changed_at), 'YYYYMMDDHH24MI') AS id,
             'team' AS family, 'settings.changed' AS kind, NULL::TEXT AS severity,
             sh.changed_by, (array_agg(u.full_name))[1], (array_agg(u.role))[1], sh.market_id,
             NULL::UUID, NULL::TEXT,
             jsonb_build_object('count', count(*), 'keys', (array_agg(sh.key ORDER BY sh.key))[1:6],
                                'market', (array_agg(m.code))[1]),
             'settings:' || COALESCE(sh.changed_by::TEXT, '-') || ':' || COALESCE(sh.market_id::TEXT, '-') || ':' ||
               to_char(date_trunc('minute', sh.changed_at), 'YYYYMMDDHH24MI')
        FROM public.settings_history sh
        LEFT JOIN public.users u ON u.id = sh.changed_by
        LEFT JOIN public.markets m ON m.id = sh.market_id
       WHERE sh.changed_at <= v_before
         AND (p_market IS NULL OR sh.market_id = p_market)
       GROUP BY sh.changed_by, sh.market_id, date_trunc('minute', sh.changed_at)
    ) x
     WHERE (x.at, x.id) < (v_before, v_bid)
       AND (p_family IS NULL OR p_family = 'team') AND NOT p_only_issues
     ORDER BY x.at DESC, x.id DESC LIMIT v_n)

    UNION ALL
    -- ── user journal (Accès) ──
    (SELECT ua.created_at, 'ua:' || ua.id, 'team', 'user.' || ua.event_type, NULL,
            ua.actor_id, u.full_name, u.role, t.market_id, NULL::UUID, NULL::TEXT,
            jsonb_strip_nulls(jsonb_build_object('target', t.full_name, 'target_role', t.role)), NULL::TEXT
       FROM public.user_audit_log ua
       LEFT JOIN public.users u ON u.id = ua.actor_id
       LEFT JOIN public.users t ON t.id = ua.target_id
      WHERE (ua.created_at, 'ua:' || ua.id) < (v_before, v_bid)
        AND (p_family IS NULL OR p_family = 'team') AND NOT p_only_issues
        AND (p_market IS NULL OR t.market_id = p_market)
      ORDER BY 1 DESC, 2 DESC LIMIT v_n)

    UNION ALL
    -- ── audit_events: before → after, explicit events, security ──
    (SELECT * FROM (
      SELECT ae.occurred_at AS at, 'ae:' || ae.id AS id,
             CASE WHEN ae.action LIKE 'auth.%' OR ae.action LIKE 'export.%' THEN 'sec'
                  WHEN ae.entity_type = 'users' AND (ae.changes ? 'role' OR ae.changes ? 'market_id') THEN 'sec'
                  WHEN ae.actor_kind = 'person' THEN 'team'
                  ELSE 'auto' END AS family,
             ae.action AS kind,
             CASE WHEN ae.action = 'auth.login_failed' THEN 'warn' END AS severity,
             ae.actor_id, u.full_name, COALESCE(u.role, ae.actor_role), ae.market_id, ae.order_id,
             o.external_id,
             jsonb_strip_nulls(jsonb_build_object(
               'entity', ae.entity_type, 'label', ae.entity_label,
               'fields', (SELECT jsonb_agg(f ORDER BY f) FROM jsonb_object_keys(ae.changes) f),
               'changes', CASE WHEN (SELECT count(*) FROM jsonb_object_keys(ae.changes)) <= 3
                               AND ae.entity_type NOT IN ('users', 'whatsapp_configs', 'meta_ad_accounts', 'investors')
                               THEN ae.changes END,
               'context', NULLIF(ae.context, '{}'::jsonb), 'kind', ae.actor_kind)) AS params,
             'audit:' || ae.id AS ref
        FROM public.audit_events ae
        LEFT JOIN public.users u ON u.id = ae.actor_id
        LEFT JOIN public.orders o ON o.id = ae.order_id
       WHERE ae.occurred_at <= v_before
         AND (p_market IS NULL OR ae.market_id = p_market)
    ) x
     WHERE (x.at, x.id) < (v_before, v_bid)
       AND (p_family IS NULL OR x.family = p_family)
       AND (NOT p_only_issues OR x.severity IS NOT NULL)
     ORDER BY x.at DESC, x.id DESC LIMIT v_n)

    UNION ALL
    -- ── availability toggles by people (the nightly reset is routine) ──
    (SELECT al.created_at, 'al:' || al.id, 'team', CASE WHEN al.is_available THEN 'agent.available' ELSE 'agent.unavailable' END,
            NULL, COALESCE(al.changed_by, al.user_id), u.full_name, u.role, al.market_id, NULL::UUID, NULL::TEXT,
            jsonb_strip_nulls(jsonb_build_object('agent', a.full_name, 'released', NULLIF(al.released_count, 0),
              'self', (COALESCE(al.changed_by, al.user_id) = al.user_id))),
            NULL::TEXT
       FROM public.agent_availability_log al
       LEFT JOIN public.users u ON u.id = COALESCE(al.changed_by, al.user_id)
       LEFT JOIN public.users a ON a.id = al.user_id
      WHERE (al.created_at, 'al:' || al.id) < (v_before, v_bid)
        AND al.actor_type <> 'system'
        AND (p_family IS NULL OR p_family = 'team') AND NOT p_only_issues
        AND (p_market IS NULL OR al.market_id = p_market)
      ORDER BY 1 DESC, 2 DESC LIMIT v_n)

    UNION ALL
    -- ── commissions ──
    (SELECT cl.created_at, 'cl:' || cl.id, 'auto', 'commission.' || cl.entry_type, NULL,
            NULL::UUID, NULL::TEXT, NULL::TEXT, cl.market_id, cl.order_id, o.external_id,
            jsonb_strip_nulls(jsonb_build_object('amount', cl.amount, 'currency', m.currency, 'agent', a.full_name)),
            CASE WHEN cl.order_id IS NOT NULL THEN 'order:' || cl.order_id END
       FROM public.agent_commission_ledger cl
       LEFT JOIN public.users a ON a.id = cl.agent_id
       LEFT JOIN public.markets m ON m.id = cl.market_id
       LEFT JOIN public.orders o ON o.id = cl.order_id
      WHERE (cl.created_at, 'cl:' || cl.id) < (v_before, v_bid)
        AND (p_family IS NULL OR p_family = 'auto') AND NOT p_only_issues
        AND (p_market IS NULL OR cl.market_id = p_market)
      ORDER BY 1 DESC, 2 DESC LIMIT v_n)

    UNION ALL
    -- ── investor statements ──
    (SELECT st.created_at, 'is:' || st.id, 'auto', 'investor.statement', NULL,
            NULL::UUID, NULL::TEXT, NULL::TEXT, st.market_id, NULL::UUID, NULL::TEXT,
            jsonb_strip_nulls(jsonb_build_object('kind', st.kind, 'from', st.period_start, 'to', st.period_end)),
            NULL::TEXT
       FROM public.investor_deal_statements st
      WHERE (st.created_at, 'is:' || st.id) < (v_before, v_bid)
        AND (p_family IS NULL OR p_family = 'auto') AND NOT p_only_issues
        AND (p_market IS NULL OR st.market_id = p_market)
      ORDER BY 1 DESC, 2 DESC LIMIT v_n)

    UNION ALL
    -- ── imports from shops: runs that brought orders, and failed runs ──
    (SELECT * FROM (
      SELECT COALESCE(r.finished_at, r.started_at) AS at, 'sr:' || r.id AS id, 'ext' AS family,
             CASE WHEN r.status = 'failed' THEN 'intake.failed' ELSE 'intake.imported' END AS kind,
             CASE WHEN r.status = 'failed' THEN 'fail' END AS severity,
             NULL::UUID, NULL::TEXT, NULL::TEXT, r.market_id, NULL::UUID, NULL::TEXT,
             jsonb_strip_nulls(jsonb_build_object('shop', s.name, 'imported', r.rows_imported,
               'errored', NULLIF(r.rows_errored, 0), 'message', left(r.error, 200))),
             'shop:' || r.storefront_id
        FROM public.sheet_sync_runs r
        LEFT JOIN public.storefronts s ON s.id = r.storefront_id
       WHERE r.started_at <= v_before
         AND (r.status = 'failed' OR COALESCE(r.rows_imported, 0) > 0)
         AND (p_market IS NULL OR r.market_id = p_market)
    ) x
     WHERE (x.at, x.id) < (v_before, v_bid)
       AND (p_family IS NULL OR p_family = 'ext')
       AND (NOT p_only_issues OR x.severity IS NOT NULL)
     ORDER BY x.at DESC, x.id DESC LIMIT v_n)

    UNION ALL
    -- ── webhooks: failures one by one, successes one row per shop · hour ──
    (SELECT * FROM (
      SELECT w.created_at AS at, 'wd:' || w.id AS id, 'ext' AS family, 'intake.webhook_failed' AS kind,
             'fail' AS severity, NULL::UUID, NULL::TEXT, NULL::TEXT, s.market_id, w.order_id, NULL::TEXT,
             jsonb_strip_nulls(jsonb_build_object('shop', COALESCE(s.name, w.source), 'message', left(w.error_message, 200))),
             'webhook:' || w.id
        FROM public.webhook_delivery_log w
        LEFT JOIN public.storefronts s ON s.id = w.storefront_id
       WHERE w.created_at <= v_before AND w.status = 'error'
         AND (p_market IS NULL OR s.market_id = p_market)
      UNION ALL
      SELECT max(w.created_at), 'wh:' || COALESCE(w.storefront_id::TEXT, w.source) || ':' ||
               to_char(date_trunc('hour', w.created_at), 'YYYYMMDDHH24'),
             'ext', 'intake.webhooks', NULL, NULL::UUID, NULL::TEXT, NULL::TEXT, (array_agg(s.market_id))[1],
             NULL::UUID, NULL::TEXT,
             jsonb_build_object('shop', COALESCE((array_agg(s.name))[1], w.source), 'count', count(*)),
             NULL::TEXT
        FROM public.webhook_delivery_log w
        LEFT JOIN public.storefronts s ON s.id = w.storefront_id
       WHERE w.created_at <= v_before AND w.status = 'processed'
         AND (p_market IS NULL OR s.market_id = p_market)
       GROUP BY w.storefront_id, w.source, date_trunc('hour', w.created_at)
    ) x
     WHERE (x.at, x.id) < (v_before, v_bid)
       AND (p_family IS NULL OR p_family = 'ext')
       AND (NOT p_only_issues OR x.severity IS NOT NULL)
     ORDER BY x.at DESC, x.id DESC LIMIT v_n)

    UNION ALL
    -- ── carrier calls that failed (successes are the « envoyée » status rows) ──
    (SELECT ic.occurred_at, 'ic:' || ic.id, 'ext', 'carrier.' || ic.operation || '_failed', 'fail',
            ic.actor_id, u.full_name, u.role, ic.market_id, ic.order_id, o.external_id,
            jsonb_strip_nulls(jsonb_build_object('carrier', COALESCE(c.name, ic.system), 'code', ic.error_code,
              'message', left(ic.message, 200), 'status', ic.status, 'ms', ic.duration_ms)),
            'call:' || ic.id
       FROM public.integration_calls ic
       LEFT JOIN public.carriers c ON c.id = ic.connection_id
       LEFT JOIN public.orders o ON o.id = ic.order_id
       LEFT JOIN public.users u ON u.id = ic.actor_id
      WHERE (ic.occurred_at, 'ic:' || ic.id) < (v_before, v_bid) AND ic.status <> 'ok'
        AND (p_family IS NULL OR p_family = 'ext')
        AND (p_market IS NULL OR ic.market_id = p_market)
      ORDER BY 1 DESC, 2 DESC LIMIT v_n)

    UNION ALL
    -- ── runs that failed, and the nightly Darb rates ──
    (SELECT * FROM (
      SELECT COALESCE(d.finished_at, d.started_at) AS at, 'ds:' || d.id AS id, 'ext' AS family,
             'sync.failed' AS kind, 'fail' AS severity, NULL::UUID, NULL::TEXT, NULL::TEXT,
             c.market_id, NULL::UUID, NULL::TEXT,
             jsonb_strip_nulls(jsonb_build_object('system', c.name, 'message', left(d.error_message, 200))),
             'carrier:' || d.carrier_id
        FROM public.darb_sync_runs d LEFT JOIN public.carriers c ON c.id = d.carrier_id
       WHERE d.status = 'failed' AND d.started_at <= v_before
         AND (p_market IS NULL OR c.market_id = p_market)
      UNION ALL
      SELECT COALESCE(a.finished_at, a.started_at), 'as:' || a.id, 'ext', 'sync.failed', 'fail',
             NULL, NULL, NULL, a.market_id, NULL, NULL,
             jsonb_strip_nulls(jsonb_build_object('system', 'Meta', 'message', left(a.error, 200))), 'meta'
        FROM public.ad_sync_runs a
       WHERE a.status = 'failed' AND a.started_at <= v_before
         AND (p_market IS NULL OR a.market_id = p_market)
      UNION ALL
      SELECT COALESCE(h.finished_at, h.started_at), 'dh:' || h.id, 'ext',
             CASE WHEN h.status = 'failed' THEN 'sync.failed' ELSE 'darb.rates' END,
             CASE WHEN h.status = 'failed' THEN 'fail' END, NULL, NULL, NULL,
             (SELECT id FROM public.markets WHERE code = 'ly'), NULL, NULL,
             jsonb_strip_nulls(jsonb_build_object('system', 'Darb', 'count', h.succeeded,
               'message', CASE WHEN h.status = 'failed' THEN left(h.notes, 200) END)),
             NULL
        FROM public.darb_rate_harvest_runs h
       WHERE h.status IN ('completed', 'partial', 'failed') AND h.started_at <= v_before
         AND (p_market IS NULL OR p_market = (SELECT id FROM public.markets WHERE code = 'ly'))
      UNION ALL
      SELECT COALESCE(r.finished_at, r.started_at), 'ir:' || r.id, 'auto', 'job.failed', 'fail',
             NULL, NULL, NULL, NULL, NULL, NULL,
             jsonb_build_object('job', 'investor-rollup', 'message', left(r.error, 200)), 'jobs'
        FROM public.investor_rollup_runs r
       WHERE r.status = 'failed' AND r.started_at <= v_before AND p_market IS NULL
      UNION ALL
      SELECT COALESCE(r.finished_at, r.started_at), 'wo:' || r.id, 'auto', 'job.failed', 'fail',
             NULL, NULL, NULL, NULL, NULL, NULL,
             jsonb_build_object('job', 'whatsapp-outbox', 'message', left(r.error, 200)), 'jobs'
        FROM public.whatsapp_outbox_runs r
       WHERE r.status = 'failed' AND r.started_at <= v_before AND p_market IS NULL
      UNION ALL
      SELECT COALESCE(r.finished_at, r.started_at), 'jr:' || r.id, 'auto', 'job.failed', 'fail',
             NULL, NULL, NULL, NULL, NULL, NULL,
             jsonb_build_object('job', r.job, 'message', left(r.error, 200)), 'jobs'
        FROM public.job_runs r
       WHERE r.status = 'failed' AND r.started_at <= v_before AND p_market IS NULL
    ) x
     WHERE (x.at, x.id) < (v_before, v_bid)
       AND (p_family IS NULL OR x.family = p_family)
       AND (NOT p_only_issues OR x.severity IS NOT NULL)
     ORDER BY x.at DESC, x.id DESC LIMIT v_n)

    UNION ALL
    -- ── Ordra's own server errors ──
    (SELECT e.occurred_at, 'ae5:' || e.id, 'sec', 'app.error', 'fail',
            e.actor_id, u.full_name, u.role, e.market_id, NULL::UUID, NULL::TEXT,
            jsonb_strip_nulls(jsonb_build_object('route', e.route, 'method', e.method, 'status', e.status,
              'code', e.error_code, 'message', e.message)),
            'error:' || e.id
       FROM public.app_errors e
       LEFT JOIN public.users u ON u.id = e.actor_id
      WHERE (e.occurred_at, 'ae5:' || e.id) < (v_before, v_bid)
        AND (p_family IS NULL OR p_family = 'sec')
        AND (p_market IS NULL OR e.market_id = p_market)
      ORDER BY 1 DESC, 2 DESC LIMIT v_n)

    UNION ALL
    -- ── problems opening and closing ──
    (SELECT * FROM (
      SELECT i.first_seen AS at, 'io:' || i.id AS id,
             CASE WHEN i.system = 'jobs' THEN 'auto' WHEN i.system = 'app' THEN 'sec' ELSE 'ext' END AS family,
             'issue.opened' AS kind,
             CASE WHEN i.severity = 'critical' THEN 'fail' ELSE 'warn' END AS severity,
             NULL::UUID, NULL::TEXT, NULL::TEXT, i.market_id, NULL::UUID, NULL::TEXT,
             jsonb_build_object('rule', i.rule_key, 'p', i.params, 'affected', i.affected_count,
                                'amount', i.impact_amount, 'currency', i.impact_currency,
                                'open', i.status <> 'resolved'),
             'issue:' || i.id
        FROM public.journal_issues i
       WHERE i.first_seen <= v_before
         AND (p_market IS NULL OR i.market_id = p_market)
      UNION ALL
      SELECT i.resolved_at, 'iz:' || i.id,
             CASE WHEN i.system = 'jobs' THEN 'auto' WHEN i.system = 'app' THEN 'sec' ELSE 'ext' END,
             'issue.resolved', NULL, NULL, NULL, NULL, i.market_id, NULL, NULL,
             jsonb_build_object('rule', i.rule_key, 'p', i.params), 'issue:' || i.id
        FROM public.journal_issues i
       WHERE i.status = 'resolved' AND i.resolved_at <= v_before
         AND (p_market IS NULL OR i.market_id = p_market)
    ) x
     WHERE (x.at, x.id) < (v_before, v_bid)
       AND (p_family IS NULL OR x.family = p_family)
       AND (NOT p_only_issues OR x.severity IS NOT NULL)
     ORDER BY x.at DESC, x.id DESC LIMIT v_n)
  )
  SELECT ev.* FROM ev ORDER BY ev.at DESC, ev.id DESC LIMIT v_n;
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_feed(TIMESTAMPTZ, TEXT, INT, TEXT, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journal_feed(TIMESTAMPTZ, TEXT, INT, TEXT, BOOLEAN, UUID) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- journal_routine — passes that ran and changed nothing, per local day
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.journal_routine(
  p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT DEFAULT 'Africa/Tripoli'
)
RETURNS TABLE (day DATE, passes BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_tz TEXT := CASE WHEN p_tz IN (SELECT name FROM pg_catalog.pg_timezone_names) THEN p_tz ELSE 'Africa/Tripoli' END;
BEGIN
  PERFORM public.journal_assert_super_admin();
  RETURN QUERY
  SELECT (r.at AT TIME ZONE v_tz)::DATE, count(*)
    FROM (
      SELECT started_at AS at FROM public.darb_sync_runs
       WHERE status = 'succeeded' AND COALESCE(orders_promoted, 0) = 0 AND started_at >= p_from AND started_at < p_to
      UNION ALL
      SELECT started_at FROM public.sheet_sync_runs
       WHERE status IN ('succeeded', 'skipped_locked') AND COALESCE(rows_imported, 0) = 0 AND started_at >= p_from AND started_at < p_to
      UNION ALL
      SELECT started_at FROM public.ad_sync_runs
       WHERE status IN ('succeeded', 'skipped_locked') AND started_at >= p_from AND started_at < p_to
      UNION ALL
      SELECT started_at FROM public.investor_rollup_runs
       WHERE status IN ('succeeded', 'skipped_locked') AND COALESCE(facts_changed, 0) = 0 AND started_at >= p_from AND started_at < p_to
      UNION ALL
      SELECT started_at FROM public.whatsapp_outbox_runs
       WHERE status IN ('succeeded', 'skipped_locked') AND COALESCE(sent, 0) = 0 AND started_at >= p_from AND started_at < p_to
      UNION ALL
      SELECT started_at FROM public.job_runs
       WHERE status IN ('succeeded', 'skipped') AND changed = 0 AND started_at >= p_from AND started_at < p_to
    ) r
   GROUP BY 1;
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_routine(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journal_routine(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- journal_order_trace — one order, every source, oldest first
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.journal_order_trace(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_head JSONB;
  v_events JSONB;
BEGIN
  PERFORM public.journal_assert_super_admin();

  SELECT jsonb_build_object(
           'id', o.id, 'ref', o.external_id, 'status', o.status, 'amount', o.total_price,
           'currency', m.currency, 'market', m.code, 'city', o.customer_city,
           'shop', s.name, 'platform', s.platform, 'carrier', c.name,
           'tracking', o.tracking_number, 'created_at', o.created_at)
    INTO v_head
    FROM public.orders o
    JOIN public.markets m ON m.id = o.market_id
    LEFT JOIN public.storefronts s ON s.id = o.storefront_id
    LEFT JOIN public.carriers c ON c.id = o.carrier_id
   WHERE o.id = p_order_id;

  IF v_head IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(e ORDER BY e.at, e.seq), '[]'::jsonb) INTO v_events
    FROM (
      SELECT oh.created_at AS at, 1 AS seq,
             public.journal_order_history_kind(oh.actor_type, oh.status_from, oh.status_to, oh.note) AS kind,
             u.full_name AS actor, oh.actor_type AS actor_type,
             jsonb_strip_nulls(jsonb_build_object('from', oh.status_from, 'to', oh.status_to,
               'note', CASE WHEN public.journal_try_jsonb(oh.note) IS NULL THEN left(oh.note, 200) END,
               'fields', (SELECT jsonb_agg(f) FROM jsonb_object_keys(public.journal_try_jsonb(oh.note)) f))) AS params
        FROM public.order_history oh LEFT JOIN public.users u ON u.id = oh.actor_id
       WHERE oh.order_id = p_order_id
      UNION ALL
      SELECT t.occurred_at, 2, 'carrier.timeline', t.actor_name, 'carrier',
             jsonb_strip_nulls(jsonb_build_object('type', t.type, 'text', COALESCE(t.description_ar, t.description_en),
               'remarks', left(t.remarks, 200)))
        FROM public.darb_timeline_events t WHERE t.order_id = p_order_id
      UNION ALL
      SELECT l.created_at, 3, 'carrier.event', NULL, 'carrier',
             jsonb_strip_nulls(jsonb_build_object('raw', l.carrier_status_raw, 'outcome', l.outcome,
               'reason', l.outcome_reason, 'repeats', NULLIF(l.repeat_count, 1), 'source', l.source))
        FROM public.carrier_event_log l WHERE l.order_id = p_order_id AND l.outcome <> 'processed'
      UNION ALL
      SELECT ic.occurred_at, 4, 'carrier.' || ic.operation || CASE WHEN ic.status = 'ok' THEN '' ELSE '_failed' END,
             u.full_name, 'person',
             jsonb_strip_nulls(jsonb_build_object('code', ic.error_code, 'message', left(ic.message, 200), 'ms', ic.duration_ms))
        FROM public.integration_calls ic LEFT JOIN public.users u ON u.id = ic.actor_id
       WHERE ic.order_id = p_order_id
      UNION ALL
      SELECT il.created_at, 5, 'stock.' || il.reason, u.full_name, 'person',
             jsonb_strip_nulls(jsonb_build_object('change', il.change, 'balance', il.balance_after,
               'product', p.name, 'site', w.name_fr))
        FROM public.inventory_log il
        JOIN public.products p ON p.id = il.product_id
        LEFT JOIN public.warehouses w ON w.id = il.warehouse_id
        LEFT JOIN public.users u ON u.id = il.actor_id
       WHERE il.order_id = p_order_id
      UNION ALL
      SELECT da.created_at, 6, 'delivery.' || da.action_type, u.full_name, da.actor_type,
             jsonb_strip_nulls(jsonb_build_object('outcome', da.outcome, 'channel', da.channel))
        FROM public.delivery_actions da LEFT JOIN public.users u ON u.id = da.actor_id
       WHERE da.order_id = p_order_id
      UNION ALL
      SELECT lp.created_at, 7, 'label.printed', u.full_name, 'person',
             jsonb_strip_nulls(jsonb_build_object('reprint', NULLIF(lp.is_reprint, FALSE)))
        FROM public.label_prints lp LEFT JOIN public.users u ON u.id = lp.printed_by
       WHERE lp.order_id = p_order_id
      UNION ALL
      SELECT cl.created_at, 8, 'commission.' || cl.entry_type, a.full_name, 'system',
             jsonb_build_object('amount', cl.amount, 'currency', (SELECT currency FROM public.markets WHERE id = cl.market_id))
        FROM public.agent_commission_ledger cl LEFT JOIN public.users a ON a.id = cl.agent_id
       WHERE cl.order_id = p_order_id
      UNION ALL
      SELECT ae.occurred_at, 9, ae.action, u.full_name, ae.actor_kind,
             jsonb_strip_nulls(jsonb_build_object('label', ae.entity_label, 'changes', ae.changes))
        FROM public.audit_events ae LEFT JOIN public.users u ON u.id = ae.actor_id
       WHERE ae.order_id = p_order_id
      UNION ALL
      SELECT wm.created_at, 10, 'whatsapp.' || wm.direction, u.full_name,
             CASE WHEN wm.direction = 'inbound' THEN 'customer' ELSE COALESCE(wm.actor_type, 'system') END,
             jsonb_strip_nulls(jsonb_build_object('status', wm.status, 'kind', wm.kind))
        FROM public.whatsapp_messages wm LEFT JOIN public.users u ON u.id = wm.sent_by
       WHERE wm.order_id = p_order_id
    ) e;

  RETURN jsonb_build_object('order', v_head, 'events', v_events);
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_order_trace(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journal_order_trace(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.journal_find_order(p_q TEXT)
RETURNS TABLE (id UUID, ref TEXT, status public.order_status, market TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_q TEXT := btrim(COALESCE(p_q, ''));
BEGIN
  PERFORM public.journal_assert_super_admin();
  IF length(v_q) < 3 THEN RETURN; END IF;
  RETURN QUERY
  SELECT o.id, o.external_id, o.status, m.code, o.created_at
    FROM public.orders o JOIN public.markets m ON m.id = o.market_id
   WHERE o.external_id = v_q OR o.tracking_number = v_q OR o.id::TEXT = v_q
   ORDER BY o.created_at DESC
   LIMIT 5;
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_find_order(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journal_find_order(TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- journal_counts — the sidebar badge
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.journal_counts()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.journal_assert_super_admin();
  RETURN (SELECT jsonb_build_object(
            'open', count(*),
            'critical', count(*) FILTER (WHERE severity = 'critical'))
            FROM public.journal_issues WHERE status = 'open');
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journal_counts() TO authenticated;
