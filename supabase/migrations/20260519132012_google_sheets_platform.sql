-- Google Sheets integration: no schema changes required.
--
-- storefronts.platform is TEXT (not an enum), so no DDL is needed to support
-- the new platform value 'google_sheets'. Sheet source configs are stored in
-- the existing settings table under two keys per market:
--
--   google_sheets_sources   — JSONB array of SheetSyncConfig objects
--   google_sheets_sync_state — JSONB map of { [storefront_id]: { last_row } }
--
-- Both keys follow the same UNIQUE(market_id, key) pattern as all other settings.
-- RLS on settings is inherited (market_manager can read/write own market).
--
-- The sync engine runs under the service role (admin client) — no new policies.

-- No-op: migration exists for migration continuity only.
SELECT 1;
