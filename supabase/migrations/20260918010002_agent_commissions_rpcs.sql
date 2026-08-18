-- ============================================================
-- 20260918010002_agent_commissions_rpcs.sql
-- Agent commissions — every read and write path.
--
-- Same shape as the team RPCs (20260907000002): SECURITY DEFINER, market
-- isolation enforced once in-function from get_user_role() /
-- get_user_market_id(), all aggregation in SQL, JSONB out. Money moves only
-- through record_agent_payout / post_agent_commission_adjustment / the
-- accrual sweep; the tables have no write policies at all.
--
-- Rules (plans/agent-commission-tracking.md, D1–D6):
--   attribution  the agent whose CONFIRMED transition is the last one before
--                the DELIVERED event (an order can be reopened + reconfirmed)
--   accrual      one per order, dated at the delivered event, rate snapshotted
--   rate         agent-specific row for that local day, else market default;
--                market row disabled → nothing; agent row disabled → nothing;
--                no row → nothing (that is what "start today, no backfill"
--                falls out of: no rate before go-live)
--   reversal     written once if an accrued order is no longer 'delivered'
--   nothing else reduces a commission (no return penalties, no advances)
--   payout       manager-entered; refuses to push the balance negative unless
--                the caller explicitly allows it
-- ============================================================

