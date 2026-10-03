-- Le stock bouge à la variante, ou il ne bouge pas du tout.
--
-- CE QUE CE FICHIER PROUVE
--   1. `record_stock_count` sait encore compter un site (régression 42P10
--      introduite par 20260920162309, qui a remplacé la clé primaire
--      (produit, site) par (produit, variante, site) sans toucher au
--      `ON CONFLICT (product_id, warehouse_id)` de la RPC).
--   2. `order_stock_lines` rend une ligne par (produit, variante) et désigne
--      UNE SEULE ligne principale.
--   3. Les RPC de scan déplacent le total marché ET la variante, du même
--      nombre, et inscrivent la variante au registre.
--   4. Le contrôle de sous-débit porte sur la VARIANTE : 50 unités demandées
--      sur une variante qui en a 40 sont refusées même si le produit en a 100.
--      Et le refus est total — pas une seule ligne déduite.
--   5. Un palier (`kind='pack'`) ne déplace PAS de stock de variante.
--   6. Les deux inégalités tiennent, y compris au COMMIT.
--
-- FIXTURE NEUVE À CHAQUE PASSAGE. `inventory_log` et `order_history` sont en
-- écriture seule par trigger : un test ne peut pas nettoyer derrière lui. Il
-- se donne donc des identifiants neufs à chaque exécution et ne mesure que des
-- écarts relatifs, ce qui le rend re-jouable sans remise à zéro de la base.
--
-- À LANCER sur une base locale jetable : supabase/tests/run.sh

\set ON_ERROR_STOP on
\i _helpers.sql

\echo ''
\echo '── fixture ────────────────────────────────────────────────────────────'

DO $fixture$
DECLARE
  v_market   UUID := '00000000-0000-0000-0000-000000000001';  -- Tunisia
  v_sa       UUID := 'aaaaaaaa-0000-4000-8000-000000000001';
  -- Le bâtiment se RÉSOUT, il ne se code pas en dur : `supabase db reset`
  -- régénère les identifiants des entrepôts, et un UUID figé transformait
  -- toute ré-exécution après remise à zéro en « ce site n'appartient pas au
  -- marché du produit ». Seuls les marchés ont des identifiants stables.
  v_site     UUID;
  v_tag      TEXT := substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_prod     UUID := gen_random_uuid();
  v_petit    UUID := gen_random_uuid();
  v_grand    UUID := gen_random_uuid();
  v_pack     UUID := gen_random_uuid();
  v_store    UUID;
  v_carrier  UUID;
BEGIN
  SELECT id INTO v_site    FROM warehouses  WHERE market_id = v_market AND is_active ORDER BY code LIMIT 1;
  SELECT id INTO v_store   FROM storefronts WHERE market_id = v_market LIMIT 1;
  SELECT id INTO v_carrier FROM carriers    WHERE market_id = v_market LIMIT 1;

  IF v_site IS NULL OR v_store IS NULL OR v_carrier IS NULL THEN
    RAISE EXCEPTION 'Fixture incomplète : entrepôt=%, boutique=%, transporteur=% — la base locale a-t-elle ses données de départ ?',
      v_site, v_store, v_carrier;
  END IF;

  -- Un acteur réel : les RPC lisent `users.role`, jamais le JWT seul.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  VALUES (v_sa, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'sqltest.sa@oms.local', 'x', now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, email, full_name, role, market_id, warehouse_id, is_active)
  VALUES (v_sa, 'sqltest.sa@oms.local', 'SQL Test Admin', 'super_admin', NULL, NULL, TRUE)
  ON CONFLICT (id) DO UPDATE SET role = 'super_admin';

  -- Le produit ouvre à ZÉRO : tout son stock entrera par le registre, comme en
  -- vrai. Rien n'est posé à la main dans `current_stock`.
  INSERT INTO products (id, market_id, name, sku, unit_cogs, default_price,
                        initial_stock, current_stock, is_active)
  VALUES (v_prod, v_market, 'SQLTEST Doudoune ' || v_tag, 'SQLTEST-' || v_tag,
          20, 129, 0, 0, TRUE);

  INSERT INTO product_variants (id, product_id, kind, label, sku, quantity,
                                unit_cogs, current_stock, display_price, is_active)
  VALUES
    (v_petit, v_prod, 'attribute', 'Petit', 'SQLTEST-' || v_tag || '-P', 1, 18, 0, 129, TRUE),
    (v_grand, v_prod, 'attribute', 'Grand', 'SQLTEST-' || v_tag || '-G', 1, 22, 0, 149, TRUE),
    -- Un palier, pour prouver qu'il ne bouge AUCUN stock de variante.
    (v_pack,  v_prod, 'pack',      'Pack 2', NULL,                       2,  0, 0, 239, TRUE);

  PERFORM set_config('t.market',  v_market::TEXT,  FALSE);
  PERFORM set_config('t.site',    v_site::TEXT,    FALSE);
  PERFORM set_config('t.sa',      v_sa::TEXT,      FALSE);
  PERFORM set_config('t.store',   v_store::TEXT,   FALSE);
  PERFORM set_config('t.carrier', v_carrier::TEXT, FALSE);
  PERFORM set_config('t.prod',    v_prod::TEXT,    FALSE);
  PERFORM set_config('t.petit',   v_petit::TEXT,   FALSE);
  PERFORM set_config('t.grand',   v_grand::TEXT,   FALSE);
  PERFORM set_config('t.pack',    v_pack::TEXT,    FALSE);
  PERFORM set_config('t.tag',     v_tag,           FALSE);

  RAISE NOTICE '  fixture %  produit %', v_tag, v_prod;
