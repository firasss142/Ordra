-- Navex statuses (20261006140000).
--
-- CE QUE CE FICHIER PROUVE
--   1. « Livrer Paye » solde un colis en livré depuis n'importe quel statut en vol,
--      y compris en sautant des étapes (expédié → livré) et depuis « à vérifier ».
--   2. Un retour annoncé par Navex va en « à rentrer » : AUCUN mouvement de stock
--      (c'est le scan du banc qui le rentre).
--   3. Un statut ne recule jamais, et un colis terminé n'est jamais touché.
--   4. La fonction refuse « retourné » / « annulé » et les commandes d'un autre transporteur.
--   5. Seul le rôle service l'appelle.

\set ON_ERROR_STOP on
\i _helpers.sql

CREATE OR REPLACE FUNCTION pg_temp.mk(p_sf UUID, p_carrier UUID, p_status order_status, p_tag TEXT, p_product UUID)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  INSERT INTO orders (market_id, storefront_id, external_id, external_platform, customer_name, customer_phone,
                      product_id, product_name, unit_price, total_price, status, carrier_id, tracking_number)
  VALUES ('00000000-0000-0000-0000-000000000001', p_sf, 'SQLTEST-NAV-' || p_tag, 'sqltest', 'Client Test', '20000000',
          p_product, 'SQLTEST produit', 50, 57, p_status, p_carrier, 'SQLTEST-NAV-' || p_tag)
  RETURNING id INTO v;
  RETURN v;
END $$;

DO $fixture$
DECLARE
  v_tn  UUID := '00000000-0000-0000-0000-000000000001';
  v_tag TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 10);
  v_sf  UUID;
  v_nav UUID;
  v_drb UUID;
  v_p   UUID;
BEGIN
  SELECT id INTO v_sf FROM storefronts WHERE market_id = v_tn ORDER BY created_at LIMIT 1;
  IF v_sf IS NULL THEN RAISE EXCEPTION 'Fixture incomplète : aucune boutique TN'; END IF;
  INSERT INTO carriers (market_id, name, code, is_active, delivery_fee)
  VALUES (v_tn, 'SQLTEST Navex ' || v_tag, 'navex', TRUE, 7) RETURNING id INTO v_nav;
  INSERT INTO carriers (market_id, name, code, is_active, delivery_fee)
  VALUES (v_tn, 'SQLTEST Autre ' || v_tag, 'cosmos', TRUE, 7) RETURNING id INTO v_drb;
  SELECT id INTO v_p FROM products WHERE market_id = v_tn ORDER BY created_at LIMIT 1;

  PERFORM set_config('r.tag', v_tag, FALSE);
  PERFORM set_config('r.p', COALESCE(v_p::TEXT, ''), FALSE);
  -- one order per case: status it starts in
  PERFORM set_config('r.o_disp', (SELECT pg_temp.mk(v_sf, v_nav, 'dispatched', v_tag || '-1', v_p))::TEXT, FALSE);
  PERFORM set_config('r.o_unv',  (SELECT pg_temp.mk(v_sf, v_nav, 'unverified', v_tag || '-2', v_p))::TEXT, FALSE);
  PERFORM set_config('r.o_ret',  (SELECT pg_temp.mk(v_sf, v_nav, 'deposit',    v_tag || '-3', v_p))::TEXT, FALSE);
  PERFORM set_config('r.o_back', (SELECT pg_temp.mk(v_sf, v_nav, 'in_transit', v_tag || '-4', v_p))::TEXT, FALSE);
  PERFORM set_config('r.o_done', (SELECT pg_temp.mk(v_sf, v_nav, 'delivered',  v_tag || '-5', v_p))::TEXT, FALSE);
  PERFORM set_config('r.o_oth',  (SELECT pg_temp.mk(v_sf, v_drb, 'deposit',    v_tag || '-6', v_p))::TEXT, FALSE);
END $fixture$;

