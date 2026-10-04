-- Accueil (/dashboard) — « vos boutiques » (plans/dashboard-redesign.md,
-- prototypes/dashboard-v2.html).
--
-- 1. storefronts.accent_color — the store's identity colour, one of five hues
--    validated against each other (indigo, pink, cyan, gold, lime). NULL = slate:
--    the sixth store and beyond. The colour belongs to the store, never to its
--    rank: it is given once (first free hue of the market) and then kept.
-- 2. get_store_dashboard — facts, not figures: one row per order RECEIVED in the
--    period (market-local days), followed to today, WITH the moment each one
--    reached its result, so the page can read the period before « at equal age ».
--    Plus every storefront of the market, its daily orders over the last 21 days,
--    the market's ad spend per day, and its first order. Buckets, rates, notes and
--    money are computed in TypeScript (src/lib/dashboard/stores,
--    src/lib/calculations/store-dashboard-money.ts) where every rule has a test.
--
-- Read-only, SECURITY DEFINER, the market guard of get_orders_performance:
-- super_admin names the market, a market_manager is pinned to their own,
-- everyone else gets '{}'. Prices are dropped for managers by the API.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. accent_color
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.storefronts ADD COLUMN IF NOT EXISTS accent_color text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storefronts_accent_color_check') THEN
    ALTER TABLE public.storefronts ADD CONSTRAINT storefronts_accent_color_check
      CHECK (accent_color IS NULL OR accent_color IN ('indigo', 'pink', 'cyan', 'gold', 'lime'));
  END IF;
END $$;

COMMENT ON COLUMN public.storefronts.accent_color IS
  'The store''s identity colour on Accueil: indigo | pink | cyan | gold | lime; NULL = slate (sixth store and beyond). Given once, kept.';

-- Backfill: per market, the five live stores with the most orders over 90 days get
-- the five hues, busiest first. Stores that already have one keep it.
WITH ranked AS (
  SELECT s.id, s.market_id,
         row_number() OVER (
           PARTITION BY s.market_id
           ORDER BY (SELECT count(*) FROM orders o
                     WHERE o.storefront_id = s.id AND o.created_at > now() - interval '90 days') DESC,
                    s.created_at
         ) AS rk
  FROM storefronts s
  WHERE s.is_active AND s.accent_color IS NULL
    AND NOT EXISTS (SELECT 1 FROM storefronts x WHERE x.market_id = s.market_id AND x.accent_color IS NOT NULL)
)
UPDATE storefronts s
SET accent_color = (ARRAY['indigo', 'pink', 'cyan', 'gold', 'lime'])[r.rk]
FROM ranked r
WHERE r.id = s.id AND r.rk <= 5;

-- A new store takes the first hue no live store of its market holds.
CREATE OR REPLACE FUNCTION public.storefront_default_accent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.accent_color IS NULL THEN
    SELECT h INTO NEW.accent_color
    FROM unnest(ARRAY['indigo', 'pink', 'cyan', 'gold', 'lime']) WITH ORDINALITY AS t(h, i)
    WHERE NOT EXISTS (
      SELECT 1 FROM storefronts s
      WHERE s.market_id = NEW.market_id AND s.is_active AND s.accent_color = t.h
    )
    ORDER BY t.i
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_storefronts_default_accent ON public.storefronts;
CREATE TRIGGER trg_storefronts_default_accent
  BEFORE INSERT ON public.storefronts
  FOR EACH ROW EXECUTE FUNCTION public.storefront_default_accent();