END
$fixture$;

\echo ''
\echo '── 1. adjust_product_stock connaît la variante ────────────────────────'

DO $t1$
DECLARE
  v_p  UUID := current_setting('t.prod')::UUID;
  v_vp UUID := current_setting('t.petit')::UUID;
  v_vg UUID := current_setting('t.grand')::UUID;
  v_sa UUID := current_setting('t.sa')::UUID;
BEGIN
  -- Entrée de 40 Petit puis 60 Grand. Une entrée de variante fait monter le
  -- total marché du même nombre : ce sont des unités qui ARRIVENT vraiment,
  -- pas une répartition d'unités déjà là (ça, c'est record_stock_count).
  PERFORM adjust_product_stock(v_p, 40, 'manual_adjustment', 'réception Petit', v_sa, FALSE, v_vp);
  PERFORM adjust_product_stock(v_p, 60, 'manual_adjustment', 'réception Grand', v_sa, FALSE, v_vg);

  PERFORM pg_temp.eq((SELECT current_stock FROM products         WHERE id = v_p),  100,
    'le total marché monte à 100');
  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vp),  40,
    'la variante Petit porte 40');
  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vg),  60,
    'la variante Grand porte 60');

  PERFORM pg_temp.eq(
    (SELECT count(*)::INTEGER FROM inventory_log
      WHERE product_id = v_p AND variant_id IS NOT NULL), 2,
    'deux lignes de registre nomment leur variante');
END
$t1$;

\echo ''
\echo '── 2. une variante d''un autre produit est refusée ────────────────────'

DO $t2$
DECLARE
  v_p     UUID := current_setting('t.prod')::UUID;
  v_pack  UUID := current_setting('t.pack')::UUID;
  v_sa    UUID := current_setting('t.sa')::UUID;
  v_other UUID := gen_random_uuid();
BEGIN
  -- Un palier ne porte pas de stock : on ne peut pas en « recevoir » 10.
  PERFORM pg_temp.ok(
    pg_temp.err(format(
      'SELECT adjust_product_stock(%L::UUID, 10, ''manual_adjustment'', ''n'', %L::UUID, FALSE, %L::UUID)',
      v_p, v_sa, v_pack)) <> 'NO_ERROR',
    'ajuster le stock d''un PALIER est refusé');

  PERFORM pg_temp.ok(
    pg_temp.err(format(
      'SELECT adjust_product_stock(%L::UUID, 10, ''manual_adjustment'', ''n'', %L::UUID, FALSE, %L::UUID)',
      v_p, v_sa, v_other)) <> 'NO_ERROR',
    'ajuster le stock d''une variante inconnue est refusé');
END
$t2$;

\echo ''
\echo '── 3. order_stock_lines : une ligne par (produit, variante) ───────────'

DO $t3$
DECLARE
  v_p    UUID := current_setting('t.prod')::UUID;
  v_vp   UUID := current_setting('t.petit')::UUID;
  v_vg   UUID := current_setting('t.grand')::UUID;
  v_ord  UUID := gen_random_uuid();
