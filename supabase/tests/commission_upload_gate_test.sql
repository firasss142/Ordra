-- Commissions — une commande ne compte que si elle a été téléversée APRÈS
-- l'activation de la commission de l'agent (20260926132710_commission_upload_gate.sql).
--
-- CE QUE CE FICHIER PROUVE
--   1. Le balayage n'acquiert rien pour une commande téléversée un jour où la
--      commission de l'agent était coupée, même livrée après l'activation.
--   2. Il acquiert une commande téléversée après l'activation, et une commande
--      RE-téléversée après l'activation (c'est le dernier téléversement avant
--      la livraison qui compte). Le jour est celui du MARCHÉ : 00:30 heure de
--      Tunis le jour de l'activation compte, alors que c'est la veille en UTC.
--   3. La correction ponctuelle annule, une seule fois, une acquisition déjà
--      écrite pour une commande téléversée avant l'activation — datée comme
--      l'acquisition qu'elle annule, motif `uploaded_before_activation`.
--   4. Les écrans : « livrées » ne compte plus une acquisition annulée
--      (get_team_commissions et get_my_commissions), le jour porte le motif de
--      la correction, et « en cours » ignore un colis téléversé avant l'activation.
--
-- Les dates sont relatives à aujourd'hui : get_my_commissions ne remonte
-- que 366 jours.

\set ON_ERROR_STOP on
\i _helpers.sql

DO $fixture$
DECLARE
  v_tn    UUID := '00000000-0000-0000-0000-000000000001';
  v_sa    UUID := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_ag    UUID := gen_random_uuid();
  v_tag   TEXT := substr(replace(v_ag::TEXT, '-', ''), 1, 8);
  v_store UUID;
  d0      DATE := current_date - 40;          -- le marché s'allume
  d_on    DATE := current_date - 30;          -- l'agent s'allume
  d_end   DATE := current_date - 10;          -- tout se referme (base locale propre)
  v_o     UUID[] := ARRAY[]::UUID[];
  i       INT;
