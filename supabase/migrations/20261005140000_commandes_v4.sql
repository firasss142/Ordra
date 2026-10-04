-- Commandes v4 (prototypes/commandes-v4.html) — the backend of the rebuilt Commandes area.
--
-- 1. duplicate_dismissals — « Pas un doublon »: the group never comes back to the cleanup.
-- 2. get_orders_work_counts — the four work shortcuts, each counting exactly the list it opens.
-- 3. get_order_facet_counts_v2 — facet counts for the multi-select filters (+ Boutique), in
--    both the working list and Archivées. The predicates restate src/lib/orders/list-query.ts.
-- 4. get_repeat_customers — « Commandes répétées »: a customer who came back, with every order.
--
-- New functions, not new signatures of old ones: get_order_facet_counts stays as it is until
-- the deploy that stops calling it (a DROP would reset its grants — drop-function-resets-grants).
-- Every function below is SECURITY INVOKER: RLS decides what a manager can count.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. « Pas un doublon »
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.duplicate_dismissals (
  order_id      uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  market_id     uuid NOT NULL REFERENCES public.markets(id),
  dismissed_by  uuid REFERENCES public.users(id),
  dismissed_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.duplicate_dismissals IS
  'Orders a manager marked « Pas un doublon » in Commandes répétées. A duplicate group whose every member is here is not shown again; a new copy arriving later brings the group back.';

CREATE INDEX IF NOT EXISTS duplicate_dismissals_market_idx ON public.duplicate_dismissals (market_id);

ALTER TABLE public.duplicate_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS duplicate_dismissals_select ON public.duplicate_dismissals;
CREATE POLICY duplicate_dismissals_select ON public.duplicate_dismissals FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR ((SELECT public.get_user_role()) IN ('market_manager', 'agent') AND market_id = (SELECT public.get_user_market_id()))
  );

DROP POLICY IF EXISTS duplicate_dismissals_insert ON public.duplicate_dismissals;
CREATE POLICY duplicate_dismissals_insert ON public.duplicate_dismissals FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.get_user_role()) = 'super_admin'
    OR ((SELECT public.get_user_role()) = 'market_manager' AND market_id = (SELECT public.get_user_market_id()))
  );

REVOKE ALL ON public.duplicate_dismissals FROM anon;
GRANT SELECT, INSERT ON public.duplicate_dismissals TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The four work shortcuts (+ the two hint lines), counted now.
--    p_day_start = the market's midnight as a UTC instant (lib/dates/market-day).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_orders_work_counts(
  p_market_id uuid DEFAULT NULL,
  p_day_start timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH live AS (
    SELECT o.id, o.status::text AS status, o.assigned_to, o.created_at, o.callback_scheduled_at
    FROM public.orders o
    WHERE (p_market_id IS NULL OR o.market_id = p_market_id)
      AND o.archived_at IS NULL
      AND o.status::text <> 'deleted'
  )
  SELECT jsonb_build_object(
    'today',          count(*) FILTER (WHERE p_day_start IS NOT NULL AND created_at >= p_day_start),
    'unassigned',     count(*) FILTER (WHERE status = 'pending' AND assigned_to IS NULL),
    'recall',         count(*) FILTER (WHERE status IN ('attempt_1', 'attempt_2', 'attempt_3', 'callback_scheduled')),
    'late_callbacks', count(*) FILTER (WHERE status = 'callback_scheduled' AND callback_scheduled_at < now()),
    'to_send',        count(*) FILTER (WHERE status = 'confirmed'),
    'uploaded_today', (
      SELECT count(DISTINCT h.order_id)
      FROM public.order_history h
      JOIN live l ON l.id = h.order_id
      WHERE p_day_start IS NOT NULL
        AND h.status_to::text = 'uploaded'
        AND h.created_at >= p_day_start
    )
  )
  FROM live;
$$;

