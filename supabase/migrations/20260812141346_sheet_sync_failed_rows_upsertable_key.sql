-- ============================================================
-- 20260812141346_sheet_sync_failed_rows_upsertable_key.sql
-- Make sheet_sync_failed_rows upsertable. Applied to production 2026-08-12.
--
-- WHY: the table shipped hours earlier with a PARTIAL unique index
--
--     (storefront_id, row_index) WHERE resolved_at IS NULL
--
-- and `recordFailedRow` upserts with ON CONFLICT (storefront_id, row_index).
-- Postgres will not match a partial index unless the statement repeats the
-- index predicate, and PostgREST cannot emit one. Proven against this database
-- before deploy:
--
--     REJECTED 42P10 :: there is no unique or exclusion constraint
--                       matching the ON CONFLICT specification
--
-- The consequence was worse than a failed insert. `recordFailure` is awaited
-- outside the per-row try/catch in sync-engine.ts, so the throw skipped that
-- row's cursor commit — the sync would have stalled permanently on the first
-- row it could not import, which is precisely the failure mode the whole
-- rewrite exists to remove. Caught in pre-deploy verification, never shipped.
--
-- A plain unique key says the same thing — one record per (storefront, sheet
-- row) — and upserts cleanly. Re-failing a row that had been resolved reopens
-- that record (the writer sets resolved_at = NULL) rather than inserting a
-- second one.
--
-- `20260902000001` now creates this index directly, so on a fresh database the
-- statements below are both no-ops. They are kept because production ran them.
-- ============================================================

DROP INDEX IF EXISTS sheet_sync_failed_rows_open_unique;

CREATE UNIQUE INDEX IF NOT EXISTS sheet_sync_failed_rows_row_unique
  ON sheet_sync_failed_rows (storefront_id, row_index);