BEGIN
  SELECT id INTO v_store FROM storefronts WHERE market_id = v_tn LIMIT 1;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Fixture incomplète : aucune boutique TN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_sa AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Fixture incomplète : super_admin % absent', v_sa;
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (v_ag, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'sqltest.comm.' || v_tag || '@oms.local', 'x', now(), now(), now());
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES (v_ag, 'sqltest.comm.' || v_tag || '@oms.local', 'SQL Comm ' || v_tag, 'agent', v_tn, TRUE);

  -- Taux : marché 5 sur [d0, d_end) ; agent coupé sur [d0, d_on), 9 sur [d_on, d_end).
  INSERT INTO agent_commission_rates (market_id, agent_id, enabled, amount, effective_from, effective_to, set_by, note)
  VALUES (v_tn, NULL,  TRUE,  5, d0,   d_end, v_sa, 'sqltest-comm-' || v_tag),
         (v_tn, v_ag,  FALSE, 0, d0,   d_on,  v_sa, 'sqltest-comm-' || v_tag),
         (v_tn, v_ag,  TRUE,  9, d_on, d_end, v_sa, 'sqltest-comm-' || v_tag);

  -- 7 commandes, toutes confirmées par l'agent.
  FOR i IN 1..7 LOOP
    v_o := v_o || gen_random_uuid();
    INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                        customer_name, customer_phone, product_name, quantity, unit_price, total_price,
                        status, assigned_to)
    VALUES (v_o[i], v_tn, v_store, 'SQLTEST-COMM-' || v_tag || '-' || i, 'manual',
            'Client comm', '2' || lpad((floor(random() * 10000000))::TEXT, 7, '0'),
            'SQLTEST COMM', 1, 50, 50,
            (CASE WHEN i IN (6, 7) THEN 'in_transit' ELSE 'delivered' END)::order_status, v_ag);
  END LOOP;

  -- Historique, en heure de Tunis.
  --  o1 : téléversée avant l'activation, livrée après     → rien
  --  o2 : téléversée après                                 → 9
  --  o3 : téléversée avant, RE-téléversée après            → 9
  --  o4 : téléversée à 00:30 le jour même de l'activation  → 9
  --  o5 : téléversée avant, DÉJÀ acquise (ancien balayage) → la correction l'annule
  --  o6 : en transit, téléversée avant                     → hors « en cours »
  --  o7 : en transit, téléversée après                     → dans « en cours »
  INSERT INTO order_history (order_id, market_id, status_from, status_to, actor_id, actor_type, created_at)
  SELECT o, v_tn, f::order_status, t::order_status, CASE WHEN t = 'delivered' THEN NULL ELSE v_ag END,
         CASE WHEN t = 'delivered' THEN 'system' ELSE 'agent' END,
         (ts::timestamp AT TIME ZONE 'Africa/Tunis')
  FROM (VALUES
    (v_o[1], 'pending',   'confirmed', (d_on - 5)  + time '10:00'),
    (v_o[1], 'confirmed', 'uploaded',  (d_on - 5)  + time '11:00'),
    (v_o[1], 'uploaded',  'delivered', (d_on + 5)  + time '15:00'),
    (v_o[2], 'pending',   'confirmed', (d_on + 1)  + time '10:00'),
    (v_o[2], 'confirmed', 'uploaded',  (d_on + 1)  + time '11:00'),
    (v_o[2], 'uploaded',  'delivered', (d_on + 5)  + time '15:00'),
    (v_o[3], 'pending',   'confirmed', (d_on - 5)  + time '10:00'),
    (v_o[3], 'confirmed', 'uploaded',  (d_on - 5)  + time '11:00'),
    (v_o[3], 'uploaded',  'uploaded',  (d_on + 2)  + time '11:00'),
    (v_o[3], 'uploaded',  'delivered', (d_on + 5)  + time '15:00'),
    (v_o[4], 'pending',   'confirmed', (d_on - 1)  + time '23:00'),
    (v_o[4], 'confirmed', 'uploaded',  d_on        + time '00:30'),
    (v_o[4], 'uploaded',  'delivered', (d_on + 5)  + time '15:00'),
    (v_o[5], 'pending',   'confirmed', (d_on - 5)  + time '10:00'),
    (v_o[5], 'confirmed', 'uploaded',  (d_on - 5)  + time '11:00'),
    (v_o[5], 'uploaded',  'delivered', (d_on + 5)  + time '15:00'),
    (v_o[6], 'pending',   'confirmed', (d_on - 5)  + time '10:00'),
    (v_o[6], 'confirmed', 'uploaded',  (d_on - 5)  + time '11:00'),
    (v_o[7], 'pending',   'confirmed', (d_on + 1)  + time '10:00'),
    (v_o[7], 'confirmed', 'uploaded',  (d_on + 1)  + time '11:00')
  ) AS h(o, f, t, ts);

  -- o5 : l'acquisition que l'ancien balayage (sans garde) avait écrite.
  INSERT INTO agent_commission_ledger (market_id, agent_id, order_id, entry_type, amount, rate_amount, effective_at)
  VALUES (v_tn, v_ag, v_o[5], 'accrual', 9, 9, (((d_on + 5) + time '15:00')::timestamp AT TIME ZONE 'Africa/Tunis'));

  PERFORM set_config('r.ag', v_ag::TEXT, FALSE);
  PERFORM set_config('r.sa', v_sa::TEXT, FALSE);
  PERFORM set_config('r.tag', v_tag, FALSE);
  PERFORM set_config('r.d0', d0::TEXT, FALSE);
  PERFORM set_config('r.don', d_on::TEXT, FALSE);
  FOR i IN 1..7 LOOP PERFORM set_config('r.o' || i, v_o[i]::TEXT, FALSE); END LOOP;
END $fixture$;

\echo '── 1–2. le balayage : téléversement avant l''activation → rien ──────────'
DO $t$
DECLARE
  v_ag UUID := current_setting('r.ag')::UUID;
BEGIN
  PERFORM accrue_agent_commissions('00000000-0000-0000-0000-000000000001');

  PERFORM pg_temp.eq((SELECT count(*)::INT FROM agent_commission_ledger
                      WHERE order_id = current_setting('r.o1')::UUID),
    0, 'o1 téléversée avant l''activation, livrée après : aucune acquisition');
  PERFORM pg_temp.eq((SELECT amount FROM agent_commission_ledger
                      WHERE order_id = current_setting('r.o2')::UUID AND entry_type = 'accrual'),
    9.000::NUMERIC, 'o2 téléversée après l''activation : acquise au taux de l''agent');
  PERFORM pg_temp.eq((SELECT amount FROM agent_commission_ledger
                      WHERE order_id = current_setting('r.o3')::UUID AND entry_type = 'accrual'),
    9.000::NUMERIC, 'o3 re-téléversée après l''activation : le dernier téléversement compte');
  PERFORM pg_temp.eq((SELECT amount FROM agent_commission_ledger
                      WHERE order_id = current_setting('r.o4')::UUID AND entry_type = 'accrual'),
    9.000::NUMERIC, 'o4 téléversée à 00:30 heure de Tunis le jour de l''activation : acquise');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM agent_commission_ledger
                      WHERE order_id = current_setting('r.o5')::UUID),
    1, 'o5 déjà acquise : le balayage n''y touche pas');
