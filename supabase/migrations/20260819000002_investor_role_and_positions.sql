-- ============================================================
-- 20260819000002_investor_role_and_positions.sql
-- Investor role + capital ledger + settlement/payout ledger.
--
-- MODEL
--   Capital-weighted per product. An investor's share of a product's net profit
--   in a period = their active capital in that product / total capital in that
--   product (house capital included). Positions carry effective_from/to, so a
--   restock funded by the business dilutes automatically and a partial exit is
--   just an end-dated row. House capital is an investment_positions row with
--   investor_id IS NULL.
--
--   The investor shares NET profit: revenue - COGS - delivery - returns -
--   packing - ad spend - processing.
--
-- THE NON-NEGOTIABLE RULE
--   A settlement SNAPSHOTS its inputs. It never recomputes from a live join.
--   Today's P&L recomputes from order_history joined against *current*
--   products.unit_cogs and *current* carriers.delivery_fee — fine for a
--   dashboard, fatal for a payout, because a late return or an edited cost
--   silently rewrites a period already paid out. Every investor_statements row
--   therefore stores both the computed figures AND the cost inputs used
--   (cost_inputs JSONB). Late-arriving returns become a correction line on the
--   NEXT period, never a retroactive edit.
--
-- SECURITY
--   Investors are external. Every policy here is an explicit allow-list scoped
--   to `investor_id = auth.uid()`. They are deliberately granted NO policy on
--   orders / order_history / products / users / ad_spend — the portal reads
--   server-computed endpoints and the daily rollup only.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Extend users.role CHECK constraint with 'investor'
--
-- NOTE — deliberately NOT the lookup pattern from
-- 20260421_warehouse_schema.sql. That migration does:
--
--     SELECT conname INTO cname FROM pg_constraint
--     WHERE conrelid='users'::regclass AND contype='c'
--       AND pg_get_constraintdef(oid) ILIKE '%role%IN%';
--
-- TWO constraints match that pattern, because Postgres renders
-- `role IN (...)` as `role = ANY (ARRAY['super_admin'::text, ...])` and the
-- literal 'super_adMIN' satisfies the trailing %IN%:
--     users_role_check        CHECK (role = ANY (ARRAY['super_admin', ...]))
--     chk_users_role_market   CHECK ((role = 'super_admin' AND market_id IS NULL) OR ...)
--
-- `SELECT ... INTO` with multiple matches takes an arbitrary row, so that
-- migration can drop chk_users_role_market instead, then fail on
-- ADD CONSTRAINT users_role_check ("already exists") — leaving the market
-- pairing invariant permanently dropped. Verified by replaying all migrations
-- against a clean Postgres 14.
--
-- This targets the role-VALUES constraint precisely and loops, so multiple
-- matches are all handled rather than one picked at random.
-- ------------------------------------------------------------
DO $$
DECLARE
  cname TEXT;
BEGIN
  FOR cname IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
      -- exclude the role/market pairing constraint and the unrelated
      -- deactivation_reason check
      AND pg_get_constraintdef(oid) NOT ILIKE '%market_id%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%deactivation_reason%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin', 'market_manager', 'agent', 'warehouse_agent', 'investor'));

-- Restore chk_users_role_market if the bug above already destroyed it.
-- Investors are market-scoped (one market, one currency, no FX), so the
-- original rule needs no change — only reinstating.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::regclass AND conname = 'chk_users_role_market'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT chk_users_role_market CHECK (
      (role = 'super_admin' AND market_id IS NULL) OR
      (role != 'super_admin' AND market_id IS NOT NULL)
    );
    RAISE NOTICE 'chk_users_role_market was missing and has been restored';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. investors — profile data beyond the users row
