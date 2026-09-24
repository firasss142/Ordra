-- ============================================================
-- 20260920000005_investor_money_rpcs.sql
-- Investor domain v2 — money RPCs.
--
-- Every write to money tables goes through one of these SECURITY DEFINER
-- functions. Admin actions assert the actor is an active super_admin
-- (assert_money_actor, kept from v1); the investor's own withdrawal request
-- is called by a route that takes the investor id from the SESSION only.
--
--   investor_available_balance     fold: settlement + correction − withdrawal
--   create_investor_deal           deal + first terms + capital_in
--   amend_investor_deal_terms      new terms version (+ capital delta)
--   commit_investor_settlements    statements + settlement entries, idempotent
--   request_investor_withdrawal    investor claim against available − open
--   decide_investor_withdrawal     approve / reject / paid (ledger on paid)
--   post_investor_adjustment       compensating correction entry (note!)
--   close_investor_deal            early exit / final statement / principal_return
--   mark_investor_notifications_read
-- ============================================================

-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION investor_available_balance(p_investor_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE entry_type
      WHEN 'settlement' THEN amount
      WHEN 'correction' THEN amount
      WHEN 'withdrawal' THEN -amount
      ELSE 0
    END), 0)
  FROM investor_ledger_entries
  WHERE investor_id = p_investor_id;
$$;
REVOKE ALL ON FUNCTION investor_available_balance(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION investor_available_balance(UUID) TO service_role;

-- Open claims (requested / approved) against available.
CREATE OR REPLACE FUNCTION investor_open_withdrawal_claims(p_investor_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount), 0)
  FROM investor_withdrawals
  WHERE investor_id = p_investor_id AND status IN ('requested', 'approved');