BEGIN
  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_name, product_id, quantity,
                      unit_price, total_price, status, carrier_id, warehouse_id)
  VALUES (v_ord, current_setting('t.market')::UUID, current_setting('t.store')::UUID,
          'SQLTEST-' || current_setting('t.tag') || '-1', 'manual',
          'Client Test', '20000001', 'SQLTEST Doudoune', v_p, 5, 129, 645,
          'uploaded', current_setting('t.carrier')::UUID, current_setting('t.site')::UUID);

  -- Deux variantes du MÊME produit : le cas que le modèle « par produit »
  -- agrégeait en une seule ligne, perdant laquelle des deux tailles partait.
  INSERT INTO order_items (order_id, product_id, product_name, variant_id,
                           variant_label, quantity, unit_price, line_total)
  VALUES (v_ord, v_p, 'SQLTEST Doudoune', v_vp, 'Petit', 3, 129, 387),
         (v_ord, v_p, 'SQLTEST Doudoune', v_vg, 'Grand', 2, 149, 298);

  PERFORM set_config('t.ord1', v_ord::TEXT, FALSE);

  PERFORM pg_temp.eq((SELECT count(*)::INTEGER FROM public.order_stock_lines(v_ord)), 2,
    'deux lignes de stock, une par variante');
  PERFORM pg_temp.eq((SELECT count(*)::INTEGER FROM public.order_stock_lines(v_ord) WHERE is_primary), 1,
    'exactement UNE ligne principale');
  PERFORM pg_temp.eq((SELECT l.quantity FROM public.order_stock_lines(v_ord) l WHERE l.variant_id = v_vp), 3,
    'la ligne Petit porte 3');
  PERFORM pg_temp.eq((SELECT l.quantity FROM public.order_stock_lines(v_ord) l WHERE l.variant_id = v_vg), 2,
    'la ligne Grand porte 2');
END
$t3$;

\echo ''
\echo '── 4. scan_order_out déduit le total ET chaque variante ──────────────'

DO $t4$
DECLARE
  v_p   UUID := current_setting('t.prod')::UUID;
  v_vp  UUID := current_setting('t.petit')::UUID;
  v_vg  UUID := current_setting('t.grand')::UUID;
  v_ord UUID := current_setting('t.ord1')::UUID;
  v_sa  UUID := current_setting('t.sa')::UUID;
BEGIN
  INSERT INTO label_prints (order_id, market_id, printed_by, batch_id)
  VALUES (v_ord, current_setting('t.market')::UUID, v_sa, gen_random_uuid());

  PERFORM scan_order_out(v_ord, v_sa, NULL);

  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 95,
    'total marché 100 − 5 = 95');
  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vp), 37,
    'Petit 40 − 3 = 37');
  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vg), 58,
    'Grand 60 − 2 = 58');

  PERFORM pg_temp.eq(
    (SELECT count(*)::INTEGER FROM inventory_log
      WHERE order_id = v_ord AND reason = 'scanned' AND variant_id IS NOT NULL), 2,
    'deux lignes « scanned » nommant leur variante');

  -- `balance_after` reste le TOTAL MARCHÉ, pas celui de la variante : c'est la
  -- grandeur que les finances lisent depuis toujours.
  PERFORM pg_temp.eq(
    (SELECT min(balance_after)::INTEGER FROM inventory_log
      WHERE order_id = v_ord AND reason = 'scanned'), 95,
    'le dernier balance_after est le total marché');
END
$t4$;

\echo ''
\echo '── 5. unscan_order rend exactement ce que le scan a pris ─────────────'

DO $t5$
DECLARE
  v_p   UUID := current_setting('t.prod')::UUID;
  v_vp  UUID := current_setting('t.petit')::UUID;
  v_vg  UUID := current_setting('t.grand')::UUID;
BEGIN
  PERFORM unscan_order(current_setting('t.ord1')::UUID, current_setting('t.sa')::UUID, 'test');

  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 100,
    'le total revient à 100');
  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vp), 40,
    'Petit revient à 40');
  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vg), 60,
    'Grand revient à 60');
END
$t5$;

\echo ''
\echo '── 6. le sous-débit se juge à la variante, et le refus est total ─────'

DO $t6$
DECLARE
  v_p   UUID := current_setting('t.prod')::UUID;
  v_vp  UUID := current_setting('t.petit')::UUID;
  v_vg  UUID := current_setting('t.grand')::UUID;
  v_ord UUID := gen_random_uuid();
  v_sa  UUID := current_setting('t.sa')::UUID;
BEGIN
  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_name, product_id, quantity,
                      unit_price, total_price, status, carrier_id, warehouse_id)
  VALUES (v_ord, current_setting('t.market')::UUID, current_setting('t.store')::UUID,
          'SQLTEST-' || current_setting('t.tag') || '-2', 'manual',
          'Client Test 2', '20000002', 'SQLTEST Doudoune', v_p, 51, 129, 6579,
          'uploaded', current_setting('t.carrier')::UUID, current_setting('t.site')::UUID);

  -- 50 Petit alors que Petit n'en a que 40 — mais le PRODUIT en a 100. Sans
  -- garde à la variante, le scan passerait et Petit finirait à −10.
  INSERT INTO order_items (order_id, product_id, product_name, variant_id,
                           variant_label, quantity, unit_price, line_total)
  VALUES (v_ord, v_p, 'SQLTEST Doudoune', v_vp, 'Petit', 50, 129, 6450),
         (v_ord, v_p, 'SQLTEST Doudoune', v_vg, 'Grand',  1, 149,  149);

  INSERT INTO label_prints (order_id, market_id, printed_by, batch_id)
  VALUES (v_ord, current_setting('t.market')::UUID, v_sa, gen_random_uuid());

  PERFORM pg_temp.ok(
    pg_temp.err(format('SELECT scan_order_out(%L::UUID, %L::UUID, NULL)', v_ord, v_sa)) <> 'NO_ERROR',
    'le scan est refusé quand une variante manque de stock');

  -- Tout ou rien : la ligne Grand ne doit PAS avoir bougé.
  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vg), 60,
    'Grand n''a pas bougé — le refus est total');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 100,
    'le total marché n''a pas bougé');
  PERFORM pg_temp.eq((SELECT status::TEXT FROM orders WHERE id = v_ord), 'uploaded',
    'la commande est restée « uploaded »');