REVOKE EXECUTE ON FUNCTION public.storefront_default_accent() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_store_dashboard
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_store_dashboard(
  p_market_id uuid, p_from date, p_to date, p_tz text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role    text := get_user_role();
  v_market  uuid;
  v_start   timestamptz;
  v_end     timestamptz;
  v_today   date;
  v_recent  date;
  v_result  jsonb;
BEGIN
  IF v_role = 'super_admin' THEN
    v_market := p_market_id;
  ELSIF v_role = 'market_manager' THEN
    v_market := get_user_market_id();
    IF p_market_id IS NOT NULL AND p_market_id IS DISTINCT FROM v_market THEN RETURN '{}'::jsonb; END IF;
  ELSE
    RETURN '{}'::jsonb;
  END IF;
  IF v_market IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_tz IS NULL
     OR p_to - p_from > 400 THEN
    RETURN '{}'::jsonb;
  END IF;

  v_start  := p_from::timestamp AT TIME ZONE p_tz;
  v_end    := (p_to + 1)::timestamp AT TIME ZONE p_tz;
  v_today  := (now() AT TIME ZONE p_tz)::date;
  v_recent := v_today - 20;

  WITH coh AS (
    SELECT o.id, o.created_at, o.storefront_id, o.status, o.rejection_reason, o.rejection_subreason,
           o.total_price, o.mapping_status, o.product_id
    FROM orders o
    WHERE o.market_id = v_market AND o.created_at >= v_start AND o.created_at < v_end
  ),
  -- When an order that never left was decided (rejected, cancelled, deleted).
  hist AS (
    SELECT h.order_id,
           max(h.created_at) FILTER (WHERE h.status_to IN ('rejected', 'cancelled', 'deleted')) AS decided_at
    FROM order_history h
    JOIN coh c ON c.id = h.order_id
    GROUP BY h.order_id
  ),
  daily AS (
    SELECT o.storefront_id, (o.created_at AT TIME ZONE p_tz)::date AS day, count(*)::int AS n
    FROM orders o
    WHERE o.market_id = v_market AND o.storefront_id IS NOT NULL
      AND o.created_at >= (v_recent::timestamp AT TIME ZONE p_tz)
    GROUP BY 1, 2
  ),
  ads AS (
    SELECT d::date AS day, sum(a.amount / ((a.period_end - a.period_start) + 1)) AS amount
    FROM ad_spend a
    CROSS JOIN LATERAL generate_series(GREATEST(a.period_start, LEAST(p_from, v_recent)),
                                       LEAST(a.period_end, GREATEST(p_to, v_today)), interval '1 day') d
    WHERE a.market_id = v_market AND a.is_active
      AND a.period_start <= GREATEST(p_to, v_today) AND a.period_end >= LEAST(p_from, v_recent)
    GROUP BY d::date
  ),
  sheet AS (
    -- A Sheets store syncs by cron: its connection is broken when runs have failed
    -- since the last one that succeeded.
    SELECT r.storefront_id,
           count(*) FILTER (WHERE r.status = 'failed' AND r.started_at > COALESCE(ok.at, '-infinity'))::int AS failures,
           min(r.started_at) FILTER (WHERE r.status = 'failed' AND r.started_at > COALESCE(ok.at, '-infinity')) AS failing_since,
           (array_agg(r.error ORDER BY r.started_at DESC) FILTER (WHERE r.status = 'failed' AND r.started_at > COALESCE(ok.at, '-infinity')))[1] AS error
    FROM sheet_sync_runs r
    LEFT JOIN LATERAL (
      SELECT max(x.started_at) AS at FROM sheet_sync_runs x
      WHERE x.storefront_id = r.storefront_id AND x.status IN ('succeeded', 'partial')
    ) ok ON true
    WHERE r.market_id = v_market AND r.storefront_id IS NOT NULL
    GROUP BY r.storefront_id
  )
  SELECT jsonb_build_object(
    'market_id', v_market,
    'from', p_from,
    'to', p_to,
    'tz', p_tz,
    'generated_at', now(),
    'orders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'created_at', c.created_at,
        'storefront_id', c.storefront_id,
        'status', c.status,
        'outcome', po.outcome,
        'outcome_at', po.outcome_at,
        'uploaded_at', po.uploaded_at,
        'decided_at', h.decided_at,
        'rejection_reason', c.rejection_reason,
        'rejection_subreason', c.rejection_subreason,
        'total_price', c.total_price,
        'delivery_cost', dc.delivery_cost,
        'return_cost', COALESCE(dc.return_cost, 0),
        -- « à relier »: the storefront's product is unknown to Ordra (the review queue),
        -- or no line of the order resolved to a product at all.
        'unmapped', (c.mapping_status = 'needs_review'
                     OR (c.product_id IS NULL
                         AND NOT EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = c.id AND x.product_id IS NOT NULL)))
      ))
      FROM coh c
      LEFT JOIN carrier_parcel_outcome po ON po.order_id = c.id
      LEFT JOIN order_delivery_cost dc ON dc.order_id = c.id
      LEFT JOIN hist h ON h.order_id = c.id
    ), '[]'::jsonb),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('order_id', l.order_id, 'product_id', l.product_id))
      FROM product_order_lines(v_market, v_start, v_end, NULL) l
    ), '[]'::jsonb),
    'stores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'platform', s.platform,
        'sheet_adapter', s.config ->> 'sheet_adapter',
        'is_active', s.is_active,
        'accent_color', s.accent_color,
        'created_at', s.created_at,
        'last_webhook_status', s.last_webhook_status,
        'last_webhook_error', s.last_webhook_error,
        'last_webhook_received_at', s.last_webhook_received_at,
        'webhook_failure_count', s.webhook_failure_count,
        'sheet_failures', COALESCE(sh.failures, 0),
        'sheet_failing_since', sh.failing_since,
        'sheet_error', sh.error,
        'first_order_at', (SELECT min(o.created_at) FROM orders o WHERE o.storefront_id = s.id),
        'last_order_at', (SELECT max(o.created_at) FROM orders o WHERE o.storefront_id = s.id AND o.created_at < v_end)
      ) ORDER BY s.created_at)
      FROM storefronts s
      LEFT JOIN sheet sh ON sh.storefront_id = s.id
      WHERE s.market_id = v_market
    ), '[]'::jsonb),
    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('storefront_id', d.storefront_id, 'day', d.day, 'n', d.n)) FROM daily d
    ), '[]'::jsonb),
    'ads', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', a.day, 'amount', round(a.amount, 3)) ORDER BY a.day) FROM ads a
    ), '[]'::jsonb),
    'avg_delivery_cost', market_avg_delivery_cost(v_market),
    'first_order_at', (SELECT min(o.created_at) FROM orders o WHERE o.market_id = v_market)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_store_dashboard(uuid, date, date, text) IS
  'Accueil « vos boutiques »: orders received in [from, to] (market-local days) followed to today — one row per order with its store, parcel outcome and the moment it was reached — plus every storefront with its connection state, daily orders over 21 days, ad spend per day and the market''s first order.';