$$;
REVOKE ALL ON FUNCTION investor_open_withdrawal_claims(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION investor_open_withdrawal_claims(UUID) TO service_role;

-- ------------------------------------------------------------
-- notification helper (internal)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION investor_notify(
  p_investor_id UUID, p_kind TEXT, p_dedupe_key TEXT,
  p_deal_id UUID DEFAULT NULL, p_statement_id UUID DEFAULT NULL, p_withdrawal_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO investor_notifications (investor_id, kind, dedupe_key, deal_id, statement_id, withdrawal_id, payload)
  VALUES (p_investor_id, p_kind, p_dedupe_key, p_deal_id, p_statement_id, p_withdrawal_id, COALESCE(p_payload, '{}'::jsonb))
  ON CONFLICT (dedupe_key) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION investor_notify(UUID, TEXT, TEXT, UUID, UUID, UUID, JSONB) FROM PUBLIC;

-- ------------------------------------------------------------
-- create_investor_deal
-- p: { investor_id, product_id, start_date, end_date, share_pct, capital_amount,
--      payout_cadence, label?, note? }
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_investor_deal(p JSONB, p_actor_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id   UUID;
  v_market_id UUID;
  v_currency  TEXT;
  v_share     NUMERIC(7,4)  := (p->>'share_pct')::numeric;
  v_capital   NUMERIC(14,3) := COALESCE((p->>'capital_amount')::numeric, 0);
  v_start     DATE := (p->>'start_date')::date;
  v_end       DATE := (p->>'end_date')::date;
  v_cadence   TEXT := COALESCE(p->>'payout_cadence', 'quarterly');
BEGIN
  PERFORM assert_money_actor(p_actor_id);

  IF NOT EXISTS (SELECT 1 FROM investors WHERE id = (p->>'investor_id')::uuid) THEN
    RAISE EXCEPTION 'investor profile not found' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT pr.market_id, m.currency INTO v_market_id, v_currency
  FROM products pr JOIN markets m ON m.id = pr.market_id
  WHERE pr.id = (p->>'product_id')::uuid AND pr.deleted_at IS NULL;
  IF v_market_id IS NULL THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_share IS NULL OR v_share <= 0 OR v_share > 100 THEN
    RAISE EXCEPTION 'share_pct must be in (0, 100]' USING ERRCODE = 'check_violation';
  END IF;
  IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start THEN
    RAISE EXCEPTION 'end_date must be after start_date' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO investor_deals (investor_id, product_id, market_id, currency, label, start_date, end_date, status, note, created_by)
  VALUES ((p->>'investor_id')::uuid, (p->>'product_id')::uuid, v_market_id, v_currency, p->>'label', v_start, v_end, 'active', p->>'note', p_actor_id)
  RETURNING id INTO v_deal_id;

  INSERT INTO investor_deal_terms (deal_id, effective_from, share_pct, capital_amount, payout_cadence, maturity_date, note, created_by)
  VALUES (v_deal_id, v_start, v_share, v_capital, v_cadence, v_end, 'v1', p_actor_id);

  IF v_capital > 0 THEN
    INSERT INTO investor_ledger_entries (investor_id, deal_id, market_id, currency, entry_type, amount, note, created_by)
    VALUES ((p->>'investor_id')::uuid, v_deal_id, v_market_id, v_currency, 'capital_in', v_capital, 'Capital invested — deal created', p_actor_id);
  END IF;

  RETURN v_deal_id;
END;
$$;
REVOKE ALL ON FUNCTION create_investor_deal(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_investor_deal(JSONB, UUID) TO service_role;

-- ------------------------------------------------------------
-- amend_investor_deal_terms
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION amend_investor_deal_terms(
  p_deal_id UUID, p_effective_from DATE, p_share_pct NUMERIC, p_capital_amount NUMERIC,
  p_payout_cadence TEXT, p_maturity_date DATE, p_note TEXT, p_actor_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d              investor_deals%ROWTYPE;
  v_last_end     DATE;
  v_prev_capital NUMERIC(14,3);
  v_terms_id     UUID;
BEGIN
  PERFORM assert_money_actor(p_actor_id);

  SELECT * INTO d FROM investor_deals WHERE id = p_deal_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'deal not found' USING ERRCODE = 'no_data_found'; END IF;
  IF d.status = 'closed' THEN RAISE EXCEPTION 'DEAL_CLOSED' USING ERRCODE = 'check_violation'; END IF;

  SELECT MAX(period_end) INTO v_last_end FROM investor_deal_statements WHERE deal_id = p_deal_id;
  IF v_last_end IS NOT NULL AND p_effective_from <= v_last_end THEN
    RAISE EXCEPTION 'TERMS_BEFORE_SETTLED' USING ERRCODE = 'check_violation',
      DETAIL = format('effective_from must be after the last settled period_end (%s)', v_last_end);
  END IF;
  IF p_effective_from < d.start_date THEN
    RAISE EXCEPTION 'TERMS_BEFORE_START' USING ERRCODE = 'check_violation';
  END IF;
  IF p_maturity_date <= d.start_date THEN
    RAISE EXCEPTION 'MATURITY_BEFORE_START' USING ERRCODE = 'check_violation';
  END IF;

  SELECT capital_amount INTO v_prev_capital
  FROM investor_deal_terms WHERE deal_id = p_deal_id ORDER BY effective_from DESC LIMIT 1;

  INSERT INTO investor_deal_terms (deal_id, effective_from, share_pct, capital_amount, payout_cadence, maturity_date, note, created_by)
  VALUES (p_deal_id, p_effective_from, p_share_pct, p_capital_amount, p_payout_cadence, p_maturity_date, p_note, p_actor_id)
  RETURNING id INTO v_terms_id;

  IF p_capital_amount IS DISTINCT FROM v_prev_capital AND (p_capital_amount - COALESCE(v_prev_capital, 0)) <> 0 THEN
    INSERT INTO investor_ledger_entries (investor_id, deal_id, market_id, currency, entry_type, amount, note, created_by)
    VALUES (d.investor_id, d.id, d.market_id, d.currency, 'capital_in', p_capital_amount - COALESCE(v_prev_capital, 0),
            format('Capital amended (effective %s)', p_effective_from), p_actor_id);
  END IF;

  IF d.status = 'active' AND p_maturity_date IS DISTINCT FROM d.end_date THEN
    UPDATE investor_deals SET end_date = p_maturity_date WHERE id = d.id;
  END IF;

  PERFORM investor_notify(d.investor_id, 'terms_amended', 'terms_amended:' || v_terms_id::text, d.id, NULL, NULL,
    jsonb_build_object('effective_from', p_effective_from, 'share_pct', p_share_pct, 'capital_amount', p_capital_amount,
                       'payout_cadence', p_payout_cadence, 'maturity_date', p_maturity_date, 'currency', d.currency));

  RETURN v_terms_id;
END;
$$;
REVOKE ALL ON FUNCTION amend_investor_deal_terms(UUID, DATE, NUMERIC, NUMERIC, TEXT, DATE, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION amend_investor_deal_terms(UUID, DATE, NUMERIC, NUMERIC, TEXT, DATE, TEXT, UUID) TO service_role;

-- ------------------------------------------------------------
-- commit_investor_settlements
-- p_statements: JSONB array of statement drafts (columns of
-- investor_deal_statements minus id/settled_*; kind defaults 'periodic').
-- Atomic across deals. Idempotent on preview_hash (replay → existing row).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION commit_investor_settlements(p_statements JSONB, p_actor_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s            JSONB;
  d            investor_deals%ROWTYPE;
  v_last_end   DATE;
  v_last_seq   INTEGER;
  v_expected   DATE;
  v_stmt_id    UUID;
  v_existing   UUID;
  v_ledger_id  UUID;
  v_payable    NUMERIC(14,3);
  v_out        JSONB := '[]'::jsonb;
BEGIN
  PERFORM assert_money_actor(p_actor_id);

  FOR s IN SELECT * FROM jsonb_array_elements(p_statements) LOOP
    SELECT * INTO d FROM investor_deals WHERE id = (s->>'deal_id')::uuid FOR UPDATE;
    IF d.id IS NULL THEN RAISE EXCEPTION 'deal not found: %', s->>'deal_id' USING ERRCODE = 'no_data_found'; END IF;
    IF d.status = 'closed' THEN RAISE EXCEPTION 'DEAL_CLOSED %', d.id USING ERRCODE = 'check_violation'; END IF;

    -- Replay?
    SELECT id, payable INTO v_existing, v_payable FROM investor_deal_statements WHERE preview_hash = s->>'preview_hash';
    IF v_existing IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('deal_id', d.id, 'statement_id', v_existing, 'payable', v_payable, 'replayed', true);
      CONTINUE;
    END IF;

    SELECT MAX(period_end), COALESCE(MAX(sequence_no), 0) INTO v_last_end, v_last_seq
    FROM investor_deal_statements WHERE deal_id = d.id;
    v_expected := COALESCE(v_last_end + 1, d.start_date);
    IF (s->>'period_start')::date IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'PERIOD_NOT_CONTIGUOUS' USING ERRCODE = 'check_violation',
        DETAIL = format('deal %s expects period_start %s, got %s', d.id, v_expected, s->>'period_start');
    END IF;

    v_payable := (s->>'payable')::numeric;

    INSERT INTO investor_deal_statements (
      deal_id, investor_id, product_id, market_id, currency, sequence_no, kind, period_start, period_end,
      revenue, cogs, delivery_cost, return_cost, packing_cost, processing_cost, ad_spend_direct, gross_profit, net_profit,
      received_count, uploaded_count, delivered_count, returned_count, excluded_dexpress_count, pending_count, pending_revenue,
      share_pct_min, share_pct_max, investor_share, restatement_delta,
      carried_loss_before, carried_loss_applied, carried_loss_after, payable,
      cumulative_share_through, cumulative_net_profit_through, capital_amount, snapshot, preview_hash, settled_by
    ) VALUES (
      d.id, d.investor_id, d.product_id, d.market_id, d.currency, v_last_seq + 1, COALESCE(s->>'kind', 'periodic'),
      (s->>'period_start')::date, (s->>'period_end')::date,
      COALESCE((s->>'revenue')::numeric, 0), COALESCE((s->>'cogs')::numeric, 0), COALESCE((s->>'delivery_cost')::numeric, 0),
      COALESCE((s->>'return_cost')::numeric, 0), COALESCE((s->>'packing_cost')::numeric, 0), COALESCE((s->>'processing_cost')::numeric, 0),
      COALESCE((s->>'ad_spend_direct')::numeric, 0), COALESCE((s->>'gross_profit')::numeric, 0), COALESCE((s->>'net_profit')::numeric, 0),
      COALESCE((s->>'received_count')::int, 0), COALESCE((s->>'uploaded_count')::int, 0), COALESCE((s->>'delivered_count')::int, 0),
      COALESCE((s->>'returned_count')::int, 0), COALESCE((s->>'excluded_dexpress_count')::int, 0), COALESCE((s->>'pending_count')::int, 0),
      COALESCE((s->>'pending_revenue')::numeric, 0),
      (s->>'share_pct_min')::numeric, (s->>'share_pct_max')::numeric, (s->>'investor_share')::numeric, COALESCE((s->>'restatement_delta')::numeric, 0),
      COALESCE((s->>'carried_loss_before')::numeric, 0), COALESCE((s->>'carried_loss_applied')::numeric, 0), COALESCE((s->>'carried_loss_after')::numeric, 0),
      v_payable, (s->>'cumulative_share_through')::numeric, (s->>'cumulative_net_profit_through')::numeric, (s->>'capital_amount')::numeric,
      COALESCE(s->'snapshot', '{}'::jsonb), s->>'preview_hash', p_actor_id
    ) RETURNING id INTO v_stmt_id;

    v_ledger_id := NULL;
    IF v_payable > 0 THEN
      INSERT INTO investor_ledger_entries (investor_id, deal_id, statement_id, market_id, currency, entry_type, amount, note, created_by)
      VALUES (d.investor_id, d.id, v_stmt_id, d.market_id, d.currency, 'settlement', v_payable,
              format('Profit share %s → %s', s->>'period_start', s->>'period_end'), p_actor_id)
      RETURNING id INTO v_ledger_id;
    END IF;

    PERFORM investor_notify(d.investor_id, 'statement_issued', 'statement_issued:' || v_stmt_id::text, d.id, v_stmt_id, NULL,
      jsonb_build_object('period_start', s->>'period_start', 'period_end', s->>'period_end', 'payable', v_payable,
                         'investor_share', (s->>'investor_share')::numeric, 'carried_loss_after', COALESCE((s->>'carried_loss_after')::numeric, 0),
                         'currency', d.currency, 'kind', COALESCE(s->>'kind', 'periodic')));

    v_out := v_out || jsonb_build_object('deal_id', d.id, 'statement_id', v_stmt_id, 'payable', v_payable, 'ledger_id', v_ledger_id, 'replayed', false);
  END LOOP;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION commit_investor_settlements(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commit_investor_settlements(JSONB, UUID) TO service_role;

-- ------------------------------------------------------------
-- request_investor_withdrawal (investor; route passes the SESSION user id)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_investor_withdrawal(p_investor_id UUID, p_amount NUMERIC, p_note TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available NUMERIC(14,3);
  v_claimed   NUMERIC(14,3);
  v_market_id UUID;
  v_currency  TEXT;
  v_id        UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM investors WHERE id = p_investor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'investor profile not found' USING ERRCODE = 'no_data_found'; END IF;

  SELECT u.market_id, m.currency INTO v_market_id, v_currency
  FROM users u JOIN markets m ON m.id = u.market_id WHERE u.id = p_investor_id;
  IF v_market_id IS NULL THEN RAISE EXCEPTION 'investor has no market' USING ERRCODE = 'check_violation'; END IF;

  v_available := investor_available_balance(p_investor_id);
  v_claimed   := investor_open_withdrawal_claims(p_investor_id);
  IF p_amount > (v_available - v_claimed) THEN
    RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE' USING ERRCODE = 'check_violation',
      DETAIL = format('available %s, open claims %s, requested %s', v_available, v_claimed, p_amount);
  END IF;

  INSERT INTO investor_withdrawals (investor_id, market_id, currency, amount, note)
  VALUES (p_investor_id, v_market_id, v_currency, p_amount, p_note)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION request_investor_withdrawal(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_investor_withdrawal(UUID, NUMERIC, TEXT) TO service_role;

-- ------------------------------------------------------------
-- decide_investor_withdrawal — approve | reject | paid
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION decide_investor_withdrawal(
  p_id UUID, p_action TEXT, p_actor_id UUID, p_reference TEXT DEFAULT NULL, p_admin_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w investor_withdrawals%ROWTYPE;
  v_available NUMERIC(14,3);
BEGIN
  PERFORM assert_money_actor(p_actor_id);
  SELECT * INTO w FROM investor_withdrawals WHERE id = p_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'withdrawal not found' USING ERRCODE = 'no_data_found'; END IF;

  IF p_action = 'approve' THEN
    IF w.status <> 'requested' THEN RAISE EXCEPTION 'ILLEGAL_TRANSITION % → approved', w.status USING ERRCODE = 'check_violation'; END IF;
    UPDATE investor_withdrawals SET status = 'approved', decided_at = now(), decided_by = p_actor_id, admin_note = COALESCE(p_admin_note, admin_note) WHERE id = p_id;
    PERFORM investor_notify(w.investor_id, 'withdrawal_approved', 'withdrawal_approved:' || p_id::text, NULL, NULL, p_id,
      jsonb_build_object('amount', w.amount, 'currency', w.currency));

  ELSIF p_action = 'reject' THEN
    IF w.status NOT IN ('requested', 'approved') THEN RAISE EXCEPTION 'ILLEGAL_TRANSITION % → rejected', w.status USING ERRCODE = 'check_violation'; END IF;
    UPDATE investor_withdrawals SET status = 'rejected', decided_at = now(), decided_by = p_actor_id, admin_note = COALESCE(p_admin_note, admin_note) WHERE id = p_id;
    PERFORM investor_notify(w.investor_id, 'withdrawal_rejected', 'withdrawal_rejected:' || p_id::text, NULL, NULL, p_id,
      jsonb_build_object('amount', w.amount, 'currency', w.currency, 'admin_note', p_admin_note));

  ELSIF p_action = 'paid' THEN
    IF w.status <> 'approved' THEN RAISE EXCEPTION 'ILLEGAL_TRANSITION % → paid', w.status USING ERRCODE = 'check_violation'; END IF;
    PERFORM 1 FROM investors WHERE id = w.investor_id FOR UPDATE;
    v_available := investor_available_balance(w.investor_id);
    IF w.amount > v_available THEN
      RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE' USING ERRCODE = 'check_violation',
        DETAIL = format('available %s, withdrawal %s', v_available, w.amount);
    END IF;
    INSERT INTO investor_ledger_entries (investor_id, withdrawal_id, market_id, currency, entry_type, amount, note, created_by)
    VALUES (w.investor_id, w.id, w.market_id, w.currency, 'withdrawal', w.amount, COALESCE('Paid — ' || p_reference, 'Paid'), p_actor_id);
    UPDATE investor_withdrawals SET status = 'paid', paid_at = now(), paid_by = p_actor_id, payout_reference = p_reference, admin_note = COALESCE(p_admin_note, admin_note) WHERE id = p_id;
    PERFORM investor_notify(w.investor_id, 'withdrawal_paid', 'withdrawal_paid:' || p_id::text, NULL, NULL, p_id,
      jsonb_build_object('amount', w.amount, 'currency', w.currency, 'reference', p_reference));
  ELSE
    RAISE EXCEPTION 'unknown action %', p_action USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION decide_investor_withdrawal(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decide_investor_withdrawal(UUID, TEXT, UUID, TEXT, TEXT) TO service_role;

-- ------------------------------------------------------------
-- post_investor_adjustment (correction) — the only repair path
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_investor_adjustment(
  p_investor_id UUID, p_amount NUMERIC, p_note TEXT, p_actor_id UUID,
  p_deal_id UUID DEFAULT NULL, p_statement_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market_id UUID; v_currency TEXT; v_id UUID;
BEGIN
  PERFORM assert_money_actor(p_actor_id);
  IF p_amount IS NULL OR p_amount = 0 THEN RAISE EXCEPTION 'amount must be non-zero' USING ERRCODE = 'check_violation'; END IF;
  IF p_note IS NULL OR btrim(p_note) = '' THEN RAISE EXCEPTION 'note is required' USING ERRCODE = 'check_violation'; END IF;

  SELECT u.market_id, m.currency INTO v_market_id, v_currency
  FROM users u JOIN markets m ON m.id = u.market_id WHERE u.id = p_investor_id;
  IF v_market_id IS NULL THEN RAISE EXCEPTION 'investor has no market' USING ERRCODE = 'check_violation'; END IF;

  INSERT INTO investor_ledger_entries (investor_id, deal_id, statement_id, market_id, currency, entry_type, amount, note, created_by)
  VALUES (p_investor_id, p_deal_id, p_statement_id, v_market_id, v_currency, 'correction', p_amount, p_note, p_actor_id)
  RETURNING id INTO v_id;

  PERFORM investor_notify(p_investor_id, 'correction_posted', 'correction_posted:' || v_id::text, p_deal_id, p_statement_id, NULL,
    jsonb_build_object('amount', p_amount, 'currency', v_currency, 'note', p_note));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION post_investor_adjustment(UUID, NUMERIC, TEXT, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_investor_adjustment(UUID, NUMERIC, TEXT, UUID, UUID, UUID) TO service_role;

-- ------------------------------------------------------------
-- close_investor_deal
--  phase (i)  early exit: p_exit_date sets end_date + status matured
--  phase (ii) final statement (jsonb, kind='final'): insert via the same
--             path as commit, post principal_return, status closed.
-- Both may be passed at once.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION close_investor_deal(
  p_deal_id UUID, p_actor_id UUID, p_reason TEXT,
  p_exit_date DATE DEFAULT NULL, p_final_statement JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d           investor_deals%ROWTYPE;
  v_capital   NUMERIC(14,3);
  v_res       JSONB := '{}'::jsonb;
  v_commit    JSONB;
  v_stmt_id   UUID;
BEGIN
  PERFORM assert_money_actor(p_actor_id);
  SELECT * INTO d FROM investor_deals WHERE id = p_deal_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'deal not found' USING ERRCODE = 'no_data_found'; END IF;
  IF d.status = 'closed' THEN RAISE EXCEPTION 'DEAL_CLOSED' USING ERRCODE = 'check_violation'; END IF;
  IF p_reason NOT IN ('maturity', 'early_exit') THEN RAISE EXCEPTION 'reason must be maturity or early_exit' USING ERRCODE = 'check_violation'; END IF;

  IF p_exit_date IS NOT NULL THEN
    IF p_exit_date <= d.start_date THEN RAISE EXCEPTION 'exit_date must be after start_date' USING ERRCODE = 'check_violation'; END IF;
    IF EXISTS (SELECT 1 FROM investor_deal_statements WHERE deal_id = d.id AND period_end > p_exit_date) THEN
      RAISE EXCEPTION 'EXIT_BEFORE_SETTLED' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE investor_deals SET end_date = p_exit_date, status = 'matured' WHERE id = d.id;
    d.end_date := p_exit_date; d.status := 'matured';
    v_res := v_res || jsonb_build_object('end_date', p_exit_date, 'status', 'matured');
  END IF;

  IF p_final_statement IS NOT NULL THEN
    v_commit := commit_investor_settlements(jsonb_build_array(p_final_statement || jsonb_build_object('deal_id', d.id, 'kind', 'final')), p_actor_id);
    v_stmt_id := (v_commit->0->>'statement_id')::uuid;

    SELECT capital_amount INTO v_capital FROM investor_deal_terms
    WHERE deal_id = d.id AND effective_from <= d.end_date ORDER BY effective_from DESC LIMIT 1;

    IF COALESCE(v_capital, 0) > 0 AND NOT EXISTS (
      SELECT 1 FROM investor_ledger_entries WHERE deal_id = d.id AND entry_type = 'principal_return'
    ) THEN
      INSERT INTO investor_ledger_entries (investor_id, deal_id, statement_id, market_id, currency, entry_type, amount, note, created_by)
      VALUES (d.investor_id, d.id, v_stmt_id, d.market_id, d.currency, 'principal_return', v_capital,
              format('Capital returned — %s', p_reason), p_actor_id);
    END IF;

    UPDATE investor_deals
       SET status = 'closed', close_reason = p_reason, closed_at = now(), closed_by = p_actor_id, final_statement_id = v_stmt_id
     WHERE id = d.id;

    PERFORM investor_notify(d.investor_id, 'deal_closed', 'deal_closed:' || d.id::text, d.id, v_stmt_id, NULL,
      jsonb_build_object('reason', p_reason, 'capital_returned', COALESCE(v_capital, 0), 'currency', d.currency, 'end_date', d.end_date));

    v_res := v_res || jsonb_build_object('status', 'closed', 'statement_id', v_stmt_id, 'capital_returned', COALESCE(v_capital, 0), 'commit', v_commit);
  END IF;

  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION close_investor_deal(UUID, UUID, TEXT, DATE, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_investor_deal(UUID, UUID, TEXT, DATE, JSONB) TO service_role;

-- ------------------------------------------------------------
-- mark_investor_notifications_read (investor; route passes session id)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_investor_notifications_read(p_investor_id UUID, p_ids UUID[] DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE investor_notifications
     SET read_at = now()
   WHERE investor_id = p_investor_id AND read_at IS NULL
     AND (p_ids IS NULL OR id = ANY(p_ids));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION mark_investor_notifications_read(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_investor_notifications_read(UUID, UUID[]) TO service_role;
