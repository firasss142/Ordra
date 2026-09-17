-- Duplicate review: group the duplicates the badge already detects, so they can
-- be worked in one pass instead of one order at a time.
--
-- WHY THIS EXISTS
-- The per-row RPC (get_duplicate_orders_batch) answers "does THIS order have
-- siblings?", which is right for a badge and useless for a review screen. This
-- one answers "which groups of duplicates exist in this market?".
--
-- The grouping predicate is deliberately IDENTICAL to the badge's: same market,
-- same normalized phone, same product (id, else lowercased trimmed name), within
-- a window, and never a dead order. Two different answers to "is this a
-- duplicate?" would be worse than none.
--
-- WHAT THE PRODUCTION DATA SAID (measured 2026-09-17, ~8,400 orders)
--   * 694 of the 868 orders already in `deleted` sat on a repeat phone, and 569
--     were same-product-within-24h — i.e. two thirds of all manual deletions
--     were duplicates the system had already flagged.
--   * Libya's same-product pairs have a median gap of 0.2h; Tunisia's is 118h.
--     Tunisia's are genuine re-orders of one consumable (36 pairs with BOTH
--     orders delivered), which is why the narrow autoselect window matters and
--     why `confidence` exists at all.
--   * In 505 fast pairs, no customer ever received both halves — but 60 orders a
--     1h rule would flag are ALREADY uploaded/scanned/delivered. Hence
--     `already_shipped` and `deletable`, and hence nothing is ever deleted here.
--
-- This function only READS. Deletion stays with manual_delete_orders, behind the
-- existing 8-step gate in src/lib/orders/duplicate-delete.ts.