END $t$;

\echo '── 3. la correction ponctuelle ──────────────────────────────────────────'
DO $t$
DECLARE
  v_n1 INT;
  v_n2 INT;
  r    RECORD;
BEGIN
  v_n1 := reverse_commissions_uploaded_before_activation('00000000-0000-0000-0000-000000000001');
  v_n2 := reverse_commissions_uploaded_before_activation('00000000-0000-0000-0000-000000000001');

  SELECT l.amount, l.reversal_reason, l.effective_at, a.effective_at AS accrual_at INTO r
  FROM agent_commission_ledger l
  JOIN agent_commission_ledger a ON a.order_id = l.order_id AND a.entry_type = 'accrual'
  WHERE l.order_id = current_setting('r.o5')::UUID AND l.entry_type = 'reversal';

  PERFORM pg_temp.ok(v_n1 >= 1, 'la correction annule au moins o5');
  PERFORM pg_temp.eq(v_n2, 0, 'relancée, elle n''annule rien de plus');
  PERFORM pg_temp.eq(r.amount, -9.000::NUMERIC, 'o5 : écriture inverse de −9');
  PERFORM pg_temp.eq(r.reversal_reason, 'uploaded_before_activation', 'o5 : motif uploaded_before_activation');
  PERFORM pg_temp.eq(r.effective_at, r.accrual_at, 'o5 : datée comme l''acquisition qu''elle annule');
  PERFORM pg_temp.eq((SELECT count(*)::INT FROM agent_commission_ledger
                      WHERE entry_type = 'reversal'
                        AND order_id IN (current_setting('r.o2')::UUID, current_setting('r.o3')::UUID,
                                         current_setting('r.o4')::UUID)),
    0, 'o2, o3, o4 ne sont pas annulées');
END $t$;

\echo '── 4. ce que les écrans lisent ──────────────────────────────────────────'
DO $t$
DECLARE
  v_ag   UUID := current_setting('r.ag')::UUID;
  v_team JSONB;
  v_me   JSONB;
  v_row  JSONB;
  v_day  JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', current_setting('r.sa'), 'role', 'authenticated')::TEXT, TRUE);
  v_team := get_team_commissions('00000000-0000-0000-0000-000000000001',
                                 current_setting('r.d0')::DATE, current_date, 'Africa/Tunis');
  SELECT a INTO v_row FROM jsonb_array_elements(v_team->'agents') a WHERE a->>'agent_id' = v_ag::TEXT;

  PERFORM pg_temp.eq((v_row->>'delivered')::INT, 3, 'équipe : livrées = 3 (o5 annulée ne compte plus)');
  PERFORM pg_temp.eq((v_row->>'earned')::NUMERIC, 27.000::NUMERIC, 'équipe : acquis sur la période = 27');
  PERFORM pg_temp.eq((v_row->>'pending_count')::INT, 1, 'équipe : en cours = o7 seulement (o6 téléversée avant)');

  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_ag, 'role', 'authenticated')::TEXT, TRUE);
  v_me := get_my_commissions(60);
  SELECT d INTO v_day FROM jsonb_array_elements(v_me->'history') d
  WHERE d->>'type' = 'day' AND (d->>'day')::DATE = current_setting('r.don')::DATE + 5;

  PERFORM pg_temp.eq((v_day->>'delivered')::INT, 3, 'agent : le jour compte 3 livrées');
  PERFORM pg_temp.eq((v_day->>'corrections')::INT, 1, 'agent : et 1 correction, le même jour');
  PERFORM pg_temp.eq((v_day->>'amount')::NUMERIC, 27.000::NUMERIC, 'agent : montant du jour = 27');
  PERFORM pg_temp.eq(
    (SELECT o->>'reason' FROM jsonb_array_elements(v_day->'orders') o WHERE o->>'entry_type' = 'reversal'),
    'uploaded_before_activation', 'agent : la correction porte son motif');
  PERFORM pg_temp.eq((v_me->'inflight'->>'count')::INT, 1, 'agent : en cours = 1');
  PERFORM pg_temp.eq((v_me->>'balance')::NUMERIC, 27.000::NUMERIC, 'agent : solde = 27');

  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t$;

-- Les taux de test sont refermés (d_end dans le passé) ; on les retire quand même.
DELETE FROM agent_commission_rates WHERE note = 'sqltest-comm-' || current_setting('r.tag');
