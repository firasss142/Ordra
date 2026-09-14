-- ============================================================
-- delivery_worklist_risk.test.sql
-- The inlined risk in get_delivery_worklist must agree with
-- evaluate_delivery_risk() on every real row, in both markets.
--
-- Why this file exists: 20260927000001 moved the risk rule out of the scalar
-- function and into the worklist query, because calling a SECURITY DEFINER
-- plpgsql function twice per row cost ~276 ms of a 386 ms request. The rule
-- now lives in two places — the trigger still needs the scalar form — so it
-- can drift. This is the thing that notices.
--
-- Run: psql $DATABASE_URL -f supabase/tests/delivery_worklist_risk.test.sql
-- Runs read-only against whatever data is there; it asserts agreement, not
-- any particular verdict, so it is safe against production.
-- ============================================================

BEGIN;

SELECT plan(6);

-- ── Both markets, every row: same verdict, same reasons, same order ─────────

PREPARE both AS
  SELECT w.order_id,
         w.is_risky      AS inlined_risky,
         w.risk_reasons  AS inlined_reasons,
         COALESCE((public.evaluate_delivery_risk(w.order_id)->>'risky')::boolean, false)
                         AS scalar_risky,
         COALESCE(ARRAY(SELECT jsonb_array_elements_text(
                   public.evaluate_delivery_risk(w.order_id)->'reasons')), '{}'::text[])
                         AS scalar_reasons
  FROM (
    SELECT * FROM public.get_delivery_worklist(
      (SELECT id FROM public.markets WHERE code = 'ly'), NULL)
    UNION ALL
    SELECT * FROM public.get_delivery_worklist(
      (SELECT id FROM public.markets WHERE code = 'tn'), NULL)
  ) w;

SELECT is(
  (SELECT count(*) FROM both WHERE inlined_risky IS DISTINCT FROM scalar_risky)::int,
  0,
  'every parcel gets the same risky verdict from the inlined rule and evaluate_delivery_risk()'
);

SELECT is(
  (SELECT count(*) FROM both WHERE inlined_reasons IS DISTINCT FROM scalar_reasons)::int,
  0,
  'reason arrays match element for element, not merely as sets'
);

-- ── p_include_done removes exactly the terminal parcels, nothing else ───────

SELECT is(
  (SELECT count(*) FROM public.get_delivery_worklist(
     (SELECT id FROM public.markets WHERE code = 'ly'), NULL, false)
   WHERE bucket = 'done')::int,
  0,
  'p_include_done = false returns no done parcels'
);

SELECT is(
  (SELECT count(*) FROM public.get_delivery_worklist(
     (SELECT id FROM public.markets WHERE code = 'ly'), NULL, false))::int,
  (SELECT count(*) FROM public.get_delivery_worklist(
     (SELECT id FROM public.markets WHERE code = 'ly'), NULL, true)
   WHERE bucket <> 'done')::int,
  'dropping done leaves every non-done parcel untouched'
);

-- ── Paging is a partition of the whole list, with no row lost or repeated ───

SELECT is(
  (SELECT count(DISTINCT order_id) FROM (
     SELECT order_id FROM public.get_delivery_worklist(
       (SELECT id FROM public.markets WHERE code = 'ly'), NULL, true, 50, 0)
     UNION ALL
     SELECT order_id FROM public.get_delivery_worklist(
       (SELECT id FROM public.markets WHERE code = 'ly'), NULL, true, 50, 50)
     UNION ALL
     SELECT order_id FROM public.get_delivery_worklist(
       (SELECT id FROM public.markets WHERE code = 'ly'), NULL, true, 1000, 100)
   ) pages)::int,
  (SELECT count(*) FROM public.get_delivery_worklist(
     (SELECT id FROM public.markets WHERE code = 'ly'), NULL))::int,
  'three consecutive pages cover the list exactly once — no duplicate, no gap'
);

-- ── total_count reports the full list, not the page ────────────────────────

SELECT is(
  (SELECT DISTINCT total_count FROM public.get_delivery_worklist(
     (SELECT id FROM public.markets WHERE code = 'ly'), NULL, true, 10, 0))::int,
  (SELECT count(*) FROM public.get_delivery_worklist(
     (SELECT id FROM public.markets WHERE code = 'ly'), NULL))::int,
  'total_count on a 10-row page still reports the whole list'
);

SELECT * FROM finish();
ROLLBACK;
