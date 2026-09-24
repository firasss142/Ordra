-- ============================================================
-- 20261003000002_percentage_distribution_and_readiness.sql
--
-- CE QUI CHANGE
--   1. users.is_available / available_since — « je suis prêt à prendre des
--      commandes ». Distinct de is_active (drapeau RH) et de last_seen_at
--      (battement de cœur). Les trois sont exigés ensemble pour recevoir.
--   2. (Le trou d'escalade de privilèges sur users est refermé séparément,
--      par 20261003000005 — c'est la seule instruction de ce lot qui peut
--      casser un chemin d'écriture existant, elle doit pouvoir être annulée
--      seule.)
--   3. orders.assigned_at — quand la propriété actuelle a été prise. Le quota
--      quotidien se compte dessus.
--   4. agent_availability_log — journal append-only des bascules.
--   5. agent_distribution_shares — le % du volume quotidien par agent.
--
-- CE QUI NE CHANGE PAS, VOLONTAIREMENT
--   Aucun corps de fonction existant n'est réémis. assign_order,
--   unassign_order et return_order_to_pool ont été patchés EN PLACE par
--   20260925000003 (réécriture de pg_get_functiondef pour y insérer
--   assert_order_unlocked). Ce garde n'existe dans aucun fichier lisible : un
--   CREATE OR REPLACE depuis la source de 20260505233818 le supprimerait sans
--   que rien n'échoue. D'où le trigger de §3 plutôt que trois réécritures.
--
--   Rien n'est semé. L'absence de ligne = le défaut codé.
-- ============================================================

-- ============================================================
-- 1. users.is_available — la disponibilité déclarée
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_available    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS available_since TIMESTAMPTZ;

COMMENT ON COLUMN public.users.is_available IS
  'Déclaré par l''agent : « je prends des commandes ». Ne suffit pas seul — la '
  'distribution exige aussi is_active, deleted_at IS NULL et un battement de '
  'cœur frais. Écrit UNIQUEMENT par set_agent_availability().';

COMMENT ON COLUMN public.users.available_since IS
  'Quand la disponibilité en cours a commencé ; NULL quand indisponible. '
  'Doublon assumé de max(created_at) sur agent_availability_log : il ne tient '
  'que parce que le GRANT de §2 interdit d''écrire is_available hors RPC.';

-- Défaut false : la fonctionnalité est inerte tant qu'aucun agent n'a basculé.

CREATE INDEX IF NOT EXISTS idx_users_available_agents
  ON public.users (market_id)
  WHERE role = 'agent' AND is_available;

-- ============================================================
-- 3. orders.assigned_at — maintenu par trigger, jamais par les RPC
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.assigned_at IS
  'Quand la propriété actuelle a été prise ; NULL si non assignée. Maintenu '
  'exclusivement par trg_orders_assigned_at — aucune RPC ne l''écrit, ce qui '
  'évite de réémettre assign_order/unassign_order/return_order_to_pool et de '
  'perdre le garde-verrou posé en place par 20260925000003.';

CREATE OR REPLACE FUNCTION public.orders_stamp_assigned_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Une commande créée par un agent arrive déjà assignée
    -- (api/orders/route.ts) ; une commande de webhook arrive nue.
    NEW.assigned_at := CASE WHEN NEW.assigned_to IS NULL THEN NULL ELSE now() END;
  ELSIF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    NEW.assigned_at := CASE WHEN NEW.assigned_to IS NULL THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END;
$$;

-- UPDATE OF assigned_to : le trigger ne se déclenche que si la colonne figure
-- dans le SET. Les ~117k écritures/jour du statut Darb ne le réveillent jamais.
-- IS DISTINCT FROM couvre le SET qui mentionne la colonne sans la changer.
DROP TRIGGER IF EXISTS trg_orders_assigned_at ON public.orders;
CREATE TRIGGER trg_orders_assigned_at
  BEFORE INSERT OR UPDATE OF assigned_to ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_stamp_assigned_at();

