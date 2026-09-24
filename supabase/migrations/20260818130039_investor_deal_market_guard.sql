-- ============================================================
-- 20260920000006_investor_deal_market_guard.sql
-- An investor is a single-market user (chk_users_role_market) and every money
-- row carries one currency. Nothing enforced that a deal's product belonged to
-- the investor's market, so a TN investor could hold an LY deal and the
-- withdrawal/correction RPCs (which derive currency from the user's market)
-- would stamp TND on LYD money. Enforce it where deals are born.
-- ============================================================

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
  v_inv_mkt   UUID;
  v_share     NUMERIC(7,4)  := (p->>'share_pct')::numeric;
  v_capital   NUMERIC(14,3) := COALESCE((p->>'capital_amount')::numeric, 0);
  v_start     DATE := (p->>'start_date')::date;
  v_end       DATE := (p->>'end_date')::date;
  v_cadence   TEXT := COALESCE(p->>'payout_cadence', 'quarterly');
BEGIN
  PERFORM assert_money_actor(p_actor_id);

  SELECT u.market_id INTO v_inv_mkt
  FROM investors i JOIN users u ON u.id = i.id
  WHERE i.id = (p->>'investor_id')::uuid;
  IF v_inv_mkt IS NULL THEN
    RAISE EXCEPTION 'investor profile not found' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT pr.market_id, m.currency INTO v_market_id, v_currency
  FROM products pr JOIN markets m ON m.id = pr.market_id
  WHERE pr.id = (p->>'product_id')::uuid AND pr.deleted_at IS NULL;
  IF v_market_id IS NULL THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_market_id <> v_inv_mkt THEN
    RAISE EXCEPTION 'MARKET_MISMATCH' USING ERRCODE = 'check_violation',
      DETAIL = 'the product must belong to the investor''s market (one currency per investor)';
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
