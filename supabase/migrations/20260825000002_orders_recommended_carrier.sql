-- ============================================================
-- 20260825000002_orders_recommended_carrier.sql
-- Which carrier account intake thinks this order should ship with.
--
-- Libya runs two Darb Assabil accounts whose per-destination prices differ by
-- 5-20 LYD (see 20260825000001). Intake already resolves the Darb (city, area)
-- for every order, so it can also say which account is cheapest for it — which
-- makes the recommendation queryable and filterable, not just a UI badge.
--
-- ADVISORY ONLY. This is a snapshot taken at intake, never authoritative. The
-- carrier picker recomputes live from darb_shipping_rates at upload time, and
-- nothing may auto-dispatch on this column: rates are re-harvested nightly, the
-- order's city can be edited afterwards, and a human always makes the call.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS recommended_carrier_id UUID
    REFERENCES carriers(id) ON DELETE SET NULL,
  -- Free text, not an enum, so adding a tie-break rung needs no migration.
  -- Current values, cheapest-first in the ladder:
  --   quote               both accounts quoted, one strictly cheaper
  --   quote_tie_true_cost quotes equal -> cheaper historical cost per delivered
  --   quote_tie_sticker   quotes and history equal -> cheaper carriers.delivery_fee
  --   true_cost           a quote was missing/stale -> ranked on history alone
  --   sticker             no quotes and no history -> ranked on the flat fee
  --   only_candidate      one carrier available
  --   none                not Libya, no resolved city, or the lookup failed
  ADD COLUMN IF NOT EXISTS recommended_carrier_reason TEXT;

COMMENT ON COLUMN orders.recommended_carrier_id IS
  'Advisory intake snapshot of the cheapest carrier account for this destination. NEVER authoritative — the picker recomputes live and a human chooses.';

CREATE INDEX IF NOT EXISTS idx_orders_recommended_carrier
  ON orders (recommended_carrier_id)
  WHERE recommended_carrier_id IS NOT NULL;
