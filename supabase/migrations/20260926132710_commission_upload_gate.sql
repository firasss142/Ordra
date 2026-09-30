-- Commissions : une commande ne compte que si elle a été TÉLÉVERSÉE après
-- l'activation de la commission de l'agent.
--
-- Avant : le balayage ne regardait que le jour de LIVRAISON. Une commande
-- téléversée pendant que la commission de l'agent était coupée, puis livrée
-- après l'activation, était payée. En prod au 2026-09-26 : 24 acquisitions
-- (tasnim 16, salima 5, roqaya 2, hend 1 — 215 LYD).
--
-- Règle : le jour (heure du marché) du DERNIER téléversement avant la
-- livraison doit avoir un taux actif (enabled, amount > 0) pour cet agent.
-- Sans téléversement dans l'historique, c'est le jour de sa confirmation.
-- Le MONTANT reste celui du jour de livraison, comme avant.
--
-- 1. agent_commission_ledger.reversal_reason — pourquoi une écriture inverse.
-- 2. commission_counts_upload() — la règle, une seule définition.
-- 3. accrue_agent_commissions — la garde à l'acquisition.
-- 4. reverse_commissions_uploaded_before_activation() — la correction
--    ponctuelle, appelée une fois en bas de ce fichier. PAS dans le balayage :
--    couper un agent avec une date passée ne doit jamais reprendre de l'argent
--    déjà acquis (« couper puis rallumer ne touche jamais l'historique »).
-- 5. get_team_commissions / get_my_commissions — « livrées » ne compte plus
--    une acquisition annulée ; « en cours » suit la même règle ; le jour de
--    l'agent porte le motif de la correction.

-- ── 1 ───────────────────────────────────────────────────────────────────────
ALTER TABLE agent_commission_ledger
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT
  CONSTRAINT agent_commission_ledger_reversal_reason_check CHECK (
    reversal_reason IS NULL
    OR (entry_type = 'reversal' AND reversal_reason IN ('not_delivered', 'uploaded_before_activation'))
  );

COMMENT ON COLUMN agent_commission_ledger.reversal_reason IS
  'reversal only: not_delivered (the order left delivered) | uploaded_before_activation (uploaded on a day the agent''s commission was off)';

-- ── 2 ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION commission_counts_upload(p_order_id UUID, p_agent_id UUID, p_before TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH o AS (SELECT market_id FROM orders WHERE id = p_order_id),
  at AS (
    SELECT COALESCE(
      (SELECT max(h.created_at) FROM order_history h
        WHERE h.order_id = p_order_id AND h.status_to = 'uploaded' AND h.created_at <= p_before),
      (SELECT max(h.created_at) FROM order_history h
        WHERE h.order_id = p_order_id AND h.status_to = 'confirmed' AND h.actor_id = p_agent_id
          AND h.created_at <= p_before)
    ) AS ts
  )
  SELECT COALESCE((
    SELECT r.enabled AND r.amount > 0
    FROM o, at, resolve_commission_rate(o.market_id, p_agent_id, (at.ts AT TIME ZONE market_tz(o.market_id))::date) r
    WHERE at.ts IS NOT NULL
  ), false);
$$;

REVOKE ALL ON FUNCTION commission_counts_upload(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ── 3 ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accrue_agent_commissions(p_market_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role     TEXT := get_user_role();
  v_accrued  INTEGER := 0;
  v_reversed INTEGER := 0;
BEGIN
  IF v_role IS NOT NULL AND v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'only super_admin (or the scheduler) may run the accrual sweep' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 1. Accruals. Candidates: first DELIVERED event per order, order still
  --    delivered, no accrual yet, market has at least one rate row and the
  --    delivery is not older than the market's first rule (cheap bound).
  WITH bounds AS (
    SELECT market_id, min(effective_from) AS first_day
    FROM agent_commission_rates
    WHERE p_market_id IS NULL OR market_id = p_market_id
    GROUP BY market_id
  ),
  candidates AS (
    SELECT DISTINCT ON (h.order_id) h.order_id, h.market_id, h.created_at AS delivered_at
    FROM order_history h
    JOIN bounds b ON b.market_id = h.market_id
    JOIN orders o ON o.id = h.order_id AND o.status = 'delivered'
    WHERE h.status_to = 'delivered'
      AND h.created_at >= (b.first_day::timestamp AT TIME ZONE market_tz(h.market_id))
      AND NOT EXISTS (SELECT 1 FROM agent_commission_ledger l WHERE l.order_id = h.order_id AND l.entry_type = 'accrual')
    ORDER BY h.order_id, h.created_at ASC
  ),
  attributed AS (
    SELECT c.order_id, c.market_id, c.delivered_at,
      (SELECT x.actor_id
         FROM order_history x
         JOIN users u ON u.id = x.actor_id AND u.role = 'agent'
        WHERE x.order_id = c.order_id AND x.status_to = 'confirmed' AND x.created_at <= c.delivered_at
        ORDER BY x.created_at DESC
        LIMIT 1) AS agent_id
    FROM candidates c
  ),
  ins AS (
    INSERT INTO agent_commission_ledger (market_id, agent_id, order_id, entry_type, amount, rate_amount, effective_at, created_by)
    SELECT a.market_id, a.agent_id, a.order_id, 'accrual', r.amount, r.amount, a.delivered_at, NULL
    FROM attributed a
    CROSS JOIN LATERAL resolve_commission_rate(a.market_id, a.agent_id, (a.delivered_at AT TIME ZONE market_tz(a.market_id))::date) r
    WHERE a.agent_id IS NOT NULL AND r.enabled AND r.amount > 0
      -- uploaded while the agent's commission was on (20260926132710)
      AND commission_counts_upload(a.order_id, a.agent_id, a.delivered_at)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_accrued FROM ins;

  -- 2. Reversals: an accrued order that is no longer delivered, once.
  WITH ins AS (
    INSERT INTO agent_commission_ledger (market_id, agent_id, order_id, entry_type, amount, rate_amount, effective_at, created_by, note, reversal_reason)
    SELECT l.market_id, l.agent_id, l.order_id, 'reversal', -l.amount, l.rate_amount, now(), NULL,
           'status corrigé : ' || o.status::text, 'not_delivered'
    FROM agent_commission_ledger l
    JOIN orders o ON o.id = l.order_id
    WHERE l.entry_type = 'accrual'
      AND (p_market_id IS NULL OR l.market_id = p_market_id)
      AND o.status <> 'delivered'
      AND NOT EXISTS (SELECT 1 FROM agent_commission_ledger x WHERE x.order_id = l.order_id AND x.entry_type = 'reversal')
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_reversed FROM ins;

  RETURN jsonb_build_object('accrued', v_accrued, 'reversed', v_reversed, 'ran_at', now());
END;
$function$;

-- ── 4 ───────────────────────────────────────────────────────────────────────
-- Dated like the accrual it cancels: the delivery never counted, so the day,
-- the period and the month read as if it had never been paid. created_at
-- still records when the correction was written.
CREATE OR REPLACE FUNCTION reverse_commissions_uploaded_before_activation(p_market_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  WITH ins AS (
    INSERT INTO agent_commission_ledger (market_id, agent_id, order_id, entry_type, amount, rate_amount, effective_at, created_by, note, reversal_reason)
    SELECT l.market_id, l.agent_id, l.order_id, 'reversal', -l.amount, l.rate_amount, l.effective_at, NULL,
           'téléversée avant l''activation de la commission', 'uploaded_before_activation'
    FROM agent_commission_ledger l
    WHERE l.entry_type = 'accrual'
      AND (p_market_id IS NULL OR l.market_id = p_market_id)
      AND NOT EXISTS (SELECT 1 FROM agent_commission_ledger x WHERE x.order_id = l.order_id AND x.entry_type = 'reversal')
      AND NOT commission_counts_upload(l.order_id, l.agent_id, l.effective_at)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION reverse_commissions_uploaded_before_activation(UUID) FROM PUBLIC, anon, authenticated;

-- ── 5 ───────────────────────────────────────────────────────────────────────
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
  -- in-flight: orders between uploaded and in_transit whose LAST confirm is this agent
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
      AND o.status IN ('uploaded','scanned','dispatched','deposit','in_transit')
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
      AND o.status IN ('uploaded','scanned','dispatched','deposit','in_transit')
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

-- ── la correction, une fois ────────────────────────────────────────────────
SELECT reverse_commissions_uploaded_before_activation(NULL);
