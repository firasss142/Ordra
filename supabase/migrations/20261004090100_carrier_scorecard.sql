-- Transporteurs — what the page reads (plans/transporteurs.md §4,
-- prototypes/transporteurs-v2.html). Built on carrier_parcel_outcome.
--
-- 1. carriers.accent_color — the colour of a carrier ACCOUNT. The two Darb
--    accounts share one logo; a thin ring of colour around it was not readable
--    (owner, 2026-10-03). The page paints a full band in this colour and the
--    agent queue a solid city pill. Validated pair (dataviz validator, CVD
--    ΔE 25.2, white text 6.1:1 and 4.8:1): #1F5FBF blue, #C24E17 orange.
--    NULL = no colour chosen; the app then falls back by position.
--
-- 2. get_carrier_scorecard(market, days, now) → everything the three screens
--    need, for every active carrier that has ever carried a parcel:
--      period    parcels SENT in [now − days, now): sent (cancellations before
--                pickup excluded), delivered, failed, in flight, the same for
--                the period before, pickup speed, first attempt, median days
--                pickup → delivered, delivered within 3 days of pickup
--      weeks     13 weekly upload cohorts, the last one is now's week
--      open      parcels at the carrier NOW, by days since pickup, late, stuck
--      returns   failures after pickup over 90 days: handed back, scanned,
--                still at the carrier, age of the unscanned ones
--      reasons   courier remark class of the failures, 90 days (Darb only)
--      cities    delivered / failed / median days per destination, 90 days
--    plus `dormant`: inactive carriers that still hold open parcels.
--    Thresholds are settings: carrier_delivery_target_pct (60),
--    carrier_late_days (3), carrier_stall_days (5, existing).
--    p_now exists for the SQL tests; the app never passes it.
--
-- 3. get_carrier_scorecard_parcels(market, carrier, kind, now) → the rows
--    behind a number: late | returns | dormant.
--
-- Guard (same as the team control room): super_admin → any market ;
-- market_manager → own market only, '{}' / no rows otherwise ; anyone else
-- → nothing. SECURITY DEFINER, so the guard IS the isolation.

-- ── 1. account colour ───────────────────────────────────────────────────────

ALTER TABLE public.carriers
  ADD COLUMN IF NOT EXISTS accent_color TEXT
  CONSTRAINT carriers_accent_color_hex CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9A-Fa-f]{6}$');

COMMENT ON COLUMN public.carriers.accent_color IS
  'Colour of this carrier account (#RRGGBB): Transporteurs band + queue city pill. NULL = fallback by position.';

UPDATE public.carriers c
   SET accent_color = CASE
         WHEN c.code = 'darb_assabil' AND x.wh = 'benghazi' THEN '#C24E17'
         WHEN c.code = 'darb_assabil'                       THEN '#1F5FBF'
         WHEN c.code = 'navex'                              THEN '#1F5FBF'
         WHEN c.code = 'cosmos'                             THEN '#C24E17'
       END
  FROM (SELECT c2.id, w.code AS wh
          FROM public.carriers c2 LEFT JOIN public.warehouses w ON w.id = c2.warehouse_id) x
 WHERE x.id = c.id
   AND c.accent_color IS NULL;

