-- Mes commissions v2 — get_my_commission_statement() (plans/agent-commissions-v2.md).
--
-- CE QUE CE FICHIER PROUVE
--   1. FIFO : les paiements règlent d'abord les livraisons les plus anciennes ; une commande
--      à cheval sur deux paiements est « split » sur celui qui la termine ; celle qui chevauche
--      le dernier paiement est « partial » et ne montre que son reste — Σ impayées = solde.
--   2. En route : les statuts Darb comptent (at_carrier, delivery_delayed, to_be_returned),
--      « returning » est compté mais hors estimation, et un colis téléversé pendant que la
--      commission était coupée n'y est pas.
--   3. Sans commission : annulée par le transporteur, rejetée, téléversée avant l'activation
--      (annulée ou jamais acquise) — et une livraison qui attend le balayage n'y est PAS.
--   4. Entonnoir et taux de livraison, taux du jour avec l'ancien taux, date d'activation.
--   5. get_team_commissions.pending_count utilise la même définition (le bug « 2 au lieu de 28 »).
--   6. Privilèges : anon ne peut pas l'appeler ; un non-agent reçoit {}.

\set ON_ERROR_STOP on
\i _helpers.sql

DO $fixture$
DECLARE
  v_tn    UUID := '00000000-0000-0000-0000-000000000001';
  v_sa    UUID := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_ag    UUID := gen_random_uuid();
  v_tag   TEXT := substr(replace(v_ag::TEXT, '-', ''), 1, 8);
  v_store UUID;
  d0      DATE := current_date - 40;   -- le marché s'allume
  d_on    DATE := current_date - 30;   -- l'agent s'allume à 9
  v_o     UUID[] := ARRAY[]::UUID[];
  i       INT;
  -- statut actuel de o1..o15
  v_st    TEXT[] := ARRAY['delivered','delivered','delivered','delivered','delivered','delivered',
                          'cancelled','rejected','at_carrier','delivery_delayed','to_be_returned',
                          'at_carrier','attempt_2','confirmed','delivered'];
