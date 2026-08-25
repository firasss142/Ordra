-- ============================================================
-- 20260920000001_investor_deals.sql
-- Investor domain v2 — DEALS.
--
-- A deal is one investor × one product × terms. The terms are a FIXED
-- NEGOTIATED SHARE of the product's net profit (no capital ÷ total capital,
-- no house position), an informational capital amount returned at maturity,
-- a fixed term, and a payout cadence. Terms are VERSIONED by effective date so
-- an amendment never rewrites a settled period.
--
-- The legacy `investment_positions` model stays in place until the money
-- migration (statements/ledger v2) replaces it; the two coexist read-only.
-- `investors` (profile) is reused as-is; `reserve_pct` becomes dead and is
-- dropped in the cleanup migration.
--
-- Also adds `carriers.investor_billing_mode`: the owner decided delivery and
-- return cost is the REAL BILLED amount only (darb_shipments.billed_shipping_
-- amount). Carriers with no billing feed would leave orders "pending" forever;
-- this per-carrier flag lets the owner opt a carrier into "flat fee is final"
-- deliberately. Default is billed_only, so the decided rule holds unless
-- someone flips it on purpose.
-- ============================================================

-- ------------------------------------------------------------
-- carriers.investor_billing_mode
-- ------------------------------------------------------------
ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS investor_billing_mode TEXT NOT NULL DEFAULT 'billed_only'
  CHECK (investor_billing_mode IN ('billed_only', 'flat_is_final'));

COMMENT ON COLUMN carriers.investor_billing_mode IS
  'Investor P&L cost basis for this carrier: billed_only = only darb_shipments.billed_shipping_amount counts (unbilled outcomes stay pending); flat_is_final = carriers.delivery_fee/return_fee are accepted as final when no billed amount exists.';

-- ------------------------------------------------------------
-- investor_deals
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_deals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id        UUID NOT NULL REFERENCES investors(id) ON DELETE RESTRICT,
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  market_id          UUID NOT NULL REFERENCES markets(id),
  currency           TEXT NOT NULL CHECK (currency IN ('TND', 'LYD')),
  label              TEXT,
  -- Cohort eligibility window (inclusive, market-local days). An order belongs
  -- to the deal iff its created_at local day is within [start_date, end_date].
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'matured', 'closed')),
  close_reason       TEXT CHECK (close_reason IN ('maturity', 'early_exit')),
  closed_at          TIMESTAMPTZ,
  closed_by          UUID REFERENCES users(id),
  final_statement_id UUID,            -- FK added by the money migration
  note               TEXT,
  created_by         UUID NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_deal_window CHECK (end_date > start_date),
  CONSTRAINT chk_deal_closed CHECK (
    status <> 'closed' OR (closed_at IS NOT NULL AND close_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS investor_deals_investor_idx ON investor_deals (investor_id);
CREATE INDEX IF NOT EXISTS investor_deals_product_idx  ON investor_deals (product_id, status);
CREATE INDEX IF NOT EXISTS investor_deals_market_idx   ON investor_deals (market_id);
CREATE INDEX IF NOT EXISTS investor_deals_status_idx   ON investor_deals (status, end_date);

DROP TRIGGER IF EXISTS trg_investor_deals_updated_at ON investor_deals;
CREATE TRIGGER trg_investor_deals_updated_at
  BEFORE UPDATE ON investor_deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE investor_deals IS
  'Investor v2: one investor × one product × terms. Fixed share % of net profit (see investor_deal_terms), fixed term, cohort membership by order-creation local day.';

-- ------------------------------------------------------------
-- investor_deal_terms — versioned, insert-only
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_deal_terms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         UUID NOT NULL REFERENCES investor_deals(id) ON DELETE RESTRICT,
  effective_from  DATE NOT NULL,
  share_pct       NUMERIC(7,4) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
  capital_amount  NUMERIC(14,3) NOT NULL CHECK (capital_amount >= 0),
  payout_cadence  TEXT NOT NULL DEFAULT 'quarterly'
                  CHECK (payout_cadence IN ('monthly', 'quarterly', 'semiannual', 'annual', 'at_maturity')),
  maturity_date   DATE NOT NULL,
  note            TEXT,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_deal_terms_effective UNIQUE (deal_id, effective_from)
);

CREATE INDEX IF NOT EXISTS investor_deal_terms_deal_idx ON investor_deal_terms (deal_id, effective_from);

-- Insert-only: a terms version is history. Amend by inserting a new row with a
-- later effective_from (enforced by the amend RPC in the money migration).
CREATE OR REPLACE FUNCTION reject_investor_deal_terms_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'investor_deal_terms is insert-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_investor_deal_terms_insert_only ON investor_deal_terms;
CREATE TRIGGER trg_investor_deal_terms_insert_only
  BEFORE UPDATE OR DELETE ON investor_deal_terms
  FOR EACH ROW EXECUTE FUNCTION reject_investor_deal_terms_mutation();

COMMENT ON TABLE investor_deal_terms IS
  'Versioned terms of a deal. Terms on day D = row with the greatest effective_from <= D. Insert-only.';

-- ------------------------------------------------------------
-- RLS — investors are external: NO policy on deals/terms (the portal is
-- server-computed under the service role, scoped by session user id).
-- Managers read their own market; super_admin reads all. Writes go through
-- SECURITY DEFINER RPCs (money migration) — no INSERT/UPDATE policies here.
-- ------------------------------------------------------------
ALTER TABLE investor_deals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_deal_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deals_select_manager ON investor_deals;
CREATE POLICY deals_select_manager ON investor_deals
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

DROP POLICY IF EXISTS deal_terms_select_manager ON investor_deal_terms;
CREATE POLICY deal_terms_select_manager ON investor_deal_terms
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM investor_deals d
      WHERE d.id = investor_deal_terms.deal_id
        AND (
          get_user_role() = 'super_admin'
          OR (get_user_role() = 'market_manager' AND d.market_id = get_user_market_id())
        )
    )
  );
