-- ============================================================
-- 20260819000006_investor_money_safety.sql
-- Closes three ways the investor ledger loses or leaks money.
--
-- All three were designed correctly and implemented incompletely: the enum
-- values, the fold arms and the doc comments for each already existed with no
-- code behind them.
--
-- A1  apply_investor_settlement was SECURITY DEFINER with NO grant statement.
--     Postgres defaults proacl to NULL, which means PUBLIC holds EXECUTE, so
--     any authenticated user could call it through PostgREST and mint a
--     `settlement` ledger row of any size — then withdraw it. The append-only
--     trigger makes such a row permanently unrepairable. Sibling RPCs in this
--     repo (20260422_toggle_product_active_rpc.sql:45) revoke correctly; this
--     one did not. `p_actor_id` was also caller-supplied, so the audit trail
--     was forgeable even by a legitimate caller.
--
-- A2  Withdrawal requests were validated with a read-then-write across three
--     separate statements — no lock, no constraint, no transaction. Two
--     concurrent POSTs both passed the balance check and both inserted.
--
-- A4  `correction` and `reserve_release` are declared in the entry_type CHECK
--     and folded by investor-balance.ts, but NOTHING could write them. The
--     error message at withdrawals/[id]/route.ts told operators to "add a
--     correcting entry" via a route that did not exist. Without this, no
--     ledger mistake can ever be repaired, and reserve release (B1) has
--     nowhere to book netted returns.
-- ============================================================

