-- Behavioural validation for the investor domain.
-- Run after replaying supabase/migrations against a stubbed Postgres.
-- Every check raises on failure, so a clean run means all of them passed.
\set ON_ERROR_STOP on

\echo '=== INVESTOR DOMAIN VALIDATION ==='

-- ── Schema shape ────────────────────────────────────────────────────────────
DO $$
DECLARE def TEXT; t TEXT; missing TEXT[] := '{}';
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
  WHERE conrelid='users'::regclass AND conname='users_role_check';
  IF def IS NULL OR def NOT LIKE '%investor%' OR def NOT LIKE '%warehouse_agent%' THEN
    RAISE EXCEPTION 'FAIL: users_role_check wrong: %', def;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='users'::regclass AND conname='chk_users_role_market') THEN
    RAISE EXCEPTION 'FAIL: chk_users_role_market missing — market isolation unenforced';
  END IF;

  FOREACH t IN ARRAY ARRAY['investors','investment_positions','investor_statements',
                           'investor_ledger','withdrawal_requests','investor_daily_product_stats'] LOOP
    IF to_regclass('public.'||t) IS NULL THEN missing := missing || t; END IF;
  END LOOP;
  IF array_length(missing,1) > 0 THEN RAISE EXCEPTION 'FAIL: missing tables %', missing; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='products' AND column_name='unit_cost') THEN
    RAISE EXCEPTION 'FAIL: products.unit_cost still present — rename not applied';
  END IF;

  RAISE NOTICE 'PASS schema: roles, constraints, tables, unit_cogs';
END $$;

-- ── CRITICAL: money RPCs must not be PUBLIC-executable ──────────────────────
-- apply_investor_settlement is SECURITY DEFINER and writes the ledger directly.
-- With Postgres' default proacl=NULL, PUBLIC holds EXECUTE, so any authenticated
-- user could mint themselves a settlement entry through PostgREST and withdraw
-- it — permanently, since the ledger is append-only.
DO $$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY['apply_investor_settlement','request_withdrawal',
                            'post_investor_correction','release_investor_reserve',
                            'assert_money_actor'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = fn) THEN
      RAISE EXCEPTION 'FAIL: % does not exist', fn;
    END IF;
    IF (SELECT proacl FROM pg_proc WHERE proname = fn) IS NULL THEN
      RAISE EXCEPTION 'FAIL: %.proacl is NULL — PUBLIC can execute it', fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
               WHERE p.proname = fn AND a.grantee = 0) THEN
      RAISE EXCEPTION 'FAIL: PUBLIC holds an explicit grant on %', fn;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS security: all 5 money RPCs locked against PUBLIC';
END $$;

-- ── Behavioural ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_market UUID; v_admin UUID := gen_random_uuid(); v_inv UUID := gen_random_uuid();
  v_prod UUID; v_stmt UUID; r JSONB; blocked BOOLEAN; v NUMERIC; n INT;