-- ---------------------------------------------------------------------------
-- 1. Make the detection window configurable (it always should have been)
-- ---------------------------------------------------------------------------
-- `duplicate_window_hours` has been in the settings UI since the badge shipped
-- but nothing ever read it: the RPC hardcoded 86,400 s. The parameter defaults
-- to 24 so every existing caller keeps today's behaviour exactly.
--
-- The old 2-arg signature MUST be dropped first. Postgres treats a new default
-- parameter as a separate overload, not a replacement, so leaving it in place
-- would make the existing 2-arg call from enrichRowsWithDuplicates ambiguous
-- ("function is not unique") and break every duplicate badge in the app.
DROP FUNCTION IF EXISTS public.get_duplicate_orders_batch(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.get_duplicate_orders_batch(
  p_market_id uuid,
  p_rows jsonb,
  p_window_hours integer DEFAULT 24
)
 RETURNS TABLE(source_id uuid, duplicate_count integer, siblings jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_caller_role TEXT;
  v_caller_market UUID;
  v_window INTERVAL;
BEGIN
  v_caller_role := get_user_role();
  v_caller_market := get_user_market_id();

  IF v_caller_role IS DISTINCT FROM 'super_admin'
     AND v_caller_market IS DISTINCT FROM p_market_id THEN
    RETURN;
  END IF;

  -- Seconds, not interval '1 day': a day-interval is calendar arithmetic and
  -- becomes 23/25h across a DST boundary.
  v_window := make_interval(secs => greatest(coalesce(p_window_hours, 24), 0) * 3600);

  RETURN QUERY
  WITH inputs_raw AS (
    SELECT
      (r->>'id')::UUID                              AS src_id,
      normalize_phone(r->>'phone')                  AS np,
      normalize_phone(r->>'phone_2')                AS np2,
      NULLIF(r->>'product_id', '')::UUID            AS pid,
      lower(coalesce(trim(r->>'product_name'), '')) AS pname,
      (r->>'created_at')::TIMESTAMPTZ               AS created_at
    FROM jsonb_array_elements(p_rows) AS r
  ),
  inputs AS (
    SELECT ir.*, array_remove(ARRAY[ir.np, ir.np2], '') AS phones
    FROM inputs_raw ir
  ),
  matches AS (
    SELECT
      i.src_id,
      o.id,
      o.external_id,
      o.status::TEXT AS status,
      o.created_at,
      o.product_name,
      p.image_url AS product_image_url,
      o.quantity,
      o.total_price,
      o.customer_name,
      o.customer_address,
      o.customer_city,
      (o.status::TEXT IN ('uploaded','scanned','dispatched','deposit','in_transit','delivered'))
        AS already_shipped
    FROM inputs i
    CROSS JOIN LATERAL unnest(i.phones) AS ph
    JOIN orders o
      ON o.market_id = p_market_id
     AND o.id <> i.src_id
     AND normalize_phone(o.customer_phone) = ph
     AND (
           (i.pid IS NOT NULL AND o.product_id = i.pid)
        OR ((i.pid IS NULL OR o.product_id IS NULL)
            AND i.pname <> '' AND lower(trim(o.product_name)) = i.pname)
         )
     AND o.created_at >= i.created_at - v_window
     AND o.created_at <= i.created_at + v_window
     AND o.status::TEXT NOT IN ('cancelled','deleted','rejected','returned')
    LEFT JOIN products p ON p.id = o.product_id

    UNION

    SELECT
      i.src_id, o.id, o.external_id, o.status::TEXT, o.created_at, o.product_name,
      p.image_url, o.quantity, o.total_price, o.customer_name, o.customer_address,
      o.customer_city,
      (o.status::TEXT IN ('uploaded','scanned','dispatched','deposit','in_transit','delivered'))
    FROM inputs i
    CROSS JOIN LATERAL unnest(i.phones) AS ph
    JOIN orders o
      ON o.market_id = p_market_id
     AND o.id <> i.src_id
     AND normalize_phone(o.customer_phone_2) = ph
     AND (
           (i.pid IS NOT NULL AND o.product_id = i.pid)
        OR ((i.pid IS NULL OR o.product_id IS NULL)
            AND i.pname <> '' AND lower(trim(o.product_name)) = i.pname)
         )
     AND o.created_at >= i.created_at - v_window
     AND o.created_at <= i.created_at + v_window
     AND o.status::TEXT NOT IN ('cancelled','deleted','rejected','returned')
    LEFT JOIN products p ON p.id = o.product_id
  )
  SELECT
    i.src_id,
    COUNT(m.id)::INTEGER,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', m.id, 'external_id', m.external_id, 'status', m.status,
          'created_at', m.created_at, 'product_name', m.product_name,
          'product_image_url', m.product_image_url, 'quantity', m.quantity,
          'total_price', m.total_price, 'customer_name', m.customer_name,
          'customer_address', m.customer_address, 'customer_city', m.customer_city,
          'already_shipped', m.already_shipped
        )
        ORDER BY m.already_shipped DESC, m.created_at DESC
      ) FILTER (WHERE m.id IS NOT NULL),
      '[]'::jsonb
    )
  FROM inputs i
  LEFT JOIN matches m ON m.src_id = i.src_id
  GROUP BY i.src_id;
END;
$function$;