END
$t6$;

\echo ''
\echo '── 7. le sous-débit AGRÉGÉ : deux variantes d''un produit trop juste ──'

DO $t7$
DECLARE
  v_p   UUID := current_setting('t.prod')::UUID;
  v_vp  UUID := current_setting('t.petit')::UUID;
  v_vg  UUID := current_setting('t.grand')::UUID;
  v_ord UUID := gen_random_uuid();
  v_sa  UUID := current_setting('t.sa')::UUID;
BEGIN
  -- Petit 40 + Grand 60 = 100 = le total. Une commande de 40 Petit ET 60 Grand
  -- passe tout juste ; la même plus une unité doit être refusée AU NIVEAU DU
  -- PRODUIT. C'est le trou qu'ouvre le passage au grain « variante » : chaque
  -- ligne passe son propre test, et leur somme dépasse.
  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_name, product_id, quantity,
                      unit_price, total_price, status, carrier_id, warehouse_id)
  VALUES (v_ord, current_setting('t.market')::UUID, current_setting('t.store')::UUID,
          'SQLTEST-' || current_setting('t.tag') || '-3', 'manual',
          'Client Test 3', '20000003', 'SQLTEST Doudoune', v_p, 101, 129, 13029,
          'uploaded', current_setting('t.carrier')::UUID, current_setting('t.site')::UUID);

  INSERT INTO order_items (order_id, product_id, product_name, variant_id,
                           variant_label, quantity, unit_price, line_total)
  VALUES (v_ord, v_p, 'SQLTEST Doudoune', v_vp, 'Petit', 40, 129, 5160),
         (v_ord, v_p, 'SQLTEST Doudoune', v_vg, 'Grand', 60, 149, 8940),
         -- La ligne de trop : sans variante, donc au niveau du produit.
         (v_ord, v_p, 'SQLTEST Doudoune', NULL, NULL,     1, 129,  129);

  INSERT INTO label_prints (order_id, market_id, printed_by, batch_id)
  VALUES (v_ord, current_setting('t.market')::UUID, v_sa, gen_random_uuid());

  PERFORM pg_temp.eq((SELECT count(*)::INTEGER FROM public.order_stock_lines(v_ord)), 3,
    'trois lignes : Petit, Grand, et le produit nu');

  PERFORM pg_temp.ok(
    pg_temp.err(format('SELECT scan_order_out(%L::UUID, %L::UUID, NULL)', v_ord, v_sa)) <> 'NO_ERROR',
    'le scan est refusé : la SOMME des lignes dépasse le total produit');

  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 100,
    'rien n''a bougé');
END
$t7$;

\echo ''
\echo '── 8. le palier, et la règle du stock NON VENTILÉ ───────────────────'

