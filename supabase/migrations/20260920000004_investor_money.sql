-- ============================================================
-- 20260920000004_investor_money.sql
-- Investor domain v2 — MONEY.
--
--   investor_deal_statements   immutable per-deal period snapshots
--   investor_ledger_entries    append-only signed money movements
--   investor_withdrawals       payout requests + state machine
--   investor_notifications     in-app events (dedupe_key, realtime)
--
-- Names are distinct from the v1 tables (investor_statements, investor_ledger,
-- withdrawal_requests) so the deployed v1 pages keep working until the whole
-- rebuild ships; v1 tables are dropped by the cleanup migration.
--
-- Rules (owner decisions, 2026-08-18): no holdback / reserve; carried loss,
-- never a clawback; settlement is a manual admin close (preview → commit);
-- the ledger entry for a withdrawal is written only when it is marked PAID;
-- capital lives in the ledger as capital_in (±, amendments post deltas) and is
-- returned at maturity as principal_return; balance is NEVER stored.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ------------------------------------------------------------
-- investor_deal_statements (immutable)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_deal_statements (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id                       UUID NOT NULL REFERENCES investor_deals(id) ON DELETE RESTRICT,
  investor_id                   UUID NOT NULL REFERENCES investors(id) ON DELETE RESTRICT,
  product_id                    UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  market_id                     UUID NOT NULL REFERENCES markets(id),
  currency                      TEXT NOT NULL CHECK (currency IN ('TND', 'LYD')),
  sequence_no                   INTEGER NOT NULL,
  kind                          TEXT NOT NULL CHECK (kind IN ('periodic', 'final')),
  period_start                  DATE NOT NULL,
  period_end                    DATE NOT NULL,          -- money cutoff (event date <= period_end)
  -- product 100 %, PERIOD figures (delta vs previous statement)
  revenue                       NUMERIC(14,3) NOT NULL DEFAULT 0,
  cogs                          NUMERIC(14,3) NOT NULL DEFAULT 0,
  delivery_cost                 NUMERIC(14,3) NOT NULL DEFAULT 0,
  return_cost                   NUMERIC(14,3) NOT NULL DEFAULT 0,
  packing_cost                  NUMERIC(14,3) NOT NULL DEFAULT 0,
  processing_cost               NUMERIC(14,3) NOT NULL DEFAULT 0,
  ad_spend_direct               NUMERIC(14,3) NOT NULL DEFAULT 0,
  gross_profit                  NUMERIC(14,3) NOT NULL DEFAULT 0,
  net_profit                    NUMERIC(14,3) NOT NULL DEFAULT 0,
  received_count                INTEGER NOT NULL DEFAULT 0,
  uploaded_count                INTEGER NOT NULL DEFAULT 0,
  delivered_count               INTEGER NOT NULL DEFAULT 0,
  returned_count                INTEGER NOT NULL DEFAULT 0,
  excluded_dexpress_count       INTEGER NOT NULL DEFAULT 0,
  pending_count                 INTEGER NOT NULL DEFAULT 0,
  pending_revenue               NUMERIC(14,3) NOT NULL DEFAULT 0,
  -- investor
  share_pct_min                 NUMERIC(7,4) NOT NULL,
  share_pct_max                 NUMERIC(7,4) NOT NULL,
  investor_share                NUMERIC(14,3) NOT NULL,   -- signed period delta
  restatement_delta             NUMERIC(14,3) NOT NULL DEFAULT 0,
  carried_loss_before           NUMERIC(14,3) NOT NULL DEFAULT 0,
  carried_loss_applied          NUMERIC(14,3) NOT NULL DEFAULT 0,
  carried_loss_after            NUMERIC(14,3) NOT NULL DEFAULT 0,
  payable                       NUMERIC(14,3) NOT NULL CHECK (payable >= 0),
  cumulative_share_through      NUMERIC(14,3) NOT NULL,   -- anchor for the next delta
  cumulative_net_profit_through NUMERIC(14,3) NOT NULL,
  capital_amount                NUMERIC(14,3) NOT NULL,   -- terms at period_end
  snapshot                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  preview_hash                  TEXT NOT NULL UNIQUE,      -- idempotency key
  settled_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_by                    UUID NOT NULL REFERENCES users(id),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_deal_statement_seq    UNIQUE (deal_id, sequence_no),
  CONSTRAINT uq_deal_statement_period UNIQUE (deal_id, period_start, period_end),
  CONSTRAINT chk_statement_period CHECK (period_end >= period_start),
  CONSTRAINT excl_deal_statement_overlap
    EXCLUDE USING gist (deal_id WITH =, daterange(period_start, period_end, '[]') WITH &&)
);

