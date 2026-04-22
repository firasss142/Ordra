-- ============================================================
-- 022_carrier_event_log.sql
-- Append-only forensic log of every carrier status check (poll now, webhook later).
-- + Supporting index on orders.tracking_number for poll lookups.
-- ============================================================

CREATE TABLE carrier_event_log (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_code         TEXT         NOT NULL CHECK (carrier_code IN ('navex', 'dexpress')),
  source               TEXT         NOT NULL DEFAULT 'poll' CHECK (source IN ('poll', 'webhook')),
  tracking_number      TEXT,
  carrier_status_raw   TEXT,
  order_id             UUID         REFERENCES orders(id),
  outcome              TEXT         NOT NULL CHECK (outcome IN ('processed', 'ignored', 'error')),
  outcome_reason       TEXT,
  raw_body             JSONB,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
  -- NO updated_at — append-only
);

CREATE INDEX idx_carrier_log_carrier_created
  ON carrier_event_log (carrier_code, created_at DESC);

CREATE INDEX idx_carrier_log_tracking
  ON carrier_event_log (tracking_number)
  WHERE tracking_number IS NOT NULL;

CREATE INDEX idx_carrier_log_outcome_created
  ON carrier_event_log (outcome, created_at DESC)
  WHERE outcome IN ('ignored', 'error');

-- RLS: service role only (no authenticated access this session)
ALTER TABLE carrier_event_log ENABLE ROW LEVEL SECURITY;
-- No policies granted → only service role can read/write.

-- Supporting index for polling lookup
CREATE INDEX idx_orders_tracking_number
  ON orders (tracking_number)
  WHERE tracking_number IS NOT NULL;