-- CE QUE CE BLOC A RÉVÉLÉ. Écrit d'abord « un palier déduit au produit », il
-- a fait exploser l'invariant au COMMIT : le produit était ventilé à 100 %
-- (Petit 40 + Grand 60 = 100), et déduire 2 unités « produit nu » faisait
-- tomber le total à 98 sous une somme de variantes restée à 100.
--
-- L'invariant avait raison. Vendre sans nommer de taille suppose qu'il reste
-- des unités NON VENTILÉES — sinon la question « laquelle des deux tailles le
-- client a-t-il reçue ? » n'a pas de réponse. D'où la règle, désormais
-- contrôlée à l'entrée du scan plutôt que constatée à la validation :
--
--     quantité sans variante <= total − somme(variantes d'attribut)
--
-- Un palier vendu correctement porte donc les DEUX colonnes : `variant_id`
-- pour la taille qui sort du rayon, `pack_variant_id` pour l'offre vendue.

DO $t8a$
DECLARE
  v_p     UUID := current_setting('t.prod')::UUID;
  v_pack  UUID := current_setting('t.pack')::UUID;
  v_vg    UUID := current_setting('t.grand')::UUID;
  v_ord   UUID := gen_random_uuid();
  v_sa    UUID := current_setting('t.sa')::UUID;
  v_grand_before INTEGER;
BEGIN
  SELECT current_stock INTO v_grand_before FROM product_variants WHERE id = v_vg;

  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_name, product_id, quantity,
                      unit_price, total_price, status, carrier_id, warehouse_id)
  VALUES (v_ord, current_setting('t.market')::UUID, current_setting('t.store')::UUID,
          'SQLTEST-' || current_setting('t.tag') || '-4', 'manual',
          'Client Test 4', '20000004', 'SQLTEST Doudoune', v_p, 2, 239, 239,
          'uploaded', current_setting('t.carrier')::UUID, current_setting('t.site')::UUID);

  -- Un « Pack 2 » de Grand : deux unités de Grand sortent du rayon, et l'offre
  -- vendue reste consignée pour le reporting commercial.
  INSERT INTO order_items (order_id, product_id, product_name, variant_id,
                           pack_variant_id, variant_label, quantity, unit_price, line_total)
  VALUES (v_ord, v_p, 'SQLTEST Doudoune', v_vg, v_pack, 'Grand · Pack 2', 2, 239, 239);

  INSERT INTO label_prints (order_id, market_id, printed_by, batch_id)
  VALUES (v_ord, current_setting('t.market')::UUID, v_sa, gen_random_uuid());

  PERFORM pg_temp.eq((SELECT l.variant_id FROM public.order_stock_lines(v_ord) l), v_vg,
    'le stock d''un palier bouge sur la variante d''attribut');

  PERFORM scan_order_out(v_ord, v_sa, NULL);

  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vg),
    v_grand_before - 2, 'Grand baisse de 2');
  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 98,
    'le total marché baisse de 2');
END
$t8a$;

-- 8b. Une ligne qui met le PALIER dans `variant_id` — ce que font les données
-- d'aujourd'hui, faute d'interface — est ramenée au produit. Elle ne peut donc
-- sortir que du non ventilé, et il n'y en a plus : refus.
DO $t8b$
DECLARE
  v_p    UUID := current_setting('t.prod')::UUID;
  v_pack UUID := current_setting('t.pack')::UUID;
  v_ord  UUID := gen_random_uuid();
  v_sa   UUID := current_setting('t.sa')::UUID;
  v_total_before INTEGER;
BEGIN
  SELECT current_stock INTO v_total_before FROM products WHERE id = v_p;

  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_name, product_id, quantity,
                      unit_price, total_price, status, carrier_id, warehouse_id)
  VALUES (v_ord, current_setting('t.market')::UUID, current_setting('t.store')::UUID,
          'SQLTEST-' || current_setting('t.tag') || '-4b', 'manual',
          'Client Test 4b', '20000014', 'SQLTEST Doudoune', v_p, 2, 239, 239,
          'uploaded', current_setting('t.carrier')::UUID, current_setting('t.site')::UUID);

  INSERT INTO order_items (order_id, product_id, product_name, variant_id,
                           variant_label, quantity, unit_price, line_total)
  VALUES (v_ord, v_p, 'SQLTEST Doudoune', v_pack, 'Pack 2', 2, 239, 239);

  INSERT INTO label_prints (order_id, market_id, printed_by, batch_id)
  VALUES (v_ord, current_setting('t.market')::UUID, v_sa, gen_random_uuid());

  PERFORM pg_temp.eq((SELECT l.variant_id FROM public.order_stock_lines(v_ord) l), NULL::UUID,
    'un palier dans variant_id est ramené au produit');

  PERFORM pg_temp.ok(
    pg_temp.err(format('SELECT scan_order_out(%L::UUID, %L::UUID, NULL)', v_ord, v_sa)) <> 'NO_ERROR',
    'refusé : il ne reste aucune unité non ventilée');

  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), v_total_before,
    'rien n''a bougé');
END
$t8b$;

-- 8c. Le même colis passe dès qu'il reste du non ventilé. La règle n'est pas
-- « pas de produit nu », c'est « pas plus que ce qui n'est pas ventilé ».
DO $t8c$
DECLARE
  v_p   UUID := current_setting('t.prod')::UUID;
  v_ord UUID := gen_random_uuid();
  v_sa  UUID := current_setting('t.sa')::UUID;
BEGIN
  -- Dix unités entrent sans être attribuées à une taille.
  PERFORM adjust_product_stock(v_p, 10, 'manual_adjustment', 'arrivage non trié', v_sa, FALSE, NULL);

  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_name, product_id, quantity,
                      unit_price, total_price, status, carrier_id, warehouse_id)
  VALUES (v_ord, current_setting('t.market')::UUID, current_setting('t.store')::UUID,
          'SQLTEST-' || current_setting('t.tag') || '-4c', 'manual',
          'Client Test 4c', '20000024', 'SQLTEST Doudoune', v_p, 2, 129, 258,
          'uploaded', current_setting('t.carrier')::UUID, current_setting('t.site')::UUID);

  INSERT INTO order_items (order_id, product_id, product_name, variant_id,
                           variant_label, quantity, unit_price, line_total)
  VALUES (v_ord, v_p, 'SQLTEST Doudoune', NULL, NULL, 2, 129, 258);

  INSERT INTO label_prints (order_id, market_id, printed_by, batch_id)
  VALUES (v_ord, current_setting('t.market')::UUID, v_sa, gen_random_uuid());

  PERFORM scan_order_out(v_ord, v_sa, NULL);

  PERFORM pg_temp.eq((SELECT current_stock FROM products WHERE id = v_p), 106,
    'le produit nu sort du non ventilé (108 − 2)');
