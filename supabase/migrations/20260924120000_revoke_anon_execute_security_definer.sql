-- ============================================================
-- 20260924120000_revoke_anon_execute_security_definer.sql
-- Fermer l'accès anonyme aux RPC SECURITY DEFINER.
--
-- CE QUI ÉTAIT OUVERT. Postgres accorde EXECUTE à PUBLIC à la création d'une
-- fonction, et `anon` en hérite. Une fonction SECURITY DEFINER s'exécute avec
-- les droits de son propriétaire et CONTOURNE donc la RLS. Résultat : 127
-- fonctions étaient appelables sans session via /rest/v1/rpc/<nom>, avec la
-- seule clé anon — celle qui est publiée dans le bundle du navigateur.
-- Vérifié en production le 2026-09-20 : un POST anonyme sur
-- /rest/v1/rpc/darb_cron_status a répondu HTTP 200 avec des données.
-- Le linter Supabase le signalait aussi : `anon_security_definer_function_executable`.
--
-- LA RLS N'ÉTAIT PAS EN CAUSE. Une lecture directe de table en anonyme renvoie
-- bien `[]`. C'est la couche RPC qui était ouverte, et elle contourne la RLS
-- par construction.
--
-- POURQUOI ÇA A DÉRIVÉ. 154 fichiers de migration contiennent
-- `CREATE OR REPLACE FUNCTION`, 40 seulement contiennent un `REVOKE` — et un
-- `CREATE OR REPLACE` RÉINITIALISE les privilèges. Chaque redéfinition
-- rouvrait donc la porte. Le piège avait déjà été identifié pour les RPC de
-- disponibilité le 2026-09-19 et corrigé là, jamais ailleurs.
-- Pire : `REVOKE ... FROM anon` SEUL ne suffit pas, puisque le droit vient de
-- PUBLIC. C'est exactement ce que faisait 20260814104214_stock_position_rpc,
-- dont la propre assertion « FAIL: anon can execute get_stock_position »
-- échouait donc sur toute base reconstruite.
--
-- CE QUE FAIT CETTE MIGRATION. Pour chaque fonction SECURITY DEFINER de
-- `public` encore exécutable par `anon` : REVOKE sur PUBLIC et anon, puis
-- GRANT à `authenticated` et `service_role`. L'application authentifie tous
-- ses utilisateurs et les webhooks tournent en service_role, donc rien de
-- légitime ne perd l'accès. Resserrer ensuite `authenticated` fonction par
-- fonction est un chantier distinct — celui-ci ferme d'abord l'accès anonyme.
--
-- LES DEUX EXCEPTIONS. `get_user_role` et `get_user_market_id` sont appelées
-- DANS 128 et 86 politiques RLS. Une politique qui appelle une fonction exige
-- EXECUTE pour le rôle courant : les révoquer ferait ÉCHOUER les requêtes
-- anonymes au lieu de les refuser proprement. Elles restent ouvertes, et c'est
-- sans risque — elles lisent `auth.uid()`, qui est NULL en anonyme, donc elles
-- renvoient NULL et la politique refuse.
-- ============================================================

DO $$
DECLARE
  f RECORD;
  n INTEGER := 0;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prosecdef
      AND p.proname NOT IN ('get_user_role', 'get_user_market_id')
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ORDER BY p.proname
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'RPC SECURITY DEFINER refermees a anon : %', n;
END $$;

-- ── Garde-fou : l'assertion qui manquait ───────────────────────────────────
-- Si une future migration redéfinit une fonction sans re-révoquer, cette
-- assertion fera échouer la reconstruction plutôt que de laisser la porte
-- se rouvrir en silence.
DO $$
DECLARE
  leaked TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO leaked
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.prosecdef
    AND p.proname NOT IN ('get_user_role', 'get_user_market_id')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: anon peut encore executer des RPC SECURITY DEFINER: %', leaked;
  END IF;
END $$;
