-- ============================================================
-- 20260920000002_investor_facts.sql
-- Investor domain v2 — FACTS.
--
-- Facts are per PRODUCT and shared by every deal on that product; a deal's
-- share % is applied at read time. Two tables:
--
--   investor_order_facts          one row per (order, product) — the truth
--   investor_daily_product_facts  one row per (product, local day) — projection
--
-- plus investor_deal_snapshots (the portal's fast read, rewritten every rollup)
-- and investor_rollup_runs (observability + advisory-lock claim).
--
-- Rules encoded here (owner decisions, 2026-08-18):
--   * revenue realized on delivered only; a return charges return cost only and
--     reverses revenue/COGS only if a prior delivered event exists;
--   * delivery/return cost = REAL BILLED amount; unbilled outcome → is_final=false
--     (pending_reason='awaiting_billing') and money stays 0;
--   * Dexpress-carried orders are excluded entirely (excluded_reason='dexpress'),
--     row kept so the count is printable;
--   * unit-cost snapshots freeze at first observed outcome so editing
--     products.unit_cogs later never rewrites history (trigger below);
--   * money in integer-exact NUMERIC(14,3) millimes.
-- ============================================================

-- ------------------------------------------------------------
-- investor_order_facts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_order_facts (
  order_id                 UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id               UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  market_id                UUID NOT NULL REFERENCES markets(id),
  carrier_id               UUID,
  carrier_code             TEXT,
  order_created_at         TIMESTAMPTZ NOT NULL,
  cohort_date              DATE NOT NULL,           -- market-local day of orders.created_at
  uploaded_at              TIMESTAMPTZ,
  delivered_at             TIMESTAMPTZ,
  returned_at              TIMESTAMPTZ,
  uploaded_date            DATE,
  delivered_date           DATE,
  returned_date            DATE,
  current_status           TEXT NOT NULL,
  stage                    TEXT NOT NULL
                           CHECK (stage IN ('received', 'not_shipped', 'in_flight', 'delivered', 'returned')),
  outcome                  TEXT CHECK (outcome IN ('delivered', 'returned')),
  reversal_applies         BOOLEAN NOT NULL DEFAULT false,
  quantity                 INTEGER NOT NULL DEFAULT 1,
  line_total               NUMERIC(12,3) NOT NULL DEFAULT 0,
  line_share               NUMERIC(9,8) NOT NULL DEFAULT 1,
  product_count            INTEGER NOT NULL DEFAULT 1,
  -- snapshots (frozen at first outcome; trigger preserves)
  unit_cogs_snapshot       NUMERIC(10,3),
  packing_cost_snapshot    NUMERIC(10,3),
  processing_cost_snapshot NUMERIC(10,3),
  snapshot_at              TIMESTAMPTZ,
  -- money (this product's slice)
  revenue_gross            NUMERIC(12,3) NOT NULL DEFAULT 0,
  revenue                  NUMERIC(12,3) NOT NULL DEFAULT 0,
  cogs                     NUMERIC(12,3) NOT NULL DEFAULT 0,
  delivery_cost            NUMERIC(12,3) NOT NULL DEFAULT 0,
  return_cost              NUMERIC(12,3) NOT NULL DEFAULT 0,
  packing_cost             NUMERIC(12,3) NOT NULL DEFAULT 0,
  processing_cost          NUMERIC(12,3) NOT NULL DEFAULT 0,
  carrier_billed_amount    NUMERIC(12,3),
  cost_source              TEXT CHECK (cost_source IN ('billed', 'flat')),
  gross_profit             NUMERIC(12,3) NOT NULL DEFAULT 0,
  net_contribution         NUMERIC(12,3) NOT NULL DEFAULT 0,
  is_final                 BOOLEAN NOT NULL DEFAULT false,
  pending_reason           TEXT CHECK (pending_reason IN ('awaiting_billing')),
  excluded_reason          TEXT CHECK (excluded_reason IN ('dexpress', 'deleted', 'no_product')),
  expected_revenue         NUMERIC(12,3) NOT NULL DEFAULT 0,
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS iof_product_cohort_idx    ON investor_order_facts (product_id, cohort_date);
CREATE INDEX IF NOT EXISTS iof_product_delivered_idx ON investor_order_facts (product_id, delivered_date);
CREATE INDEX IF NOT EXISTS iof_product_returned_idx  ON investor_order_facts (product_id, returned_date);
CREATE INDEX IF NOT EXISTS iof_updated_idx           ON investor_order_facts (updated_at);
CREATE INDEX IF NOT EXISTS iof_pending_idx           ON investor_order_facts (product_id)
  WHERE outcome IS NOT NULL AND NOT is_final;

-- BEFORE UPDATE: keep first-observed snapshots; suppress no-op writes so
-- updated_at is an honest change watermark; stamp updated_at on real change.
CREATE OR REPLACE FUNCTION investor_order_facts_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.unit_cogs_snapshot       := COALESCE(OLD.unit_cogs_snapshot,       NEW.unit_cogs_snapshot);
  NEW.packing_cost_snapshot    := COALESCE(OLD.packing_cost_snapshot,    NEW.packing_cost_snapshot);
  NEW.processing_cost_snapshot := COALESCE(OLD.processing_cost_snapshot, NEW.processing_cost_snapshot);
  NEW.snapshot_at              := COALESCE(OLD.snapshot_at,              NEW.snapshot_at);

  -- Recompute money from the preserved snapshots when the loader sent fresh
  -- product costs but a snapshot already existed. The loader already does this
  -- when it can see the existing row; this is the belt to that suspender.
  IF NEW.outcome IS NOT NULL AND NEW.excluded_reason IS NULL AND NEW.is_final THEN
    IF NEW.outcome = 'delivered' THEN
      NEW.cogs := round(COALESCE(NEW.unit_cogs_snapshot, 0) * NEW.quantity, 3);
    END IF;
    NEW.packing_cost    := round(COALESCE(NEW.packing_cost_snapshot, 0)    * NEW.line_share, 3);
    NEW.processing_cost := round(COALESCE(NEW.processing_cost_snapshot, 0) * NEW.line_share, 3);
    NEW.gross_profit     := NEW.revenue - NEW.cogs - NEW.delivery_cost - NEW.return_cost;
    NEW.net_contribution := NEW.gross_profit - NEW.packing_cost - NEW.processing_cost;
  END IF;

  IF ROW(NEW.market_id, NEW.carrier_id, NEW.carrier_code, NEW.order_created_at, NEW.cohort_date,
         NEW.uploaded_at, NEW.delivered_at, NEW.returned_at, NEW.uploaded_date, NEW.delivered_date,
         NEW.returned_date, NEW.current_status, NEW.stage, NEW.outcome, NEW.reversal_applies,
         NEW.quantity, NEW.line_total, NEW.line_share, NEW.product_count,
         NEW.unit_cogs_snapshot, NEW.packing_cost_snapshot, NEW.processing_cost_snapshot,
         NEW.revenue_gross, NEW.revenue, NEW.cogs, NEW.delivery_cost, NEW.return_cost,
         NEW.packing_cost, NEW.processing_cost, NEW.carrier_billed_amount, NEW.cost_source,
         NEW.gross_profit, NEW.net_contribution, NEW.is_final, NEW.pending_reason,
         NEW.excluded_reason, NEW.expected_revenue)
     IS NOT DISTINCT FROM
     ROW(OLD.market_id, OLD.carrier_id, OLD.carrier_code, OLD.order_created_at, OLD.cohort_date,
         OLD.uploaded_at, OLD.delivered_at, OLD.returned_at, OLD.uploaded_date, OLD.delivered_date,
         OLD.returned_date, OLD.current_status, OLD.stage, OLD.outcome, OLD.reversal_applies,
         OLD.quantity, OLD.line_total, OLD.line_share, OLD.product_count,
         OLD.unit_cogs_snapshot, OLD.packing_cost_snapshot, OLD.processing_cost_snapshot,
         OLD.revenue_gross, OLD.revenue, OLD.cogs, OLD.delivery_cost, OLD.return_cost,
         OLD.packing_cost, OLD.processing_cost, OLD.carrier_billed_amount, OLD.cost_source,
         OLD.gross_profit, OLD.net_contribution, OLD.is_final, OLD.pending_reason,
         OLD.excluded_reason, OLD.expected_revenue)
  THEN
    RETURN NULL;  -- no-op write suppressed; updated_at stays put
  END IF;

  NEW.computed_at := now();
  NEW.updated_at  := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_investor_order_facts_before_update ON investor_order_facts;
CREATE TRIGGER trg_investor_order_facts_before_update
  BEFORE UPDATE ON investor_order_facts
  FOR EACH ROW EXECUTE FUNCTION investor_order_facts_before_update();

COMMENT ON TABLE investor_order_facts IS
  'Investor v2 fact table: one row per (order, product). Money is this product''s slice, final only when the outcome AND the billed carrier cost are known. Shared by all deals on the product; share % applied at read time.';

-- ------------------------------------------------------------
-- investor_daily_product_facts — projection per (product, local day)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_daily_product_facts (
  product_id                 UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  market_id                  UUID NOT NULL REFERENCES markets(id),
  fact_date                  DATE NOT NULL,
  -- COHORT family: orders CREATED on fact_date, outcome as of now
  received_count             INTEGER NOT NULL DEFAULT 0,
  excluded_dexpress_count    INTEGER NOT NULL DEFAULT 0,
  excluded_deleted_count     INTEGER NOT NULL DEFAULT 0,
  uploaded_count             INTEGER NOT NULL DEFAULT 0,
  delivered_count            INTEGER NOT NULL DEFAULT 0,
  returned_count             INTEGER NOT NULL DEFAULT 0,
  in_flight_count            INTEGER NOT NULL DEFAULT 0,
  not_shipped_count          INTEGER NOT NULL DEFAULT 0,
  pending_billing_count      INTEGER NOT NULL DEFAULT 0,
  in_flight_expected_revenue NUMERIC(14,3) NOT NULL DEFAULT 0,
  -- EVENT family: money that LANDED on fact_date (final rows only)
  ev_delivered_count         INTEGER NOT NULL DEFAULT 0,
  ev_returned_count          INTEGER NOT NULL DEFAULT 0,
  revenue                    NUMERIC(14,3) NOT NULL DEFAULT 0,
  cogs                       NUMERIC(14,3) NOT NULL DEFAULT 0,
  delivery_cost              NUMERIC(14,3) NOT NULL DEFAULT 0,
  return_cost                NUMERIC(14,3) NOT NULL DEFAULT 0,
  packing_cost               NUMERIC(14,3) NOT NULL DEFAULT 0,
  processing_cost            NUMERIC(14,3) NOT NULL DEFAULT 0,
  gross_profit               NUMERIC(14,3) NOT NULL DEFAULT 0,
  net_profit_before_ads      NUMERIC(14,3) NOT NULL DEFAULT 0,
  pending_revenue            NUMERIC(14,3) NOT NULL DEFAULT 0,
  pending_count              INTEGER NOT NULL DEFAULT 0,
  -- CALENDAR family
  ad_spend_direct            NUMERIC(14,3) NOT NULL DEFAULT 0,
  net_profit                 NUMERIC(14,3) GENERATED ALWAYS AS (net_profit_before_ads - ad_spend_direct) STORED,
  computed_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, fact_date)
);

CREATE INDEX IF NOT EXISTS idpf_market_date_idx ON investor_daily_product_facts (market_id, fact_date);

COMMENT ON TABLE investor_daily_product_facts IS
  'Investor v2 daily projection per product. Cohort counts by order-creation day; money by event day (two-posting rule); product-mapped ad spend prorated per day. Rebuilt idempotently by the rollup.';

-- ------------------------------------------------------------
-- investor_deal_snapshots — portal fast read
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_deal_snapshots (
  deal_id              UUID PRIMARY KEY REFERENCES investor_deals(id) ON DELETE CASCADE,
  as_of                TIMESTAMPTZ NOT NULL DEFAULT now(),
  rollup_run_id        UUID,
  facts_watermark      TIMESTAMPTZ,
  cumulative_share     NUMERIC(14,3) NOT NULL DEFAULT 0,
  unsettled_share      NUMERIC(14,3) NOT NULL DEFAULT 0,
  payable_now          NUMERIC(14,3) NOT NULL DEFAULT 0,
  carried_loss_before  NUMERIC(14,3) NOT NULL DEFAULT 0,
  carried_loss_after   NUMERIC(14,3) NOT NULL DEFAULT 0,
  restatement_delta    NUMERIC(14,3) NOT NULL DEFAULT 0,
  totals               JSONB NOT NULL DEFAULT '{}'::jsonb,
  yours                JSONB NOT NULL DEFAULT '{}'::jsonb,
  series               JSONB NOT NULL DEFAULT '[]'::jsonb,
  pending              JSONB NOT NULL DEFAULT '{}'::jsonb,
  in_flight            JSONB NOT NULL DEFAULT '{}'::jsonb,
  rates                JSONB NOT NULL DEFAULT '{}'::jsonb,
  counts               JSONB NOT NULL DEFAULT '{}'::jsonb,
  excluded             JSONB NOT NULL DEFAULT '{}'::jsonb,
  terms_current        JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE investor_deal_snapshots IS
  'Investor v2: per-deal accrual snapshot written by the rollup (same function as settlement preview). Never authoritative for payouts.';

-- ------------------------------------------------------------
-- investor_rollup_runs — observability + claim lock
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_rollup_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger           TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  mode              TEXT NOT NULL CHECK (mode IN ('incremental', 'full')),
  product_id        UUID REFERENCES products(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'skipped_locked')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  watermark_from    TIMESTAMPTZ,
  watermark_to      TIMESTAMPTZ,
  orders_scanned    INTEGER NOT NULL DEFAULT 0,
  facts_changed     INTEGER NOT NULL DEFAULT 0,
  days_written      INTEGER NOT NULL DEFAULT 0,
  deals_snapshotted INTEGER NOT NULL DEFAULT 0,
  excluded_dexpress INTEGER NOT NULL DEFAULT 0,
  error             TEXT
);

CREATE INDEX IF NOT EXISTS irr_started_idx ON investor_rollup_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS irr_status_idx  ON investor_rollup_runs (status, finished_at DESC);

-- Claim: one rollup at a time. Uses a transaction-scoped advisory lock so a
-- crashed run never leaves a stale lock; the row is the observable record.
CREATE OR REPLACE FUNCTION claim_investor_rollup_run(
  p_trigger TEXT,
  p_mode    TEXT,
  p_product_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_running INTEGER;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('investor-rollup')) THEN
    RETURN NULL;
  END IF;

  -- A run that has been "running" for more than 20 minutes is dead (Vercel
  -- maxDuration is 300 s); mark it failed so it does not block forever.
  UPDATE investor_rollup_runs
     SET status = 'failed', finished_at = now(), error = COALESCE(error, 'stale: exceeded 20 min')
   WHERE status = 'running' AND started_at < now() - INTERVAL '20 minutes';

  SELECT COUNT(*) INTO v_running FROM investor_rollup_runs WHERE status = 'running';
  IF v_running > 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO investor_rollup_runs (trigger, mode, product_id)
  VALUES (p_trigger, p_mode, p_product_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION claim_investor_rollup_run(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_investor_rollup_run(TEXT, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION finish_investor_rollup_run(
  p_id                UUID,
  p_status            TEXT,
  p_watermark_from    TIMESTAMPTZ,
  p_watermark_to      TIMESTAMPTZ,
  p_orders_scanned    INTEGER,
  p_facts_changed     INTEGER,
  p_days_written      INTEGER,
  p_deals_snapshotted INTEGER,
  p_excluded_dexpress INTEGER,
  p_error             TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE investor_rollup_runs
     SET status            = p_status,
         finished_at       = now(),
         watermark_from    = p_watermark_from,
         watermark_to      = p_watermark_to,
         orders_scanned    = p_orders_scanned,
         facts_changed     = p_facts_changed,
         days_written      = p_days_written,
         deals_snapshotted = p_deals_snapshotted,
         excluded_dexpress = p_excluded_dexpress,
         error             = p_error
   WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION finish_investor_rollup_run(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finish_investor_rollup_run(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) TO service_role;

-- ------------------------------------------------------------
-- RLS — facts carry unit-cost snapshots: super_admin read only; nobody else.
-- The service role (rollup, portal APIs) bypasses RLS.
-- ------------------------------------------------------------
ALTER TABLE investor_order_facts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_daily_product_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_deal_snapshots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_rollup_runs         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS iof_select_super_admin ON investor_order_facts;
CREATE POLICY iof_select_super_admin ON investor_order_facts
  FOR SELECT TO authenticated USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS idpf_select_super_admin ON investor_daily_product_facts;
CREATE POLICY idpf_select_super_admin ON investor_daily_product_facts
  FOR SELECT TO authenticated USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS ids_select_super_admin ON investor_deal_snapshots;
CREATE POLICY ids_select_super_admin ON investor_deal_snapshots
  FOR SELECT TO authenticated USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS irr_select_super_admin ON investor_rollup_runs;
CREATE POLICY irr_select_super_admin ON investor_rollup_runs
  FOR SELECT TO authenticated USING (get_user_role() = 'super_admin');