\echo '── 1 · « Livrer Paye » ─────────────────────────────────────────────────'
SELECT public.promote_navex_status(current_setting('r.o_disp')::UUID, 'delivered', 'Livrer Paye');
SELECT public.promote_navex_status(current_setting('r.o_unv')::UUID, 'delivered', 'Livrer Paye');
DO $t1$
BEGIN
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = current_setting('r.o_disp')::UUID), 'delivered', 'expédié → livré, sans passer par chaque étape');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = current_setting('r.o_unv')::UUID), 'delivered', '« à vérifier » → livré');
  PERFORM pg_temp.eq((SELECT actor_type::TEXT FROM order_history WHERE order_id = current_setting('r.o_disp')::UUID ORDER BY created_at DESC LIMIT 1),
                     'system', 'l''historique dit « système »');
  PERFORM pg_temp.eq((SELECT note FROM order_history WHERE order_id = current_setting('r.o_disp')::UUID ORDER BY created_at DESC LIMIT 1),
                     'Navex : Livrer Paye', 'et le statut Navex exact');
  PERFORM pg_temp.eq((SELECT carrier_status_slug FROM orders WHERE id = current_setting('r.o_disp')::UUID), 'Livrer Paye', 'le statut brut est gardé sur la commande');
END $t1$;

\echo '── 2 · a return goes to « à rentrer », stock untouched ─────────────────'
DO $t2$
DECLARE v_before INT; v_logs_before INT;
BEGIN
  v_logs_before := (SELECT count(*) FROM inventory_log WHERE order_id = current_setting('r.o_ret')::UUID);
  PERFORM public.promote_navex_status(current_setting('r.o_ret')::UUID, 'to_be_returned', 'Retour recu');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = current_setting('r.o_ret')::UUID), 'to_be_returned', 'déposé → à rentrer');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM inventory_log WHERE order_id = current_setting('r.o_ret')::UUID), v_logs_before,
                     'aucune ligne de stock : le banc scannera');
END $t2$;

\echo '── 3 · never backwards, never a finished parcel ─────────────────────────'
DO $t3$
DECLARE r JSON;
BEGIN
  UPDATE orders SET status = 'to_be_returned' WHERE id = current_setting('r.o_back')::UUID;
  r := public.promote_navex_status(current_setting('r.o_back')::UUID, 'in_transit', 'En cours');
  PERFORM pg_temp.eq((r ->> 'promoted')::BOOLEAN, FALSE, 'à rentrer ne revient pas en transit');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = current_setting('r.o_back')::UUID), 'to_be_returned', 'le statut reste');

  r := public.promote_navex_status(current_setting('r.o_done')::UUID, 'to_be_returned', 'Retour recu');
  PERFORM pg_temp.eq((r ->> 'promoted')::BOOLEAN, FALSE, 'un colis livré n''est jamais touché');
END $t3$;

\echo '── 4 · what it refuses ─────────────────────────────────────────────────'
DO $t4$
BEGIN
  PERFORM pg_temp.ok(pg_temp.err(format($q$SELECT public.promote_navex_status(%L, 'returned', 'x')$q$, current_setting('r.o_back'))) <> 'NO_ERROR',
                     '« retourné » est réservé au scan du banc');
  PERFORM pg_temp.ok(pg_temp.err(format($q$SELECT public.promote_navex_status(%L, 'cancelled', 'x')$q$, current_setting('r.o_back'))) <> 'NO_ERROR',
                     '« annulé » est réservé aux responsables');
  PERFORM pg_temp.ok(pg_temp.err(format($q$SELECT public.promote_navex_status(%L, 'delivered', 'x')$q$, current_setting('r.o_oth'))) <> 'NO_ERROR',
                     'une commande d''un autre transporteur est refusée');
END $t4$;

\echo '── 5 · who may call it ─────────────────────────────────────────────────'
DO $t5$
BEGIN
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.promote_navex_status(uuid, order_status, text, timestamptz)', 'EXECUTE'), 'anon ne l''appelle pas');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public.promote_navex_status(uuid, order_status, text, timestamptz)', 'EXECUTE'), 'une session non plus');
  PERFORM pg_temp.ok(has_function_privilege('service_role', 'public.promote_navex_status(uuid, order_status, text, timestamptz)', 'EXECUTE'), 'le cron (rôle service) oui');
END $t5$;

\echo '✓ navex_status_test'
