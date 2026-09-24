-- ============================================================
-- 20261003000006_availability_rpc_execute_grants.sql
--
-- Referme l'exécution ANONYME des RPC de disponibilité.
--
-- CE QUI N'ALLAIT PAS
--   Postgres accorde EXECUTE à PUBLIC par défaut sur toute fonction. Le
--   `GRANT ... TO authenticated` de 20261003000003 n'enlevait donc rien :
--   `anon` héritait le droit via PUBLIC et les trois fonctions étaient
--   appelables SANS session via /rest/v1/rpc/<nom>.
--
--   Conséquences concrètes, pas théoriques :
--     - set_agent_availability : son premier garde est
--       `IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id` — pour un
--       appelant anonyme auth.uid() vaut NULL, donc le garde PASSE (il est
--       écrit ainsi pour laisser passer service_role et pg_cron). Avec un UUID
--       d'agent connu passé en p_agent_id ET p_actor_id, l'appel se qualifie
--       en « self » : l'agent sort de la rotation et ses commandes intouchées
--       repartent au pool.
--     - apply_pool_assignments : p_actor_id NULL sautait TOUTE la validation
--       d'acteur et de marché.
--     - reset_agent_availability_daily : accordée à service_role seulement,
--       mais PUBLIC la rendait appelable par n'importe qui.
--
--   Même leçon que 20260924000001 pour order_stock_lines : « publiée via
--   PostgREST, un id de commande aurait suffi ». Un GRANT explicite ne
--   suffit pas — il faut REVOKE FROM PUBLIC d'abord.
--
--   Détectée par `get_advisors(type: security)` après application :
--   anon_security_definer_function_executable.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.set_agent_availability(UUID, BOOLEAN, UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_pool_assignments(UUID, JSONB, UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reset_agent_availability_daily()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_agent_availability(UUID, BOOLEAN, UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pool_assignments(UUID, JSONB, UUID, TEXT)
  TO authenticated;
-- La remise à zéro reste réservée au cron et à la route super_admin, qui
-- passe par createAdminClient().
GRANT EXECUTE ON FUNCTION public.reset_agent_availability_daily()
  TO service_role;

-- Ceinture et bretelles : p_actor_id devient obligatoire dans
-- apply_pool_assignments — c'était le chemin par lequel la vérification de
-- marché se sautait. Aucun appelant applicatif ne passait NULL.
--
-- NOTE : un CREATE OR REPLACE réinitialise les droits de la fonction, d'où le
-- REVOKE/GRANT répété APRÈS la redéfinition, en bas de ce fichier.