REVOKE EXECUTE ON FUNCTION public.get_orders_work_counts(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_orders_work_counts(uuid, timestamptz) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Facet counts for the multi-select filter line.
--    A dimension is counted with every OTHER filter applied but not its own.
--    « none » / « unassigned » are the NULL value of a facet, as in list-query.ts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_order_facet_counts_v2(
  p_market_id uuid DEFAULT NULL,
  p_scope text DEFAULT 'orders',
  p_state text DEFAULT 'eligible',
  p_archive_cutoff timestamptz DEFAULT NULL,
  p_preset text DEFAULT 'all',
  p_day_start timestamptz DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_agents text[] DEFAULT NULL,
  p_storefronts uuid[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_products uuid[] DEFAULT NULL,
  p_carriers text[] DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_search_legs jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH base AS (
  SELECT
    o.status::text AS status,
    o.assigned_to,
    o.storefront_id,
    nullif(o.customer_city, '') AS city,
    o.product_id,
    o.carrier_id,
    (coalesce(cardinality(p_statuses), 0) = 0 OR o.status::text = ANY (p_statuses)) AS m_status,
    (coalesce(cardinality(p_agents), 0) = 0
       OR ('unassigned' = ANY (p_agents) AND o.assigned_to IS NULL)
       OR o.assigned_to::text = ANY (p_agents)) AS m_agent,
    (coalesce(cardinality(p_storefronts), 0) = 0 OR o.storefront_id = ANY (p_storefronts)) AS m_store,
    (coalesce(cardinality(p_cities), 0) = 0
       OR ('none' = ANY (p_cities) AND nullif(o.customer_city, '') IS NULL)
       OR o.customer_city = ANY (p_cities)) AS m_city,
    (coalesce(cardinality(p_products), 0) = 0 OR o.product_id = ANY (p_products)) AS m_product,
    (coalesce(cardinality(p_carriers), 0) = 0
       OR ('none' = ANY (p_carriers) AND o.carrier_id IS NULL)
       OR o.carrier_id::text = ANY (p_carriers)) AS m_carrier
  FROM public.orders o
  WHERE
    (p_market_id IS NULL OR o.market_id = p_market_id)
    -- Scope, as list-query.ts: the working list, or one tab of Archivées.
    AND CASE
      WHEN p_scope = 'archive' AND p_state = 'deleted' THEN o.status::text = 'deleted'
      WHEN p_scope = 'archive' THEN
        o.terminal_at IS NOT NULL
        AND o.status::text <> 'deleted'
        AND CASE p_state
          WHEN 'archived' THEN o.archived_at IS NOT NULL
          WHEN 'recent'   THEN o.archived_at IS NULL AND o.terminal_at >= p_archive_cutoff
          ELSE                 o.archived_at IS NULL AND o.terminal_at <  p_archive_cutoff
        END
      ELSE o.archived_at IS NULL AND o.status::text <> 'deleted'
    END
    -- The work shortcuts apply to the working list only.
    AND (
      p_scope = 'archive' OR p_preset IS NULL OR p_preset = 'all'
      OR (p_preset = 'today' AND o.created_at >= p_day_start)
      OR (p_preset = 'unassigned' AND o.status::text = 'pending' AND o.assigned_to IS NULL)
      OR (p_preset = 'recall' AND o.status::text IN ('attempt_1', 'attempt_2', 'attempt_3', 'callback_scheduled'))
      OR (p_preset = 'uploaded_today' AND EXISTS (
            SELECT 1 FROM public.order_history h
            WHERE h.order_id = o.id AND h.status_to::text = 'uploaded' AND h.created_at >= p_day_start))
    )
    AND (p_date_from IS NULL OR o.created_at >= p_date_from)
    AND (p_date_to IS NULL OR o.created_at <= p_date_to)
    -- Search: terms AND, legs within a term OR (same as get_order_facet_counts).
    AND (
      p_search_legs IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_search_legs) AS term
        WHERE NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(term) AS leg
          CROSS JOIN LATERAL (
            SELECT coalesce(
              CASE leg->>'c'
                WHEN 'customer_name'    THEN o.customer_name
                WHEN 'customer_phone'   THEN o.customer_phone
                WHEN 'customer_phone_2' THEN o.customer_phone_2
                WHEN 'customer_city'    THEN o.customer_city
                WHEN 'customer_address' THEN o.customer_address
                WHEN 'product_name'     THEN o.product_name
                WHEN 'external_id'      THEN o.external_id
                WHEN 'tracking_number'  THEN o.tracking_number
              END, ''
            ) AS val
          ) f
          WHERE CASE WHEN leg->>'op' = 'imatch'
                  THEN f.val ~* (leg->>'v')
                  ELSE f.val ILIKE '%' || (leg->>'v') || '%'
                END
        )
      )
    )
)
SELECT jsonb_build_object(
  'statuses', coalesce((SELECT jsonb_object_agg(status, n) FROM (
      SELECT status, count(*) AS n FROM base
      WHERE m_agent AND m_store AND m_city AND m_product AND m_carrier GROUP BY status) s), '{}'::jsonb),
  'agents', coalesce((SELECT jsonb_object_agg(k, n) FROM (
      SELECT coalesce(assigned_to::text, 'unassigned') AS k, count(*) AS n FROM base
      WHERE m_status AND m_store AND m_city AND m_product AND m_carrier GROUP BY 1) a), '{}'::jsonb),
  'storefronts', coalesce((SELECT jsonb_object_agg(k, n) FROM (
      SELECT storefront_id::text AS k, count(*) AS n FROM base
      WHERE m_status AND m_agent AND m_city AND m_product AND m_carrier AND storefront_id IS NOT NULL GROUP BY 1) b), '{}'::jsonb),
  'cities', coalesce((SELECT jsonb_object_agg(k, n) FROM (
      SELECT coalesce(city, 'none') AS k, count(*) AS n FROM base
      WHERE m_status AND m_agent AND m_store AND m_product AND m_carrier GROUP BY 1) c), '{}'::jsonb),
  'products', coalesce((SELECT jsonb_object_agg(k, n) FROM (
      SELECT product_id::text AS k, count(*) AS n FROM base
      WHERE m_status AND m_agent AND m_store AND m_city AND m_carrier AND product_id IS NOT NULL GROUP BY 1) p), '{}'::jsonb),
  'carriers', coalesce((SELECT jsonb_object_agg(k, n) FROM (
      SELECT coalesce(carrier_id::text, 'none') AS k, count(*) AS n FROM base
      WHERE m_status AND m_agent AND m_store AND m_city AND m_product GROUP BY 1) r), '{}'::jsonb)
);
$$;