-- ── 2. the scorecard ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_carrier_scorecard(
  p_market_id UUID,
  p_days      INT         DEFAULT 30,
  p_now       TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   TEXT := get_user_role();
  v_market UUID;
  v_days   INT  := GREATEST(1, LEAST(COALESCE(p_days, 30), 365));
  v_now    TIMESTAMPTZ := COALESCE(p_now, now());
  v_from   TIMESTAMPTZ;
  v_prev   TIMESTAMPTZ;
  v_90     TIMESTAMPTZ;
  v_target INT;
  v_late   INT;
  v_stuck  INT;
  v_tz     TEXT;
  v_week0  DATE;
  v_out    JSONB;
BEGIN
  IF v_role = 'super_admin' THEN
    v_market := p_market_id;
  ELSIF v_role = 'market_manager' THEN
    v_market := get_user_market_id();
    IF p_market_id IS DISTINCT FROM v_market THEN
      RETURN '{}'::JSONB;
    END IF;
  ELSE
    RETURN '{}'::JSONB;
  END IF;
  IF v_market IS NULL THEN
    RETURN '{}'::JSONB;
  END IF;

  v_from   := v_now - make_interval(days => v_days);
  v_prev   := v_now - make_interval(days => 2 * v_days);
  v_90     := v_now - INTERVAL '90 days';
  v_target := delivery_setting_int(v_market, 'carrier_delivery_target_pct', 60);
  v_late   := delivery_setting_int(v_market, 'carrier_late_days', 3);
  v_stuck  := delivery_setting_int(v_market, 'carrier_stall_days', 5);
  v_tz     := COALESCE(market_tz(v_market), 'UTC');
  v_week0  := (date_trunc('week', v_now AT TIME ZONE v_tz))::DATE - 84;

  WITH p AS MATERIALIZED (
    SELECT cpo.*
      FROM carrier_parcel_outcome cpo
     WHERE cpo.market_id = v_market
  ),
  cards AS (
    SELECT c.id, c.name, c.code, c.accent_color, c.created_at, w.name_fr, w.name_ar,
           (SELECT count(*) FROM carriers c2
             WHERE c2.market_id = c.market_id AND c2.code = c.code AND c2.is_active) > 1 AS multi_account,
           min(p.uploaded_at) AS first_upload_at,
           max(p.uploaded_at) AS last_upload_at
      FROM carriers c
      JOIN p ON p.carrier_id = c.id
      LEFT JOIN warehouses w ON w.id = c.warehouse_id
     WHERE c.market_id = v_market AND c.is_active
     GROUP BY c.id, c.name, c.code, c.accent_color, c.created_at, w.name_fr, w.name_ar, c.market_id
  )
  SELECT jsonb_build_object(
    'market_id',    v_market,
    'days',         v_days,
    'generated_at', v_now,
    'settings',     jsonb_build_object('target_pct', v_target, 'late_days', v_late, 'stuck_days', v_stuck),
    'last_sync_at', (SELECT max(s.last_synced_at)
                       FROM darb_shipments s JOIN carriers c ON c.id = s.carrier_id
                      WHERE c.market_id = v_market),
    'carriers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',              k.id,
        'name',            k.name,
        'code',            k.code,
        'accent_color',    k.accent_color,
        'account_label',   CASE WHEN k.multi_account AND k.name_fr IS NOT NULL
                                THEN jsonb_build_object('fr', k.name_fr, 'ar', k.name_ar) END,
        'first_upload_at', k.first_upload_at,
        'last_upload_at',  k.last_upload_at,
        'has_reasons',     k.code = 'darb_assabil',
        'has_attempts',    k.code = 'darb_assabil',
        'period', (
          SELECT jsonb_build_object(
            'sent',           count(*) FILTER (WHERE q.inwin AND q.outcome <> 'cancelled_before_pickup'),
            'delivered',      count(*) FILTER (WHERE q.inwin AND q.outcome = 'delivered'),
            'failed',         count(*) FILTER (WHERE q.inwin AND q.outcome = 'failed'),
            'in_flight',      count(*) FILTER (WHERE q.inwin AND q.outcome = 'in_flight'),
            'prev_delivered', count(*) FILTER (WHERE q.inprev AND q.outcome = 'delivered'),
            'prev_failed',    count(*) FILTER (WHERE q.inprev AND q.outcome = 'failed'),
            'picked',         count(*) FILTER (WHERE q.inwin AND q.picked_at IS NOT NULL),
            'picked_fast',    count(*) FILTER (WHERE q.inwin AND q.picked_at IS NOT NULL
                                AND q.picked_at - q.uploaded_at <
                                    CASE WHEN k.code = 'darb_assabil' THEN INTERVAL '6 hours' ELSE INTERVAL '24 hours' END),
            'first_attempt',  CASE WHEN k.code = 'darb_assabil'
                                   THEN count(*) FILTER (WHERE q.inwin AND q.outcome = 'delivered' AND q.n_postponed = 0) END,
            'median_days',    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY q.deliver_days)
                                FILTER (WHERE q.inwin AND q.deliver_days IS NOT NULL))::NUMERIC, 1),
            'fast3',          count(*) FILTER (WHERE q.inwin AND q.deliver_days < 3)
          )
          FROM (
            SELECT p.*,
                   (p.uploaded_at >= v_from AND p.uploaded_at < v_now)  AS inwin,
                   (p.uploaded_at >= v_prev AND p.uploaded_at < v_from) AS inprev,
                   CASE WHEN p.outcome = 'delivered' AND p.picked_at IS NOT NULL AND p.outcome_at >= p.picked_at
                        THEN extract(epoch FROM p.outcome_at - p.picked_at) / 86400 END AS deliver_days
              FROM p WHERE p.carrier_id = k.id
          ) q
        ),
        'weeks', (
          SELECT jsonb_agg(jsonb_build_object(
                   'week',      to_char(g.wk, 'YYYY-MM-DD'),
                   'delivered', COALESCE(x.d, 0),
                   'failed',    COALESCE(x.f, 0),
                   'in_flight', COALESCE(x.m, 0)) ORDER BY g.wk)
            FROM (SELECT v_week0 + 7 * i AS wk FROM generate_series(0, 12) i) g
            LEFT JOIN (
              SELECT (date_trunc('week', p.uploaded_at AT TIME ZONE v_tz))::DATE AS wk,
                     count(*) FILTER (WHERE p.outcome = 'delivered') AS d,
                     count(*) FILTER (WHERE p.outcome = 'failed')    AS f,
                     count(*) FILTER (WHERE p.outcome = 'in_flight') AS m
                FROM p
               WHERE p.carrier_id = k.id
                 AND p.uploaded_at >= (v_week0::TIMESTAMP AT TIME ZONE v_tz)
                 AND p.uploaded_at < v_now
               GROUP BY 1
            ) x ON x.wk = g.wk
        ),
        'open', (
          SELECT jsonb_build_object(
            'total',      count(*),
            'not_picked', count(*) FILTER (WHERE p.picked_at IS NULL),
            'b0_2',       count(*) FILTER (WHERE p.picked_at IS NOT NULL AND v_now - p.picked_at <  INTERVAL '3 days'),
            'b3_4',       count(*) FILTER (WHERE p.picked_at IS NOT NULL AND v_now - p.picked_at >= INTERVAL '3 days'
                                                                       AND v_now - p.picked_at <  INTERVAL '5 days'),
            'b5_9',       count(*) FILTER (WHERE p.picked_at IS NOT NULL AND v_now - p.picked_at >= INTERVAL '5 days'
                                                                       AND v_now - p.picked_at <  INTERVAL '10 days'),
            'b10p',       count(*) FILTER (WHERE p.picked_at IS NOT NULL AND v_now - p.picked_at >= INTERVAL '10 days'),
            'late',       count(*) FILTER (WHERE (p.picked_at IS NULL AND v_now - p.uploaded_at >= INTERVAL '2 days')
                                              OR (p.picked_at IS NOT NULL AND v_now - p.picked_at >= make_interval(days => v_late))),
            'stuck',      count(*) FILTER (WHERE v_now - p.last_move_at >= make_interval(days => v_stuck))
          )
          FROM p WHERE p.carrier_id = k.id AND p.open_at_carrier
        ),
        'returns', (
          SELECT jsonb_build_object(
            'failed',      count(*),
            'handed_back', count(*) FILTER (WHERE p.handed_back_at IS NOT NULL),
            'scanned',     count(*) FILTER (WHERE p.scanned_back),
            'out',         count(*) FILTER (WHERE p.handed_back_at IS NULL AND NOT p.scanned_back),
            'out_late',    count(*) FILTER (WHERE p.handed_back_at IS NULL AND NOT p.scanned_back
                                              AND v_now - p.outcome_at >= INTERVAL '7 days'),
            'age_lt7',     count(*) FILTER (WHERE p.handed_back_at IS NOT NULL AND NOT p.scanned_back
                                              AND v_now - p.handed_back_at <  INTERVAL '7 days'),
            'age_7_30',    count(*) FILTER (WHERE p.handed_back_at IS NOT NULL AND NOT p.scanned_back
                                              AND v_now - p.handed_back_at >= INTERVAL '7 days'
                                              AND v_now - p.handed_back_at <  INTERVAL '30 days'),
            'age_30p',     count(*) FILTER (WHERE p.handed_back_at IS NOT NULL AND NOT p.scanned_back
                                              AND v_now - p.handed_back_at >= INTERVAL '30 days'),
            'within7',     count(*) FILTER (WHERE p.handed_back_at IS NOT NULL
                                              AND p.handed_back_at - p.outcome_at <= INTERVAL '7 days'),
            'median_days', round((percentile_cont(0.5) WITHIN GROUP
                                   (ORDER BY extract(epoch FROM p.handed_back_at - p.outcome_at) / 86400)
                                   FILTER (WHERE p.handed_back_at IS NOT NULL AND p.handed_back_at >= p.outcome_at))::NUMERIC, 1)
          )
          FROM p
         WHERE p.carrier_id = k.id AND p.outcome = 'failed' AND p.picked_at IS NOT NULL
           AND p.outcome_at >= v_90 AND p.outcome_at < v_now
        ),
        'reasons', CASE WHEN k.code = 'darb_assabil' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('class', r.rc, 'n', r.n) ORDER BY r.n DESC, r.rc)
            FROM (SELECT COALESCE(p.remark_class, 'none') AS rc, count(*) AS n
                    FROM p
                   WHERE p.carrier_id = k.id AND p.outcome = 'failed'
                     AND p.uploaded_at >= v_90 AND p.uploaded_at < v_now
                   GROUP BY 1) r), '[]'::JSONB) ELSE '[]'::JSONB END,
        'cities', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('city', y.city, 'delivered', y.d, 'failed', y.f, 'median_days', y.md)
                           ORDER BY y.d + y.f DESC, y.city)
            FROM (
              SELECT initcap(lower(p.city)) AS city,
                     count(*) FILTER (WHERE p.outcome = 'delivered') AS d,
                     count(*) FILTER (WHERE p.outcome = 'failed')    AS f,
                     round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM p.outcome_at - p.picked_at) / 86400)
                            FILTER (WHERE p.outcome = 'delivered' AND p.picked_at IS NOT NULL AND p.outcome_at >= p.picked_at))::NUMERIC, 1) AS md
                FROM p
               WHERE p.carrier_id = k.id AND p.city IS NOT NULL AND p.outcome IN ('delivered', 'failed')
                 AND p.uploaded_at >= v_90 AND p.uploaded_at < v_now
               GROUP BY 1
               ORDER BY count(*) DESC
               LIMIT 40
            ) y), '[]'::JSONB)
      ) ORDER BY k.created_at, k.name)
      FROM cards k), '[]'::JSONB),
    'dormant', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'code', c.code, 'accent_color', c.accent_color,
               'last_upload_at', x.last_up, 'open', x.n) ORDER BY x.n DESC, c.name)
        FROM carriers c
        JOIN (SELECT p.carrier_id, count(*) FILTER (WHERE p.open_at_carrier) AS n, max(p.uploaded_at) AS last_up
                FROM p GROUP BY 1) x ON x.carrier_id = c.id
       WHERE c.market_id = v_market AND NOT c.is_active AND x.n > 0), '[]'::JSONB)
  )
  INTO v_out;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.get_carrier_scorecard(UUID, INT, TIMESTAMPTZ) IS
  'Transporteurs page: per-carrier period, weeks, open, returns, reasons, cities + dormant carriers. Guarded by market.';

