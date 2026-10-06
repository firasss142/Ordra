-- Every delivery rate in Ordra is the same number (docs/carrier-scorecard.md, « PR 2 »).
--
-- CE QUE CE FICHIER PROUVE
--   1. get_carrier_true_cost compte livrés / échoués comme carrier_parcel_outcome
--      (un colis Darb annulé après ramassage est un échec, plus un « succès » caché),
--      et un échec Darb coûte 0 — les autres transporteurs gardent leur frais de retour.
--   2. get_carrier_delivery_performance (lu par /api/carriers/performance, donc par le
--      « meilleur choix » de la file d'appels et Réglages › Livraison) : mêmes comptes,
--      cloisonné par marché, fermé à anon.
--   3. refresh_delivery_zone_stats : une zone compte ses échecs Darb, pas seulement
--      ses « returned » scannés au dépôt.
--
-- Le jeu de données est celui de carrier_parcel_outcome_test.sql : lancez-le d'abord
-- (run.sh les prend dans l'ordre alphabétique, il passe avant celui-ci).

\set ON_ERROR_STOP on
\i _helpers.sql

DO $g$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = 'ca000000-0000-4000-8000-000000000016') THEN
    RAISE EXCEPTION 'fixture absente — lancez carrier_parcel_outcome_test.sql d''abord';
  END IF;
END
$g$;
SELECT set_config('r.mm', 'ca000000-0000-4000-8000-0000000000a1', FALSE) \gset

\echo ''
\echo '── carrier rates, one definition ─────────────────────────────────────'

DO $t$
DECLARE
  v_tn    UUID := '00000000-0000-0000-0000-000000000001';
  v_ly    UUID := '00000000-0000-0000-0000-000000000002';
  v_darb  UUID := 'ca000000-0000-4000-8000-0000000000d1';
  v_navex UUID := 'ca000000-0000-4000-8000-0000000000e1';
  v_del BIGINT; v_fail BIGINT;
  r RECORD;
BEGIN
  -- the truth, from the view
  SELECT count(*) FILTER (WHERE outcome = 'delivered'), count(*) FILTER (WHERE outcome = 'failed')
    INTO v_del, v_fail
    FROM carrier_parcel_outcome WHERE carrier_id = v_darb;
  IF v_fail = 0 THEN RAISE EXCEPTION 'fixture: expected Darb failures in the view'; END IF;

  -- 1 · true cost
  SELECT * INTO r FROM get_carrier_true_cost(v_ly, 3650) WHERE carrier_id = v_darb;
  IF r.delivered IS DISTINCT FROM v_del OR r.returned IS DISTINCT FROM v_fail THEN
    RAISE EXCEPTION 'true cost Darb: % delivered / % failed, view says % / %', r.delivered, r.returned, v_del, v_fail;
  END IF;
  IF r.return_cost <> 0 THEN
    RAISE EXCEPTION 'true cost Darb: a failed Darb parcel costs nothing, got %', r.return_cost;
  END IF;
  RAISE NOTICE '  ✓ true cost counts Darb like the view (% / %), failures at 0', v_del, v_fail;

  SELECT * INTO r FROM get_carrier_true_cost(v_tn, 3650) WHERE carrier_id = v_navex;
  IF r.delivered <> 1 OR r.returned <> 1 THEN
    RAISE EXCEPTION 'true cost Navex: expected 1 / 1, got % / %', r.delivered, r.returned;
  END IF;
  RAISE NOTICE '  ✓ true cost Navex: the to_be_returned parcel is a failure';

  -- 2 · delivery performance
  SELECT * INTO r FROM get_carrier_delivery_performance(v_ly, 3650) WHERE carrier_id = v_darb;
  IF r.delivered IS DISTINCT FROM v_del OR r.failed IS DISTINCT FROM v_fail THEN
    RAISE EXCEPTION 'performance Darb: % / %, view says % / %', r.delivered, r.failed, v_del, v_fail;
  END IF;
  IF r.median_transit_hours IS NULL THEN
    RAISE EXCEPTION 'performance Darb: a delivered parcel with a pickup must give a transit time';
  END IF;
  RAISE NOTICE '  ✓ delivery performance = the view (% delivered, % failed, median % h)', r.delivered, r.failed, r.median_transit_hours;

  IF EXISTS (SELECT 1 FROM get_carrier_delivery_performance(v_ly, 3650) WHERE carrier_id = v_navex) THEN
    RAISE EXCEPTION 'performance: a Tunisian carrier leaked into Libya';
  END IF;
  RAISE NOTICE '  ✓ delivery performance stays inside its market';

  -- 3 · zone stats
  PERFORM refresh_delivery_zone_stats(3650);
  SELECT * INTO r FROM delivery_zone_stats
   WHERE market_id = v_ly AND zone_key = delivery_zone_key(NULL, NULL, 'X');
  IF r IS NULL OR r.returned_count < v_fail THEN
    RAISE EXCEPTION 'zone X: expected at least % failures, got %', v_fail, r.returned_count;
  END IF;
  RAISE NOTICE '  ✓ zone stats count Darb failures (zone X: % delivered, % failed, rate %)', r.delivered_count, r.returned_count, r.delivery_rate;
END
$t$;

\echo ''
\echo '── access ─────────────────────────────────────────────────────────────'

DO $t$
BEGIN
  IF has_function_privilege('anon', 'public.get_carrier_delivery_performance(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute get_carrier_delivery_performance';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_carrier_delivery_performance(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute get_carrier_delivery_performance';
  END IF;
  RAISE NOTICE '  ✓ anon closed, authenticated open';
END
$t$;

-- A Libyan manager asking for Tunisia gets nothing.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('r.mm'), 'role', 'authenticated')::text, FALSE);
SET ROLE authenticated;
DO $t$
BEGIN
  IF EXISTS (SELECT 1 FROM get_carrier_delivery_performance('00000000-0000-0000-0000-000000000001', 3650)) THEN
    RAISE EXCEPTION 'a Libyan manager read Tunisian carrier rates';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM get_carrier_delivery_performance('00000000-0000-0000-0000-000000000002', 3650)) THEN
    RAISE EXCEPTION 'a Libyan manager cannot read Libyan carrier rates';
  END IF;
  RAISE NOTICE '  ✓ market_manager reads own market only';
END
$t$;
RESET ROLE;
