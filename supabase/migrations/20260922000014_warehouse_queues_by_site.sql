-- La file et ses compteurs se lisent par bâtiment.
--
-- Sans cela, l'agent de Benghazi voit les 365 colis de Tripoli qu'il ne peut ni
-- emballer ni remettre, et le compteur « à préparer » de chaque site est le
-- total libyen. Le paramètre est optionnel et NULL veut dire « tous les sites »,
-- ce qui est la vue du manager et l'ancien comportement mot pour mot.
--
-- Les commandes expédiées depuis l'entrepôt du transporteur n'ont pas de site :
-- elles restent comptées même quand un site est demandé, sinon la ligne
-- « expédiées par le transporteur » disparaîtrait de l'écran de l'agent.
--
-- get_warehouse_queue_stats gagne aussi `sticker_unconfirmed` : les colis
-- scannés dont Darb ne tient pas notre numéro (cf. 20260922000003).
-- Corps exact appliqué en production ; régénéré depuis pg_get_functiondef.

DROP FUNCTION IF EXISTS public.get_to_label_orders(UUID, INTEGER, TIMESTAMPTZ, UUID);

CREATE OR REPLACE FUNCTION public.get_to_label_orders(
  p_market_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT 50,
  p_cursor_created_at TIMESTAMPTZ DEFAULT NULL, p_cursor_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID, customer_name TEXT, customer_phone TEXT, customer_city TEXT,
  customer_area TEXT, customer_address TEXT, product_id UUID, product_name TEXT,
  variant_label TEXT, quantity INTEGER, total_price NUMERIC, status TEXT,
  created_at TIMESTAMPTZ, uploaded_at TIMESTAMPTZ, tracking_number TEXT,
  carrier_sticker_ref TEXT, carrier_status_slug TEXT, branch_group TEXT,
  has_carrier_ref BOOLEAN, current_stock INTEGER, low_stock_threshold INTEGER,
  warehouse_id UUID
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    o.id, o.customer_name, o.customer_phone, o.customer_city,
    o.carrier_extra->>'customer_area', o.customer_address,
    o.product_id, o.product_name, o.variant_label, o.quantity, o.total_price,
    o.status::TEXT, o.created_at,
    (SELECT MAX(h.created_at) FROM order_history h
      WHERE h.order_id = o.id AND h.status_to::TEXT = 'uploaded'),
    o.tracking_number, o.carrier_sticker_ref, o.carrier_status_slug,
    o.carrier_extra->>'darb_branch_group',
    (o.carrier_extra->>'darb_assabil_id') IS NOT NULL,
    -- Le stock du bâtiment quand il est connu, sinon le total marché : l'agent
    -- doit lire ce qu'il a sur SON rayonnage.
    COALESCE(s.current_stock, p.current_stock),
    p.low_stock_threshold, o.warehouse_id
  FROM orders o
  LEFT JOIN products p ON p.id = o.product_id
  LEFT JOIN product_site_stock s
         ON s.product_id = o.product_id AND s.warehouse_id = o.warehouse_id
  WHERE o.status = 'uploaded'
    AND o.archived_at IS NULL
    AND o.bench_cleared_at IS NULL
    AND (o.carrier_extra->>'fulfil_from_carrier_warehouse') IS DISTINCT FROM 'true'
    AND (p_market_id IS NULL OR o.market_id = p_market_id)
    AND (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
    AND (p_cursor_created_at IS NULL OR (o.created_at, o.id) > (p_cursor_created_at, p_cursor_id))
  ORDER BY o.created_at ASC, o.id ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_to_label_orders(UUID, INTEGER, TIMESTAMPTZ, UUID, UUID) TO PUBLIC;

DROP FUNCTION IF EXISTS public.get_warehouse_queue_stats(UUID);

CREATE OR REPLACE FUNCTION public.get_warehouse_queue_stats(
  p_market_id UUID DEFAULT NULL, p_warehouse_id UUID DEFAULT NULL
)
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH scoped AS (
    SELECT o.*,
           (o.carrier_extra->>'fulfil_from_carrier_warehouse') IS DISTINCT FROM 'true' AS ours,
           o.bench_cleared_at IS NULL AS on_bench,
           COALESCE((SELECT MAX(h.created_at) FROM order_history h
                      WHERE h.order_id = o.id AND h.status_to::TEXT = 'uploaded'),
                    o.created_at) AS bench_at
    FROM orders o
    WHERE o.archived_at IS NULL
      AND (p_market_id IS NULL OR o.market_id = p_market_id)
      AND (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id
           OR (o.carrier_extra->>'fulfil_from_carrier_warehouse') = 'true')
  )
  SELECT json_build_object(
    'to_prepare', COUNT(*) FILTER (WHERE status='uploaded' AND ours AND on_bench),
    'oldest_prepare_hours', COALESCE(MAX(EXTRACT(EPOCH FROM (now()-bench_at))/3600.0)
      FILTER (WHERE status='uploaded' AND ours AND on_bench), 0)::INT,
    'late_prepare', COUNT(*) FILTER (WHERE status='uploaded' AND ours AND on_bench
      AND bench_at < now()-INTERVAL '2 days' AND bench_at >= now()-INTERVAL '7 days'),
    'never_scanned', COUNT(*) FILTER (WHERE status='uploaded' AND ours AND on_bench
      AND bench_at < now()-INTERVAL '7 days'),
    'confirmed_not_uploaded', COUNT(*) FILTER (WHERE status='confirmed'),
    'carrier_warehouse', COUNT(*) FILTER (WHERE status='uploaded' AND NOT ours),
    'returns_inbox', COUNT(*) FILTER (WHERE status='to_be_returned'),
    'to_hand_over', COUNT(*) FILTER (WHERE status='scanned'),
    'released_at_carrier', COUNT(*) FILTER (WHERE status='uploaded' AND ours AND on_bench
      AND carrier_status_slug IN ('released','completed','returning','returned')),
    'set_aside', COUNT(*) FILTER (WHERE status='uploaded' AND ours AND NOT on_bench),
    'sticker_unconfirmed', COUNT(*) FILTER (WHERE status='scanned'
      AND sticker_bind_state IS NOT NULL AND sticker_bind_state <> 'confirmed')
  )
  FROM scoped;
$$;

GRANT EXECUTE ON FUNCTION public.get_warehouse_queue_stats(UUID, UUID) TO PUBLIC;