-- ── 3. the parcels behind a number ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_carrier_scorecard_parcels(
  p_market_id  UUID,
  p_carrier_id UUID,
  p_kind       TEXT,
  p_now        TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  order_id        UUID,
  tracking_number TEXT,
  city            TEXT,
  since           TIMESTAMPTZ,
  days            NUMERIC,
  picked          BOOLEAN,
  stuck           BOOLEAN,
  darb_status     TEXT,
  order_status    TEXT,
  remark          TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_role   TEXT := get_user_role();
  v_market UUID;
  v_now    TIMESTAMPTZ := COALESCE(p_now, now());
  v_late   INT;
  v_stuck  INT;
BEGIN
  IF v_role = 'super_admin' THEN
    v_market := p_market_id;
  ELSIF v_role = 'market_manager' THEN
    v_market := get_user_market_id();
    IF p_market_id IS DISTINCT FROM v_market THEN RETURN; END IF;
  ELSE
    RETURN;
  END IF;
  IF v_market IS NULL
     OR NOT EXISTS (SELECT 1 FROM carriers c WHERE c.id = p_carrier_id AND c.market_id = v_market) THEN
    RETURN;
  END IF;

  v_late  := delivery_setting_int(v_market, 'carrier_late_days', 3);
  v_stuck := delivery_setting_int(v_market, 'carrier_stall_days', 5);

  RETURN QUERY
  SELECT p.order_id,
         p.tracking_number,
         p.city,
         x.since,
         round((extract(epoch FROM v_now - x.since) / 86400)::NUMERIC, 1),
         p.picked_at IS NOT NULL,
         v_now - p.last_move_at >= make_interval(days => v_stuck),
         p.darb_status,
         p.order_status::TEXT,
         ds.latest_remark
    FROM carrier_parcel_outcome p
    CROSS JOIN LATERAL (
      SELECT CASE p_kind
               WHEN 'returns' THEN p.handed_back_at
               WHEN 'dormant' THEN p.uploaded_at
               ELSE COALESCE(p.picked_at, p.uploaded_at)
             END AS since
    ) x
    LEFT JOIN LATERAL (
      SELECT s.latest_remark FROM darb_shipments s
       WHERE s.order_id = p.order_id
       ORDER BY s.carrier_updated_at DESC NULLS LAST LIMIT 1
    ) ds ON TRUE
   WHERE p.market_id = v_market
     AND p.carrier_id = p_carrier_id
     AND CASE p_kind
           WHEN 'late' THEN p.open_at_carrier
                AND ((p.picked_at IS NULL AND v_now - p.uploaded_at >= INTERVAL '2 days')
                  OR (p.picked_at IS NOT NULL AND v_now - p.picked_at >= make_interval(days => v_late)))
           WHEN 'returns' THEN p.outcome = 'failed' AND p.picked_at IS NOT NULL
                AND p.outcome_at >= v_now - INTERVAL '90 days' AND p.outcome_at < v_now
                AND p.handed_back_at IS NOT NULL AND NOT p.scanned_back
           WHEN 'dormant' THEN p.open_at_carrier
           ELSE FALSE
         END
   ORDER BY x.since ASC NULLS LAST
   LIMIT 500;
END;
$$;

COMMENT ON FUNCTION public.get_carrier_scorecard_parcels(UUID, UUID, TEXT, TIMESTAMPTZ) IS
  'Transporteurs drawers: late | returns | dormant parcels of one carrier, oldest first. Guarded by market.';

REVOKE EXECUTE ON FUNCTION public.get_carrier_scorecard(UUID, INT, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_carrier_scorecard_parcels(UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_carrier_scorecard(UUID, INT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_carrier_scorecard_parcels(UUID, UUID, TEXT, TIMESTAMPTZ) TO authenticated;