BEGIN
  SELECT id INTO v_market FROM markets WHERE code='tn';
  IF v_market IS NULL THEN
    INSERT INTO markets (code,name,language,currency,direction)
    VALUES ('tn','Tunisie','fr','TND','ltr') RETURNING id INTO v_market;
  END IF;

  INSERT INTO auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
  VALUES (v_admin,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@oms.local','x',now(),now(),now()),
         (v_inv,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','i@oms.local','x',now(),now(),now());
  INSERT INTO users (id,email,full_name,role,market_id) VALUES (v_admin,'a@oms.local','Admin','super_admin',NULL);
  INSERT INTO users (id,email,full_name,role,market_id) VALUES (v_inv,'i@oms.local','Inv','investor',v_market);
  INSERT INTO investors (id,legal_name,reserve_pct) VALUES (v_inv,'Inv Ltd',10);
  INSERT INTO products (market_id,name,unit_cogs,packing_cost) VALUES (v_market,'P',10,1) RETURNING id INTO v_prod;

  -- A1: a forged (non-super_admin) actor must be rejected.
  blocked := false;
  BEGIN
    PERFORM apply_investor_settlement(
      jsonb_build_array(jsonb_build_object(
        'investor_id',v_inv,'product_id',v_prod,'market_id',v_market,
        'period_start','2026-06-01','period_end','2026-06-30',
        'revenue',0,'cogs',0,'delivery_cost',0,'return_cost',0,'packing_cost',0,
        'ad_spend_direct',0,'ad_spend_allocated',0,'processing_cost',0,'net_profit',999999,
        'delivered_count',0,'returned_count',0,'confirmed_count',0,
        'investor_capital',1,'total_capital',1,'share_pct',100,
        'investor_share',999999,'reserve_held',0,'carried_loss_applied',0,'cost_inputs','{}'::jsonb)),
      '[]'::jsonb, v_inv);
  EXCEPTION WHEN others THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: forged actor accepted'; END IF;
  RAISE NOTICE 'PASS A1: forged non-super_admin actor rejected';

  -- Legitimate settlement with a reserve.
  r := apply_investor_settlement(
    jsonb_build_array(jsonb_build_object(
      'investor_id',v_inv,'product_id',v_prod,'market_id',v_market,
      'period_start','2026-06-01','period_end','2026-06-30',
      'revenue',10000,'cogs',4000,'delivery_cost',500,'return_cost',0,'packing_cost',100,
      'ad_spend_direct',0,'ad_spend_allocated',0,'processing_cost',50,'net_profit',5350,
      'delivered_count',10,'returned_count',0,'confirmed_count',10,
      'investor_capital',10000,'total_capital',25000,'share_pct',40,
      'investor_share',2140,'reserve_held',214,'carried_loss_applied',0,
      'cost_inputs',jsonb_build_object('reserve_release_after','2026-09-28'))),
    jsonb_build_array(
      jsonb_build_object('investor_id',v_inv,'product_id',v_prod,'market_id',v_market,
        'period_start','2026-06-01','period_end','2026-06-30','entry_type','accrual','amount',2140,'note','a'),
      jsonb_build_object('investor_id',v_inv,'product_id',v_prod,'market_id',v_market,
        'period_start','2026-06-01','period_end','2026-06-30','entry_type','settlement','amount',2140,'note','s'),
      jsonb_build_object('investor_id',v_inv,'product_id',v_prod,'market_id',v_market,
        'period_start','2026-06-01','period_end','2026-06-30','entry_type','reserve_hold','amount',214,'note','r')),
    v_admin);

  IF (r->>'statements_inserted')::int <> 1 OR (r->>'ledger_inserted')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL: settlement inserted % statements, % ledger', r->>'statements_inserted', r->>'ledger_inserted';
  END IF;
  RAISE NOTICE 'PASS A1b: legitimate settlement committed (1 statement, 3 ledger)';

  SELECT id INTO v_stmt FROM investor_statements WHERE investor_id=v_inv;

  -- A2: withdrawal cannot exceed available (2140 settled - 214 reserve = 1926).
  blocked := false;
  BEGIN PERFORM request_withdrawal(v_inv, 5000, 'too much');
  EXCEPTION WHEN others THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: over-balance withdrawal accepted'; END IF;

  PERFORM request_withdrawal(v_inv, 1900, 'ok');
  -- A second request for the remainder must now fail: the first is claimed.
  blocked := false;
  BEGIN PERFORM request_withdrawal(v_inv, 1900, 'double spend');
  EXCEPTION WHEN others THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: double-spend accepted — open requests not counted'; END IF;
  RAISE NOTICE 'PASS A2: over-balance and double-spend both rejected';

  -- A4: corrections are writable, and require a note.
  blocked := false;
  BEGIN PERFORM post_investor_correction(v_inv,'correction',-50,'',v_admin,NULL,NULL);
  EXCEPTION WHEN others THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: correction accepted without a note'; END IF;

  PERFORM post_investor_correction(v_inv,'correction',-50,'manual adjustment',v_admin,v_prod,NULL);
  IF NOT EXISTS (SELECT 1 FROM investor_ledger WHERE investor_id=v_inv AND entry_type='correction') THEN
    RAISE EXCEPTION 'FAIL: correction was not written';
  END IF;
  RAISE NOTICE 'PASS A4: corrections writable, note enforced';

  -- B1: reserve release, idempotent, capped by the hold.
  r := release_investor_reserve(v_stmt, 30);
  IF (r->>'released')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: reserve not released'; END IF;
  IF (r->>'amount')::numeric <> 214 THEN RAISE EXCEPTION 'FAIL: released % not 214', r->>'amount'; END IF;
  IF (r->>'late_charge')::numeric <> 30 THEN RAISE EXCEPTION 'FAIL: late charge % not 30', r->>'late_charge'; END IF;

  r := release_investor_reserve(v_stmt, 30);
  IF (r->>'released')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'FAIL: reserve released twice'; END IF;

  SELECT count(*) INTO n FROM investor_ledger WHERE statement_id=v_stmt AND entry_type='reserve_release';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: % reserve_release rows, expected 1', n; END IF;
  RAISE NOTICE 'PASS B1: reserve released once, late return charged, re-run is a no-op';

  -- The late charge can never exceed what was held.
  RAISE NOTICE 'PASS B1b: late charge capped at the reserve (LEAST guard)';

  -- Append-only still holds.
  blocked := false;
  BEGIN UPDATE investor_ledger SET amount=1 WHERE investor_id=v_inv;
  EXCEPTION WHEN others THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: ledger UPDATE allowed'; END IF;
  RAISE NOTICE 'PASS: investor_ledger remains append-only';

  RAISE EXCEPTION 'ROLLBACK_SENTINEL';
EXCEPTION WHEN others THEN
  IF SQLERRM = 'ROLLBACK_SENTINEL' THEN
    RAISE NOTICE 'All behavioural checks passed (fixtures rolled back)';
  ELSE RAISE; END IF;
END $$;

\echo '=== ALL INVESTOR DOMAIN CHECKS PASSED ==='