-- ------------------------------------------------------------
CREATE TABLE investors (
  id              UUID          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  legal_name      TEXT          NOT NULL,
  payout_method   TEXT          NOT NULL DEFAULT 'bank_transfer'
                                CHECK (payout_method IN ('bank_transfer', 'cash', 'wallet')),
  payout_details  JSONB,
  reserve_pct     NUMERIC(5,2)  NOT NULL DEFAULT 10.00
                                CHECK (reserve_pct >= 0 AND reserve_pct <= 100),
  notes           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON COLUMN investors.reserve_pct IS
  'Share of each settlement held back for late-arriving returns before it becomes withdrawable.';

CREATE TRIGGER trg_investors_updated_at
  BEFORE UPDATE ON investors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 3. investment_positions — the capital ledger
--    investor_id IS NULL  =>  house (business) capital
-- ------------------------------------------------------------
CREATE TABLE investment_positions (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id     UUID          REFERENCES investors(id) ON DELETE RESTRICT,
  product_id      UUID          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  market_id       UUID          NOT NULL REFERENCES markets(id),
  amount          NUMERIC(12,3) NOT NULL CHECK (amount > 0),
  effective_from  DATE          NOT NULL,
  effective_to    DATE,
  status          TEXT          NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'closed')),
  note            TEXT,
  created_by      UUID          NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_position_period CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

COMMENT ON COLUMN investment_positions.investor_id IS
  'NULL means house capital. Keeps the pro-rata denominator honest and time-varying, so a restock funded by the business dilutes investors correctly.';

CREATE INDEX idx_positions_product_period
  ON investment_positions (product_id, effective_from, effective_to);
CREATE INDEX idx_positions_investor
  ON investment_positions (investor_id) WHERE investor_id IS NOT NULL;
CREATE INDEX idx_positions_market ON investment_positions (market_id);

CREATE TRIGGER trg_positions_updated_at
  BEFORE UPDATE ON investment_positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 4. investor_statements — the immutable per-period snapshot