BEGIN
  SELECT id INTO v_store FROM storefronts WHERE market_id = v_tn LIMIT 1;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Fixture incomplète : aucune boutique TN'; END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (v_ag, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'sqltest.stmt.' || v_tag || '@oms.local', 'x', now(), now(), now());
  INSERT INTO public.users (id, email, full_name, role, market_id, is_active)
  VALUES (v_ag, 'sqltest.stmt.' || v_tag || '@oms.local', 'SQL Stmt ' || v_tag, 'agent', v_tn, TRUE);

  -- Un test qui a planté avant son DELETE final laisse ses taux (la table n'est pas en
  -- écriture seule) : un taux de marché oublié avance la date d'activation de tout le monde.
  DELETE FROM agent_commission_rates WHERE note LIKE 'sqltest-%';

  -- Taux : marché 5 dès d0 ; agent coupé [d0, d_on), 9 [d_on, aujourd'hui), 10 dès aujourd'hui.
  INSERT INTO agent_commission_rates (market_id, agent_id, enabled, amount, effective_from, effective_to, set_by, note)
  VALUES (v_tn, NULL, TRUE,  5,  d0,           NULL,         v_sa, 'sqltest-stmt-' || v_tag),
         (v_tn, v_ag, FALSE, 0,  d0,           d_on,         v_sa, 'sqltest-stmt-' || v_tag),
         (v_tn, v_ag, TRUE,  9,  d_on,         current_date, v_sa, 'sqltest-stmt-' || v_tag),
         (v_tn, v_ag, TRUE,  10, current_date, NULL,         v_sa, 'sqltest-stmt-' || v_tag);

  FOR i IN 1..15 LOOP
    v_o := v_o || gen_random_uuid();
    INSERT INTO orders (id, market_id, storefront_id, external_id, external_platform,
                        customer_name, customer_phone, product_name, quantity, unit_price, total_price,
                        status, assigned_to)
    VALUES (v_o[i], v_tn, v_store, 'SQLTEST-STMT-' || v_tag || '-' || i, 'manual',
            'Client ' || i, '2' || lpad((floor(random() * 10000000))::TEXT, 7, '0'),
            'SQLTEST STMT', 1, 50, 50, v_st[i]::order_status, v_ag);
  END LOOP;

  -- Historique (heure de Tunis). c = confirmée (agent), u = téléversée (agent), f = statut final.
  --  o1–o4 : téléversées après l'activation, livrées d_on+2..+5, acquises à 9
  --  o5    : téléversée avant, livrée, acquise puis ANNULÉE (uploaded_before_activation)
  --  o6    : téléversée avant, livrée, jamais acquise (la garde)
  --  o7    : annulée par Darb (acteur system) · o8 : rejetée par l'agent
  --  o9 at_carrier · o10 delivery_delayed · o11 to_be_returned — téléversées après
  --  o12   : at_carrier mais téléversée AVANT l'activation → hors « en route »
  --  o13   : confirmée puis revenue en attempt_2 · o14 : confirmée, pas encore téléversée
  --  o15   : livrée il y a 5 minutes, admissible, pas encore acquise (balayage à venir)
  INSERT INTO order_history (order_id, market_id, status_from, status_to, actor_id, actor_type, created_at)
  SELECT v_o[h.o], v_tn, h.f::order_status, h.t::order_status,
         CASE WHEN h.who = 'agent' THEN v_ag END, h.who, h.ts
  FROM (VALUES
    (1, 'pending','confirmed','agent', ((d_on+1)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (1, 'confirmed','uploaded','agent',((d_on+1)+time '11:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (1, 'uploaded','delivered','system',((d_on+2)+time '15:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (2, 'pending','confirmed','agent', ((d_on+1)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (2, 'confirmed','uploaded','agent',((d_on+1)+time '11:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (2, 'uploaded','delivered','system',((d_on+3)+time '15:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (3, 'pending','confirmed','agent', ((d_on+1)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (3, 'confirmed','uploaded','agent',((d_on+1)+time '11:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (3, 'uploaded','delivered','system',((d_on+4)+time '15:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (4, 'pending','confirmed','agent', ((d_on+1)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (4, 'confirmed','uploaded','agent',((d_on+1)+time '11:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (4, 'uploaded','delivered','system',((d_on+5)+time '15:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (5, 'pending','confirmed','agent', ((d_on-3)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (5, 'confirmed','uploaded','agent',((d_on-3)+time '11:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (5, 'uploaded','delivered','system',((d_on+2)+time '16:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (6, 'pending','confirmed','agent', ((d_on-3)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (6, 'confirmed','uploaded','agent',((d_on-3)+time '11:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (6, 'uploaded','delivered','system',((d_on+3)+time '16:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (7, 'pending','confirmed','agent', ((d_on+2)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (7, 'confirmed','uploaded','agent',((d_on+2)+time '11:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (7, 'uploaded','cancelled','system',((d_on+6)+time '09:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (8, 'pending','confirmed','agent', ((d_on+2)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (8, 'confirmed','rejected','agent',((d_on+3)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (9, 'pending','confirmed','agent', ((d_on+20)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (9, 'confirmed','uploaded','agent',((d_on+20)+time '11:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (9, 'uploaded','at_carrier','system',((d_on+21)+time '09:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (10,'pending','confirmed','agent', ((d_on+20)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (10,'confirmed','uploaded','agent',((d_on+20)+time '11:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (10,'uploaded','delivery_delayed','system',((d_on+22)+time '09:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (11,'pending','confirmed','agent', ((d_on+20)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (11,'confirmed','uploaded','agent',((d_on+20)+time '11:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (11,'uploaded','to_be_returned','system',((d_on+23)+time '09:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (12,'pending','confirmed','agent', ((d_on-2)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (12,'confirmed','uploaded','agent',((d_on-2)+time '11:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (12,'uploaded','at_carrier','system',((d_on-1)+time '09:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (13,'pending','confirmed','agent', ((d_on+25)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (13,'confirmed','attempt_2','agent',((d_on+26)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (14,'pending','confirmed','agent', ((d_on+28)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (15,'pending','confirmed','agent', ((d_on+24)+time '10:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (15,'confirmed','uploaded','agent',((d_on+24)+time '11:00')::timestamp AT TIME ZONE 'Africa/Tunis'),
    (15,'uploaded','delivered','system', now() - interval '5 minutes')
  ) AS h(o, f, t, who, ts);

  -- Le relevé : o1–o4 acquises à 9, o5 acquise puis annulée, deux paiements (13 puis 10).
  INSERT INTO agent_commission_ledger (market_id, agent_id, order_id, entry_type, amount, rate_amount, effective_at, method, reversal_reason, note)
  SELECT v_tn, v_ag, v_o[l.o], l.kind, l.amt, abs(l.amt), l.ts, l.method, l.reason, l.note
  FROM (VALUES
    (1,    'accrual',   9::NUMERIC,  ((d_on+2)+time '15:00')::timestamp AT TIME ZONE 'Africa/Tunis', NULL::TEXT, NULL::TEXT, NULL::TEXT),
    (2,    'accrual',   9,  ((d_on+3)+time '15:00')::timestamp AT TIME ZONE 'Africa/Tunis', NULL, NULL, NULL),
    (3,    'accrual',   9,  ((d_on+4)+time '15:00')::timestamp AT TIME ZONE 'Africa/Tunis', NULL, NULL, NULL),
    (4,    'accrual',   9,  ((d_on+5)+time '15:00')::timestamp AT TIME ZONE 'Africa/Tunis', NULL, NULL, NULL),
    (5,    'accrual',   9,  ((d_on+2)+time '16:00')::timestamp AT TIME ZONE 'Africa/Tunis', NULL, NULL, NULL),
    (5,    'reversal', -9,  ((d_on+2)+time '16:00')::timestamp AT TIME ZONE 'Africa/Tunis', NULL, 'uploaded_before_activation', 'test')
  ) AS l(o, kind, amt, ts, method, reason, note);
  INSERT INTO agent_commission_ledger (market_id, agent_id, order_id, entry_type, amount, effective_at, method, created_by)
  VALUES (v_tn, v_ag, NULL, 'payout', -13, ((d_on+6)+time '12:00')::timestamp AT TIME ZONE 'Africa/Tunis', 'cash', v_sa),
         (v_tn, v_ag, NULL, 'payout', -10, ((d_on+8)+time '12:00')::timestamp AT TIME ZONE 'Africa/Tunis', 'cash', v_sa);

  PERFORM set_config('r.ag', v_ag::TEXT, FALSE);
  PERFORM set_config('r.sa', v_sa::TEXT, FALSE);
  PERFORM set_config('r.tag', v_tag, FALSE);
  PERFORM set_config('r.don', d_on::TEXT, FALSE);
  FOR i IN 1..15 LOOP PERFORM set_config('r.o' || i, v_o[i]::TEXT, FALSE); END LOOP;
END $fixture$;

-- Le relevé de l'agent, lu comme l'agent (jeton), une fois pour tout le fichier.
CREATE TEMP TABLE stmt AS SELECT NULL::JSONB AS j;
DO $read$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.ag'), 'role', 'authenticated')::TEXT, TRUE);
  UPDATE stmt SET j = get_my_commission_statement(90);
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $read$;

\echo '── 1. FIFO — payées, impayées, Σ impayées = solde ────────────────────────'
DO $t$
DECLARE
  j JSONB := (SELECT j FROM stmt);
  o3 JSONB;
BEGIN
  PERFORM pg_temp.eq((j->>'earned')::NUMERIC, 36::NUMERIC, 'gagné = 4 × 9 (o5 acquise puis annulée ne compte pas)');
  PERFORM pg_temp.eq((j->>'paid')::NUMERIC, 23::NUMERIC, 'reçu = 13 + 10');
  PERFORM pg_temp.eq((j->>'owed')::NUMERIC, 13::NUMERIC, 'solde = 36 − 23');
  PERFORM pg_temp.eq((j->'unpaid'->>'count')::INT, 2, 'impayées : o3 (reste) et o4');
  PERFORM pg_temp.eq((j->'unpaid'->>'amount')::NUMERIC, 13::NUMERIC, 'Σ impayées = solde, exactement');
  SELECT r INTO o3 FROM jsonb_array_elements(j->'unpaid'->'rows') r WHERE r->>'order_id' = current_setting('r.o3');
  PERFORM pg_temp.eq((o3->>'partial')::BOOLEAN, TRUE, 'o3 chevauche le dernier paiement : partial');
  PERFORM pg_temp.eq((o3->>'amount')::NUMERIC, 4::NUMERIC, 'o3 ne montre que son reste (27 − 23)');
  PERFORM pg_temp.eq((o3->>'customer_name'), 'Client 3', 'la ligne porte le nom du client');
  PERFORM pg_temp.eq((j->'paid_orders'->>'count')::INT, 2, 'payées : o1 et o2');
  PERFORM pg_temp.eq(jsonb_array_length(j->'paid_orders'->'payouts'), 2, 'deux paiements, chacun avec ses commandes');
  -- Le plus récent d'abord : le paiement de 10 a terminé o2, commencée par celui de 13.
  PERFORM pg_temp.eq((j->'paid_orders'->'payouts'->0->>'amount')::NUMERIC, 10::NUMERIC, 'paiement le plus récent en premier');
  PERFORM pg_temp.eq(j->'paid_orders'->'payouts'->0->'rows'->0->>'order_id', current_setting('r.o2'), 'le paiement de 10 a réglé o2');
  PERFORM pg_temp.eq((j->'paid_orders'->'payouts'->0->'rows'->0->>'split')::BOOLEAN, TRUE, 'o2 réglée en deux fois');
  PERFORM pg_temp.eq(j->'paid_orders'->'payouts'->1->'rows'->0->>'order_id', current_setting('r.o1'), 'le paiement de 13 a réglé o1');
  PERFORM pg_temp.eq((j->'last_payout'->>'amount')::NUMERIC, 10::NUMERIC, 'dernier paiement = 10');
END $t$;

\echo '── 2. En route ──────────────────────────────────────────────────────────'
DO $t$
DECLARE j JSONB := (SELECT j FROM stmt);
BEGIN
  PERFORM pg_temp.eq((j->'way'->>'count')::INT, 3, 'en route : o9, o10, o11 (o12 téléversée avant l''activation est exclue)');
  PERFORM pg_temp.eq((j->'way'->'stages'->>'with_carrier')::INT, 1, 'at_carrier → chez le transporteur');
  PERFORM pg_temp.eq((j->'way'->'stages'->>'delayed')::INT, 1, 'delivery_delayed → en retard');
  PERFORM pg_temp.eq((j->'way'->'stages'->>'returning')::INT, 1, 'to_be_returned → en retour');
  PERFORM pg_temp.eq((j->'way'->>'est')::NUMERIC, 20::NUMERIC, 'estimation = 2 × 10 (le retour n''est pas estimé)');
  PERFORM pg_temp.eq((j->'way'->>'est_likely')::NUMERIC, 14::NUMERIC, 'probable = 20 × 5/7, arrondi');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'way'->'rows') r WHERE r->>'order_id' = current_setting('r.o12')),
    'o12 n''est pas dans les lignes en route');
END $t$;

\echo '── 3. Sans commission ───────────────────────────────────────────────────'
DO $t$
DECLARE j JSONB := (SELECT j FROM stmt);
BEGIN
  PERFORM pg_temp.eq((j->'lost'->>'count')::INT, 4, 'sans commission : o5, o6, o7, o8');
  PERFORM pg_temp.eq((j->'lost'->>'before_activation')::INT, 2, 'o5 (annulée) et o6 (jamais acquise) : avant l''activation');
  PERFORM pg_temp.eq((j->'lost'->>'carrier_cancelled')::INT, 1, 'o7 : annulée par le transporteur');
  PERFORM pg_temp.eq((j->'lost'->>'rejected')::INT, 1, 'o8 : rejetée');
  PERFORM pg_temp.eq(
    (SELECT (r->>'was_amount')::NUMERIC FROM jsonb_array_elements(j->'lost'->'rows') r WHERE r->>'order_id' = current_setting('r.o5')),
    9::NUMERIC, 'o5 dit combien elle avait rapporté avant l''annulation');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'lost'->'rows') r WHERE r->>'order_id' = current_setting('r.o15')),
    'o15, livrée il y a 5 min et pas encore balayée, n''est PAS « sans commission »');
END $t$;

\echo '── 4. Entonnoir, taux, activation ───────────────────────────────────────'
DO $t$
DECLARE j JSONB := (SELECT j FROM stmt);
BEGIN
  PERFORM pg_temp.eq((j->>'activated_on')::DATE, current_setting('r.don')::DATE, 'activation = premier jour où le taux de l''agent est actif');
  PERFORM pg_temp.eq((j->>'since')::DATE, current_setting('r.don')::DATE, 'fenêtre = depuis l''activation');
  PERFORM pg_temp.eq((j->'funnel'->>'confirmed')::INT, 12, 'confirmées depuis l''activation : 12');
  PERFORM pg_temp.eq((j->'funnel'->>'delivered')::INT, 5, 'livrées : o1–o4 + o15');
  PERFORM pg_temp.eq((j->'funnel'->>'way')::INT, 3, 'en route : 3');
  PERFORM pg_temp.eq((j->'funnel'->>'lost')::INT, 2, 'terminées sans livraison : o7, o8');
  PERFORM pg_temp.eq((j->'funnel'->>'awaiting_upload')::INT, 1, 'à téléverser : o14');
  PERFORM pg_temp.eq((j->'funnel'->>'back_in_queue')::INT, 1, 'revenue dans la file : o13');
  PERFORM pg_temp.eq((j->>'delivery_rate')::NUMERIC, 0.714::NUMERIC, 'taux de livraison = 5 / 7');
  PERFORM pg_temp.eq((j->'rate'->>'amount')::NUMERIC, 10::NUMERIC, 'taux du jour 10');
  PERFORM pg_temp.eq((j->'rate'->>'previous_amount')::NUMERIC, 9::NUMERIC, 'l''ancien taux (9) est donné quand le taux vient de changer');
  PERFORM pg_temp.eq((j->>'enabled')::BOOLEAN, TRUE, 'activée');
END $t$;

\echo '── 5. Équipe : en cours sur la même définition ──────────────────────────'
DO $t$
DECLARE v_row JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.sa'), 'role', 'authenticated')::TEXT, TRUE);
  SELECT a INTO v_row FROM jsonb_array_elements(
    get_team_commissions('00000000-0000-0000-0000-000000000001', current_date - 60, current_date, 'Africa/Tunis')->'agents') a
  WHERE a->>'agent_id' = current_setting('r.ag');
  PERFORM set_config('request.jwt.claims', '', TRUE);
  PERFORM pg_temp.eq((v_row->>'pending_count')::INT, 2, 'équipe : en cours = o9 + o10 (statuts Darb comptés, retour et o12 exclus)');
END $t$;

\echo '── 6. Privilèges ────────────────────────────────────────────────────────'
DO $t$
BEGIN
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'get_my_commission_statement(integer)', 'EXECUTE'), 'anon ne peut pas l''appeler');
  PERFORM pg_temp.ok(has_function_privilege('authenticated', 'get_my_commission_statement(integer)', 'EXECUTE'), 'authenticated peut');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'commission_order_stage(order_status)', 'EXECUTE'), 'anon n''appelle pas le helper');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('r.sa'), 'role', 'authenticated')::TEXT, TRUE);
  PERFORM pg_temp.eq(get_my_commission_statement(90), '{}'::JSONB, 'un super_admin reçoit {} — la page est celle de l''agent');
  PERFORM set_config('request.jwt.claims', '', TRUE);
END $t$;

DELETE FROM agent_commission_rates WHERE note = 'sqltest-stmt-' || current_setting('r.tag');
