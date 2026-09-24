-- ============================================================
-- 20260506010000_drop_legacy_transition_overload.sql
-- Drop the legacy 7-arg transition_order_status overload.
--
-- Background: 004_order_rpcs.sql created
--   transition_order_status(uuid, order_status, uuid, text, text,
--                           rejection_reason, text)   -- 7 args
-- Later migrations added p_callback_at + scheduled-dispatch params,
-- producing an 11-arg version. Because the parameter count changed,
-- Postgres treated the new definitions as overloads instead of
-- replacements, so both versions coexist.
--
-- Effect: any caller using the 11-arg signature (the canonical one
-- since 20260421_scheduled_dispatch) hits PostgREST error
--   "Could not choose the best candidate function between: ..."
-- because two candidates match.
--
-- Fix: drop the 7-arg legacy overload. The 11-arg version (latest
-- in 20260506000000_uploaded_status_model.sql) is the only one
-- application code calls.
-- ============================================================

DROP FUNCTION IF EXISTS public.transition_order_status(
  uuid,
  order_status,
  uuid,
  text,
  text,
  rejection_reason,
  text
);

-- Defensive: also drop the 8-arg variant from 005_carrier_dispatch
-- (uuid, order_status, uuid, text, text, rejection_reason, text, timestamptz)
-- in case any environment still has it. 018_add_to_be_returned_status
-- dropped p_callback_at and reverted to 7 args, so this should already
-- be gone, but the IF EXISTS makes it safe either way.
DROP FUNCTION IF EXISTS public.transition_order_status(
  uuid,
  order_status,
  uuid,
  text,
  text,
  rejection_reason,
  text,
  timestamptz
);
