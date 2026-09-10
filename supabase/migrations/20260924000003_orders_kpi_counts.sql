-- ============================================================
-- 20260924000003_orders_kpi_counts.sql
-- The orders KPI strip in one scan instead of seven head-counts.
--
-- WHY: /api/orders/status-counts issued seven exact PostgREST head-counts
-- (total, unassigned, to-recall, uploaded, rejected, delivered, period total)
-- plus one RPC, all in a Promise.all. Seven of those eight round trips ask the
-- same table the same question with different filters, and each pays the full
-- network + planning cost. One pass with count(*) FILTER answers all seven.
--
-- WHAT: get_orders_kpi_counts(market, from, to) -> jsonb, with the predicates
-- copied VERBATIM from the route and from src/lib/orders/unassigned.ts:
--   unassigned    status = 'pending' AND assigned_to IS NULL   (the narrow
--                 definition — the sidebar badge and this tile disagreed once,
--                 9 vs 188 on Libya. The badge still counts through
--                 whereUnassigned() in src/lib/orders/unassigned.ts, because
--                 routing it here would compute six counts it discards; the two
--                 must therefore be changed together.)
--   to_recall     status IN (attempt_1, attempt_2, attempt_3, callback_scheduled)
--   uploaded/rejected/delivered   that status, created_at inside the window
--   period_total  created_at inside the window, status <> 'deleted'
--   total         everything, INCLUDING soft-deleted: it is the market's
--                 standing head-count of what came through the door, not money
--
-- The window is applied on created_at with an INCLUSIVE upper bound, exactly as
-- /api/orders/list applies it. Any divergence puts a number on a tile that the
-- table it opens cannot reproduce (design-system §4.17 G).
--
-- SECURITY INVOKER on purpose: RLS is what keeps a market manager inside their
-- own market. A SECURITY DEFINER version would have to re-implement that check,
-- and getting it wrong leaks another market's totals. p_market_id IS NULL means
-- "every market the caller can see" — the super_admin "all markets" scope.
--
-- Also snapshots get_confirmation_rate_windows, which is CALLED by the route and
-- exists in production but was never committed to supabase/migrations/. Body
-- copied from pg_get_functiondef on 2026-09-10, unchanged, so the schema history
-- stops lying. (Repo convention: "corps exact appliqué en production".)
--
-- NON-GOALS: no column, index, policy or trigger is touched. order_history and
-- inventory_log stay append-only and unreferenced except by the read-only rate
-- function below.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_orders_kpi_counts(
  p_market_id uuid,
  p_from      timestamptz,
  p_to        timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total',        count(*),
    'unassigned',   count(*) FILTER (
                      WHERE o.status::text = 'pending' AND o.assigned_to IS NULL),
    'to_recall',    count(*) FILTER (
                      WHERE o.status::text = ANY (ARRAY[
                        'attempt_1','attempt_2','attempt_3','callback_scheduled'])),
    'uploaded',     count(*) FILTER (
                      WHERE o.status::text = 'uploaded' AND in_window),
    'rejected',     count(*) FILTER (
                      WHERE o.status::text = 'rejected' AND in_window),
    'delivered',    count(*) FILTER (
                      WHERE o.status::text = 'delivered' AND in_window),
    'period_total', count(*) FILTER (
                      WHERE o.status::text <> 'deleted' AND in_window)
  )
  FROM (
    SELECT
      ord.status,
      ord.assigned_to,
      (p_from IS NULL OR ord.created_at >= p_from)
        AND (p_to IS NULL OR ord.created_at <= p_to) AS in_window
    FROM orders ord
    WHERE p_market_id IS NULL OR ord.market_id = p_market_id
  ) o;
$function$;

REVOKE ALL ON FUNCTION public.get_orders_kpi_counts(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_kpi_counts(uuid, timestamptz, timestamptz) TO authenticated;

-- ------------------------------------------------------------
-- Drift fix: the exact body running in production on 2026-09-10, committed so
-- the migration history is complete. Not a behaviour change.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_confirmation_rate_windows(
  p_market_id uuid,
  p_current_from timestamp with time zone,
  p_prev_from timestamp with time zone
)
RETURNS TABLE(current_yes bigint, current_total bigint, prev_yes bigint, prev_total bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  with decisions as (
    select
      h.order_id,
      h.created_at,
      h.status_to::text = any (array['confirmed', 'dispatch_scheduled']) as said_yes,
      h.status_to::text = any (array['confirmed', 'dispatch_scheduled', 'rejected', 'cancelled']) as is_decision
    from order_history h
    where h.created_at >= p_prev_from
      and (p_market_id is null or h.market_id = p_market_id)
  )
  select
    count(distinct order_id) filter (where created_at >= p_current_from and said_yes),
    count(distinct order_id) filter (where created_at >= p_current_from and is_decision),
    count(distinct order_id) filter (where created_at < p_current_from and said_yes),
    count(distinct order_id) filter (where created_at < p_current_from and is_decision)
  from decisions;
$function$;