-- ------------------------------------------------------------
-- Shared guard: is this actor allowed to move money?
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_money_actor(p_actor_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role TEXT;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'actor is required for money movement';
  END IF;

  SELECT role INTO v_role
  FROM users
  WHERE id = p_actor_id AND is_active AND deleted_at IS NULL;

  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'actor % is not an active super_admin', p_actor_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION assert_money_actor(UUID) FROM PUBLIC;

-- ------------------------------------------------------------
-- A1. Lock the settlement RPC and stop trusting the supplied actor.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_investor_settlement(
  p_statements JSONB,
  p_ledger     JSONB,
  p_actor_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_statements_inserted INT := 0;
  v_ledger_inserted     INT := 0;
BEGIN
  -- Defence in depth. The route already gates on super_admin via getActor(),
  -- but this function bypasses RLS by design, so it must not depend on the
  -- caller having done that.
  PERFORM assert_money_actor(p_actor_id);

  IF p_statements IS NULL OR jsonb_array_length(p_statements) = 0 THEN
    RETURN jsonb_build_object('statements_inserted', 0, 'ledger_inserted', 0);
  END IF;

  WITH inserted AS (
    INSERT INTO investor_statements (
      investor_id, product_id, market_id, period_start, period_end,
      revenue, cogs, delivery_cost, return_cost, packing_cost,
      ad_spend_direct, ad_spend_allocated, processing_cost, net_profit,
      delivered_count, returned_count, confirmed_count,
      investor_capital, total_capital, share_pct, investor_share,
      reserve_held, carried_loss_applied, cost_inputs,
      status, settled_at, settled_by
    )
    SELECT
      s.investor_id, s.product_id, s.market_id, s.period_start, s.period_end,
      s.revenue, s.cogs, s.delivery_cost, s.return_cost, s.packing_cost,
      s.ad_spend_direct, s.ad_spend_allocated, s.processing_cost, s.net_profit,
      s.delivered_count, s.returned_count, s.confirmed_count,
      s.investor_capital, s.total_capital, s.share_pct, s.investor_share,
      s.reserve_held, s.carried_loss_applied, s.cost_inputs,
      'settled', now(), p_actor_id
    FROM jsonb_to_recordset(p_statements) AS s(
      investor_id UUID, product_id UUID, market_id UUID,
      period_start DATE, period_end DATE,
      revenue NUMERIC, cogs NUMERIC, delivery_cost NUMERIC, return_cost NUMERIC,
      packing_cost NUMERIC, ad_spend_direct NUMERIC, ad_spend_allocated NUMERIC,
      processing_cost NUMERIC, net_profit NUMERIC,
      delivered_count INT, returned_count INT, confirmed_count INT,
      investor_capital NUMERIC, total_capital NUMERIC, share_pct NUMERIC,
      investor_share NUMERIC, reserve_held NUMERIC, carried_loss_applied NUMERIC,
      cost_inputs JSONB
    )
    ON CONFLICT (investor_id, product_id, period_start, period_end) DO NOTHING
    RETURNING id, investor_id, product_id, period_start, period_end
  ),
  ledger_ins AS (
    INSERT INTO investor_ledger (
      investor_id, statement_id, product_id, market_id,
      entry_type, amount, note, created_by
    )
    SELECT
      l.investor_id, i.id, l.product_id, l.market_id,
      l.entry_type, l.amount, l.note, p_actor_id
    FROM jsonb_to_recordset(p_ledger) AS l(
      investor_id UUID, product_id UUID, market_id UUID,
      period_start DATE, period_end DATE,
      entry_type TEXT, amount NUMERIC, note TEXT
    )
    -- Join on the PERIOD as well as (investor, product). Without the period
    -- key this is a cartesian product the moment a single call settles more
    -- than one period — the previous version only worked by accident.
    JOIN inserted i
      ON i.investor_id  = l.investor_id
     AND i.product_id   = l.product_id
     AND i.period_start = l.period_start
     AND i.period_end   = l.period_end
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM inserted),
    (SELECT count(*) FROM ledger_ins)
  INTO v_statements_inserted, v_ledger_inserted;

  RETURN jsonb_build_object(
    'statements_inserted', v_statements_inserted,
    'ledger_inserted',     v_ledger_inserted
  );
END;
$$;

-- The route calls this with the service-role client, which bypasses grants
-- entirely. No application role needs EXECUTE.
REVOKE ALL ON FUNCTION apply_investor_settlement(JSONB, JSONB, UUID) FROM PUBLIC;

-- ------------------------------------------------------------
-- A2. Atomic withdrawal request.
--
-- Serialises per investor with a row lock, recomputes the available balance
-- from the ledger inside the same transaction, subtracts everything already
-- claimed by open requests, and only then inserts. Two concurrent callers now
-- queue on the lock and the second sees the first one's row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_withdrawal(
  p_investor_id UUID,
  p_amount      NUMERIC,
  p_note        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market    UUID;
  v_available NUMERIC := 0;
  v_claimed   NUMERIC := 0;
  v_id        UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive' USING ERRCODE = 'check_violation';
  END IF;

  -- Serialisation point. Everything below reads a stable snapshot per investor.
  PERFORM 1 FROM investors WHERE id = p_investor_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'investor % not found', p_investor_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT market_id INTO v_market FROM users WHERE id = p_investor_id;

  -- Available = settled and released only. Mirrors foldLedger():
  -- settlement and reserve_release add; reserve_hold, withdrawal and
  -- principal_return subtract. Pending accruals are deliberately excluded.
  SELECT COALESCE(SUM(
    CASE entry_type
      WHEN 'settlement'       THEN amount
      WHEN 'reserve_release'  THEN amount
      WHEN 'reserve_hold'     THEN -amount
      WHEN 'withdrawal'       THEN -amount
      WHEN 'principal_return' THEN -amount
      ELSE 0
    END), 0)
  INTO v_available
  FROM investor_ledger
  WHERE investor_id = p_investor_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_claimed
  FROM withdrawal_requests
  WHERE investor_id = p_investor_id
    AND status IN ('requested', 'approved');

  IF p_amount > (v_available - v_claimed) THEN
    RAISE EXCEPTION 'amount exceeds available balance'
      USING ERRCODE = 'check_violation',
            DETAIL  = format('available=%s claimed=%s requested=%s',
                             v_available, v_claimed, p_amount);
  END IF;

  INSERT INTO withdrawal_requests (investor_id, market_id, amount, status, note)
  VALUES (p_investor_id, v_market, p_amount, 'requested', p_note)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'amount', p_amount,
    'available_after', v_available - v_claimed - p_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION request_withdrawal(UUID, NUMERIC, TEXT) FROM PUBLIC;

-- ------------------------------------------------------------
-- A4. The correcting-entry path.
--
-- The ledger is append-only by design, so the ONLY way to repair a mistake is
-- a compensating entry. Until now nothing could write one, which meant every
-- error in this system was permanent.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_investor_correction(
  p_investor_id UUID,
  p_entry_type  TEXT,
  p_amount      NUMERIC,
  p_note        TEXT,
  p_actor_id    UUID,
  p_product_id  UUID DEFAULT NULL,
  p_statement_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market UUID;
  v_id     UUID;
BEGIN
  PERFORM assert_money_actor(p_actor_id);

  -- Only the repair entry types. Settlements must go through the settlement
  -- path so they stay tied to a statement.
  IF p_entry_type NOT IN ('correction', 'reserve_release', 'principal_return') THEN
    RAISE EXCEPTION 'entry_type % is not permitted here', p_entry_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'a note is required — corrections must be explainable'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT market_id INTO v_market FROM users WHERE id = p_investor_id;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'investor % not found', p_investor_id USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO investor_ledger (
    investor_id, statement_id, product_id, market_id,
    entry_type, amount, note, created_by
  )
  VALUES (
    p_investor_id, p_statement_id, p_product_id, v_market,
    p_entry_type, p_amount, p_note, p_actor_id
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'entry_type', p_entry_type, 'amount', p_amount);
END;
$$;

REVOKE ALL ON FUNCTION post_investor_correction(UUID, TEXT, NUMERIC, TEXT, UUID, UUID, UUID) FROM PUBLIC;

COMMENT ON FUNCTION post_investor_correction IS
  'The only way to repair an append-only investor_ledger. super_admin only, note mandatory.';

-- ------------------------------------------------------------
-- B1. Reserve release — system-initiated, so no human actor.
--
-- Releases a matured hold and books any late-return charge in ONE transaction.
-- Splitting them would risk releasing the money and then failing to charge the
-- return, and the ledger is append-only so that could not be walked back.
--
-- Idempotent: a statement that already has a reserve_release entry is skipped,
-- which matters because the cron re-runs daily.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_investor_reserve(
  p_statement_id  UUID,
  p_late_charge   NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s          RECORD;
  v_charge   NUMERIC;
BEGIN
  SELECT id, investor_id, product_id, market_id, period_end, reserve_held
    INTO s
  FROM investor_statements
  WHERE id = p_statement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'statement % not found', p_statement_id USING ERRCODE = 'no_data_found';
  END IF;

  IF s.reserve_held IS NULL OR s.reserve_held <= 0 THEN
    RETURN jsonb_build_object('released', false, 'reason', 'no reserve held');
  END IF;

  IF EXISTS (
    SELECT 1 FROM investor_ledger
    WHERE statement_id = p_statement_id AND entry_type = 'reserve_release'
  ) THEN
    RETURN jsonb_build_object('released', false, 'reason', 'already released');
  END IF;

  -- The reserve caps what a late return can cost after the fact.
  v_charge := LEAST(GREATEST(COALESCE(p_late_charge, 0), 0), s.reserve_held);

  INSERT INTO investor_ledger (
    investor_id, statement_id, product_id, market_id, entry_type, amount, note, created_by
  ) VALUES (
    s.investor_id, s.id, s.product_id, s.market_id, 'reserve_release', s.reserve_held,
    format('Reserve released for period ending %s', s.period_end), NULL
  );

  IF v_charge > 0 THEN
    INSERT INTO investor_ledger (
      investor_id, statement_id, product_id, market_id, entry_type, amount, note, created_by
    ) VALUES (
      s.investor_id, s.id, s.product_id, s.market_id, 'correction', -v_charge,
      format('Late returns after %s, charged against released reserve', s.period_end), NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'released', true,
    'amount', s.reserve_held,
    'late_charge', v_charge
  );
END;
$$;

REVOKE ALL ON FUNCTION release_investor_reserve(UUID, NUMERIC) FROM PUBLIC;

COMMENT ON FUNCTION release_investor_reserve IS
  'Releases a matured reserve and charges late returns atomically. System-initiated (created_by NULL); idempotent per statement.';
