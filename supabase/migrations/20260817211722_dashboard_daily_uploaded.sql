-- ============================================================
-- 20260910000001_dashboard_daily_uploaded.sql
-- Add `uploaded` to each row of the dashboard rollup's `daily` array, so the
-- intake chart's hover card can report the day's carrier handoffs beside the
-- four outcome bands it already stacks.
--
-- WHY order_history AND NOT orders.status: `uploaded` is transient. An order
-- that went on to `scanned`/`delivered` no longer holds it, so a cohort count
-- would report whatever happens to be sitting mid-flight rather than the number
-- of orders actually handed to the carrier that day. It is counted the same way
-- the neighbouring `confirmed` field already is — both are EVENT counts, and
-- they share no basis with daily's cohort outcome fields.
--
-- WHY A DEFINITION REWRITE rather than re-pasting the body: the same reason
-- 20260909000008 gives. That migration is NOT in this database's history but its
-- change IS live, so re-pasting any migration file's body would silently revert
-- the billed-cost fix (flat carriers.delivery_fee understated Libya delivery
-- cost by ~7,000 LYD over 90 days). Transforming the live definition keeps every
-- untouched line bit-identical to what is running. Each anchor is asserted, so a
-- future refactor that moves them fails loudly here instead of quietly no-oping.
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

  -- Already migrated? Nothing to do (keeps this migration idempotent).
  IF position('dc.uploaded' IN def) > 0 THEN
    RETURN;
  END IF;

  -- 1. daily_conf CTE: count uploads alongside confirmations.
  prev := def;
  def := replace(def,
    E'    SELECT (h.created_at AT TIME ZONE \'UTC\')::date AS day, COUNT(*) AS confirmed',
    E'    SELECT (h.created_at AT TIME ZONE \'UTC\')::date AS day,\n'
    || E'      COUNT(*) FILTER (WHERE h.status_to = \'confirmed\') AS confirmed,\n'
    || E'      COUNT(*) FILTER (WHERE h.status_to = \'uploaded\')  AS uploaded');
  IF def = prev THEN RAISE EXCEPTION 'anchor 1 (daily_conf select) not found'; END IF;

  -- 2. daily_conf CTE: widen the status filter so uploads survive it.
  prev := def;
  def := replace(def,
    E'      AND h.status_to = \'confirmed\'',
    E'      AND h.status_to IN (\'confirmed\', \'uploaded\')');
  IF def = prev THEN RAISE EXCEPTION 'anchor 2 (daily_conf where) not found'; END IF;

  -- 3. daily payload: emit the new key.
  prev := def;
  def := replace(def,
    E'\'confirmed\', COALESCE(dc.confirmed, 0)) ORDER BY dl.day)',
    E'\'confirmed\', COALESCE(dc.confirmed, 0),\n'
    || E'        \'uploaded\', COALESCE(dc.uploaded, 0)) ORDER BY dl.day)');
  IF def = prev THEN RAISE EXCEPTION 'anchor 3 (daily payload) not found'; END IF;

  EXECUTE def;
END
$rewrite$;
