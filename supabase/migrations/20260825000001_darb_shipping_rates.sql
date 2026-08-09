-- ============================================================
-- 20260825000001_darb_shipping_rates.sql
-- Per-destination Darb Assabil shipping prices, harvested per carrier ACCOUNT.
--
-- THE PROBLEM. Libyan carriers price delivery by destination address, not by a
-- flat rate. The OMS modelled it as flat: both Darb Assabil accounts (Tripoli
-- and Benghazi) carried an identical carriers.delivery_fee of 10.000 LYD, so
-- "which account is cheaper for this customer" was always a tie, and every Darb
-- order was booked at a cost unrelated to what Darb actually charges.
--
-- THE EVIDENCE. Probed live on 2026-08-08 via Darb's own preview endpoint
-- POST /api/local/shipments/calculate/shipping (see
-- scripts/probe-darb-shipping-rates.ts and
-- plans/darb-per-destination-rate-recommendation.md). Real prices run 10-50 LYD
-- and the two accounts differ on 11 of 12 sampled destinations:
--
--     طرابلس    Tripoli 15  Benghazi 20   -> Tripoli cheaper
--     سرت       Tripoli 30  Benghazi 25   -> Benghazi cheaper  (the hinge)
--     بنغازي    Tripoli 30  Benghazi 10   -> Benghazi cheaper by 20
--     درنة      Tripoli 40  Benghazi 25   -> Benghazi cheaper by 15
--
-- The differentiator is the breakdown's branchToBranch leg (origin branch ->
-- destination branch); dropToDoor depends only on the destination and is equal
-- for both accounts.
--
-- WHY THE KEY IS JUST (carrier_id, city, area). The same probe established the
-- quote is INVARIANT to products[].amount (50/199/500/2000 all identical), to
-- the service plan (all three catalogue services quote the same), to quantity
-- and line count, and to paymentBy. So there are no value bands and no service
-- dimension — 278 catalogue combos x 2 accounts = 556 rows, full stop. The
-- service surcharges (women's +10, express +15) are applied by Darb on top and
-- already live in darb_services.
--
-- MISSING IS NOT ZERO. shipping_amount NULL means "never successfully quoted";
-- 0 means "Darb quoted zero" (which happens: Benghazi's branchToBranch into
-- بنغازي is 0). The CHECK below makes the two impossible to confuse, and a
-- failed refresh KEEPS the last good price rather than blanking it — a
-- transient 502 must never turn a real price into a gap. Staleness is a
-- read-side policy against last_success_at, never a destructive write.
-- ============================================================

-- 1. Harvest run log. Written before the cells so a partial run is diagnosable.
CREATE TABLE IF NOT EXISTS darb_rate_harvest_runs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  requested   INTEGER     NOT NULL DEFAULT 0,
  succeeded   INTEGER     NOT NULL DEFAULT 0,
  failed      INTEGER     NOT NULL DEFAULT 0,
  status      TEXT        NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running','completed','partial','failed')),
  trigger     TEXT        NOT NULL DEFAULT 'cron'
                          CHECK (trigger IN ('cron','script')),
  notes       TEXT
);

-- 2. The rate table: one row per (account, city, area).
CREATE TABLE IF NOT EXISTS darb_shipping_rates (
  id                     BIGSERIAL     PRIMARY KEY,
  carrier_id             UUID          NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  city                   TEXT          NOT NULL,
  area                   TEXT          NOT NULL,

  -- Last KNOWN-GOOD quote. NULL = never successfully quoted. 0 is a real price.
  shipping_amount        NUMERIC(10,3),
  currency               TEXT          NOT NULL DEFAULT 'lyd',
  -- Raw legs: { branchToBranch, pickFromDoor, dropToDoor }. Kept because
  -- branchToBranch is the account-choice signal and is worth auditing.
  breakdown              JSONB,

  -- Provenance: what the quote was taken WITH. Not key dimensions (the price is
  -- invariant to both), but if Darb ever starts pricing by service or by order
  -- value these columns are how we notice the assumption broke.
  quoted_with_service_id TEXT,
  quoted_with_amount     NUMERIC(12,3),

  status                 TEXT          NOT NULL CHECK (status IN ('ok','error')),
  http_status            INTEGER,
  error_message          TEXT,

  quoted_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),  -- last ATTEMPT
  last_success_at        TIMESTAMPTZ,                           -- last OK; drives staleness
  last_error_at          TIMESTAMPTZ,
  attempt_count          INTEGER       NOT NULL DEFAULT 1,
  harvest_run_id         UUID          REFERENCES darb_rate_harvest_runs(id) ON DELETE SET NULL,

  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (carrier_id, city, area),

  -- A price and a success timestamp exist together or not at all. This is what
  -- makes "no rate" impossible to confuse with "0 LYD" anywhere downstream.
  CONSTRAINT darb_rate_price_implies_success
    CHECK ((shipping_amount IS NULL) = (last_success_at IS NULL))
);

COMMENT ON COLUMN darb_shipping_rates.shipping_amount IS
  'Last known-good shipping price in `currency`. NULL means never successfully quoted — NOT free. A failed refresh preserves this value.';

