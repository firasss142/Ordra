-- Journaux v2 — the real cause of an error, browser crashes, every outside call
-- (plans/journal-detection-and-settings-v2.md §A–§C).
--
-- On 2026-10-06 prod held 720 `/api/cities GET 500` rows that all said
-- « Internal server error »: 179 routes answer with that sentence after
-- catching the real error, so the journal never knew WHY. The app now records
-- the cause it saw during the request (a PostgREST error, an outside service's
-- answer, or a logged exception) next to the answer it gave.
--
-- Safe in any order with the app: the recorder retries without these columns
-- when they are missing, so deploying first loses only the cause.

-- ── 1. app_errors: cause + browser crashes ──────────────────────────────────
ALTER TABLE public.app_errors
  ADD COLUMN IF NOT EXISTS source       TEXT NOT NULL DEFAULT 'server',
  ADD COLUMN IF NOT EXISTS page         TEXT,
  ADD COLUMN IF NOT EXISTS cause_kind   TEXT,
  ADD COLUMN IF NOT EXISTS cause_code   TEXT,
  ADD COLUMN IF NOT EXISTS cause_detail TEXT,
  ADD COLUMN IF NOT EXISTS cause_target TEXT;

ALTER TABLE public.app_errors DROP CONSTRAINT IF EXISTS app_errors_source_check;
ALTER TABLE public.app_errors ADD CONSTRAINT app_errors_source_check CHECK (source IN ('server', 'browser'));
ALTER TABLE public.app_errors DROP CONSTRAINT IF EXISTS app_errors_cause_kind_check;
ALTER TABLE public.app_errors ADD CONSTRAINT app_errors_cause_kind_check
  CHECK (cause_kind IS NULL OR cause_kind IN ('db', 'external', 'code'));

CREATE INDEX IF NOT EXISTS app_errors_source_idx ON public.app_errors (source, occurred_at DESC);

-- ── 2. integration_calls: polls, syncs and reads, not only uploads ───────────
ALTER TABLE public.integration_calls DROP CONSTRAINT IF EXISTS integration_calls_operation_check;
ALTER TABLE public.integration_calls ADD CONSTRAINT integration_calls_operation_check
  CHECK (operation IN ('upload', 'void', 'bind', 'verify', 'quote', 'stock_read', 'send', 'test', 'poll', 'sync', 'read'));

CREATE INDEX IF NOT EXISTS integration_calls_failing_idx
  ON public.integration_calls (system, operation, occurred_at DESC) WHERE status <> 'ok';

-- ── 3. the Historique row of an error carries its cause ─────────────────────
-- journal_feed() is 600 lines; rewriting it to add five keys would risk the
-- other 20 sources. Its live text is patched in place instead, and the patch
-- refuses to run if that text has changed since 20261003160300.
DO $patch$
DECLARE
  v_sig  REGPROCEDURE := 'public.journal_feed(timestamptz, text, integer, text, boolean, uuid)'::REGPROCEDURE;
  v_def  TEXT := pg_get_functiondef(v_sig);
  v_old  TEXT := $o$'code', e.error_code, 'message', e.message)),$o$;
  v_new  TEXT := $n$'code', e.error_code, 'message', e.message,
              'source', e.source, 'page', e.page, 'cause_kind', e.cause_kind, 'cause_code', e.cause_code,
              'cause_target', e.cause_target, 'cause_detail', left(e.cause_detail, 200))),$n$;
BEGIN
  IF position('cause_kind' IN v_def) > 0 THEN
    RETURN; -- already patched
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'journal_feed a changé depuis 20261003160300 : patch refusé';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $patch$;