END
$t8c$;

\echo '── 9. record_stock_count compte un site (et une variante) ────────────'

DO $t9$
DECLARE
  v_p    UUID := current_setting('t.prod')::UUID;
  v_vp   UUID := current_setting('t.petit')::UUID;
  v_site UUID := current_setting('t.site')::UUID;
  v_sa   UUID := current_setting('t.sa')::UUID;
BEGIN
  -- RÉGRESSION. Depuis que la clé de product_site_stock porte la variante, le
  -- `ON CONFLICT (product_id, warehouse_id)` de la RPC ne correspondait plus à
  -- aucun index unique : tout comptage par site mourait en 42P10.
  PERFORM pg_temp.eq(
    pg_temp.err(format(
      'SELECT record_stock_count(%L::UUID, 30, %L::UUID, ''comptage sans variante'', %L::UUID)',
      v_p, v_sa, v_site)),
    'NO_ERROR', 'un comptage de site sans variante fonctionne');

  PERFORM pg_temp.eq(
    (SELECT current_stock FROM product_site_stock
      WHERE product_id = v_p AND warehouse_id = v_site AND variant_id IS NULL), 30,
    'la ligne de site sans variante porte 30');

  PERFORM pg_temp.eq(
    pg_temp.err(format(
      'SELECT record_stock_count(%L::UUID, 12, %L::UUID, ''comptage Petit'', %L::UUID, %L::UUID)',
      v_p, v_sa, v_site, v_vp)),
    'NO_ERROR', 'un comptage de variante par site fonctionne');

  PERFORM pg_temp.eq(
    (SELECT current_stock FROM product_site_stock
      WHERE product_id = v_p AND warehouse_id = v_site AND variant_id = v_vp), 12,
    'la ligne de site Petit porte 12');

  PERFORM pg_temp.eq(
    (SELECT count(*)::INTEGER FROM product_site_stock
      WHERE product_id = v_p AND warehouse_id = v_site), 2,
    'les deux lignes de site coexistent (variante NULL, et Petit)');

  -- Un comptage POSE une valeur, il ne se propage pas : le trigger de
  -- ventilation s'arrête sur 'stock_count'. C'est la RPC qui reporte l'écart.
  --
  -- CHANGÉ LE 2026-10-02 (20261002190000_record_stock_count_draws_from_pool).
  -- Ce test attendait 40 + 12 = 52 : le bâtiment jamais compté était lu comme
  -- tenant zéro, et ses 12 s'AJOUTAIENT aux 40 de la variante. C'était le bug
  -- qui doublait le stock au premier comptage. La Tunisie n'a qu'un bâtiment :
  -- le compter, c'est compter le marché — Petit vaut ce qu'on a compté.
  -- Les cas à deux bâtiments sont dans stock_count_pool_test.sql.
  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vp), 12,
    'un marché à un bâtiment : la variante vaut le comptage du bâtiment');
END
$t9$;

\echo ''
\echo '── 10. scan_return_in rend la variante ──────────────────────────────'

DO $t10$
DECLARE
  v_p   UUID := current_setting('t.prod')::UUID;
  v_vg  UUID := current_setting('t.grand')::UUID;
  v_ord UUID := gen_random_uuid();
  v_sa  UUID := current_setting('t.sa')::UUID;
  v_before INTEGER;
BEGIN
  SELECT current_stock INTO v_before FROM product_variants WHERE id = v_vg;

  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_name, product_id, quantity,
                      unit_price, total_price, status, carrier_id, warehouse_id)
  VALUES (v_ord, current_setting('t.market')::UUID, current_setting('t.store')::UUID,
          'SQLTEST-' || current_setting('t.tag') || '-5', 'manual',
          'Client Test 5', '20000005', 'SQLTEST Doudoune', v_p, 4, 149, 596,
          'to_be_returned', current_setting('t.carrier')::UUID, current_setting('t.site')::UUID);

  INSERT INTO order_items (order_id, product_id, product_name, variant_id,
                           variant_label, quantity, unit_price, line_total)
  VALUES (v_ord, v_p, 'SQLTEST Doudoune', v_vg, 'Grand', 4, 149, 596);

  PERFORM scan_return_in(v_ord, v_sa, FALSE, NULL, NULL, NULL);

  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vg),
    v_before + 4, 'le retour recrédite la variante Grand');
  PERFORM pg_temp.eq(
    (SELECT variant_id FROM inventory_log WHERE order_id = v_ord AND reason = 'returned' LIMIT 1),
    v_vg, 'la ligne de retour nomme la variante');
