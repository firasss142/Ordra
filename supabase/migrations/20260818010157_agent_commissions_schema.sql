-- ============================================================
-- 20260918010001_agent_commissions_schema.sql
-- Agent commissions — storage.
--
-- WHY: confirmation agents are paid a flat commission per order they
-- confirmed that the carrier later marks DELIVERED. Until now that was tracked
-- outside the OMS. Two tables:
--
--   • agent_commission_rates — effective-dated rules. One row per (market,
--     agent-or-NULL) per validity window; NULL agent_id = the market default.
--     `enabled=false` is a dated PAUSE (the on/off switch), never a deletion.
--     Rows are closed by a new row (effective_to = next effective_from, half-
--     open [from, to)), never edited — same posture as agent_targets.
--   • agent_commission_ledger — APPEND-ONLY signed money movements, enforced
--     by trigger exactly like investor_ledger. Balance is never stored: it is
--     always SUM(amount) per agent. accrual +, reversal −, payout −,
--     adjustment ±. One accrual per order (partial unique index) makes the
--     accrual sweep idempotent.
--
-- WHAT DOES NOT LIVE HERE: judgement. Rates resolve and money moves only via
-- the SECURITY DEFINER RPCs in 20260918010002; RLS below is read-only for the
-- market's managers and super_admin. Agents read through get_my_commissions()
-- and never touch these tables directly (same containment as investors).
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_commission_rates (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       UUID          NOT NULL REFERENCES markets(id),
  agent_id        UUID          REFERENCES users(id) ON DELETE CASCADE,   -- NULL = market default
  enabled         BOOLEAN       NOT NULL DEFAULT true,
  amount          NUMERIC(10,3) NOT NULL DEFAULT 0 CHECK (amount >= 0),    -- per delivered order, market currency
  effective_from  DATE          NOT NULL,
  effective_to    DATE,                                                     -- half-open: applies while day < effective_to
  set_by          UUID          REFERENCES users(id),
  note            TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT chk_commission_rate_window CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS agent_commission_rates_lookup_idx
  ON agent_commission_rates (market_id, agent_id, effective_from DESC);

COMMENT ON TABLE agent_commission_rates IS
  'Effective-dated commission rules. agent_id NULL = market default. enabled=false = paused from effective_from. Closed by a new row (effective_to = next effective_from), never edited. Written only by set_agent_commission_rate().';

CREATE TABLE IF NOT EXISTS agent_commission_ledger (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id     UUID          NOT NULL REFERENCES markets(id),
  agent_id      UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id      UUID          REFERENCES orders(id) ON DELETE SET NULL,     -- accrual / reversal only
  entry_type    TEXT          NOT NULL CHECK (entry_type IN ('accrual', 'reversal', 'payout', 'adjustment')),
  amount        NUMERIC(12,3) NOT NULL,                                     -- signed
  rate_amount   NUMERIC(10,3),                                              -- snapshot on accrual / reversal
  effective_at  TIMESTAMPTZ   NOT NULL,                                     -- delivered event for accruals; PAYMENT DATE for payouts
  method        TEXT          CHECK (method IS NULL OR method IN ('cash', 'bank_transfer', 'wallet')),
  reference     TEXT,
  note          TEXT,
  created_by    UUID          REFERENCES users(id),                         -- NULL = system (accrual sweep)
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
  -- NO updated_at — append-only
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_commission_ledger_one_per_order_idx
  ON agent_commission_ledger (order_id, entry_type) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_commission_ledger_agent_idx
  ON agent_commission_ledger (agent_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS agent_commission_ledger_market_idx
  ON agent_commission_ledger (market_id, effective_at DESC);

COMMENT ON TABLE agent_commission_ledger IS
  'APPEND-ONLY signed commission movements per agent. Balance = SUM(amount). accrual +, reversal −, payout −, adjustment ±. Never UPDATE/DELETE — repair with a compensating adjustment.';

CREATE OR REPLACE FUNCTION reject_agent_commission_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'agent_commission_ledger is append-only: % is not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_commission_ledger_append_only ON agent_commission_ledger;
CREATE TRIGGER trg_agent_commission_ledger_append_only
  BEFORE UPDATE OR DELETE ON agent_commission_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_agent_commission_ledger_mutation();

-- ------------------------------------------------------------
-- RLS — read for the market's managers and super_admin. No write policies:
-- every write goes through a SECURITY DEFINER RPC that re-checks the role.
-- No agent policy at all: agents read via get_my_commissions().
-- ------------------------------------------------------------
ALTER TABLE agent_commission_rates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_commission_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_commission_rates_select ON agent_commission_rates;
CREATE POLICY agent_commission_rates_select ON agent_commission_rates FOR SELECT
  USING (
    (SELECT get_user_role()) = 'super_admin'
    OR ((SELECT get_user_role()) = 'market_manager' AND market_id = (SELECT get_user_market_id()))
  );

DROP POLICY IF EXISTS agent_commission_ledger_select ON agent_commission_ledger;
CREATE POLICY agent_commission_ledger_select ON agent_commission_ledger FOR SELECT
  USING (
    (SELECT get_user_role()) = 'super_admin'
    OR ((SELECT get_user_role()) = 'market_manager' AND market_id = (SELECT get_user_market_id()))
  );