-- Rattrapage. On N'ANALYSE PAS order_history.note : le libellé a changé cinq
-- fois (021_translate_assignment_notes_fr, 20260505233818, l'orchestrateur…)
-- et la table ne porte pas assigned_to — aucun signal structurel n'existe.
-- La colonne alimente un quota du JOUR : aucune décision ne dépend d'une
-- valeur antérieure à aujourd'hui. Même transaction que l'ADD COLUMN, donc
-- aucune fenêtre avec des NULL sur des lignes assignées.
UPDATE public.orders
   SET assigned_at = created_at
 WHERE assigned_to IS NOT NULL
   AND assigned_at IS NULL;

-- La question du sélecteur : « combien chaque agent a-t-il reçu aujourd'hui »,
-- en UNE lecture groupée pour tout le marché. INCLUDE porte assigned_to pour
-- un index-only scan.
CREATE INDEX IF NOT EXISTS idx_orders_market_assigned_at
  ON public.orders (market_id, assigned_at DESC)
  INCLUDE (assigned_to)
  WHERE assigned_to IS NOT NULL;

-- La question d'un tableau de bord agent unique.
CREATE INDEX IF NOT EXISTS idx_orders_assigned_to_at
  ON public.orders (assigned_to, assigned_at)
  WHERE assigned_to IS NOT NULL;

-- ============================================================
-- 4. agent_availability_log — append-only
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_availability_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  market_id      UUID        NOT NULL REFERENCES public.markets(id),
  is_available   BOOLEAN     NOT NULL,
  -- NULL = système (le cron de minuit). Les agents et managers sont nommés.
  changed_by     UUID        REFERENCES public.users(id),
  actor_type     TEXT        NOT NULL
                   CHECK (actor_type IN ('self', 'manager', 'super_admin', 'system')),
  reason         TEXT,
  -- Dénormalisé exprès : sans lui, « combien de commandes ce OFF a-t-il
  -- rendu » se répond en croisant order_history sur une fenêtre de temps floue.
  released_count INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_availability_log IS
  'Journal append-only des bascules de disponibilité. Écrit uniquement par '
  'set_agent_availability() et le cron de minuit (SECURITY DEFINER) — aucune '
  'policy INSERT pour authenticated, ce qui rend « la RPC est le seul chemin » '
  'structurel et non conventionnel.';

CREATE INDEX IF NOT EXISTS idx_agent_availability_log_market
  ON public.agent_availability_log (market_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_availability_log_user
  ON public.agent_availability_log (user_id, created_at DESC);

-- Garde d'idempotence du cron : « ce marché a-t-il déjà été réinitialisé ce
-- jour local ? » doit être une lecture d'index, pas un parcours.
CREATE INDEX IF NOT EXISTS idx_agent_availability_log_daily_reset
  ON public.agent_availability_log (market_id, created_at DESC)
  WHERE actor_type = 'system' AND reason = 'daily_reset';

DROP TRIGGER IF EXISTS trg_agent_availability_log_append_only ON public.agent_availability_log;
CREATE TRIGGER trg_agent_availability_log_append_only
  BEFORE UPDATE OR DELETE ON public.agent_availability_log
  FOR EACH ROW EXECUTE FUNCTION public.ledger_append_only();

ALTER TABLE public.agent_availability_log ENABLE ROW LEVEL SECURITY;

-- Lecture : SA partout, manager son marché, agent ses propres lignes.
DROP POLICY IF EXISTS agent_availability_log_select ON public.agent_availability_log;
CREATE POLICY agent_availability_log_select
  ON public.agent_availability_log FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR (
      (SELECT public.get_user_role()) = 'market_manager'
      AND market_id = (SELECT public.get_user_market_id())
    )
    OR user_id = (SELECT auth.uid())
  );

-- AUCUNE policy INSERT/UPDATE/DELETE, volontairement. order_history en a une
-- pour authenticated (002_rls_policies) — ne pas la recopier ici.

-- ============================================================
-- 5. agent_distribution_shares — le % par agent
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_distribution_shares (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id  UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  agent_id   UUID NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,

  -- numeric(5,2) monte à 999.99 ; le CHECK est la vraie borne.
  share_pct  NUMERIC(5,2) NOT NULL DEFAULT 0
               CHECK (share_pct >= 0 AND share_pct <= 100),

  updated_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_distribution_shares_unique UNIQUE (market_id, agent_id)
);

COMMENT ON TABLE public.agent_distribution_shares IS
  'Part du volume quotidien par agent, par marché. Table dédiée et non '
  'assignment_rules.config : FK vers users, RLS par marché, updated_by — et '
  'hors du rayon de souffle de /api/orders/auto-assign-bulk, qui écrase '
  'config à chaque lot.';

COMMENT ON COLUMN public.agent_distribution_shares.share_pct IS
  'Part ABSOLUE du volume du jour, pas un poids renormalisé sur les agents '
  'prêts. La somme doit faire 100 — règle appliquée dans le validateur pur et '
  'l''UI, pas ici : un trigger de niveau instruction ferait échouer « retirer '
  'un agent » sur une violation de contrainte au lieu de faire l''évident.';

-- Pas d'index supplémentaire : la contrainte unique (market_id, agent_id) sert
-- déjà la seule lecture (« toutes les parts du marché M »).

CREATE TRIGGER trg_agent_distribution_shares_updated_at
  BEFORE UPDATE ON public.agent_distribution_shares
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.agent_distribution_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_distribution_shares_select ON public.agent_distribution_shares;
CREATE POLICY agent_distribution_shares_select
  ON public.agent_distribution_shares FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR market_id = (SELECT public.get_user_market_id())
  );

DROP POLICY IF EXISTS agent_distribution_shares_insert ON public.agent_distribution_shares;
CREATE POLICY agent_distribution_shares_insert
  ON public.agent_distribution_shares FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.get_user_role()) = 'super_admin'
    OR (
      (SELECT public.get_user_role()) = 'market_manager'
      AND market_id = (SELECT public.get_user_market_id())
    )
  );

DROP POLICY IF EXISTS agent_distribution_shares_update ON public.agent_distribution_shares;
CREATE POLICY agent_distribution_shares_update
  ON public.agent_distribution_shares FOR UPDATE TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR (
      (SELECT public.get_user_role()) = 'market_manager'
      AND market_id = (SELECT public.get_user_market_id())
    )
  )
  WITH CHECK (
    (SELECT public.get_user_role()) = 'super_admin'
    OR (
      (SELECT public.get_user_role()) = 'market_manager'
      AND market_id = (SELECT public.get_user_market_id())
    )
  );

DROP POLICY IF EXISTS agent_distribution_shares_delete ON public.agent_distribution_shares;
CREATE POLICY agent_distribution_shares_delete
  ON public.agent_distribution_shares FOR DELETE TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR (
      (SELECT public.get_user_role()) = 'market_manager'
      AND market_id = (SELECT public.get_user_market_id())
    )
  );

-- Les helpers sont enveloppés en (SELECT f()) : un appel nu se réévalue par
-- ligne (20260928000006 — 905 buffers contre 26).