-- ------------------------------------------------------------
-- market_tz — the markets table has no tz column (see stamp_next_retry_slot).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION market_tz(p_market_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE code WHEN 'ly' THEN 'Africa/Tripoli' ELSE 'Africa/Tunis' END
  FROM markets WHERE id = p_market_id;
$$;

-- ------------------------------------------------------------
-- resolve_commission_rate — the rule for one agent on one local day.
-- Returns NULL when nothing applies. `enabled` false when paused.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_commission_rate(
  p_market_id UUID,
  p_agent_id  UUID,
  p_day       DATE
)
RETURNS TABLE (enabled BOOLEAN, amount NUMERIC, is_override BOOLEAN, effective_from DATE)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  m RECORD;
  a RECORD;
BEGIN
  SELECT r.enabled, r.amount, r.effective_from INTO m
  FROM agent_commission_rates r
  WHERE r.market_id = p_market_id AND r.agent_id IS NULL
    AND r.effective_from <= p_day AND (r.effective_to IS NULL OR p_day < r.effective_to)
  ORDER BY r.effective_from DESC, r.created_at DESC
  LIMIT 1;

  IF m IS NULL THEN RETURN; END IF;                 -- no market rule → nothing
  IF NOT m.enabled THEN
    RETURN QUERY SELECT false, m.amount, false, m.effective_from;   -- market paused wins over everything
    RETURN;
  END IF;

  IF p_agent_id IS NOT NULL THEN
    SELECT r.enabled, r.amount, r.effective_from INTO a
    FROM agent_commission_rates r
    WHERE r.market_id = p_market_id AND r.agent_id = p_agent_id
      AND r.effective_from <= p_day AND (r.effective_to IS NULL OR p_day < r.effective_to)
    ORDER BY r.effective_from DESC, r.created_at DESC
    LIMIT 1;
    IF a IS NOT NULL THEN
      RETURN QUERY SELECT a.enabled, a.amount, true, a.effective_from;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT m.enabled, m.amount, false, m.effective_from;
END;
$$;

-- ------------------------------------------------------------
-- set_agent_commission_rate — the settings write. super_admin only.
-- Closes the open row for (market, agent-or-NULL) at p_effective_from and
-- inserts the new one. Same call for a rate change and for the on/off switch.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_agent_commission_rate(
  p_market_id      UUID,
  p_agent_id       UUID,
  p_amount         NUMERIC,
  p_enabled        BOOLEAN,
  p_effective_from DATE,
  p_note           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_id    UUID;
BEGIN
  IF get_user_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'only super_admin can set commission rates' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_market_id IS NULL OR p_effective_from IS NULL THEN
    RAISE EXCEPTION 'market_id and effective_from are required';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'amount must be >= 0';
  END IF;
  IF p_agent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = p_agent_id AND u.role = 'agent' AND u.market_id = p_market_id AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'agent % is not an agent of this market', p_agent_id;
  END IF;

  -- Close every open row for this scope at the new start (half-open windows,
  -- so a same-day replacement leaves an empty window rather than a violation).
  UPDATE agent_commission_rates
     SET effective_to = GREATEST(p_effective_from, effective_from)
   WHERE market_id = p_market_id
     AND agent_id IS NOT DISTINCT FROM p_agent_id
     AND effective_to IS NULL;

  INSERT INTO agent_commission_rates (market_id, agent_id, enabled, amount, effective_from, set_by, note)
  VALUES (p_market_id, p_agent_id, COALESCE(p_enabled, true), p_amount, p_effective_from, v_actor, NULLIF(trim(p_note), ''))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'market_id', p_market_id, 'agent_id', p_agent_id,
                            'enabled', COALESCE(p_enabled, true), 'amount', p_amount, 'effective_from', p_effective_from);
END;
$$;
REVOKE ALL ON FUNCTION set_agent_commission_rate(UUID, UUID, NUMERIC, BOOLEAN, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_agent_commission_rate(UUID, UUID, NUMERIC, BOOLEAN, DATE, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- get_commission_settings — what Paramètres › Général › Commissions shows.
-- super_admin only (the group is hidden for everyone else).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_commission_settings(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_today  DATE;
  v_result JSONB;
BEGIN
  IF get_user_role() IS DISTINCT FROM 'super_admin' THEN
    RETURN '{}'::jsonb;
  END IF;
  v_today := (now() AT TIME ZONE market_tz(p_market_id))::date;

  WITH row_json AS (
    SELECT r.id, r.agent_id, r.enabled, r.amount, r.effective_from, r.effective_to, r.note, r.created_at,
           u.full_name AS set_by_name, ag.full_name AS agent_name
    FROM agent_commission_rates r
    LEFT JOIN users u  ON u.id  = r.set_by
    LEFT JOIN users ag ON ag.id = r.agent_id
    WHERE r.market_id = p_market_id
  ),
  market_row AS (
    SELECT * FROM row_json WHERE agent_id IS NULL
      AND effective_from <= v_today AND (effective_to IS NULL OR v_today < effective_to)
    ORDER BY effective_from DESC, created_at DESC LIMIT 1
  ),
  agents AS (
    SELECT u.id, u.full_name, u.avatar_url, u.is_active
    FROM users u WHERE u.role = 'agent' AND u.market_id = p_market_id AND u.deleted_at IS NULL
  ),
  overrides AS (
    SELECT DISTINCT ON (agent_id) * FROM row_json
    WHERE agent_id IS NOT NULL
      AND effective_from <= v_today AND (effective_to IS NULL OR v_today < effective_to)
    ORDER BY agent_id, effective_from DESC, created_at DESC
  )
  SELECT jsonb_build_object(
    'market_id', p_market_id,
    'currency', (SELECT currency FROM markets WHERE id = p_market_id),
    'market', (SELECT to_jsonb(m) - 'agent_name' FROM market_row m),
    'agents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'agent_id', a.id, 'name', a.full_name, 'avatar_url', a.avatar_url, 'is_active', a.is_active,
        'override', (SELECT to_jsonb(o) - 'agent_name' FROM overrides o WHERE o.agent_id = a.id)
      ) ORDER BY a.is_active DESC, a.full_name)
      FROM agents a), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC)
      FROM (SELECT * FROM row_json ORDER BY created_at DESC LIMIT 100) h), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION get_commission_settings(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_commission_settings(UUID) TO authenticated;

-- ------------------------------------------------------------
-- accrue_agent_commissions — the sweep. Runs from pg_cron (no JWT) and from
-- POST /api/team/commissions/accrue (super_admin). Idempotent: the partial
-- unique index on (order_id, entry_type) makes a second run insert nothing.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION accrue_agent_commissions(p_market_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_accrued FROM ins;

  -- 2. Reversals: an accrued order that is no longer delivered, once.
  WITH ins AS (
    INSERT INTO agent_commission_ledger (market_id, agent_id, order_id, entry_type, amount, rate_amount, effective_at, created_by, note)
    SELECT l.market_id, l.agent_id, l.order_id, 'reversal', -l.amount, l.rate_amount, now(), NULL,
           'status corrigé : ' || o.status::text
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
$$;
REVOKE ALL ON FUNCTION accrue_agent_commissions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accrue_agent_commissions(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- get_team_commissions — the manager read behind /team and /team/performance.
-- Period figures on effective_at in market-local days; balance all-time.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_team_commissions(
  p_market_id UUID,
  p_from      DATE,
  p_to        DATE,
  p_tz        TEXT DEFAULT 'Africa/Tunis'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
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
      count(*) FILTER (WHERE l.entry_type = 'accrual'  AND l.effective_at >= v_start AND l.effective_at < v_end) AS delivered,
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
$$;
REVOKE ALL ON FUNCTION get_team_commissions(UUID, DATE, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_team_commissions(UUID, DATE, DATE, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- get_agent_commission_ledger — one agent's statement for the drawer / CSV.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_agent_commission_ledger(
  p_agent_id UUID,
  p_from     DATE DEFAULT NULL,
  p_to       DATE DEFAULT NULL,
  p_limit    INTEGER DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role   TEXT := get_user_role();
  v_market UUID;
  v_tz     TEXT;
BEGIN
  SELECT u.market_id INTO v_market FROM users u WHERE u.id = p_agent_id AND u.role = 'agent';
  IF v_market IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT (v_role = 'super_admin' OR (v_role = 'market_manager' AND get_user_market_id() = v_market)) THEN
    RETURN '[]'::jsonb;
  END IF;
  v_tz := market_tz(v_market);

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', l.id, 'entry_type', l.entry_type, 'amount', l.amount, 'rate_amount', l.rate_amount,
      'effective_at', l.effective_at, 'method', l.method, 'reference', l.reference, 'note', l.note,
      'order_id', l.order_id, 'external_id', o.external_id,
      'product_name', COALESCE(p.name, o.product_name),
      'created_by_name', u.full_name, 'created_at', l.created_at
    ) ORDER BY l.effective_at DESC, l.created_at DESC)
    FROM (
      SELECT * FROM agent_commission_ledger l
      WHERE l.agent_id = p_agent_id
        AND (p_from IS NULL OR l.effective_at >= (p_from::timestamp AT TIME ZONE v_tz))
        AND (p_to   IS NULL OR l.effective_at <  ((p_to + 1)::timestamp AT TIME ZONE v_tz))
      ORDER BY l.effective_at DESC, l.created_at DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000)
    ) l
    LEFT JOIN orders o   ON o.id = l.order_id
    LEFT JOIN products p ON p.id = o.product_id
    LEFT JOIN users u    ON u.id = l.created_by
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION get_agent_commission_ledger(UUID, DATE, DATE, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_agent_commission_ledger(UUID, DATE, DATE, INTEGER) TO authenticated;

-- ------------------------------------------------------------
-- record_agent_payout — the manager's "Enregistrer un paiement".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_agent_payout(
  p_agent_id       UUID,
  p_amount         NUMERIC,
  p_paid_at        TIMESTAMPTZ,
  p_method         TEXT,
  p_reference      TEXT DEFAULT NULL,
  p_note           TEXT DEFAULT NULL,
  p_allow_negative BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role    TEXT := get_user_role();
  v_actor   UUID := auth.uid();
  v_market  UUID;
  v_balance NUMERIC;
  v_id      UUID;
BEGIN
  SELECT u.market_id INTO v_market FROM users u WHERE u.id = p_agent_id AND u.role = 'agent' AND u.deleted_at IS NULL;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'agent not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (v_role = 'super_admin' OR (v_role = 'market_manager' AND get_user_market_id() = v_market)) THEN
    RAISE EXCEPTION 'not allowed to record payouts for this agent' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0' USING ERRCODE = 'check_violation';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash', 'bank_transfer', 'wallet') THEN
    RAISE EXCEPTION 'method must be cash, bank_transfer or wallet' USING ERRCODE = 'check_violation';
  END IF;
  IF p_paid_at IS NULL OR p_paid_at > now() + interval '1 day' THEN
    RAISE EXCEPTION 'paid_at must be a past or present timestamp' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM agent_commission_ledger WHERE agent_id = p_agent_id;
  IF v_balance - p_amount < 0 AND NOT COALESCE(p_allow_negative, false) THEN
    RAISE EXCEPTION 'NEGATIVE_BALANCE: paying % leaves the balance at %', p_amount, v_balance - p_amount
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO agent_commission_ledger (market_id, agent_id, entry_type, amount, effective_at, method, reference, note, created_by)
  VALUES (v_market, p_agent_id, 'payout', -p_amount, p_paid_at, p_method,
          NULLIF(left(trim(p_reference), 200), ''), NULLIF(left(trim(p_note), 500), ''), v_actor)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'agent_id', p_agent_id, 'amount', p_amount,
                            'balance_after', v_balance - p_amount);
END;
$$;
REVOKE ALL ON FUNCTION record_agent_payout(UUID, NUMERIC, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_agent_payout(UUID, NUMERIC, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- post_agent_commission_adjustment — the only repair path. Note mandatory.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_agent_commission_adjustment(
  p_agent_id UUID,
  p_amount   NUMERIC,
  p_note     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   TEXT := get_user_role();
  v_actor  UUID := auth.uid();
  v_market UUID;
  v_id     UUID;
BEGIN
  SELECT u.market_id INTO v_market FROM users u WHERE u.id = p_agent_id AND u.role = 'agent' AND u.deleted_at IS NULL;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'agent not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (v_role = 'super_admin' OR (v_role = 'market_manager' AND get_user_market_id() = v_market)) THEN
    RAISE EXCEPTION 'not allowed to adjust this agent' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'amount must be non-zero' USING ERRCODE = 'check_violation';
  END IF;
  IF p_note IS NULL OR length(trim(p_note)) < 3 THEN
    RAISE EXCEPTION 'a note is required for an adjustment' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO agent_commission_ledger (market_id, agent_id, entry_type, amount, effective_at, note, created_by)
  VALUES (v_market, p_agent_id, 'adjustment', p_amount, now(), left(trim(p_note), 500), v_actor)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'agent_id', p_agent_id, 'amount', p_amount);
END;
$$;
REVOKE ALL ON FUNCTION post_agent_commission_adjustment(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_agent_commission_adjustment(UUID, NUMERIC, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- get_my_commissions — the agent's own view. Caller = auth.uid(), always;
-- there is no agent parameter, so no agent can read another's figures.
-- History is grouped by local day in SQL so the payload stays small.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_commissions(p_days INTEGER DEFAULT 60)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
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
    SELECT * FROM agent_commission_ledger l WHERE l.agent_id = v_me
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
  ),
  days AS (
    SELECT (l.effective_at AT TIME ZONE v_tz)::date AS day,
      count(*) FILTER (WHERE l.entry_type = 'accrual')  AS delivered,
      count(*) FILTER (WHERE l.entry_type = 'reversal') AS corrections,
      SUM(l.amount) AS amount,
      jsonb_agg(jsonb_build_object(
        'external_id', o.external_id,
        'product_name', COALESCE(p.name, o.product_name),
        'city', o.customer_city,
        'amount', l.amount,
        'entry_type', l.entry_type
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
      'delivered',   (SELECT count(*) FROM me WHERE entry_type = 'accrual'  AND (v_last_at IS NULL OR effective_at > v_last_at)),
      'corrections', (SELECT count(*) FROM me WHERE entry_type = 'reversal' AND (v_last_at IS NULL OR effective_at > v_last_at))),
    'month', jsonb_build_object(
      'delivered', (SELECT count(*) FROM me WHERE entry_type = 'accrual' AND effective_at >= v_month),
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
$$;
REVOKE ALL ON FUNCTION get_my_commissions(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_commissions(INTEGER) TO authenticated;