END
$t10$;

\echo ''
\echo '── 11. un retour ENDOMMAGÉ alimente la casse, pas le stock ───────────'

DO $t11$
DECLARE
  v_p   UUID := current_setting('t.prod')::UUID;
  v_vg  UUID := current_setting('t.grand')::UUID;
  v_ord UUID := gen_random_uuid();
  v_sa  UUID := current_setting('t.sa')::UUID;
  v_stock_before INTEGER;
  v_dmg_before   INTEGER;
BEGIN
  SELECT current_stock, damaged_return_count INTO v_stock_before, v_dmg_before
    FROM product_variants WHERE id = v_vg;

  INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                      customer_name, customer_phone, product_name, product_id, quantity,
                      unit_price, total_price, status, carrier_id, warehouse_id)
  VALUES (v_ord, current_setting('t.market')::UUID, current_setting('t.store')::UUID,
          'SQLTEST-' || current_setting('t.tag') || '-6', 'manual',
          'Client Test 6', '20000006', 'SQLTEST Doudoune', v_p, 3, 149, 447,
          'to_be_returned', current_setting('t.carrier')::UUID, current_setting('t.site')::UUID);

  INSERT INTO order_items (order_id, product_id, product_name, variant_id,
                           variant_label, quantity, unit_price, line_total)
  VALUES (v_ord, v_p, 'SQLTEST Doudoune', v_vg, 'Grand', 3, 149, 447);

  PERFORM scan_return_in(v_ord, v_sa, TRUE, 'other', NULL, 'écrasé au transport');

  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vg),
    v_stock_before, 'le stock de la variante ne bouge pas');
  PERFORM pg_temp.eq((SELECT damaged_return_count FROM product_variants WHERE id = v_vg),
    v_dmg_before + 3, 'la casse de la variante monte de 3');
END
$t11$;

\echo ''
\echo '── 12. l''inégalité tient AU COMMIT, pas seulement en théorie ────────'

-- 12a. Monter un comptage de site au-dessus de ce que la variante portait
-- n'est pas une faute : la variante suit l'écart, et le total produit aussi.
-- Ce bloc n'attrape rien volontairement — les invariants sont des contraintes
-- DIFFÉRÉES, évaluées à la validation implicite qui suit le bloc. S'ils se
-- déclenchaient à tort, psql sortirait en erreur et le test échouerait ici.
DO $t12a$
DECLARE
  v_p    UUID := current_setting('t.prod')::UUID;
  v_vp   UUID := current_setting('t.petit')::UUID;
  v_site UUID := current_setting('t.site')::UUID;
  v_sa   UUID := current_setting('t.sa')::UUID;
  v_petit INTEGER;
  v_site_before INTEGER;
  v_counted INTEGER;
BEGIN
  SELECT current_stock INTO v_petit FROM product_variants WHERE id = v_vp;
  SELECT current_stock INTO v_site_before FROM product_site_stock
   WHERE product_id = v_p AND variant_id = v_vp AND warehouse_id = v_site;

  v_counted := v_petit + 500;
  PERFORM record_stock_count(v_p, v_counted, v_sa, 'gros réassort Petit', v_site, v_vp);

  -- UN COMPTAGE DE SITE NE POSE PAS LE TOTAL DE LA VARIANTE. Il pose la valeur
  -- DU SITE, et reporte l'ÉCART sur la variante — qui peut être présente dans
  -- d'autres bâtiments. Confondre les deux ferait disparaître le stock des
  -- autres sites à chaque comptage.
  PERFORM pg_temp.eq(
    (SELECT current_stock FROM product_site_stock
      WHERE product_id = v_p AND variant_id = v_vp AND warehouse_id = v_site),
    v_counted, 'la ligne de site porte le compté');
  PERFORM pg_temp.eq((SELECT current_stock FROM product_variants WHERE id = v_vp),
    v_petit + (v_counted - v_site_before),
    'la variante bouge de l''ÉCART du comptage, pas du compté');
END
$t12a$;

