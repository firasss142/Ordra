-- ═══════════════════════════════════════════════════════════════════════════
-- journal_family_counts — the four tiles of Journaux › Historique (v3, 2026-10-09)
--
-- prototypes/journaux-v3.html: « 113 Équipe · modifications », « 10 Systèmes
-- externes · 2 en échec », « 2 061 Tâches automatiques », « 38 Sécurité et
-- erreurs ». journal_feed() pages 150 rows at a time and cannot count a week,
-- so this counts the SAME sources with the SAME family rules
-- (20261003160300_journal_read.sql, journal_feed), one line per family:
--   events   — rows journal_feed would list since p_from
--   problems — those of them that carry a severity (« Problèmes seulement »)
-- Routine passes are not here: journal_routine() already counts them.
-- Read-only. The screen tolerates this function being absent (tiles show « — »).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.journal_family_counts(
  p_from   TIMESTAMPTZ,
  p_market UUID DEFAULT NULL
)
RETURNS TABLE (family TEXT, events BIGINT, problems BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.journal_assert_super_admin();

  RETURN QUERY
  WITH ev(family, problem) AS (
    -- order_history (order.received is never listed)
    SELECT CASE WHEN k.kind = 'carrier.status' THEN 'ext'
                WHEN oh.actor_type = 'system' THEN 'auto' ELSE 'team' END, FALSE
      FROM public.order_history oh
      CROSS JOIN LATERAL (SELECT public.journal_order_history_kind(oh.actor_type, oh.status_from, oh.status_to, oh.note) AS kind) k
      JOIN public.orders o ON o.id = oh.order_id
     WHERE oh.created_at >= p_from AND k.kind <> 'order.received'
       AND (p_market IS NULL OR o.market_id = p_market)
    UNION ALL
    SELECT 'team', FALSE FROM public.delivery_actions da
     WHERE da.created_at >= p_from AND (p_market IS NULL OR da.market_id = p_market)
    UNION ALL
    SELECT CASE WHEN il.actor_id IS NULL THEN 'auto' ELSE 'team' END, FALSE
      FROM public.inventory_log il JOIN public.products p ON p.id = il.product_id
     WHERE il.created_at >= p_from AND il.reason <> 'scanned'
       AND (p_market IS NULL OR p.market_id = p_market)
    UNION ALL
    SELECT CASE WHEN lh.actor_id IS NULL THEN 'auto' ELSE 'team' END, FALSE
      FROM public.lead_history lh JOIN public.leads l ON l.id = lh.lead_id
     WHERE lh.created_at >= p_from AND (p_market IS NULL OR l.market_id = p_market)
    UNION ALL
    SELECT 'team', FALSE FROM public.customer_feedback_events fe
     WHERE fe.created_at >= p_from AND (p_market IS NULL OR fe.market_id = p_market)
    UNION ALL
    -- settings: one row per person · market · minute, as the feed groups them
    SELECT 'team', FALSE FROM (
      SELECT 1 FROM public.settings_history sh
       WHERE sh.changed_at >= p_from AND (p_market IS NULL OR sh.market_id = p_market)
       GROUP BY sh.changed_by, sh.market_id, date_trunc('minute', sh.changed_at)
    ) g
    UNION ALL
    SELECT 'team', FALSE FROM public.user_audit_log ua
      LEFT JOIN public.users t ON t.id = ua.target_id
     WHERE ua.created_at >= p_from AND (p_market IS NULL OR t.market_id = p_market)
    UNION ALL
    SELECT CASE WHEN ae.action LIKE 'auth.%' OR ae.action LIKE 'export.%' THEN 'sec'
                WHEN ae.entity_type = 'users' AND (ae.changes ? 'role' OR ae.changes ? 'market_id') THEN 'sec'
                WHEN ae.actor_kind = 'person' THEN 'team'
                ELSE 'auto' END,
           ae.action = 'auth.login_failed'
      FROM public.audit_events ae
     WHERE ae.occurred_at >= p_from AND (p_market IS NULL OR ae.market_id = p_market)
    UNION ALL
    SELECT 'team', FALSE FROM public.agent_availability_log al
     WHERE al.created_at >= p_from AND al.actor_type <> 'system'
       AND (p_market IS NULL OR al.market_id = p_market)
    UNION ALL
    SELECT 'auto', FALSE FROM public.agent_commission_ledger cl
     WHERE cl.created_at >= p_from AND (p_market IS NULL OR cl.market_id = p_market)
    UNION ALL
    SELECT 'auto', FALSE FROM public.investor_deal_statements st
     WHERE st.created_at >= p_from AND (p_market IS NULL OR st.market_id = p_market)
    UNION ALL
    SELECT 'ext', r.status = 'failed' FROM public.sheet_sync_runs r
     WHERE COALESCE(r.finished_at, r.started_at) >= p_from
       AND (r.status = 'failed' OR COALESCE(r.rows_imported, 0) > 0)
       AND (p_market IS NULL OR r.market_id = p_market)
    UNION ALL
    SELECT 'ext', TRUE FROM public.webhook_delivery_log w
      LEFT JOIN public.storefronts s ON s.id = w.storefront_id
     WHERE w.created_at >= p_from AND w.status = 'error'
       AND (p_market IS NULL OR s.market_id = p_market)
    UNION ALL
    SELECT 'ext', FALSE FROM (
      SELECT 1 FROM public.webhook_delivery_log w
        LEFT JOIN public.storefronts s ON s.id = w.storefront_id
       WHERE w.created_at >= p_from AND w.status = 'processed'
         AND (p_market IS NULL OR s.market_id = p_market)
       GROUP BY w.storefront_id, w.source, date_trunc('hour', w.created_at)
    ) g
    UNION ALL
    SELECT 'ext', TRUE FROM public.integration_calls ic
     WHERE ic.occurred_at >= p_from AND ic.status <> 'ok'
       AND (p_market IS NULL OR ic.market_id = p_market)
    UNION ALL
    SELECT 'ext', TRUE FROM public.darb_sync_runs d LEFT JOIN public.carriers c ON c.id = d.carrier_id
     WHERE d.status = 'failed' AND COALESCE(d.finished_at, d.started_at) >= p_from
       AND (p_market IS NULL OR c.market_id = p_market)
    UNION ALL
    SELECT 'ext', TRUE FROM public.ad_sync_runs a
     WHERE a.status = 'failed' AND COALESCE(a.finished_at, a.started_at) >= p_from
       AND (p_market IS NULL OR a.market_id = p_market)
    UNION ALL
    SELECT 'ext', h.status = 'failed' FROM public.darb_rate_harvest_runs h
     WHERE h.status IN ('completed', 'partial', 'failed') AND COALESCE(h.finished_at, h.started_at) >= p_from
       AND (p_market IS NULL OR p_market = (SELECT id FROM public.markets WHERE code = 'ly'))
    UNION ALL
    SELECT 'auto', TRUE FROM public.investor_rollup_runs r
     WHERE r.status = 'failed' AND COALESCE(r.finished_at, r.started_at) >= p_from AND p_market IS NULL
    UNION ALL
    SELECT 'auto', TRUE FROM public.whatsapp_outbox_runs r
     WHERE r.status = 'failed' AND COALESCE(r.finished_at, r.started_at) >= p_from AND p_market IS NULL
    UNION ALL
    SELECT 'auto', TRUE FROM public.job_runs r
     WHERE r.status = 'failed' AND COALESCE(r.finished_at, r.started_at) >= p_from AND p_market IS NULL
    UNION ALL
    SELECT 'sec', TRUE FROM public.app_errors e
     WHERE e.occurred_at >= p_from AND (p_market IS NULL OR e.market_id = p_market)
    UNION ALL
    SELECT CASE WHEN i.system = 'jobs' THEN 'auto' WHEN i.system = 'app' THEN 'sec' ELSE 'ext' END, TRUE
      FROM public.journal_issues i
     WHERE i.first_seen >= p_from AND (p_market IS NULL OR i.market_id = p_market)
    UNION ALL
    SELECT CASE WHEN i.system = 'jobs' THEN 'auto' WHEN i.system = 'app' THEN 'sec' ELSE 'ext' END, FALSE
      FROM public.journal_issues i
     WHERE i.status = 'resolved' AND i.resolved_at >= p_from AND (p_market IS NULL OR i.market_id = p_market)
  )
  SELECT ev.family, count(*), count(*) FILTER (WHERE ev.problem)
    FROM ev
   GROUP BY ev.family;
END $$;

REVOKE EXECUTE ON FUNCTION public.journal_family_counts(TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journal_family_counts(TIMESTAMPTZ, UUID) TO authenticated;