-- SECURITY DEFINER functions are executable by PUBLIC by default: revoke first.
REVOKE EXECUTE ON FUNCTION public.get_store_dashboard(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_dashboard(uuid, date, date, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_orders_performance — each order now says which store it came from, so
--    Performance › Commandes can open on one store (?boutique=), the target of a
--    click on an Accueil card. Same function as 20261005090000 plus that one field;
--    CREATE OR REPLACE keeps its grants, revoked again below all the same.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_orders_performance(
  p_market_id uuid, p_from date, p_to date, p_tz text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text := get_user_role();
  v_market uuid;
  v_start  timestamptz;
  v_end    timestamptz;
  v_result jsonb;
BEGIN
  IF v_role = 'super_admin' THEN
    v_market := p_market_id;
  ELSIF v_role = 'market_manager' THEN
    v_market := get_user_market_id();
    IF p_market_id IS NOT NULL AND p_market_id IS DISTINCT FROM v_market THEN RETURN '{}'::jsonb; END IF;
  ELSE
    RETURN '{}'::jsonb;
  END IF;
  IF v_market IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_tz IS NULL
     OR p_to - p_from > 400 THEN
    RETURN '{}'::jsonb;
  END IF;

  v_start := p_from::timestamp AT TIME ZONE p_tz;
  v_end   := (p_to + 1)::timestamp AT TIME ZONE p_tz;

  WITH coh AS (
    SELECT o.id, o.external_id, o.created_at, o.status, o.assigned_to, o.rejection_reason,
           o.rejection_subreason, o.total_price, o.customer_city, o.product_id, o.product_variant_id, o.storefront_id
    FROM orders o
    WHERE o.market_id = v_market AND o.created_at >= v_start AND o.created_at < v_end
  ),
  lines AS (
    SELECT * FROM product_order_lines(v_market, v_start, v_end, NULL)
  ),
  -- The sizes (attribute variants) of each product in each order; packs are not sizes.
  sizes AS (
    SELECT oi.order_id, oi.product_id, array_agg(DISTINCT oi.variant_id) AS variants
    FROM order_items oi
    JOIN coh c ON c.id = oi.order_id
    JOIN product_variants pv ON pv.id = oi.variant_id AND pv.kind = 'attribute'
    GROUP BY oi.order_id, oi.product_id
    UNION ALL
    SELECT c.id, c.product_id, ARRAY[c.product_variant_id]
    FROM coh c
    JOIN product_variants pv ON pv.id = c.product_variant_id AND pv.kind = 'attribute'
    WHERE NOT EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = c.id)
  ),
  ads AS (
    SELECT d::date AS day, sum(a.amount / ((a.period_end - a.period_start) + 1)) AS amount
    FROM ad_spend a
    CROSS JOIN LATERAL generate_series(GREATEST(a.period_start, p_from), LEAST(a.period_end, p_to), interval '1 day') d
    WHERE a.market_id = v_market AND a.is_active
      AND a.period_start <= p_to AND a.period_end >= p_from
    GROUP BY d::date
  )
  SELECT jsonb_build_object(
    'market_id', v_market,
    'from', p_from,
    'to', p_to,
    'tz', p_tz,
    'orders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'ref', c.external_id,
        'created_at', c.created_at,
        'status', c.status,
        'outcome', po.outcome,
        'failure_cause', po.failure_cause,
        'assigned_to', c.assigned_to,
        'rejection_reason', c.rejection_reason,
        'rejection_subreason', c.rejection_subreason,
        'total_price', c.total_price,
        'city', NULLIF(btrim(c.customer_city), ''),
        'storefront_id', c.storefront_id
      ))
      FROM coh c
      LEFT JOIN carrier_parcel_outcome po ON po.order_id = c.id
    ), '[]'::jsonb),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_id', l.order_id,
        'product_id', l.product_id,
        'share', round(l.share, 6),
        'variants', COALESCE(to_jsonb(s.variants), '[]'::jsonb)
      ))
      FROM lines l
      LEFT JOIN sizes s ON s.order_id = l.order_id AND s.product_id = l.product_id
    ), '[]'::jsonb),
    'ads', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', s.day, 'amount', round(s.amount, 3)) ORDER BY s.day) FROM ads s
    ), '[]'::jsonb),
    'users', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', u.id, 'full_name', u.full_name, 'color', u.color, 'avatar_url', u.avatar_url))
      FROM users u
      WHERE u.id IN (SELECT DISTINCT c.assigned_to FROM coh c WHERE c.assigned_to IS NOT NULL)
    ), '[]'::jsonb),
    'first_order_at', (SELECT min(o.created_at) FROM orders o WHERE o.market_id = v_market)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_orders_performance(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_orders_performance(uuid, date, date, text) TO authenticated;