-- 12b. En revanche, faire tomber le TOTAL PRODUIT sous la somme de ses
-- variantes doit être refusé.
--
-- POURQUOI UNE TRANSACTION EXPLICITE, ET PAS pg_temp.err(). L'invariant est un
-- CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED : il ne s'évalue qu'au
-- COMMIT, donc HORS de tout bloc PL/pgSQL, où aucun `EXCEPTION WHEN` ne peut
-- le voir. Un `err()` rendrait « NO_ERROR » et le test se croirait vert — mot
-- pour mot le piège que documente 20260909195032, où l'invariant par site
-- avait été « vérifié » à travers un ROLLBACK et plantait en vrai. On laisse
-- donc le COMMIT échouer, et on prouve le refus par son seul effet observable.
--
-- `SET CONSTRAINTS ALL IMMEDIATE` ne conviendrait pas non plus : il ferait
-- contrôler des états INTERMÉDIAIRES qu'une opération en plusieurs écritures
-- traverse forcément, et que le différé existe précisément pour ignorer.

-- `\gset` + `:avant` ne conviendrait PAS : psql ne substitue pas ses variables
-- à l'intérieur d'une chaîne dollar-quotée, donc `:avant` arriverait tel quel
-- dans le bloc DO et lèverait une erreur de syntaxe. On passe donc par un
-- réglage de session, lisible des deux côtés.
SELECT set_config('t.avant', current_stock::TEXT, FALSE)
  FROM products WHERE id = current_setting('t.prod')::UUID;

\set ON_ERROR_STOP off
BEGIN;
SELECT adjust_product_stock(
  current_setting('t.prod')::UUID,
  -(SELECT current_stock FROM product_variants WHERE id = current_setting('t.petit')::UUID)::INTEGER,
  'manual_adjustment', 'retrait qui viderait le produit sous ses variantes',
  current_setting('t.sa')::UUID, FALSE, NULL);
COMMIT;
\set ON_ERROR_STOP on

DO $t12b$
BEGIN
  PERFORM pg_temp.eq(
    (SELECT current_stock FROM products WHERE id = current_setting('t.prod')::UUID),
    current_setting('t.avant')::INTEGER,
    'le total produit n''a pas bougé — le retrait a été refusé');
END
$t12b$;

-- 12c. Et le FILET : la garde ci-dessus vit dans la RPC, donc quiconque écrit
-- `products` directement la contourne. Le déclencheur d'invariant doit refuser,
-- quel que soit le chemin.
--
-- On rend IMMÉDIAT CE SEUL déclencheur, nommément. Un `SET CONSTRAINTS ALL
-- IMMEDIATE` ferait contrôler des états intermédiaires que le différé existe
-- pour ignorer ; et laisser échouer le COMMIT prouverait seulement qu'« un »
-- invariant a refusé — la première version de ce test passait au vert alors
-- que c'était `assert_site_stock_within_total` qui se déclenchait, pas celui
-- des variantes. Nommer la contrainte, c'est tester ce qu'on croit tester.
DO $t12c$
DECLARE
  v_state TEXT;
  v_before INTEGER;
BEGIN
  SET CONSTRAINTS trg_products_total_covers_variants IMMEDIATE;

  SELECT current_stock INTO v_before FROM products WHERE id = current_setting('t.prod')::UUID;

  v_state := pg_temp.err(format(
    'UPDATE products SET current_stock = %s WHERE id = %L',
    -- Au-dessus de ce que les sites déclarent (pour que l'invariant de site ne
    -- se déclenche pas), mais sous la somme des variantes.
    (SELECT COALESCE(SUM(current_stock), 0) FROM product_site_stock
      WHERE product_id = current_setting('t.prod')::UUID),
    current_setting('t.prod')::UUID));

  PERFORM pg_temp.eq(v_state, '23514',
    'le déclencheur des VARIANTES refuse un UPDATE direct de products');
  PERFORM pg_temp.eq(
    (SELECT current_stock FROM products WHERE id = current_setting('t.prod')::UUID),
    v_before, 'et rien n''a bougé');
END
$t12c$;

\echo '── 13. rien n''est resté exécutable par anon ─────────────────────────'

DO $t13$
DECLARE
  v_open TEXT;
BEGIN
  SELECT string_agg(p.oid::regprocedure::TEXT, ', ') INTO v_open
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.proname IN ('order_stock_lines','scan_order_out','unscan_order',
                      'scan_return_in','scan_received_in','record_stock_count',
                      'adjust_product_stock','manual_delete_orders')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  PERFORM pg_temp.ok(v_open IS NULL,
    'aucune RPC de stock n''est exécutable sans connexion'
    || COALESCE(' — ouvertes : ' || v_open, ''));

  -- `order_stock_lines` ne prend pas d'acteur : même connecté, personne ne
  -- doit pouvoir lire le contenu de n'importe quelle commande.
  PERFORM pg_temp.ok(
    NOT has_function_privilege('authenticated', 'public.order_stock_lines(uuid)', 'EXECUTE'),
    'order_stock_lines reste interne, même pour un utilisateur connecté');
END
$t13$;

\echo ''
\echo '✅ stock_variant_axis_test.sql — toutes les assertions passent'
