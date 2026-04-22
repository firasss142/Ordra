-- ============================================================
-- 20260601000003_dynamic_statuses_trigger_search_path.sql
-- Harden the dual-write triggers from 20260601000001 with a pinned
-- search_path. Matches the pattern used by the new RPCs and silences
-- the function_search_path_mutable advisor for these functions.
-- ============================================================

ALTER FUNCTION sync_lead_status_columns() SET search_path = public, pg_temp;
ALTER FUNCTION sync_follow_up_status_columns() SET search_path = public, pg_temp;