REVOKE EXECUTE ON FUNCTION public.get_order_facet_counts_v2(uuid, text, text, timestamptz, text, timestamptz, text[], text[], uuid[], text[], uuid[], text[], timestamptz, timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_facet_counts_v2(uuid, text, text, timestamptz, text, timestamptz, text[], text[], uuid[], text[], uuid[], text[], timestamptz, timestamptz, jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. « Commandes répétées » — a customer who ordered in the last p_recent_days and
--    has at least two orders over p_days_back, with every one of those orders
--    (oldest first) for the trail. Duplicate groups are collapsed by the app,
--    which also reads /api/orders/duplicates.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_repeat_customers(
  p_market_id uuid,
  p_recent_days int DEFAULT 7,
  p_days_back int DEFAULT 90,
  p_limit int DEFAULT 400
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH recent AS (
    SELECT DISTINCT o.customer_id
    FROM public.orders o
    WHERE o.market_id = p_market_id
      AND o.customer_id IS NOT NULL
      AND o.status::text <> 'deleted'
      AND o.created_at >= now() - make_interval(days => p_recent_days)
  ),
  hist AS (
    SELECT o.*
    FROM public.orders o
    JOIN recent r ON r.customer_id = o.customer_id
    WHERE o.market_id = p_market_id
      AND o.status::text <> 'deleted'
      AND o.created_at >= now() - make_interval(days => p_days_back)
  ),
  multi AS (
    SELECT customer_id, max(created_at) AS last_at
    FROM hist
    GROUP BY customer_id
    HAVING count(*) >= 2
    ORDER BY max(created_at) DESC
    LIMIT p_limit
  )
  SELECT coalesce(jsonb_agg(c ORDER BY (c->>'last_at') DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'customer_id', m.customer_id,
      'last_at', m.last_at,
      'orders', (
        SELECT jsonb_agg(jsonb_build_object(
          'id', h.id,
          'external_id', h.external_id,
          'created_at', h.created_at,
          'status', h.status,
          'customer_name', h.customer_name,
          'customer_phone', h.customer_phone,
          'customer_city', h.customer_city,
          'customer_address', h.customer_address,
          'product_id', h.product_id,
          'product_name', coalesce(p.name, h.product_name),
          'product_image_url', p.image_url,
          'variant_label', h.variant_label,
          'quantity', h.quantity,
          'total_price', h.total_price,
          'assigned_to', h.assigned_to,
          'storefront_id', h.storefront_id,
          'rejection_reason', h.rejection_reason,
          'rejection_subreason', h.rejection_subreason,
          'callback_scheduled_at', h.callback_scheduled_at,
          'attempts_count', h.attempts_count
        ) ORDER BY h.created_at)
        FROM hist h
        LEFT JOIN public.products p ON p.id = h.product_id
        WHERE h.customer_id = m.customer_id
      )
    ) AS c
    FROM multi m
  ) x;
$$;

REVOKE EXECUTE ON FUNCTION public.get_repeat_customers(uuid, int, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_repeat_customers(uuid, int, int, int) TO authenticated;