-- DROP removed the old grants along with the old signature; restore them.
REVOKE ALL ON FUNCTION public.get_duplicate_orders_batch(uuid, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_duplicate_orders_batch(uuid, jsonb, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The review screen's grouped view
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_duplicate_groups(
  p_market_id uuid,
  p_window_hours integer DEFAULT 24,
  p_days_back integer DEFAULT 90,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
 RETURNS TABLE(group_key text, member_count integer, members jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_caller_market UUID;
  v_window INTERVAL;
BEGIN
  v_caller_role := get_user_role();
  v_caller_market := get_user_market_id();

  -- Same market guard as get_duplicate_orders_batch. SECURITY DEFINER bypasses
  -- RLS, so this is the only thing standing between a market manager and the
  -- other market's customers.
  IF v_caller_role IS DISTINCT FROM 'super_admin'
     AND v_caller_market IS DISTINCT FROM p_market_id THEN
    RETURN;
  END IF;

  v_window := make_interval(secs => greatest(coalesce(p_window_hours, 24), 0) * 3600);

  RETURN QUERY
  WITH live AS (
    SELECT
      o.id, o.external_id, o.status::TEXT AS status, o.created_at,
      o.product_id, o.product_name, o.quantity, o.unit_price, o.total_price,
      o.customer_name, o.customer_phone, o.customer_address, o.customer_city,
      normalize_phone(o.customer_phone) AS np,
      COALESCE(o.product_id::TEXT, lower(trim(o.product_name))) AS prod_key,
      p.image_url AS product_image_url
    FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
    WHERE o.market_id = p_market_id
      AND o.created_at >= now() - make_interval(days => greatest(coalesce(p_days_back, 90), 1))
      AND o.status::TEXT NOT IN ('cancelled','deleted','rejected','returned')
      AND normalize_phone(o.customer_phone) <> ''
  ),
  -- A group is a (phone, product) bucket that holds more than one order AND
  -- whose members actually fall inside the window of one another. The bucket
  -- alone is not enough: two orders of the same product a year apart share a
  -- bucket but are not duplicates.
  bucketed AS (
    SELECT l.*,
           COUNT(*)      OVER w AS bucket_n,
           MIN(l.created_at) OVER w AS first_at,
           MAX(l.created_at) OVER w AS last_at
    FROM live l
    WINDOW w AS (PARTITION BY l.np, l.prod_key)
  ),
  in_window AS (
    SELECT b.*
    FROM bucketed b
    WHERE b.bucket_n > 1
      AND b.last_at - b.first_at <= v_window
  ),
  -- Deletability mirrors DUPLICATE_DIALOG_DELETE_STATUSES in
  -- src/lib/order-permissions.ts. A drift test in groups.test.ts asserts the
  -- two lists stay identical; change one and you must change the other.
  shaped AS (
    SELECT
      w.np || '|' || w.prod_key AS group_key,
      w.id, w.external_id, w.status, w.created_at, w.product_id, w.product_name,
      w.product_image_url, w.quantity, w.unit_price, w.total_price,
      w.customer_name, w.customer_address, w.customer_city,
      (w.status IN ('uploaded','scanned','dispatched','deposit','in_transit','delivered'))
        AS already_shipped,
      (w.created_at = MAX(w.created_at) OVER (PARTITION BY w.np, w.prod_key))
        AS is_anchor,
      (w.status IN ('pending','assigned','attempt_1','attempt_2','attempt_3',
                    'callback_scheduled','confirmed','dispatch_scheduled'))
        AS deletable
    FROM in_window w
  )
  SELECT
    s.group_key,
    COUNT(*)::INTEGER,
    jsonb_agg(
      jsonb_build_object(
        'id', s.id, 'external_id', s.external_id, 'status', s.status,
        'created_at', s.created_at, 'product_id', s.product_id,
        'product_name', s.product_name, 'product_image_url', s.product_image_url,
        'quantity', s.quantity, 'unit_price', s.unit_price,
        'total_price', s.total_price, 'customer_name', s.customer_name,
        'customer_address', s.customer_address, 'customer_city', s.customer_city,
        'already_shipped', s.already_shipped, 'is_anchor', s.is_anchor,
        'deletable', s.deletable
      ) ORDER BY s.created_at DESC
    )
  FROM shaped s
  GROUP BY s.group_key
  ORDER BY MAX(s.created_at) DESC
  LIMIT greatest(coalesce(p_limit, 100), 1)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_duplicate_groups(uuid, integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_duplicate_groups(uuid, integer, integer, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_duplicate_groups IS
  'Groups of likely-duplicate orders for the review screen. Same predicate as '
  'get_duplicate_orders_batch (the badge), grouped by (normalized phone, product) '
  'instead of per-row. Read-only: deletion goes through manual_delete_orders '
  'behind the gate in src/lib/orders/duplicate-delete.ts.';
