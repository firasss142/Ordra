-- Entrepôt — the five pipeline figures and the four priority actions.
--
-- One round-trip instead of seven counts, and one place where "our warehouse"
-- is defined. That definition matters: orders Darb ships from its own shelves
-- (carrier_extra.fulfil_from_carrier_warehouse) must never appear in the prep
-- queue — the goods left our stock at handover, so scanning them would deduct
-- twice. They are surfaced as their own action row instead.
--
-- "À préparer" is `uploaded`, not `confirmed`. Since the uploaded status model
-- (20260506000000) a confirmed order has not reached the carrier yet, so it is
-- not warehouse work — it is the "envoyer au transporteur" action.

CREATE OR REPLACE FUNCTION public.get_warehouse_queue_stats(p_market_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH scoped AS (
    SELECT o.*,
           (o.carrier_extra->>'fulfil_from_carrier_warehouse') IS DISTINCT FROM 'true' AS ours
    FROM orders o
    WHERE o.archived_at IS NULL
      AND (p_market_id IS NULL OR o.market_id = p_market_id)
  )
  SELECT json_build_object(
    'to_prepare',
      COUNT(*) FILTER (WHERE status = 'uploaded' AND ours),
    'oldest_prepare_hours',
      COALESCE(
        MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0)
          FILTER (WHERE status = 'uploaded' AND ours),
        0
      )::INT,
    -- Late but still recent: past the two-day mark, not yet abandoned. This
    -- and never_scanned PARTITION the backlog — they must not overlap, or the
    -- "total à rattraper" counts the same order twice.
    'late_prepare',
      COUNT(*) FILTER (
        WHERE status = 'uploaded' AND ours
          AND created_at <  now() - INTERVAL '2 days'
          AND created_at >= now() - INTERVAL '7 days'
      ),
    -- Never scanned: stickered in Darb's own app, so the OMS never saw the
    -- scan and still counts the units as ours.
    'never_scanned',
      COUNT(*) FILTER (WHERE status = 'uploaded' AND ours AND created_at < now() - INTERVAL '7 days'),
    'confirmed_not_uploaded',
      COUNT(*) FILTER (WHERE status = 'confirmed'),
    'carrier_warehouse',
      COUNT(*) FILTER (WHERE status = 'uploaded' AND NOT ours),
    'returns_inbox',
      COUNT(*) FILTER (WHERE status = 'to_be_returned'),
    'to_hand_over',
      COUNT(*) FILTER (WHERE status = 'scanned')
  )
  FROM scoped;
$$;

GRANT EXECUTE ON FUNCTION public.get_warehouse_queue_stats(UUID) TO PUBLIC;
