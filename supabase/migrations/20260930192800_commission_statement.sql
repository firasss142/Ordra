-- Mes commissions v2 — the agent's statement, order by order (plans/agent-commissions-v2.md).
--
-- 1. commission_order_stage(status) — one definition of "where is this parcel". The old
--    in-flight lists knew only the Tunisian statuses (uploaded, scanned, dispatched,
--    deposit, in_transit), so Libya's at_carrier / out_for_delivery / delivery_delayed were
--    invisible: tasnim saw « 2 en cours » with 28 parcels on the road (2026-09-30).
-- 2. get_team_commissions / get_my_commissions — their in-flight count uses it.
-- 3. get_my_commission_statement(p_days) — everything « Mes commissions » v2 shows:
--    owed = earned − paid, the unpaid orders (Σ = owed), the paid orders grouped by the
--    payout that settled them (FIFO), what is on the road by stage, what earned nothing and
--    why, the funnel and the delivery rate. Additive: the deployed build keeps calling
--    get_my_commissions until the new one ships.

-- ── 1 ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION commission_order_stage(p_status order_status)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE p_status::TEXT
    WHEN 'pending'            THEN 'queue'
    WHEN 'new'                THEN 'queue'
    WHEN 'assigned'           THEN 'queue'
    WHEN 'attempt_1'          THEN 'queue'
    WHEN 'attempt_2'          THEN 'queue'
    WHEN 'attempt_3'          THEN 'queue'
    WHEN 'callback_scheduled' THEN 'queue'
    WHEN 'confirmed'          THEN 'awaiting_upload'
    WHEN 'dispatch_scheduled' THEN 'awaiting_upload'
    WHEN 'uploaded'           THEN 'awaiting_scan'
    WHEN 'dispatching'        THEN 'awaiting_scan'
    WHEN 'scanned'            THEN 'with_carrier'
    WHEN 'at_carrier'         THEN 'with_carrier'
    WHEN 'dispatched'         THEN 'with_carrier'
    WHEN 'deposit'            THEN 'with_carrier'
    WHEN 'in_transit'         THEN 'with_carrier'
    WHEN 'unverified'         THEN 'with_carrier'
    WHEN 'out_for_delivery'   THEN 'out'
    WHEN 'delivery_delayed'   THEN 'delayed'
    WHEN 'returning'          THEN 'returning'
    WHEN 'to_be_returned'     THEN 'returning'
    WHEN 'delivered'          THEN 'delivered'
    WHEN 'returned'           THEN 'returned'
    WHEN 'received'           THEN 'returned'   -- Darb: back in our warehouse, after returned
    WHEN 'rejected'           THEN 'rejected'
    WHEN 'cancelled'          THEN 'cancelled'
    WHEN 'deleted'            THEN 'deleted'
    ELSE 'unknown'
  END
$$;

REVOKE ALL ON FUNCTION commission_order_stage(order_status) FROM PUBLIC, anon, authenticated;

