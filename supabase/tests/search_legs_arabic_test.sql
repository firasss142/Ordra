-- Recherche — les variantes d'écriture arabes dans get_order_facet_counts
-- (20261002000207_search_legs_arabic_variants.sql).
--
-- CE QUE CE FICHIER PROUVE
--   1. Une jambe `op: imatch` est une expression régulière insensible à la casse :
--      « [اأإآ]حمد » trouve أحمد, احمد et إحمد. Avant la migration, le motif
--      était lu comme du texte ILIKE et ne trouvait rien.
--   2. Une jambe sans `op` garde son ILIKE d'avant, à l'octet près : « احمد »
--      ne trouve que احمد. Les appelants qui n'envoient pas `op` ne changent pas.
--   3. Les termes restent en ET : le motif ET l'étiquette du test.
--
-- lib/orders/search-query construit les jambes ; ce test ne vérifie que la
-- façon dont le SQL les lit, pour que le nombre d'une facette et les lignes
-- de la liste (PostgREST `imatch`) restent d'accord.

\set ON_ERROR_STOP on
\i _helpers.sql

DO $fixture$
DECLARE
  v_tn    UUID := '00000000-0000-0000-0000-000000000001';
  v_tag   TEXT := 'SQLAR' || substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  v_store UUID;
  v_names TEXT[] := ARRAY['أحمد', 'احمد', 'إحمد', 'فاطمة', 'Hèla', 'HÉLA', 'Hela'];
  i       INT;
BEGIN
  SELECT id INTO v_store FROM storefronts WHERE market_id = v_tn LIMIT 1;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Fixture incomplète : aucune boutique TN'; END IF;

  FOR i IN 1 .. array_length(v_names, 1) LOOP
    INSERT INTO orders (market_id, storefront_id, external_id, external_platform,
                        customer_name, customer_phone, product_name, quantity, unit_price, total_price,
                        status)
    VALUES (v_tn, v_store, v_tag || '-' || i, 'manual',
            v_names[i] || ' ' || v_tag, '9' || lpad((floor(random() * 10000000))::TEXT, 7, '0'),
            'SQLTEST AR', 1, 50, 50, 'pending');
  END LOOP;

  PERFORM set_config('sqltest.tag', v_tag, false);
END $fixture$;

CREATE OR REPLACE FUNCTION pg_temp.hits(p_legs JSONB)
RETURNS INT LANGUAGE sql AS $$
  SELECT coalesce(sum(value::INT), 0)::INT
  FROM jsonb_each_text(
    public.get_order_facet_counts(
      p_market_id    => '00000000-0000-0000-0000-000000000001',
      p_search_legs  => p_legs
    ) -> 'statuses'
  );
$$;

SELECT pg_temp.eq(
  pg_temp.hits(jsonb_build_array(
    jsonb_build_array(jsonb_build_object('c', 'customer_name', 'v', '[اأإآ]حمد', 'op', 'imatch')),
    jsonb_build_array(jsonb_build_object('c', 'customer_name', 'v', current_setting('sqltest.tag')))
  )),
  3,
  '1. un motif imatch trouve أحمد, احمد et إحمد'
);

SELECT pg_temp.eq(
  pg_temp.hits(jsonb_build_array(
    jsonb_build_array(jsonb_build_object('c', 'customer_name', 'v', 'احمد')),
    jsonb_build_array(jsonb_build_object('c', 'customer_name', 'v', current_setting('sqltest.tag')))
  )),
  1,
  '2. une jambe sans op reste un ILIKE littéral'
);

SELECT pg_temp.eq(
  pg_temp.hits(jsonb_build_array(
    jsonb_build_array(jsonb_build_object('c', 'customer_name', 'v', 'ف[اأإآ]طم[هة]', 'op', 'imatch')),
    jsonb_build_array(jsonb_build_object('c', 'customer_name', 'v', current_setting('sqltest.tag')))
  )),
  1,
  '3. les termes restent en ET, et ة se trouve par [هة]'
);

SELECT pg_temp.eq(
  pg_temp.hits(jsonb_build_array(
    jsonb_build_array(jsonb_build_object('c', 'customer_name', 'v', 'h[eéèêë]l[aàâäá]', 'op', 'imatch')),
    jsonb_build_array(jsonb_build_object('c', 'customer_name', 'v', current_setting('sqltest.tag')))
  )),
  3,
  '4. les accents aussi : Hèla, HÉLA et Hela, majuscules comprises'
);
