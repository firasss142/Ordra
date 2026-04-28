-- ============================================================
-- 20260614000001_libya_dexpress_alignment.sql
-- Align Shipping Eyes (Libya carrier) integration with v2 spec:
--   1. Add customer_whatsapp to orders (customer_phone_2 already exists)
--   2. Extend dexpress_states/places with status + audit columns
--   3. Drop UNIQUE constraint on dexpress_states.name (Arabic dupes possible)
--   4. Clear stale Tunisian seed (was wrong country); real Libyan seed
--      is populated by scripts/seed-dexpress-from-api.ts which calls the
--      carrier's own /delivery-states + /delivery-places endpoints.
-- ============================================================

-- ---- 1. orders: add customer_whatsapp ----
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_whatsapp TEXT;

-- ---- 2. dexpress_states: extend schema ----
ALTER TABLE dexpress_states ADD COLUMN IF NOT EXISTS status        INTEGER     NOT NULL DEFAULT 1;
ALTER TABLE dexpress_states ADD COLUMN IF NOT EXISTS route_id      INTEGER;
ALTER TABLE dexpress_states ADD COLUMN IF NOT EXISTS delivery_days INTEGER;
ALTER TABLE dexpress_states ADD COLUMN IF NOT EXISTS notes         TEXT;
ALTER TABLE dexpress_states ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ DEFAULT now();
ALTER TABLE dexpress_states ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT now();

-- ---- 3. dexpress_places: extend schema ----
ALTER TABLE dexpress_places ADD COLUMN IF NOT EXISTS status     INTEGER     NOT NULL DEFAULT 1;
ALTER TABLE dexpress_places ADD COLUMN IF NOT EXISTS notes      TEXT;
ALTER TABLE dexpress_places ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE dexpress_places ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- ---- 4. Drop UNIQUE constraint on dexpress_states.name ----
-- The carrier's name list contains Arabic duplicates across spellings.
ALTER TABLE dexpress_states DROP CONSTRAINT IF EXISTS dexpress_states_name_key;

-- ---- 5. Clear stale Tunisian seed (006_dexpress_seed.sql) ----
-- The original 006_dexpress_seed inserted Tunisian governorates by mistake.
-- Wipe both tables; scripts/seed-dexpress-from-api.ts repopulates from the
-- carrier's authoritative API.
DELETE FROM dexpress_places;
DELETE FROM dexpress_states;
