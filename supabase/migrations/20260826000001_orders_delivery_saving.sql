-- ============================================================
-- 20260826000001_orders_delivery_saving.sql
-- What routing this order to its carrier account was worth.
--
-- Libya runs two Darb Assabil accounts whose per-destination prices differ by
-- 5-25 LYD (see 20260825000001). At dispatch we now know both prices, so we can
-- record what the choice actually saved — or cost.
--
--     delivery_saving_lyd = cheapest account NOT used - account actually used
--
-- Positive = routed to the cheaper account. Negative = overpaid. Zero = the
-- accounts price this destination identically (سبها does, at 35 from both).
--
-- WHY SNAPSHOT INSTEAD OF DERIVING. darb_shipping_rates is overwritten by the
-- nightly harvest. Joining orders to it live would make yesterday's savings
-- total drift every morning and make the KPI unauditable. These columns are
-- written once, at dispatch, and never recomputed.
--
-- NULL = NOT MEASURED, NOT ZERO. Non-Darb carriers, destinations that were
-- never quoted for one of the accounts, and every order dispatched before this
-- shipped all stay NULL and are excluded from the KPI. That is deliberate: the
-- counter answers "what has choosing the cheapest account earned us SINCE we
-- started choosing", so it must not absorb historical routing.
--
-- For the record, measured over the 759 Darb orders dispatched before this
-- feature (2026-06-23 .. 2026-08-08): 296 went to the cheaper account (+2,120
-- LYD), 363 to the dearer one (-4,830 LYD), 100 were ties — a net -2,710 LYD.
-- That is the baseline this counter is meant to replace, not include.
-- ============================================================

ALTER TABLE orders
  -- The counterfactual difference. The KPI is SUM() of this column.
  ADD COLUMN IF NOT EXISTS delivery_saving_lyd NUMERIC(10,3),
  -- What the chosen account actually charges for this destination. Independently
  -- useful: orders.delivery_fee is a flat 10 while real Darb shipping is 10-50.
  ADD COLUMN IF NOT EXISTS delivery_cost_quoted NUMERIC(10,3),
  -- When the snapshot was taken. Drives the "last 30 days" figure without
  -- depending on updated_at, which any later edit would move.
  ADD COLUMN IF NOT EXISTS delivery_saving_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.delivery_saving_lyd IS
  'Snapshot at dispatch: (cheapest carrier account not used) - (account used), in LYD. Positive = saved, negative = overpaid. NULL = not measured (non-Darb, unquoted destination, or dispatched before the feature) - NOT zero.';

COMMENT ON COLUMN orders.delivery_cost_quoted IS
  'Snapshot at dispatch: what the chosen carrier account charges to reach this destination. Distinct from orders.delivery_fee, which is a flat per-carrier rate.';

-- Partial: only measured rows are ever summed, and they are the minority.
CREATE INDEX IF NOT EXISTS idx_orders_delivery_saving
  ON orders (market_id, delivery_saving_at)
  WHERE delivery_saving_lyd IS NOT NULL;
