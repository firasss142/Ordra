-- ============================================================
-- 20261003000003_agent_availability_rpcs.sql
--
-- set_agent_availability — la bascule « je prends des commandes », et la
-- remise au pool des commandes intouchées quand un agent s'arrête.
--
-- POURQUOI UNE RPC ET PAS UN UPDATE DEPUIS LA ROUTE
--   Le GRANT de 20261003000002 n'accorde que last_seen_at à `authenticated`.
--   is_available ne bouge donc que par ici, ce qui rend impossible de changer
--   son état sans écrire le journal ni rendre ses commandes — un PATCH
--   PostgREST direct ne peut pas contourner l'effet de bord.
--
-- CE QU'ELLE NE FAIT PAS : distribuer le pool. Le ON doit répondre en
-- millisecondes ; brancher une redistribution de 400 commandes dessus ferait
-- dépendre la latence de la bascule de la taille du pool et transformerait
-- chaque bascule simultanée en concurrent du même verrou. Voir
-- drain_unassigned_pool plus bas.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_agent_availability(
  p_agent_id  UUID,
  p_available BOOLEAN,
  p_actor_id  UUID,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role    TEXT;
  v_actor_market  UUID;
  v_agent_role    TEXT;
  v_agent_market  UUID;
  v_agent_active  BOOLEAN;
  v_agent_deleted TIMESTAMPTZ;
  v_current       BOOLEAN;
  v_actor_type    TEXT;
  v_released      INT := 0;
  v_log_id        UUID;
BEGIN
  -- Une bascule est une signature. Une session ne peut pas l'attribuer à un
  -- autre. service_role et pg_cron passent (auth.uid() NULL), comme pour
  -- scan_order_out.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Une bascule de disponibilité ne peut pas être portée au crédit d''un autre'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role, market_id INTO v_actor_role, v_actor_market
    FROM users WHERE id = p_actor_id;
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_NOT_FOUND"}';
  END IF;

  -- FOR UPDATE : sérialise deux bascules concurrentes sur le même agent, sinon
  -- les deux liraient le même `v_current` et la garde d'idempotence sauterait.
  SELECT role, market_id, is_active, deleted_at, is_available
    INTO v_agent_role, v_agent_market, v_agent_active, v_agent_deleted, v_current
    FROM users WHERE id = p_agent_id
    FOR UPDATE;

  IF v_agent_role IS NULL THEN
    RAISE EXCEPTION 'Agent not found: %', p_agent_id
      USING ERRCODE = '42501', DETAIL = '{"code":"AGENT_NOT_FOUND"}';
  END IF;
  IF v_agent_role <> 'agent' THEN
    RAISE EXCEPTION 'Role % has no order queue', v_agent_role
      USING ERRCODE = '42501', DETAIL = '{"code":"NOT_AN_AGENT"}';
  END IF;
  -- is_active ET deleted_at : assign_order ne teste que is_active, ce qui
  -- laisse un agent supprimé recevoir des commandes. On ne reproduit pas
  -- l'oubli ici.
  IF NOT v_agent_active OR v_agent_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'Agent inactive or deleted: %', p_agent_id
      USING ERRCODE = '42501', DETAIL = '{"code":"AGENT_INACTIVE"}';
  END IF;

  -- Qui a le droit. Un manager doit pouvoir forcer un agent hors rotation :
  -- portable cassé en pleine journée, trente commandes intouchées bloquées.
  IF p_actor_id = p_agent_id THEN
    v_actor_type := 'self';
  ELSIF v_actor_role = 'super_admin' THEN
    v_actor_type := 'super_admin';
  ELSIF v_actor_role = 'market_manager' AND v_actor_market = v_agent_market THEN
    v_actor_type := 'manager';
  ELSE
    RAISE EXCEPTION 'Actor % cannot set availability for %', p_actor_id, p_agent_id
      USING ERRCODE = '42501', DETAIL = '{"code":"FORBIDDEN"}';
  END IF;

  -- Idempotent : rebasculer dans le même état ne libère rien et n'écrit rien.
  IF v_current IS NOT DISTINCT FROM p_available THEN
    RETURN json_build_object(
      'agent_id', p_agent_id, 'is_available', p_available,
      'released', 0, 'changed', false);
  END IF;

  UPDATE users
     SET is_available    = p_available,
         available_since = CASE WHEN p_available THEN now() ELSE NULL END
   WHERE id = p_agent_id;

  -- ── OFF : les commandes INTOUCHÉES retournent au pool ──────────────────
  -- Intouchée = pending ET aucun rappel programmé ET aucune tentative. Les
  -- trois, pas une : `pending` seul laisserait partir une commande dont
  -- l'agent a déjà ouvert la fiche et reprogrammé l'appel. Ce qui a été
  -- travaillé reste chez lui — le contexte n'existe que là.
  IF NOT p_available THEN
    WITH victims AS (
      SELECT o.id AS order_id, o.market_id
        FROM orders o
       WHERE o.assigned_to = p_agent_id
         AND o.status = 'pending'
         AND o.callback_scheduled_at IS NULL
         AND o.attempts_count = 0
         -- Ne jamais arracher une fiche ouverte sous les yeux d'un collègue.
         -- L'UPDATE tourne en tant que propriétaire, donc
         -- trg_orders_lock_guard (SECURITY INVOKER, court-circuité dès que
         -- current_user <> 'authenticated') ne s'exécutera PAS. Le garde est
         -- reproduit ici explicitement.
         AND NOT EXISTS (
           SELECT 1 FROM order_presence p
            WHERE p.order_id = o.id
              AND p.role = 'agent'
              AND p.expires_at > now()
         )
       FOR UPDATE OF o
    ),
    released AS (
      UPDATE orders o
         SET assigned_to = NULL,
             status = 'pending',
             callback_scheduled_at = NULL
        FROM victims v
       WHERE o.id = v.order_id
      RETURNING o.id
    ),
    logged AS (
      -- status_from est le littéral 'pending' : le WHERE de `victims` l'a déjà
      -- épinglé, et RETURNING d'un UPDATE rend la NOUVELLE ligne, pas
      -- l'ancienne. market_id est fourni pour court-circuiter
      -- trg_order_history_market_id et ses N lectures de orders.
      -- ledger_append_only est BEFORE UPDATE OR DELETE : un INSERT ensembliste
      -- passe (même schéma que bulk_assign_leads).
      INSERT INTO order_history
        (order_id, market_id, status_from, status_to, actor_id, actor_type, note)
      SELECT v.order_id, v.market_id,
             'pending'::order_status, 'pending'::order_status,
             p_actor_id,
             -- order_history.actor_type n'admet que system|agent|manager :
             -- il n'a jamais été élargi comme celui de follow_ups.
             CASE WHEN v_actor_type = 'self' THEN 'agent' ELSE 'manager' END,
             'Agent indisponible — commande rendue au pool'
        FROM victims v
      RETURNING order_id
    )
    SELECT count(*)::int INTO v_released FROM released;
  END IF;

  INSERT INTO agent_availability_log
    (user_id, market_id, is_available, changed_by, actor_type, reason, released_count)
  VALUES
    (p_agent_id, v_agent_market, p_available, p_actor_id, v_actor_type, p_reason, v_released)
  RETURNING id INTO v_log_id;

  RETURN json_build_object(
    'agent_id',     p_agent_id,
    'is_available', p_available,
    'released',     v_released,
    'changed',      true,
    'log_id',       v_log_id
  );
END;
$$;

COMMENT ON FUNCTION public.set_agent_availability(UUID, BOOLEAN, UUID, TEXT) IS
  'Bascule « prêt à prendre des commandes ». Appelable par l''agent sur '
  'lui-même, par un market_manager sur un agent de son marché, par un '
  'super_admin sur n''importe qui. Sur OFF, rend au pool les commandes '
  'intouchées (pending, sans rappel, sans tentative, sans fiche ouverte).';

GRANT EXECUTE ON FUNCTION public.set_agent_availability(UUID, BOOLEAN, UUID, TEXT) TO authenticated;

-- ============================================================
-- apply_pool_assignments — écrit un plan de distribution sur le pool
--
-- Le plan est calculé en TypeScript (planAssignments), parce que l'aperçu que
-- le manager confirme et l'écriture qui suit doivent passer par la MÊME
-- fonction pure, et parce que l'algorithme est couvert par des tests unitaires.
-- Cette RPC ne décide rien : elle applique, en vérifiant que chaque commande
-- est toujours prenable.
--
-- POURQUOI PAS bulk_assign_orders : il est tout-ou-rien (assign_order lève, la
-- transaction entière est annulée), mono-agent, et ne vérifie pas que la
-- commande est encore libre. Pour un drain, une seule commande prise entre le
-- calcul et l'écriture annulerait les 499 autres.
--
-- CONCURRENCE. Deux agents qui se déclarent prêts à la même seconde calculent
-- chacun un plan sur le même pool. Le verrou consultatif sérialise les
-- écritures pour que les deux plans ne s'entrelacent pas ; la garde
-- `assigned_to IS NULL` rend l'écriture honnête si le verrou est contourné.
-- Les deux, pas l'un ou l'autre — le verrou seul ne protège pas d'un autre
-- chemin d'assignation (webhook, manager), la garde seule laisserait les
-- compteurs des deux plans diverger.
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_pool_assignments(
  p_market_id   UUID,
  p_assignments JSONB,
  p_actor_id    UUID,
  p_actor_type  TEXT DEFAULT 'system'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_role   TEXT;
  v_actor_market UUID;
  v_rec          RECORD;
  v_claimable    UUID;
  v_assigned     INT := 0;
  v_skipped      INT := 0;
BEGIN
  IF jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'p_assignments must be a JSON array'
      USING ERRCODE = '22023', DETAIL = '{"code":"BAD_PAYLOAD"}';
  END IF;

  IF p_actor_type NOT IN ('system', 'agent', 'manager') THEN
    -- Le CHECK de order_history n'admet que ces trois-là.
    RAISE EXCEPTION 'Unsupported actor_type: %', p_actor_type
      USING ERRCODE = '22023', DETAIL = '{"code":"BAD_ACTOR_TYPE"}';
  END IF;

  -- Obligatoire : p_actor_id NULL sautait toute la validation de marché.
  -- Durci par 20261003000006.
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'p_actor_id is required'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_REQUIRED"}';
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Assignments cannot be credited to another user'
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_MISMATCH"}';
  END IF;

  SELECT role, market_id INTO v_actor_role, v_actor_market
    FROM users WHERE id = p_actor_id;
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id
      USING ERRCODE = '42501', DETAIL = '{"code":"ACTOR_NOT_FOUND"}';
  END IF;
  -- Le marché de l'acteur l'emporte sur ce que prétend l'appel.
  IF v_actor_role <> 'super_admin' AND v_actor_market IS DISTINCT FROM p_market_id THEN
    RAISE EXCEPTION 'Actor market does not match'
      USING ERRCODE = '42501', DETAIL = '{"code":"MARKET_MISMATCH"}';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ordra:pool:' || p_market_id::text));

  FOR v_rec IN
    SELECT DISTINCT ON (e->>'order_id')
           (e->>'order_id')::uuid AS order_id,
           (e->>'agent_id')::uuid AS agent_id
      FROM jsonb_array_elements(p_assignments) AS e
     WHERE e->>'order_id' IS NOT NULL
       AND e->>'agent_id' IS NOT NULL
  LOOP
    -- Toujours prenable ? Une commande que le webhook ou un manager a prise
    -- entre le calcul et maintenant est sautée, pas volée.
    SELECT o.id INTO v_claimable
      FROM orders o
     WHERE o.id = v_rec.order_id
       AND o.market_id = p_market_id
       AND o.status = 'pending'
       AND o.assigned_to IS NULL
     FOR UPDATE;

    IF v_claimable IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Sous-transaction par commande : assign_order lève (agent inactif,
    -- marché différent, fiche verrouillée…) et on saute celle-là seulement,
    -- au lieu d'annuler tout le lot.
    BEGIN
      PERFORM assign_order(
        v_rec.order_id,
        v_rec.agent_id,
        p_actor_id,
        p_actor_type,
        'Distribution du pool — agent disponible'
      );
      v_assigned := v_assigned + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN json_build_object('assigned', v_assigned, 'skipped', v_skipped);
END;
$$;

COMMENT ON FUNCTION public.apply_pool_assignments(UUID, JSONB, UUID, TEXT) IS
  'Applique un plan de distribution calculé par planAssignments (TypeScript). '
  'Ne décide rien. Verrou consultatif par marché + garde assigned_to IS NULL : '
  'deux drains simultanés n''assignent jamais la même commande deux fois.';

GRANT EXECUTE ON FUNCTION public.apply_pool_assignments(UUID, JSONB, UUID, TEXT) TO authenticated;
