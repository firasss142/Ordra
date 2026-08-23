-- Retours — make the scanner able to find the parcel in the operator's hands.
--
-- WHY
--   The returns scan input matched the scanned code against `orders.id`, the
--   OMS UUID. Nothing is printed on a returned parcel that resembles a UUID:
--   all 50 returns in the queue today are Tunisian, carry a 12-digit Cosmos
--   tracking number, and none carries a sticker. So every scan of a real parcel
--   fell through to "commande introuvable" — the scanner could not work at all.
--
--   get_to_be_returned_orders did not even RETURN the tracking number, so there
--   was nothing on the client to match against either.
--
-- WHAT CHANGES
--   1. The queue carries the identifiers actually printed on a parcel.
--   2. find_return_by_code resolves a scanned code across the WHOLE market, not
--      just the page the browser happens to hold, and says what it found rather
--      than only whether it found something.
--
-- A parcel that is not a return still gets an answer. "Introuvable" for a
-- parcel the operator is physically holding is never true and never actionable
-- — it is in the system, just not where they expected — so the lookup reports
-- its real status and lets the console explain.

DROP FUNCTION IF EXISTS public.get_to_be_returned_orders(UUID, INTEGER, TIMESTAMPTZ, UUID);

CREATE FUNCTION public.get_to_be_returned_orders(
  p_market_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_cursor_created_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  customer_name TEXT,
  customer_phone TEXT,
  customer_city TEXT,
  customer_address TEXT,
  product_id UUID,
  product_name TEXT,
  variant_label TEXT,
  quantity INTEGER,
  total_price NUMERIC,
  status TEXT,
  created_at TIMESTAMPTZ,
  -- What is actually printed on the parcel.
  tracking_number TEXT,
  carrier_sticker_ref TEXT,
  carrier_status_slug TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    o.id, o.customer_name, o.customer_phone, o.customer_city, o.customer_address,
    o.product_id, o.product_name, o.variant_label, o.quantity, o.total_price,
    o.status::TEXT, o.created_at,
    o.tracking_number, o.carrier_sticker_ref, o.carrier_status_slug
  FROM orders o
  WHERE o.status = 'to_be_returned'
    AND o.archived_at IS NULL
    AND (p_market_id IS NULL OR o.market_id = p_market_id)
    AND (
      p_cursor_created_at IS NULL
      OR (o.created_at, o.id) > (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY o.created_at ASC, o.id ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_to_be_returned_orders(UUID, INTEGER, TIMESTAMPTZ, UUID) TO PUBLIC;

-- ── Resolve a scanned code ──────────────────────────────────────────────────
--
-- Match order, most specific first:
--   1. the carrier sticker (Libya — the number Darb routes by),
--   2. the carrier tracking number (Tunisia — the 12 digits on the label),
--   3. the OMS id, whole or by a prefix of at least 6 characters.
--
-- A prefix that matches more than one order returns `ambiguous` rather than an
-- arbitrary pick: two parcels resolving to whichever row sorted first is how a
-- return gets recorded against the wrong customer.

CREATE OR REPLACE FUNCTION public.find_return_by_code(
  p_market_id UUID,
  p_code      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_code    TEXT := NULLIF(btrim(COALESCE(p_code, '')), '');
  v_id      UUID;
  v_status  TEXT;
  v_matches INT;
BEGIN
  IF v_code IS NULL THEN
    RETURN json_build_object('outcome', 'empty');
  END IF;

  -- 1 + 2: the carrier identifiers.
  --
  -- Compared with leading zeros stripped as well as literally: Cosmos prints
  -- twelve digits like `000000227104`, which a scanner reads exactly but a
  -- person retyping drops the zeros from. Both should find the same parcel.
  SELECT o.id, o.status::TEXT INTO v_id, v_status
  FROM orders o
  WHERE (p_market_id IS NULL OR o.market_id = p_market_id)
    AND o.archived_at IS NULL
    AND (
      o.carrier_sticker_ref = v_code
      OR lower(o.tracking_number) = lower(v_code)
      OR (
        v_code ~ '^[0-9]+$'
        AND o.tracking_number ~ '^[0-9]+$'
        AND ltrim(o.tracking_number, '0') = ltrim(v_code, '0')
      )
      OR (
        v_code ~ '^[0-9]+$'
        AND o.carrier_sticker_ref ~ '^[0-9]+$'
        AND ltrim(o.carrier_sticker_ref, '0') = ltrim(v_code, '0')
      )
    )
  ORDER BY o.created_at DESC
  LIMIT 1;

  -- 3: the OMS id, whole or by prefix.
  IF v_id IS NULL AND length(v_code) >= 6 THEN
    SELECT COUNT(*) INTO v_matches
    FROM orders o
    WHERE (p_market_id IS NULL OR o.market_id = p_market_id)
      AND o.archived_at IS NULL
      AND lower(o.id::TEXT) LIKE lower(v_code) || '%';

    IF v_matches > 1 THEN
      RETURN json_build_object('outcome', 'ambiguous', 'matches', v_matches, 'code', v_code);
    END IF;

    SELECT o.id, o.status::TEXT INTO v_id, v_status
    FROM orders o
    WHERE (p_market_id IS NULL OR o.market_id = p_market_id)
      AND o.archived_at IS NULL
      AND lower(o.id::TEXT) LIKE lower(v_code) || '%'
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    RETURN json_build_object('outcome', 'not_found', 'code', v_code);
  END IF;

  -- Found, but not a return. The operator is holding it, so telling them
  -- "introuvable" would be false; name the state it is actually in.
  IF v_status <> 'to_be_returned' THEN
    RETURN json_build_object(
      'outcome', 'wrong_status', 'order_id', v_id, 'status', v_status, 'code', v_code
    );
  END IF;

  RETURN json_build_object('outcome', 'found', 'order_id', v_id, 'code', v_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_return_by_code(UUID, TEXT) TO PUBLIC;