-- ── 2 ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_team_commissions(p_market_id uuid, p_from date, p_to date, p_tz text DEFAULT 'Africa/Tunis'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role   TEXT := get_user_role();
  v_market UUID;
  v_start  TIMESTAMPTZ;
  v_end    TIMESTAMPTZ;
  v_today  DATE;
  v_result JSONB;
BEGIN
  IF v_role = 'super_admin' THEN
    v_market := p_market_id;
  ELSIF v_role = 'market_manager' THEN
    v_market := get_user_market_id();
    IF p_market_id IS NOT NULL AND p_market_id IS DISTINCT FROM v_market THEN RETURN '{}'::jsonb; END IF;
  ELSE
    RETURN '{}'::jsonb;
  END IF;
  IF v_market IS NULL THEN RETURN '{}'::jsonb; END IF;

  v_start := p_from::timestamp AT TIME ZONE p_tz;
  v_end   := (p_to + 1)::timestamp AT TIME ZONE p_tz;
  v_today := (now() AT TIME ZONE p_tz)::date;

  WITH agents AS (
    SELECT u.id, u.full_name, u.avatar_url, u.is_active
    FROM users u
    WHERE u.role = 'agent' AND u.market_id = v_market AND u.deleted_at IS NULL
  ),
  fold AS (
    SELECT l.agent_id,
      SUM(l.amount) AS balance,
      COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type IN ('accrual','reversal','adjustment')), 0) AS earned_total,
      COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_type = 'payout'), 0) AS paid_total,
      count(*) FILTER (WHERE l.entry_type = 'accrual' AND l.effective_at >= v_start AND l.effective_at < v_end
                         AND NOT EXISTS (SELECT 1 FROM agent_commission_ledger r
                                         WHERE r.order_id = l.order_id AND r.entry_type = 'reversal')) AS delivered,
      COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type IN ('accrual','reversal','adjustment') AND l.effective_at >= v_start AND l.effective_at < v_end), 0) AS earned,
      COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_type = 'payout' AND l.effective_at >= v_start AND l.effective_at < v_end), 0) AS paid
    FROM agent_commission_ledger l
    WHERE l.market_id = v_market
    GROUP BY l.agent_id
  ),
  last_pay AS (
    SELECT DISTINCT ON (l.agent_id) l.agent_id, l.effective_at, -l.amount AS amount, l.method
    FROM agent_commission_ledger l
    WHERE l.market_id = v_market AND l.entry_type = 'payout'
    ORDER BY l.agent_id, l.effective_at DESC, l.created_at DESC
  ),
  -- in-flight: parcels past upload and not yet delivered or returning, whose LAST confirm is this agent
  inflight AS (
    SELECT lc.agent_id, count(*) AS n
    FROM orders o
    CROSS JOIN LATERAL (
      SELECT x.actor_id AS agent_id
      FROM order_history x JOIN users u ON u.id = x.actor_id AND u.role = 'agent'
      WHERE x.order_id = o.id AND x.status_to = 'confirmed'
      ORDER BY x.created_at DESC LIMIT 1
    ) lc
    WHERE o.market_id = v_market
      AND commission_order_stage(o.status) IN ('awaiting_scan','with_carrier','out','delayed')
      AND commission_counts_upload(o.id, lc.agent_id, now())
    GROUP BY lc.agent_id
  ),
  per_agent AS (
    SELECT a.id, a.full_name, a.avatar_url, a.is_active,
      COALESCE(f.balance, 0)   AS balance,
      COALESCE(f.earned_total, 0) AS earned_total,
      COALESCE(f.paid_total, 0)   AS paid_total,
      COALESCE(f.delivered, 0) AS delivered,
      COALESCE(f.earned, 0)    AS earned,
      COALESCE(f.paid, 0)      AS paid,
      COALESCE(i.n, 0)         AS pending_count,
      r.enabled, r.amount, r.is_override, r.effective_from,
      lp.effective_at AS lp_at, lp.amount AS lp_amount, lp.method AS lp_method
    FROM agents a
    LEFT JOIN fold f ON f.agent_id = a.id
    LEFT JOIN inflight i ON i.agent_id = a.id
    LEFT JOIN last_pay lp ON lp.agent_id = a.id
    LEFT JOIN LATERAL resolve_commission_rate(v_market, a.id, v_today) r ON true
  ),
  mkt AS (
    SELECT * FROM resolve_commission_rate(v_market, NULL, v_today)
  )
  SELECT jsonb_build_object(
    'market_id', v_market,
    'currency', (SELECT currency FROM markets WHERE id = v_market),
    'from', p_from, 'to', p_to, 'tz', p_tz,
    'market', (SELECT jsonb_build_object('enabled', m.enabled, 'amount', m.amount, 'effective_from', m.effective_from) FROM mkt m),
    'agents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'agent_id', p.id, 'name', p.full_name, 'avatar_url', p.avatar_url, 'is_active', p.is_active,
        'rate', jsonb_build_object(
          'amount', COALESCE(p.amount, 0),
          'enabled', COALESCE(p.enabled, false),
          'is_override', COALESCE(p.is_override, false),
          'effective_from', p.effective_from),
        'delivered', p.delivered, 'earned', p.earned, 'paid', p.paid,
        'pending_count', p.pending_count,
        'pending_est', CASE WHEN COALESCE(p.enabled, false) THEN p.pending_count * COALESCE(p.amount, 0) ELSE 0 END,
        'balance', p.balance, 'earned_total', p.earned_total, 'paid_total', p.paid_total,
        'last_payout', CASE WHEN p.lp_at IS NULL THEN NULL
                            ELSE jsonb_build_object('at', p.lp_at, 'amount', p.lp_amount, 'method', p.lp_method) END
      ) ORDER BY p.earned DESC, p.full_name)
      FROM per_agent p
      -- inactive agents disappear once settled
      WHERE p.is_active OR p.balance <> 0), '[]'::jsonb),
    'team', (SELECT jsonb_build_object(
        'delivered', COALESCE(SUM(delivered), 0), 'earned', COALESCE(SUM(earned), 0),
        'paid', COALESCE(SUM(paid), 0), 'balance', COALESCE(SUM(balance), 0))
      FROM per_agent WHERE is_active OR balance <> 0)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_commissions(p_days integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me      UUID := auth.uid();
  v_market  UUID;
  v_tz      TEXT;
  v_today   DATE;
  v_since   TIMESTAMPTZ;
  v_month   TIMESTAMPTZ;
  v_last_at TIMESTAMPTZ;
  v_result  JSONB;
BEGIN
  SELECT u.market_id INTO v_market FROM users u WHERE u.id = v_me AND u.role = 'agent' AND u.deleted_at IS NULL;
  IF v_market IS NULL THEN RETURN '{}'::jsonb; END IF;
  v_tz    := market_tz(v_market);
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_since := ((v_today - LEAST(GREATEST(COALESCE(p_days, 60), 7), 366))::timestamp AT TIME ZONE v_tz);
  v_month := (date_trunc('month', v_today)::timestamp AT TIME ZONE v_tz);

  SELECT max(effective_at) INTO v_last_at FROM agent_commission_ledger WHERE agent_id = v_me AND entry_type = 'payout';

  WITH me AS (
    -- reversed: this accrual was later cancelled, so it is not a delivery that counts
    SELECT l.*, EXISTS (SELECT 1 FROM agent_commission_ledger r
                        WHERE r.order_id = l.order_id AND r.entry_type = 'reversal') AS reversed
    FROM agent_commission_ledger l WHERE l.agent_id = v_me
  ),
  rate AS (SELECT * FROM resolve_commission_rate(v_market, v_me, v_today)),
  inflight AS (
    SELECT count(*) AS n
    FROM orders o
    WHERE o.market_id = v_market
      AND commission_order_stage(o.status) IN ('awaiting_scan','with_carrier','out','delayed')
      AND (SELECT x.actor_id FROM order_history x WHERE x.order_id = o.id AND x.status_to = 'confirmed'
             AND EXISTS (SELECT 1 FROM users u WHERE u.id = x.actor_id AND u.role = 'agent')
           ORDER BY x.created_at DESC LIMIT 1) = v_me
      AND commission_counts_upload(o.id, v_me, now())
  ),
  days AS (
    SELECT (l.effective_at AT TIME ZONE v_tz)::date AS day,
      count(*) FILTER (WHERE l.entry_type = 'accrual' AND NOT l.reversed) AS delivered,
      count(*) FILTER (WHERE l.entry_type = 'reversal') AS corrections,
      SUM(l.amount) AS amount,
      jsonb_agg(jsonb_build_object(
        'external_id', o.external_id,
        'product_name', COALESCE(p.name, o.product_name),
        'city', o.customer_city,
        'amount', l.amount,
        'entry_type', l.entry_type,
        'reason', l.reversal_reason
      ) ORDER BY l.effective_at DESC) AS orders
    FROM me l
    LEFT JOIN orders o ON o.id = l.order_id
    LEFT JOIN products p ON p.id = o.product_id
    WHERE l.entry_type IN ('accrual','reversal') AND l.effective_at >= v_since
    GROUP BY 1
  ),
  items AS (
    SELECT (d.day::timestamp AT TIME ZONE v_tz) AS at,
           jsonb_build_object('type','day','day',d.day,'delivered',d.delivered,'corrections',d.corrections,'amount',d.amount,'orders',d.orders) AS item
    FROM days d
    UNION ALL
    SELECT l.effective_at,
           jsonb_build_object('type','payout','at',l.effective_at,'amount',l.amount,'method',l.method,'reference',l.reference)
    FROM me l WHERE l.entry_type = 'payout' AND l.effective_at >= v_since
    UNION ALL
    SELECT l.effective_at,
           jsonb_build_object('type','adjustment','at',l.effective_at,'amount',l.amount,'note',l.note)
    FROM me l WHERE l.entry_type = 'adjustment' AND l.effective_at >= v_since
  )
  SELECT jsonb_build_object(
    'enabled', COALESCE((SELECT enabled FROM rate), false),
    'currency', (SELECT currency FROM markets WHERE id = v_market),
    'rate', (SELECT amount FROM rate),
    'balance', COALESCE((SELECT SUM(amount) FROM me), 0),
    'since_last_payout', jsonb_build_object(
      'delivered',   (SELECT count(*) FROM me WHERE entry_type = 'accrual' AND NOT reversed AND (v_last_at IS NULL OR effective_at > v_last_at)),
      'corrections', (SELECT count(*) FROM me WHERE entry_type = 'reversal' AND (v_last_at IS NULL OR effective_at > v_last_at))),
    'month', jsonb_build_object(
      'delivered', (SELECT count(*) FROM me WHERE entry_type = 'accrual' AND NOT reversed AND effective_at >= v_month),
      'earned',    COALESCE((SELECT SUM(amount) FROM me WHERE entry_type IN ('accrual','reversal','adjustment') AND effective_at >= v_month), 0)),
    'inflight', jsonb_build_object(
      'count', (SELECT n FROM inflight),
      'est', CASE WHEN COALESCE((SELECT enabled FROM rate), false) THEN (SELECT n FROM inflight) * COALESCE((SELECT amount FROM rate), 0) ELSE 0 END),
    'last_payout', (SELECT jsonb_build_object('at', l.effective_at, 'amount', -l.amount, 'method', l.method)
                    FROM me l WHERE l.entry_type = 'payout' ORDER BY l.effective_at DESC, l.created_at DESC LIMIT 1),
    'history', COALESCE((SELECT jsonb_agg(i.item ORDER BY i.at DESC) FROM items i), '[]'::jsonb),
    'has_more', EXISTS (SELECT 1 FROM me WHERE effective_at < v_since)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- ── 3 ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_my_commission_statement(p_days INTEGER DEFAULT 90)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me       UUID := auth.uid();
  v_market   UUID;
  v_tz       TEXT;
  v_today    DATE;
  v_act      DATE;
  v_since    DATE;
  v_since_ts TIMESTAMPTZ;
  v_rate     RECORD;
  v_prev     NUMERIC;
  v_paid     NUMERIC;
  v_result   JSONB;
BEGIN
  SELECT u.market_id INTO v_market FROM users u WHERE u.id = v_me AND u.role = 'agent' AND u.deleted_at IS NULL;
  IF v_market IS NULL THEN RETURN '{}'::JSONB; END IF;
  v_tz    := market_tz(v_market);
  v_today := (now() AT TIME ZONE v_tz)::DATE;

  -- Activation: the first rule boundary on which this agent's resolved rate pays.
  SELECT min(d.day) INTO v_act
  FROM (
    SELECT r.effective_from AS day FROM agent_commission_rates r
     WHERE r.market_id = v_market AND (r.agent_id IS NULL OR r.agent_id = v_me)
    UNION
    SELECT r.effective_to FROM agent_commission_rates r
     WHERE r.market_id = v_market AND (r.agent_id IS NULL OR r.agent_id = v_me) AND r.effective_to IS NOT NULL
  ) d
  CROSS JOIN LATERAL resolve_commission_rate(v_market, v_me, d.day) x
  WHERE d.day <= v_today AND x.enabled AND x.amount > 0;

  v_since    := GREATEST(COALESCE(v_act, v_today), v_today - LEAST(GREATEST(COALESCE(p_days, 90), 7), 366));
  v_since_ts := v_since::TIMESTAMP AT TIME ZONE v_tz;

  SELECT * INTO v_rate FROM resolve_commission_rate(v_market, v_me, v_today);
  -- The previous rate, said only while the change is recent (a week).
  IF v_rate.enabled AND v_rate.effective_from > v_today - 7 THEN
    SELECT x.amount INTO v_prev FROM resolve_commission_rate(v_market, v_me, v_rate.effective_from - 1) x
     WHERE x.enabled AND x.amount > 0 AND x.amount <> v_rate.amount;
  END IF;

  SELECT COALESCE(-SUM(amount), 0) INTO v_paid FROM agent_commission_ledger WHERE agent_id = v_me AND entry_type = 'payout';

  WITH led AS (
    SELECT * FROM agent_commission_ledger WHERE agent_id = v_me
  ),
  -- Credits: accruals nobody took back, plus adjustments. Σ credits = earned.
  credits AS (
    SELECT l.id, l.order_id, l.entry_type, l.amount, l.effective_at, l.note,
           SUM(l.amount) OVER (ORDER BY l.effective_at, l.created_at, l.id) AS cum
    FROM led l
    WHERE (l.entry_type = 'accrual'
           AND NOT EXISTS (SELECT 1 FROM led r WHERE r.order_id = l.order_id AND r.entry_type = 'reversal'))
       OR l.entry_type = 'adjustment'
  ),
  pays AS (
    SELECT l.id, l.effective_at, -l.amount AS amount, l.method, l.reference,
           SUM(-l.amount) OVER (ORDER BY l.effective_at, l.created_at, l.id) AS pcum,
           ROW_NUMBER() OVER (ORDER BY l.effective_at, l.created_at, l.id) AS k
    FROM led l WHERE l.entry_type = 'payout'
  ),
  -- FIFO: a credit is settled by the first payout whose running total reaches it.
  placed AS (
    SELECT c.*, p.k AS pay_k,
           (SELECT p2.pcum FROM pays p2 WHERE p2.k = p.k - 1) AS prev_cum
    FROM credits c
    LEFT JOIN LATERAL (SELECT p.k FROM pays p WHERE p.pcum >= c.cum ORDER BY p.k LIMIT 1) p ON TRUE
  ),
  crow AS (
    SELECT pl.*,
           (pl.pay_k IS NOT NULL AND pl.prev_cum IS NOT NULL AND pl.cum - pl.amount < pl.prev_cum) AS split,
           (pl.pay_k IS NULL AND v_paid > 0 AND pl.cum - pl.amount < v_paid) AS partial,
           jsonb_build_object(
             'order_id', o.id, 'external_id', o.external_id, 'customer_name', o.customer_name,
             'product_name', COALESCE(p.name, o.product_name), 'image_url', p.image_url, 'city', o.customer_city,
             'kind', pl.entry_type, 'note', pl.note, 'at', pl.effective_at, 'full_amount', pl.amount
           ) AS base
    FROM placed pl
    LEFT JOIN orders o ON o.id = pl.order_id
    LEFT JOIN products p ON p.id = o.product_id
  ),
  -- Orders whose LAST agent confirmation is mine — the sweep's attribution.
  mine AS (
    SELECT o.id, o.status, commission_order_stage(o.status) AS stage, lc.conf_at,
           o.external_id, o.customer_name, COALESCE(p.name, o.product_name) AS product_name,
           p.image_url, o.customer_city
    FROM (SELECT DISTINCT h.order_id FROM order_history h WHERE h.actor_id = v_me AND h.status_to = 'confirmed') m
    JOIN orders o ON o.id = m.order_id
    LEFT JOIN products p ON p.id = o.product_id
    CROSS JOIN LATERAL (
      SELECT x.actor_id, x.created_at AS conf_at
      FROM order_history x JOIN users u ON u.id = x.actor_id AND u.role = 'agent'
      WHERE x.order_id = o.id AND x.status_to = 'confirmed'
      ORDER BY x.created_at DESC LIMIT 1
    ) lc
    WHERE lc.actor_id = v_me
  ),
  way AS (
    SELECT m.*,
           (SELECT max(h.created_at) FROM order_history h WHERE h.order_id = m.id AND h.status_to = 'uploaded') AS uploaded_at,
           (SELECT max(h.created_at) FROM order_history h WHERE h.order_id = m.id AND h.status_to = m.status) AS stage_at
    FROM mine m
    WHERE m.stage IN ('awaiting_scan', 'with_carrier', 'out', 'delayed', 'returning')
      AND commission_counts_upload(m.id, v_me, now())
  ),
  funnel AS (
    SELECT count(*) FILTER (WHERE stage <> 'deleted') AS confirmed,
           count(*) FILTER (WHERE stage = 'delivered') AS delivered,
           count(*) FILTER (WHERE stage IN ('awaiting_scan', 'with_carrier', 'out', 'delayed', 'returning')) AS way,
           count(*) FILTER (WHERE stage IN ('cancelled', 'rejected', 'returned')) AS lost,
           count(*) FILTER (WHERE stage = 'awaiting_upload') AS awaiting_upload,
           count(*) FILTER (WHERE stage = 'queue') AS back_in_queue
    FROM mine WHERE conf_at >= v_since_ts
  ),
  -- Finished without delivery, confirmed in the window.
  lost_status AS (
    SELECT m.id, m.external_id, m.customer_name, m.product_name, m.image_url, m.customer_city,
           CASE m.stage
             WHEN 'cancelled' THEN CASE WHEN last.actor_type = 'system' THEN 'carrier_cancelled' ELSE 'cancelled' END
             ELSE m.stage END AS reason,
           last.created_at AS at,
           (SELECT max(h.created_at) FROM order_history h WHERE h.order_id = m.id AND h.status_to = 'uploaded') AS uploaded_at,
           NULL::NUMERIC AS was_amount
    FROM mine m
    LEFT JOIN LATERAL (
      SELECT h.actor_type, h.created_at FROM order_history h
      WHERE h.order_id = m.id AND h.status_to = m.status ORDER BY h.created_at DESC LIMIT 1
    ) last ON TRUE
    WHERE m.conf_at >= v_since_ts AND m.stage IN ('cancelled', 'rejected', 'returned')
  ),
  -- Delivered in the window, but the rule says no: taken back, or never eligible. A delivery
  -- that is eligible and merely waiting for the 15-minute sweep is NOT listed.
  dlv AS (
    SELECT m.*, (SELECT min(h.created_at) FROM order_history h WHERE h.order_id = m.id AND h.status_to = 'delivered') AS delivered_at
    FROM mine m WHERE m.stage = 'delivered'
  ),
  lost_dlv AS (
    SELECT d.id, d.external_id, d.customer_name, d.product_name, d.image_url, d.customer_city,
           CASE
             WHEN rv.reversal_reason = 'not_delivered' THEN 'corrected'
             WHEN rv.id IS NOT NULL THEN 'before_activation'
             WHEN (SELECT max(h.created_at) FROM order_history h WHERE h.order_id = d.id AND h.status_to = 'uploaded' AND h.created_at <= d.delivered_at)
                  < (COALESCE(v_act, v_today)::TIMESTAMP AT TIME ZONE v_tz) THEN 'before_activation'
             ELSE 'commission_off' END AS reason,
           d.delivered_at AS at,
           (SELECT max(h.created_at) FROM order_history h WHERE h.order_id = d.id AND h.status_to = 'uploaded' AND h.created_at <= d.delivered_at) AS uploaded_at,
           ac.amount AS was_amount
    FROM dlv d
    LEFT JOIN led ac ON ac.order_id = d.id AND ac.entry_type = 'accrual'
    LEFT JOIN led rv ON rv.order_id = d.id AND rv.entry_type = 'reversal'
    WHERE d.delivered_at >= v_since_ts
      AND (rv.id IS NOT NULL
           OR (ac.id IS NULL AND NOT (
                 commission_counts_upload(d.id, v_me, d.delivered_at)
                 AND COALESCE((SELECT x.enabled AND x.amount > 0 FROM resolve_commission_rate(v_market, v_me, (d.delivered_at AT TIME ZONE v_tz)::DATE) x), FALSE))))
  ),
  lost AS (SELECT * FROM lost_status UNION ALL SELECT * FROM lost_dlv),
  est AS (
    SELECT CASE WHEN COALESCE(v_rate.enabled, FALSE)
                THEN (SELECT count(*) FROM way WHERE stage <> 'returning') * COALESCE(v_rate.amount, 0) ELSE 0 END AS est
  ),
  rate AS (
    SELECT CASE WHEN f.delivered + f.lost > 0 THEN round(f.delivered::NUMERIC / (f.delivered + f.lost), 3) END AS r FROM funnel f
  )
  SELECT jsonb_build_object(
    'enabled', COALESCE(v_rate.enabled, FALSE),
    'currency', (SELECT currency FROM markets WHERE id = v_market),
    'rate', jsonb_build_object(
      'amount', v_rate.amount,
      'effective_from', v_rate.effective_from,
      'previous_amount', v_prev,
      'off_since', CASE WHEN v_rate.enabled IS FALSE THEN v_rate.effective_from END),
    'activated_on', v_act,
    'since', v_since,
    'earned', COALESCE((SELECT SUM(amount) FROM credits), 0),
    'paid', v_paid,
    'owed', COALESCE((SELECT SUM(amount) FROM led), 0),
    'last_payout', (SELECT jsonb_build_object('at', p.effective_at, 'amount', p.amount, 'method', p.method)
                    FROM pays p ORDER BY p.k DESC LIMIT 1),
    'unpaid', jsonb_build_object(
      'count',  (SELECT count(*) FROM crow WHERE pay_k IS NULL AND entry_type = 'accrual'),
      'amount', COALESCE((SELECT SUM(CASE WHEN partial THEN cum - v_paid ELSE amount END) FROM crow WHERE pay_k IS NULL), 0),
      'rows',   COALESCE((SELECT jsonb_agg(base || jsonb_build_object(
                    'amount', CASE WHEN partial THEN cum - v_paid ELSE amount END,
                    'partial', partial) ORDER BY effective_at DESC)
                  FROM crow WHERE pay_k IS NULL), '[]'::JSONB)),
    'paid_orders', jsonb_build_object(
      'count',  (SELECT count(*) FROM crow WHERE pay_k IS NOT NULL AND entry_type = 'accrual'),
      'amount', COALESCE((SELECT SUM(amount) FROM crow WHERE pay_k IS NOT NULL), 0),
      'payouts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'at', p.effective_at, 'amount', p.amount, 'method', p.method, 'reference', p.reference,
                 'count', (SELECT count(*) FROM crow c WHERE c.pay_k = p.k AND c.entry_type = 'accrual'),
                 'from', (SELECT min(c.effective_at) FROM crow c WHERE c.pay_k = p.k),
                 'to',   (SELECT max(c.effective_at) FROM crow c WHERE c.pay_k = p.k),
                 'has_split', EXISTS (SELECT 1 FROM crow c WHERE c.pay_k = p.k AND c.split),
                 'rows_omitted', p.effective_at < v_since_ts,
                 'rows', CASE WHEN p.effective_at < v_since_ts THEN '[]'::JSONB ELSE COALESCE((
                           SELECT jsonb_agg(c.base || jsonb_build_object('amount', c.amount, 'split', c.split) ORDER BY c.effective_at DESC)
                           FROM crow c WHERE c.pay_k = p.k), '[]'::JSONB) END
               ) ORDER BY p.k DESC)
        FROM pays p), '[]'::JSONB)),
    'way', jsonb_build_object(
      'count', (SELECT count(*) FROM way),
      'est', (SELECT est FROM est),
      'est_likely', (SELECT round((SELECT est FROM est) * r) FROM rate WHERE r IS NOT NULL),
      'stages', jsonb_build_object(
        'awaiting_scan', (SELECT count(*) FROM way WHERE stage = 'awaiting_scan'),
        'with_carrier',  (SELECT count(*) FROM way WHERE stage = 'with_carrier'),
        'out',           (SELECT count(*) FROM way WHERE stage = 'out'),
        'delayed',       (SELECT count(*) FROM way WHERE stage = 'delayed'),
        'returning',     (SELECT count(*) FROM way WHERE stage = 'returning')),
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'order_id', w.id, 'external_id', w.external_id, 'customer_name', w.customer_name,
                  'product_name', w.product_name, 'image_url', w.image_url, 'city', w.customer_city,
                  'stage', w.stage, 'uploaded_at', w.uploaded_at, 'stage_at', w.stage_at)
                ORDER BY CASE w.stage WHEN 'delayed' THEN 0 WHEN 'out' THEN 1 WHEN 'with_carrier' THEN 2 WHEN 'awaiting_scan' THEN 3 ELSE 4 END,
                         w.uploaded_at)
                FROM way w), '[]'::JSONB)),
    'lost', jsonb_build_object(
      'count',             (SELECT count(*) FROM lost),
      'carrier_cancelled', (SELECT count(*) FROM lost WHERE reason = 'carrier_cancelled'),
      'cancelled',         (SELECT count(*) FROM lost WHERE reason = 'cancelled'),
      'rejected',          (SELECT count(*) FROM lost WHERE reason = 'rejected'),
      'returned',          (SELECT count(*) FROM lost WHERE reason = 'returned'),
      'before_activation', (SELECT count(*) FROM lost WHERE reason = 'before_activation'),
      'commission_off',    (SELECT count(*) FROM lost WHERE reason = 'commission_off'),
      'corrected',         (SELECT count(*) FROM lost WHERE reason = 'corrected'),
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'order_id', l.id, 'external_id', l.external_id, 'customer_name', l.customer_name,
                  'product_name', l.product_name, 'image_url', l.image_url, 'city', l.customer_city,
                  'reason', l.reason, 'at', l.at, 'uploaded_at', l.uploaded_at, 'was_amount', l.was_amount)
                ORDER BY l.at DESC)
                FROM lost l), '[]'::JSONB)),
    'funnel', (SELECT to_jsonb(f) FROM funnel f),
    'delivery_rate', (SELECT r FROM rate)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION get_my_commission_statement(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_my_commission_statement(INTEGER) TO authenticated;