-- The per-order read: both accounts for one destination, priced rows only.
CREATE INDEX IF NOT EXISTS idx_darb_rates_lookup
  ON darb_shipping_rates (city, area)
  WHERE shipping_amount IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_darb_rates_carrier
  ON darb_shipping_rates (carrier_id);

-- Stalest-first harvest scan, so a run capped by `limit` resumes where it left
-- off next cycle without any cursor state to corrupt.
CREATE INDEX IF NOT EXISTS idx_darb_rates_stale
  ON darb_shipping_rates (quoted_at);

-- 3. Atomic upsert. The "keep the last good price on failure" rule and the
--    attempt counter belong in ONE statement — a read-then-write in TS would
--    race two overlapping harvest runs and could blank a valid price.
CREATE OR REPLACE FUNCTION upsert_darb_shipping_rates(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH incoming AS (
    SELECT
      (r->>'carrier_id')::UUID              AS carrier_id,
      r->>'city'                            AS city,
      r->>'area'                            AS area,
      NULLIF(r->>'shipping_amount','')::NUMERIC(10,3) AS shipping_amount,
      COALESCE(r->>'currency','lyd')        AS currency,
      CASE WHEN r->'breakdown' = 'null'::JSONB THEN NULL ELSE r->'breakdown' END AS breakdown,
      r->>'quoted_with_service_id'          AS quoted_with_service_id,
      NULLIF(r->>'quoted_with_amount','')::NUMERIC(12,3) AS quoted_with_amount,
      r->>'status'                          AS status,
      NULLIF(r->>'http_status','')::INTEGER AS http_status,
      r->>'error_message'                   AS error_message,
      COALESCE(NULLIF(r->>'quoted_at','')::TIMESTAMPTZ, now()) AS quoted_at,
      NULLIF(r->>'harvest_run_id','')::UUID AS harvest_run_id
    FROM jsonb_array_elements(p_rows) AS r
  ),
  upserted AS (
    INSERT INTO darb_shipping_rates AS t (
      carrier_id, city, area,
      shipping_amount, currency, breakdown,
      quoted_with_service_id, quoted_with_amount,
      status, http_status, error_message,
      quoted_at, last_success_at, last_error_at,
      attempt_count, harvest_run_id, updated_at
    )
    SELECT
      i.carrier_id, i.city, i.area,
      CASE WHEN i.status = 'ok' THEN i.shipping_amount ELSE NULL END,
      i.currency,
      CASE WHEN i.status = 'ok' THEN i.breakdown ELSE NULL END,
      i.quoted_with_service_id, i.quoted_with_amount,
      i.status, i.http_status, i.error_message,
      i.quoted_at,
      CASE WHEN i.status = 'ok'    THEN i.quoted_at ELSE NULL END,
      CASE WHEN i.status <> 'ok'   THEN i.quoted_at ELSE NULL END,
      1, i.harvest_run_id, now()
    FROM incoming i
    ON CONFLICT (carrier_id, city, area) DO UPDATE SET
      -- On failure: preserve the last good price, breakdown and success stamp.
      shipping_amount = CASE WHEN EXCLUDED.status = 'ok'
                             THEN EXCLUDED.shipping_amount
                             ELSE t.shipping_amount END,
      breakdown       = CASE WHEN EXCLUDED.status = 'ok'
                             THEN EXCLUDED.breakdown
                             ELSE t.breakdown END,
      last_success_at = CASE WHEN EXCLUDED.status = 'ok'
                             THEN EXCLUDED.quoted_at
                             ELSE t.last_success_at END,
      last_error_at   = CASE WHEN EXCLUDED.status <> 'ok'
                             THEN EXCLUDED.quoted_at
                             ELSE t.last_error_at END,
      currency        = CASE WHEN EXCLUDED.status = 'ok'
                             THEN EXCLUDED.currency
                             ELSE t.currency END,
      quoted_with_service_id = COALESCE(EXCLUDED.quoted_with_service_id, t.quoted_with_service_id),
      quoted_with_amount     = COALESCE(EXCLUDED.quoted_with_amount, t.quoted_with_amount),
      -- Always reflect the latest attempt.
      status          = EXCLUDED.status,
      http_status     = EXCLUDED.http_status,
      error_message   = EXCLUDED.error_message,
      quoted_at       = EXCLUDED.quoted_at,
      harvest_run_id  = EXCLUDED.harvest_run_id,
      attempt_count   = t.attempt_count + 1,
      updated_at      = now()
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM upserted;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION upsert_darb_shipping_rates(JSONB) FROM PUBLIC, anon, authenticated;

-- 4. RLS. Same shape as darb_destinations / darb_services: a shared carrier
--    catalogue, readable by any authenticated user, written ONLY by the service
--    role (which bypasses RLS). No write policies at all, deliberately.
ALTER TABLE darb_shipping_rates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE darb_rate_harvest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "darb_shipping_rates_read"
  ON darb_shipping_rates FOR SELECT
  TO authenticated
  USING (true);

-- darb_rate_harvest_runs is operational data — service role only, no policy.
