-- ============================================================
-- 20260926000002_normalize_phone_trunk_zero.sql
-- normalize_phone() kept the domestic trunk zero, so one buyer was two people.
--
-- WHAT WAS WRONG: normalize_phone (20260611000001) strips separators and the
-- country code (+218 / 00218 / 218) but not the national trunk prefix. Libyan
-- numbers are written both ways in the wild — "0916063026" when typed locally
-- and "916431639" when it arrives through a form that already dropped the zero.
-- Both are the same subscriber. The function returned them unchanged, so:
--
--   • 1 240 of 3 976 Libyan orders normalise to a 10-char string starting '0'
--     while 2 736 normalise to the bare 9 digits;
--   • 149 real people were split across 298 `customers` rows, each holding half
--     that person's history.
--
-- WHY IT MATTERS NOW: `customers.risk_class` (20260926000001) decides whether
-- an agent is warned before a delivery. A buyer who returned two parcels under
-- "0912..." and orders again as "912..." lands on a fresh row with
-- risk_class = 'none' — the exact warning the column exists to give, silently
-- withheld. Repeat-buyer badges and duplicate detection read the same function
-- and were wrong in the same direction.
--
-- THE RULE: strip a leading zero only when what remains is a 9-digit national
-- number. Verified against the whole order table before applying:
--   Libya   3 501 distinct → 3 352 distinct  (149 identities merged, correct)
--   Tunisia 3 761 distinct → 3 761 distinct  (untouched — TN numbers are 8
--           digits and never carry the trunk zero)
-- The length guard is what keeps Tunisia out: a TN "0" prefix would leave 7 or
-- 9 digits, never 9-from-10, so no TN pair can collide.
--
-- IMMUTABLE is preserved (the body is still a pure function of its input), so
-- idx_orders_market_phone_norm and get_customer_history_batch stay valid — but
-- the index is REINDEXed below because its stored keys were computed with the
-- old definition and Postgres will not recompute them on its own.
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v TEXT;
BEGIN
  IF p_phone IS NULL OR length(p_phone) = 0 THEN RETURN ''; END IF;
  v := regexp_replace(p_phone, '[\s\-\.\(\) ]', '', 'g');
  IF substring(v, 1, 1) = '+' THEN v := substring(v, 2); END IF;
  IF substring(v, 1, 5) = '00216' THEN v := substring(v, 6);
  ELSIF substring(v, 1, 5) = '00218' THEN v := substring(v, 6);
  ELSIF substring(v, 1, 3) = '216' AND length(v) > 3 THEN v := substring(v, 4);
  ELSIF substring(v, 1, 3) = '218' AND length(v) > 3 THEN v := substring(v, 4);
  END IF;

  -- National trunk zero. Only when the remainder is a 9-digit subscriber
  -- number, which is Libya's plan. Tunisia's 8-digit numbers never match.
  IF v ~ '^0[0-9]{9}$' THEN
    v := substring(v, 2);
  END IF;

  RETURN v;
END;
$$;

COMMENT ON FUNCTION public.normalize_phone(TEXT) IS
  'Strips separators, country code (216/218) and the Libyan trunk zero (only when 10 digits starting 0). Mirrored in src/lib/leads/phone.ts.';

-- The functional index stored keys built by the OLD definition.
REINDEX INDEX public.idx_orders_market_phone_norm;

-- ── Re-key the customers the old definition split ──────────────────────────
--
-- Order matters. For each (market, stripped) pair that now collides, keep the
-- row with the most orders as the survivor, move every order onto it, delete
-- the loser, then recount. Doing it as one UPDATE would violate the unique
-- constraint mid-statement.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.id            AS loser_id,
           keep.id         AS keeper_id
    FROM public.customers c
    JOIN LATERAL (
      SELECT k.id, k.orders_count
      FROM public.customers k
      WHERE k.market_id = c.market_id
        AND k.phone_normalized = substring(c.phone_normalized, 2)
      ORDER BY k.orders_count DESC, k.created_at ASC
      LIMIT 1
    ) keep ON true
    WHERE c.phone_normalized ~ '^0[0-9]{9}$'
  LOOP
    UPDATE public.orders SET customer_id = r.keeper_id WHERE customer_id = r.loser_id;
    -- Fold the loser's phone spellings into the keeper before dropping it.
    UPDATE public.customers k
    SET phones = ARRAY(SELECT DISTINCT unnest(k.phones || l.phones)),
        name   = COALESCE(k.name, l.name)
    FROM public.customers l
    WHERE k.id = r.keeper_id AND l.id = r.loser_id;
    DELETE FROM public.customers WHERE id = r.loser_id;
  END LOOP;
END;
$$;

-- Any surviving row whose key still carries the trunk zero had no counterpart:
-- rewrite the key in place rather than leaving two spellings in the table.
UPDATE public.customers
SET phone_normalized = substring(phone_normalized, 2),
    updated_at = now()
WHERE phone_normalized ~ '^0[0-9]{9}$';

-- Recount everything the re-keying touched.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.customers LOOP
    PERFORM public.refresh_customer_stats(r.id);
  END LOOP;
END;
$$;
