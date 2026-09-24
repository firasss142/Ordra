-- ============================================================
-- 20260816000001_darb_destinations.sql
-- Darb Assabil is the PRIMARY Libya carrier. Its destination model is a
-- hierarchical (city, area) pair — unlike Dexpress's flat state list. This
-- table is the Libya destination catalogue the storefront dropdown + webhook
-- intake resolve against, so orders arrive aligned to a pair the carrier
-- actually accepts (no "Unable to fetch branch" at dispatch).
--
-- Rows are seeded from src/lib/carriers/darb-assabil-areas-data.json (the
-- validated 25-city × areas map) via scripts/seed-darb-destinations.ts —
-- mirroring how dexpress_states is populated from its JSON. The table is left
-- empty here; run the seed script after migrating.
-- ============================================================

-- 1. Catalogue table: one row per deliverable (city, area) pair.
CREATE TABLE IF NOT EXISTS darb_destinations (
  id          SERIAL      PRIMARY KEY,
  city        TEXT        NOT NULL,
  area        TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city, area)
);

CREATE INDEX IF NOT EXISTS idx_darb_destinations_active
  ON darb_destinations (city)
  WHERE is_active;

-- 2. Order reference to the resolved Darb destination (Libya primary path).
--    Mutually exclusive with city_id (Tunisia) and dexpress_state_id (Libya
--    fallback) — enforced in the orders PATCH contract, mirroring those columns.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS darb_destination_id INTEGER
    REFERENCES darb_destinations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_darb_destination_id
  ON orders (darb_destination_id)
  WHERE darb_destination_id IS NOT NULL;

-- 3. RLS: read-only for all authenticated users (same as dexpress_states —
--    a shared geography catalogue, not market-scoped data).
ALTER TABLE darb_destinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "darb_destinations_read"
  ON darb_destinations FOR SELECT
  TO authenticated
  USING (true);
