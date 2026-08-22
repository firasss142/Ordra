-- ============================================================
-- 20260918000001_dashboard_funnel_uploaded.sql
-- Re-base the dashboard funnel's second stage from "confirmed" to "uploaded".
--
-- WHY: the tile answered "how many orders got past the agent", which counts an
-- order the moment the phone call succeeds. The number people actually steer on
-- is how many reached the carrier, because an order stuck between `confirmed`
-- and `uploaded` is agreed-to but not moving, and the old figure hid exactly
-- that gap by counting it as progress (155 vs 145 over the last 30 days, i.e.
-- 10 orders sitting confirmed-but-not-uploaded).
--
-- HOW: the stage is CUMULATIVE — a status list covering "reached this point or
-- went beyond it", which is why `delivered` and `returned` appear in it. Moving
-- the boundary one step down the pipeline therefore just means dropping the two
-- pre-upload statuses, `confirmed` and `dispatch_scheduled`, from both the
-- current and previous halves of the pair. Everything downstream (the tile, its
-- delta, and confirmationRate's numerator) reads these same two counters.
--
-- The JSON key stays `confirmed` so the payload contract and the TypeScript
-- RawPair mapping are untouched; only what it counts changes. The UI relabels.
--
-- WHY A DEFINITION REWRITE rather than re-pasting the body: 20260909000008's
-- billed-cost fix is live in this database but absent from its migration
-- history, so re-pasting any migration file's body would silently revert it and
-- put Libya delivery cost back on the flat carriers.delivery_fee (~7,000 LYD
-- understated over 90 days). Transforming the live definition keeps every
-- untouched line bit-identical. Both anchors are asserted.
-- ============================================================

DO $rewrite$
DECLARE
  def  TEXT;
  prev TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'get_dashboard_health' AND n.nspname = 'public';

  IF def IS NULL THEN
    RAISE EXCEPTION 'get_dashboard_health not found';
  END IF;

  -- Already migrated? The pre-upload statuses are gone from the funnel stage.
  IF position(E'AS confirmed_cur' IN def) > 0
     AND position(E'\'confirmed\',\'dispatch_scheduled\',\'uploaded\'' IN def) = 0 THEN
    RETURN;
  END IF;

  -- 1. funnel CTE, current half: start the stage at `uploaded`.
  prev := def;
  def := replace(def,
    E'      COUNT(*) FILTER (WHERE is_cur  AND status IN (\n'
    || E'        \'confirmed\',\'dispatch_scheduled\',\'uploaded\',\'scanned\',\'dispatched\',\'deposit\',',
    E'      COUNT(*) FILTER (WHERE is_cur  AND status IN (\n'
    || E'        \'uploaded\',\'scanned\',\'dispatched\',\'deposit\',');
  IF def = prev THEN RAISE EXCEPTION 'anchor 1 (funnel current half) not found'; END IF;

  -- 2. funnel CTE, previous half: same boundary, so the delta compares like
  --    with like rather than measuring the re-basing itself.
  prev := def;
  def := replace(def,
    E'      COUNT(*) FILTER (WHERE is_prev AND status IN (\n'
    || E'        \'confirmed\',\'dispatch_scheduled\',\'uploaded\',\'scanned\',\'dispatched\',\'deposit\',',
    E'      COUNT(*) FILTER (WHERE is_prev AND status IN (\n'
    || E'        \'uploaded\',\'scanned\',\'dispatched\',\'deposit\',');
  IF def = prev THEN RAISE EXCEPTION 'anchor 2 (funnel previous half) not found'; END IF;

  EXECUTE def;
END
$rewrite$;