CREATE INDEX IF NOT EXISTS ids2_investor_idx ON investor_deal_statements (investor_id, settled_at DESC);
CREATE INDEX IF NOT EXISTS ids2_deal_idx     ON investor_deal_statements (deal_id, period_end DESC);
CREATE INDEX IF NOT EXISTS ids2_market_idx   ON investor_deal_statements (market_id);

CREATE OR REPLACE FUNCTION reject_investor_deal_statement_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'investor_deal_statements is immutable: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_investor_deal_statements_immutable ON investor_deal_statements;
CREATE TRIGGER trg_investor_deal_statements_immutable
  BEFORE UPDATE OR DELETE ON investor_deal_statements
  FOR EACH ROW EXECUTE FUNCTION reject_investor_deal_statement_mutation();

ALTER TABLE investor_deals
  DROP CONSTRAINT IF EXISTS investor_deals_final_statement_fk;
ALTER TABLE investor_deals
  ADD CONSTRAINT investor_deals_final_statement_fk
  FOREIGN KEY (final_statement_id) REFERENCES investor_deal_statements(id);

COMMENT ON TABLE investor_deal_statements IS
  'Investor v2: immutable per-deal statement. investor_share is the signed delta vs cumulative_share_through of the previous statement; payable applies the carried-loss rule. preview_hash makes commit idempotent.';

-- ------------------------------------------------------------
-- investor_ledger_entries (append-only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_ledger_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id    UUID NOT NULL REFERENCES investors(id) ON DELETE RESTRICT,
  deal_id        UUID REFERENCES investor_deals(id) ON DELETE RESTRICT,
  statement_id   UUID REFERENCES investor_deal_statements(id) ON DELETE RESTRICT,
  withdrawal_id  UUID,                     -- FK added below (table created after)
  market_id      UUID NOT NULL REFERENCES markets(id),
  currency       TEXT NOT NULL CHECK (currency IN ('TND', 'LYD')),
  entry_type     TEXT NOT NULL CHECK (entry_type IN ('capital_in', 'settlement', 'withdrawal', 'correction', 'principal_return')),
  amount         NUMERIC(14,3) NOT NULL,   -- signed for capital_in / correction; positive otherwise
  note           TEXT,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ledger_settlement       CHECK (entry_type <> 'settlement'       OR (statement_id IS NOT NULL AND deal_id IS NOT NULL AND amount > 0)),
  CONSTRAINT chk_ledger_withdrawal       CHECK (entry_type <> 'withdrawal'       OR (withdrawal_id IS NOT NULL AND amount > 0)),
  CONSTRAINT chk_ledger_principal_return CHECK (entry_type <> 'principal_return' OR (deal_id IS NOT NULL AND amount > 0)),
  CONSTRAINT chk_ledger_capital_in       CHECK (entry_type <> 'capital_in'       OR (deal_id IS NOT NULL AND amount <> 0)),
  CONSTRAINT chk_ledger_correction_note  CHECK (entry_type <> 'correction'       OR (note IS NOT NULL AND btrim(note) <> ''))
);

