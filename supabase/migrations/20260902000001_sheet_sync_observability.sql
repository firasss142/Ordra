-- ============================================================
-- 20260902000001_sheet_sync_observability.sql
-- A durable record of what the Google Sheets sync actually did.
--
-- WHY: the sync had been failing every fifteen minutes for days and nothing in
-- the system said so. pg_cron job 4 reported 8,033 consecutive "succeeded"
-- runs, because succeeding at `SELECT invoke_google_sheets_sync()` only means
-- Postgres handed an async request to pg_net — the HTTP reply lands in
-- net._http_response, which nothing reads. Every one of those replies was a
-- 55-second timeout, and the only other record of a run was a per-row `errors`
-- array returned in a JSON body that pg_net discards.
--
-- The cursor tells the same story from the other side: settings
-- 'google_sheets_sync_state' sat at last_row 2834 from 2026-08-08 12:00 while
-- the job kept "succeeding" four times an hour. Fifteen orders were stranded on
-- the sheet and the first person to notice was the operator.
--
-- WHAT: one row per run, one row per row that could not be imported. This is
-- the table the storefront page reads, the table the alerts engine derives
-- `sheet_sync_stalled` from, and the record that makes a failed import
-- retryable instead of lost.
--
-- The in-flight lock is a unique partial index rather than application code: a
-- run that overruns its window used to have the next one started on top of it,
-- and two workers walking the same cursor double-import. An index makes the
-- second INSERT fail, which is the only way to be sure.
--
-- NON-GOALS: orders, order_history and inventory_log are untouched; the sync
-- cursor stays in `settings` where the engine already keeps it.
-- ============================================================

CREATE TABLE IF NOT EXISTS sheet_sync_runs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id      UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  storefront_id  UUID NOT NULL,
  -- Who asked. A manual run failing is a different conversation from the cron
  -- failing unattended, and the storefront page says which it is showing.
  trigger        TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  status         TEXT NOT NULL CHECK (
                   status IN ('running', 'succeeded', 'partial', 'failed', 'skipped_locked')
                 ),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  rows_fetched   INTEGER NOT NULL DEFAULT 0,
  rows_imported  INTEGER NOT NULL DEFAULT 0,
  rows_duplicate INTEGER NOT NULL DEFAULT 0,
  rows_errored   INTEGER NOT NULL DEFAULT 0,
  -- Where the cursor stood when this run stopped, committed or not.
  last_row       INTEGER NOT NULL DEFAULT 0,
  -- The run hit its deadline with rows still pending. Not a failure — the next
  -- run continues from the committed cursor — but the page says so, because a
  -- sync that is permanently `has_more` is a sync that is falling behind.
  has_more       BOOLEAN NOT NULL DEFAULT false,
  error          TEXT
);

-- At most one live run per storefront. The second concurrent INSERT raises a
-- unique violation, which the caller reads as "already running" and records as
-- `skipped_locked` rather than walking the same cursor twice.
CREATE UNIQUE INDEX IF NOT EXISTS sheet_sync_runs_one_in_flight
  ON sheet_sync_runs (storefront_id)
  WHERE status = 'running';

-- The page and the alerts engine both ask the same question: what happened
-- last, for this market.
CREATE INDEX IF NOT EXISTS idx_sheet_sync_runs_market_started
  ON sheet_sync_runs (market_id, started_at DESC);

CREATE TABLE IF NOT EXISTS sheet_sync_failed_rows (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id        UUID NOT NULL REFERENCES sheet_sync_runs(id) ON DELETE CASCADE,
  market_id     UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  storefront_id UUID NOT NULL,
  row_index     INTEGER NOT NULL,
  -- The sheet row as it was read. Without it a failure is unactionable: the
  -- cursor has moved past that row and nothing else in the system holds it.
  raw_row       JSONB NOT NULL,
  message       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

-- One record per (storefront, sheet row). NOT partial: a partial unique index
-- cannot serve `ON CONFLICT (storefront_id, row_index)` — Postgres requires the
-- statement to repeat the index predicate and PostgREST cannot emit one, so
-- every failed row raised 42P10. Verified against this database before shipping.
CREATE UNIQUE INDEX IF NOT EXISTS sheet_sync_failed_rows_row_unique
  ON sheet_sync_failed_rows (storefront_id, row_index);

CREATE INDEX IF NOT EXISTS idx_sheet_sync_failed_rows_open
  ON sheet_sync_failed_rows (market_id, created_at DESC)
  WHERE resolved_at IS NULL;

-- ---- RLS ----------------------------------------------------------------
-- Writes come from the sync itself, which runs on the service role and bypasses
-- RLS. Authenticated users only read, and only their own market — the same rule
-- every other market-scoped table here carries.
ALTER TABLE sheet_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheet_sync_failed_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sheet_sync_runs_select" ON sheet_sync_runs;
CREATE POLICY "sheet_sync_runs_select"
  ON sheet_sync_runs FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );

DROP POLICY IF EXISTS "sheet_sync_failed_rows_select" ON sheet_sync_failed_rows;
CREATE POLICY "sheet_sync_failed_rows_select"
  ON sheet_sync_failed_rows FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );
