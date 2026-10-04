-- Salle de contrôle v6 — la couleur de chaque agent (20261004200000_team_room_v6_agent_colour.sql).
--
-- CE QUE CE FICHIER PROUVE
--   1. Un agent créé sans couleur reçoit la teinte la MOINS portée de son marché
--      (la première de la palette à égalité) ; deux agents créés à la suite n'ont
--      pas la même tant qu'il reste une teinte libre.
--   2. Une couleur posée ne bouge pas quand un autre agent arrive.
--   3. Changer de marché redonne une couleur libre dans le nouveau marché.
--   4. La contrainte refuse une clé hors palette.
--   5. Un utilisateur connecté ne peut PAS écrire sa couleur (pas de privilège
--      UPDATE sur la colonne) — l'escalade « colonne aveugle » ne revient pas.
--   6. get_team_day et get_team_funnel rendent `color` pour chaque agent.

\set ON_ERROR_STOP on
\i _helpers.sql

DO $t$
DECLARE
  v_tn   UUID := '00000000-0000-0000-0000-000000000001';
  v_ly   UUID := '00000000-0000-0000-0000-000000000002';
  v_sa   UUID := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_a    UUID := gen_random_uuid();
  v_b    UUID := gen_random_uuid();
  v_tag  TEXT := substr(replace(v_a::TEXT, '-', ''), 1, 8);
  v_want TEXT;
  v_ca   TEXT;
  v_cb   TEXT;
  v_day  JSONB;
  v_fun  JSONB;
BEGIN
  -- 1. the least-worn hue
  v_want := (
    SELECT k.key FROM unnest(ARRAY['indigo','pink','cyan','gold','lime','orange']) WITH ORDINALITY k(key, ord)
    LEFT JOIN users u ON u.color = k.key AND u.market_id = v_tn AND u.role = 'agent' AND u.deleted_at IS NULL
    GROUP BY k.key, k.ord ORDER BY count(u.id), k.ord LIMIT 1);

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (v_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.col.a.' || v_tag || '@oms.local', 'x', now(), now(), now()),
         (v_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest.col.b.' || v_tag || '@oms.local', 'x', now(), now(), now());
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES (v_a, 'sqltest.col.a.' || v_tag || '@oms.local', 'SQL Col A ' || v_tag, 'agent', v_tn, TRUE);
  SELECT color INTO v_ca FROM users WHERE id = v_a;
  PERFORM pg_temp.eq(v_ca, v_want, '1. a new agent wears the least-worn hue of her market');

  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES (v_b, 'sqltest.col.b.' || v_tag || '@oms.local', 'SQL Col B ' || v_tag, 'agent', v_tn, TRUE);
  SELECT color INTO v_cb FROM users WHERE id = v_b;
  PERFORM pg_temp.ok(v_cb IS NOT NULL, '1. the second one gets a hue too');

  -- 2. stays put
  PERFORM pg_temp.eq((SELECT color FROM users WHERE id = v_a), v_ca, '2. her hue did not move when another agent arrived');
  UPDATE users SET full_name = full_name || '.' WHERE id = v_a;
  PERFORM pg_temp.eq((SELECT color FROM users WHERE id = v_a), v_ca, '2. an unrelated edit keeps it');

  -- 3. moving market re-picks in the new market
  UPDATE users SET market_id = v_ly WHERE id = v_b;
  PERFORM pg_temp.ok((SELECT color FROM users WHERE id = v_b) = agent_color_pick(v_ly, v_b),
                     '3. moving market picks the least-worn hue there');

  -- 4. the palette is closed
  PERFORM pg_temp.ok(pg_temp.err(format('UPDATE users SET color = %L WHERE id = %L', 'teal', v_a)) = '23514',
                     '4. a key outside the palette is refused');

  -- 5. nobody writes their own colour
  PERFORM pg_temp.ok(NOT has_column_privilege('authenticated', 'public.users', 'color', 'UPDATE'),
                     '5. authenticated has no UPDATE on users.color');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public.agent_color_pick(uuid, uuid)', 'EXECUTE'),
                     '5. agent_color_pick is not callable by a client');

  -- 6. the reads carry it
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);
  v_day := get_team_day(v_tn, current_date, 'Africa/Tunis');
  v_fun := get_team_funnel(v_tn, current_date - 29, current_date, 'Africa/Tunis');
  PERFORM pg_temp.eq((SELECT a->>'color' FROM jsonb_array_elements(v_day->'agents') a WHERE a->>'agent_id' = v_a::text), v_ca,
                     '6. get_team_day returns her colour');
  PERFORM pg_temp.eq((SELECT a->>'color' FROM jsonb_array_elements(v_fun->'agents') a WHERE a->>'agent_id' = v_a::text), v_ca,
                     '6. get_team_funnel returns her colour');
END
$t$;