CREATE INDEX IF NOT EXISTS ile_investor_idx   ON investor_ledger_entries (investor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ile_deal_idx       ON investor_ledger_entries (deal_id);
CREATE INDEX IF NOT EXISTS ile_statement_idx  ON investor_ledger_entries (statement_id);
CREATE INDEX IF NOT EXISTS ile_withdrawal_idx ON investor_ledger_entries (withdrawal_id);

CREATE OR REPLACE FUNCTION reject_investor_ledger_entry_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'investor_ledger_entries is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_investor_ledger_entries_append_only ON investor_ledger_entries;
CREATE TRIGGER trg_investor_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON investor_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_investor_ledger_entry_mutation();

COMMENT ON TABLE investor_ledger_entries IS
  'Investor v2 append-only ledger. available = settlement + correction − withdrawal; capital_outstanding = capital_in − principal_return. Balance is never stored.';

-- ------------------------------------------------------------
-- investor_withdrawals
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_withdrawals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id       UUID NOT NULL REFERENCES investors(id) ON DELETE RESTRICT,
  market_id         UUID NOT NULL REFERENCES markets(id),
  currency          TEXT NOT NULL CHECK (currency IN ('TND', 'LYD')),
  amount            NUMERIC(14,3) NOT NULL CHECK (amount > 0),
  status            TEXT NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested', 'approved', 'rejected', 'paid')),
  note              TEXT,
  admin_note        TEXT,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ,
  decided_by        UUID REFERENCES users(id),
  paid_at           TIMESTAMPTZ,
  paid_by           UUID REFERENCES users(id),
  payout_reference  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS iw_investor_idx ON investor_withdrawals (investor_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS iw_status_idx   ON investor_withdrawals (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS iw_market_idx   ON investor_withdrawals (market_id);

DROP TRIGGER IF EXISTS trg_investor_withdrawals_updated_at ON investor_withdrawals;
CREATE TRIGGER trg_investor_withdrawals_updated_at
  BEFORE UPDATE ON investor_withdrawals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE investor_ledger_entries
  DROP CONSTRAINT IF EXISTS investor_ledger_entries_withdrawal_fk;
ALTER TABLE investor_ledger_entries
  ADD CONSTRAINT investor_ledger_entries_withdrawal_fk
  FOREIGN KEY (withdrawal_id) REFERENCES investor_withdrawals(id) ON DELETE RESTRICT;

-- ------------------------------------------------------------
-- investor_notifications
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN (
                   'statement_issued', 'withdrawal_approved', 'withdrawal_rejected', 'withdrawal_paid',
                   'terms_amended', 'deal_matured', 'deal_closed', 'correction_posted')),
  deal_id        UUID REFERENCES investor_deals(id) ON DELETE CASCADE,
  statement_id   UUID REFERENCES investor_deal_statements(id) ON DELETE CASCADE,
  withdrawal_id  UUID REFERENCES investor_withdrawals(id) ON DELETE CASCADE,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key     TEXT NOT NULL UNIQUE,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inotif_unread_idx ON investor_notifications (investor_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS inotif_investor_idx ON investor_notifications (investor_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'investor_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE investor_notifications;
  END IF;
END $$;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE investor_deal_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_ledger_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_withdrawals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_notifications   ENABLE ROW LEVEL SECURITY;

-- Statements / ledger / withdrawals: managers read own market, super_admin all.
-- Investors get NO policy (portal is server-computed via service role).
DROP POLICY IF EXISTS ids2_select_manager ON investor_deal_statements;
CREATE POLICY ids2_select_manager ON investor_deal_statements FOR SELECT TO authenticated
  USING (get_user_role() = 'super_admin' OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id()));

DROP POLICY IF EXISTS ile_select_manager ON investor_ledger_entries;
CREATE POLICY ile_select_manager ON investor_ledger_entries FOR SELECT TO authenticated
  USING (get_user_role() = 'super_admin' OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id()));

DROP POLICY IF EXISTS iw_select_manager ON investor_withdrawals;
CREATE POLICY iw_select_manager ON investor_withdrawals FOR SELECT TO authenticated
  USING (get_user_role() = 'super_admin' OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id()));

-- Notifications: the investor reads their own (needed for Realtime); admins read all.
DROP POLICY IF EXISTS inotif_select_self ON investor_notifications;
CREATE POLICY inotif_select_self ON investor_notifications FOR SELECT TO authenticated
  USING (investor_id = auth.uid() OR get_user_role() = 'super_admin');
