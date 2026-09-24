-- Assertion helpers for the SQL tests.
--
-- POURQUOI PAS pgTAP. L'extension est disponible mais n'est pas installée en
-- production, et l'installer pour des tests ferait entrer une extension de
-- test dans le schéma d'une base de production. Trois fonctions dans `pg_temp`
-- suffisent : elles vivent le temps de la session psql et ne laissent rien.
--
-- POURQUOI PAS DE ROLLBACK. Les invariants de stock sont des CONSTRAINT
-- TRIGGERS `DEFERRABLE INITIALLY DEFERRED` : ils ne s'évaluent qu'au COMMIT.
-- Un test encadré d'un ROLLBACK ne les déclenche JAMAIS — c'est exactement
-- ainsi que `assert_site_stock_within_total` a été « vérifié en production »
-- le 2026-09-09 alors qu'il plantait sur toute écriture de `products`
-- (voir 20260909195032_fix_site_stock_guard_relid.sql). Ces tests écrivent
-- donc pour de vrai, sur une base locale jetable, et valident.

CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond BOOLEAN, p_what TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_what;
  END IF;
  RAISE NOTICE '  ok  %', p_what;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.eq(p_got ANYELEMENT, p_want ANYELEMENT, p_what TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION 'FAIL: % — attendu %, obtenu %', p_what, p_want, p_got;
  END IF;
  RAISE NOTICE '  ok  % (%)', p_what, p_got;
END $$;

-- Exécute `p_sql` et rend le code d'erreur SQLSTATE, ou 'NO_ERROR'. Sert à
-- prouver qu'une garde refuse bien — et, avant le correctif, à prouver qu'une
-- opération légitime échoue.
CREATE OR REPLACE FUNCTION pg_temp.err(p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'NO_ERROR';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;