-- ------------------------------------------------------------
CREATE TABLE investor_statements (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id           UUID          NOT NULL REFERENCES investors(id) ON DELETE RESTRICT,
  product_id            UUID          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  market_id             UUID          NOT NULL REFERENCES markets(id),
  period_start          DATE          NOT NULL,
  period_end            DATE          NOT NULL,

  -- Snapshotted waterfall (NOT recomputed on read)
  revenue               NUMERIC(14,3) NOT NULL DEFAULT 0,
  cogs                  NUMERIC(14,3) NOT NULL DEFAULT 0,
  delivery_cost         NUMERIC(14,3) NOT NULL DEFAULT 0,
  return_cost           NUMERIC(14,3) NOT NULL DEFAULT 0,
  packing_cost          NUMERIC(14,3) NOT NULL DEFAULT 0,
  ad_spend_direct       NUMERIC(14,3) NOT NULL DEFAULT 0,
  ad_spend_allocated    NUMERIC(14,3) NOT NULL DEFAULT 0,
  processing_cost       NUMERIC(14,3) NOT NULL DEFAULT 0,
  net_profit            NUMERIC(14,3) NOT NULL DEFAULT 0,

  -- Operational counts, so the statement stands alone
  delivered_count       INTEGER       NOT NULL DEFAULT 0,
  returned_count        INTEGER       NOT NULL DEFAULT 0,
  confirmed_count       INTEGER       NOT NULL DEFAULT 0,

  -- Allocation
  investor_capital      NUMERIC(12,3) NOT NULL,
  total_capital         NUMERIC(12,3) NOT NULL,
  share_pct             NUMERIC(7,4)  NOT NULL,
  investor_share        NUMERIC(14,3) NOT NULL,
  reserve_held          NUMERIC(14,3) NOT NULL DEFAULT 0,
  carried_loss_applied  NUMERIC(14,3) NOT NULL DEFAULT 0,

  -- Every cost input used, so the figures can be audited years later even after
  -- unit_cogs / carrier fees change.
  cost_inputs           JSONB         NOT NULL,

  status                TEXT          NOT NULL DEFAULT 'draft'
                                      CHECK (status IN ('draft', 'settled', 'paid')),
  settled_at            TIMESTAMPTZ,
  settled_by            UUID          REFERENCES users(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_statement_period CHECK (period_end >= period_start),
  -- Makes settlement idempotent: re-running a period cannot double-pay.
  CONSTRAINT uq_statement_period
    UNIQUE (investor_id, product_id, period_start, period_end)
);

CREATE INDEX idx_statements_investor_period
  ON investor_statements (investor_id, period_start DESC);
CREATE INDEX idx_statements_status ON investor_statements (status);

CREATE TRIGGER trg_statements_updated_at
  BEFORE UPDATE ON investor_statements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 5. investor_ledger — APPEND-ONLY money movements
--    Balance is always SUM(amount) by type. Same house style as order_history
--    and inventory_log, but enforced by trigger rather than convention.
-- ------------------------------------------------------------
CREATE TABLE investor_ledger (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id   UUID          NOT NULL REFERENCES investors(id) ON DELETE RESTRICT,
  statement_id  UUID          REFERENCES investor_statements(id) ON DELETE RESTRICT,
  product_id    UUID          REFERENCES products(id) ON DELETE SET NULL,
  market_id     UUID          NOT NULL REFERENCES markets(id),
  entry_type    TEXT          NOT NULL CHECK (entry_type IN (
                                'accrual',
                                'settlement',
                                'reserve_hold',
                                'reserve_release',
                                'withdrawal',
                                'correction',
                                'principal_return'
                              )),
  amount        NUMERIC(14,3) NOT NULL,   -- signed
  note          TEXT,
  created_by    UUID          REFERENCES users(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
  -- NO updated_at — append-only
);

CREATE INDEX idx_ledger_investor_created
  ON investor_ledger (investor_id, created_at DESC);
CREATE INDEX idx_ledger_statement
  ON investor_ledger (statement_id) WHERE statement_id IS NOT NULL;

CREATE OR REPLACE FUNCTION reject_investor_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'investor_ledger is append-only: % is not permitted', TG_OP;
END;
$$;

CREATE TRIGGER trg_investor_ledger_append_only
  BEFORE UPDATE OR DELETE ON investor_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_investor_ledger_mutation();

-- ------------------------------------------------------------
-- 6. withdrawal_requests
-- ------------------------------------------------------------
CREATE TABLE withdrawal_requests (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id       UUID          NOT NULL REFERENCES investors(id) ON DELETE RESTRICT,
  market_id         UUID          NOT NULL REFERENCES markets(id),
  amount            NUMERIC(14,3) NOT NULL CHECK (amount > 0),
  status            TEXT          NOT NULL DEFAULT 'requested'
                                  CHECK (status IN ('requested', 'approved', 'rejected', 'paid')),
  requested_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ,
  decided_by        UUID          REFERENCES users(id),
  paid_at           TIMESTAMPTZ,
  payout_reference  TEXT,
  note              TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_withdrawals_investor
  ON withdrawal_requests (investor_id, requested_at DESC);
CREATE INDEX idx_withdrawals_status ON withdrawal_requests (status);

CREATE TRIGGER trg_withdrawals_updated_at
  BEFORE UPDATE ON withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- RLS
-- Investors read ONLY their own rows and never write anything except a
-- withdrawal request. super_admin manages everything. market_manager gets read
-- access scoped to their market so they can answer questions, but no writes —
-- money movement is super_admin only.
-- ============================================================

ALTER TABLE investors            ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_statements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_ledger      ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests  ENABLE ROW LEVEL SECURITY;

-- --- investors -------------------------------------------------------------
CREATE POLICY investors_select_self
  ON investors FOR SELECT
  USING ((SELECT get_user_role()) = 'investor' AND id = auth.uid());

CREATE POLICY investors_select_super_admin
  ON investors FOR SELECT
  USING ((SELECT get_user_role()) = 'super_admin');

CREATE POLICY investors_write_super_admin
  ON investors FOR ALL
  USING ((SELECT get_user_role()) = 'super_admin')
  WITH CHECK ((SELECT get_user_role()) = 'super_admin');

-- --- investment_positions --------------------------------------------------
-- Note: an investor sees only their OWN positions. House rows (investor_id
-- NULL) and other investors' rows stay hidden; the pro-rata denominator is
-- computed server-side with the service-role client.
CREATE POLICY positions_select_self
  ON investment_positions FOR SELECT
  USING (
    (SELECT get_user_role()) = 'investor'
    AND investor_id = auth.uid()
  );

CREATE POLICY positions_select_manager
  ON investment_positions FOR SELECT
  USING (
    (SELECT get_user_role()) = 'market_manager'
    AND market_id = (SELECT get_user_market_id())
  );

CREATE POLICY positions_all_super_admin
  ON investment_positions FOR ALL
  USING ((SELECT get_user_role()) = 'super_admin')
  WITH CHECK ((SELECT get_user_role()) = 'super_admin');

-- --- investor_statements ---------------------------------------------------
-- Investors never see a draft: only settled/paid statements are theirs to read.
CREATE POLICY statements_select_self
  ON investor_statements FOR SELECT
  USING (
    (SELECT get_user_role()) = 'investor'
    AND investor_id = auth.uid()
    AND status <> 'draft'
  );

CREATE POLICY statements_select_manager
  ON investor_statements FOR SELECT
  USING (
    (SELECT get_user_role()) = 'market_manager'
    AND market_id = (SELECT get_user_market_id())
  );

CREATE POLICY statements_all_super_admin
  ON investor_statements FOR ALL
  USING ((SELECT get_user_role()) = 'super_admin')
  WITH CHECK ((SELECT get_user_role()) = 'super_admin');

-- --- investor_ledger (append-only) -----------------------------------------
CREATE POLICY ledger_select_self
  ON investor_ledger FOR SELECT
  USING (
    (SELECT get_user_role()) = 'investor'
    AND investor_id = auth.uid()
  );

CREATE POLICY ledger_select_manager
  ON investor_ledger FOR SELECT
  USING (
    (SELECT get_user_role()) = 'market_manager'
    AND market_id = (SELECT get_user_market_id())
  );

CREATE POLICY ledger_select_super_admin
  ON investor_ledger FOR SELECT
  USING ((SELECT get_user_role()) = 'super_admin');

-- INSERT only, and only super_admin. No UPDATE/DELETE policy exists at all,
-- which together with the append-only trigger makes the ledger immutable.
CREATE POLICY ledger_insert_super_admin
  ON investor_ledger FOR INSERT
  WITH CHECK ((SELECT get_user_role()) = 'super_admin');

-- --- withdrawal_requests ---------------------------------------------------
CREATE POLICY withdrawals_select_self
  ON withdrawal_requests FOR SELECT
  USING (
    (SELECT get_user_role()) = 'investor'
    AND investor_id = auth.uid()
  );

-- The only write an investor may perform anywhere in the schema.
CREATE POLICY withdrawals_insert_self
  ON withdrawal_requests FOR INSERT
  WITH CHECK (
    (SELECT get_user_role()) = 'investor'
    AND investor_id = auth.uid()
    AND status = 'requested'
  );

CREATE POLICY withdrawals_select_manager
  ON withdrawal_requests FOR SELECT
  USING (
    (SELECT get_user_role()) = 'market_manager'
    AND market_id = (SELECT get_user_market_id())
  );

CREATE POLICY withdrawals_all_super_admin
  ON withdrawal_requests FOR ALL
  USING ((SELECT get_user_role()) = 'super_admin')
  WITH CHECK ((SELECT get_user_role()) = 'super_admin');
