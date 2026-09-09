-- Le banc dit la vérité — durcissement des écritures d'entrepôt.
--
-- QUATRE DÉFAUTS, TOUS TROUVÉS EN PRODUCTION LE 2026-09-09
--
-- 1. `p_actor_id` n'est pas authentifié. scan_order_out, scan_return_in,
--    scan_received_in et record_stock_count prennent l'acteur en paramètre et ne
--    vérifient jamais qu'il s'agit de l'appelant. N'importe quel utilisateur
--    connecté pouvait porter un scan au crédit d'un collègue. Seul
--    manual_delete_orders faisait le contrôle (20260520181559:41-44).
--    Règle retenue : `auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id` est un
--    refus. Un appel sans session (service_role : les scripts, les crons, le
--    fixture E2E) passe — c'est déjà un contexte de confiance.
--
-- 2. Les erreurs des RPC sont du texte libre, reconnu par sous-chaîne côté
--    TypeScript (scan-out/route.ts classifyRpcError). Changer un mot de la phrase
--    française cassait silencieusement le code d'erreur, donc le message affiché
--    à l'agent. Chaque refus porte désormais un code machine dans DETAIL, que
--    PostgREST rend comme `error.details`. Le texte reste, pour les journaux.
--
-- 3. `inventory_log.reason` n'a aucune contrainte. Neuf valeurs sont écrites par
--    cinq RPC, docs/database-schema.md en documente deux qui n'existent pas.
--    Une faute de frappe dans une future fonction créerait un motif fantôme que
--    personne ne verrait jamais.
--
-- 4. « Append-only » n'était que l'absence de policy RLS. 20260921000002:18
--    affirme que des triggers protègent inventory_log et order_history : ils
--    n'existent pas. Le service_role et toute fonction SECURITY DEFINER peuvent
--    réécrire ou supprimer une ligne de registre aujourd'hui.

-- ── 1. Le vocabulaire du registre ───────────────────────────────────────────

ALTER TABLE public.inventory_log
  DROP CONSTRAINT IF EXISTS inventory_log_reason_check;

ALTER TABLE public.inventory_log
  ADD CONSTRAINT inventory_log_reason_check CHECK (reason IN (
    'initial_stock',          -- création du produit (super_admin)
    'scanned',                -- sortie entrepôt, −qty
    'scan_reversal',          -- dé-scan, +qty (20260922000030)
    'returned',               -- retour remis en stock, +qty
    'received_back',          -- retour à réexpédier, +qty
    'damaged_writeoff',       -- retour endommagé → damaged_return_count
    'manual_adjustment',      -- correction super_admin
    'stock_count',            -- comptage physique, ± delta
    'manual_delete_reversal', -- suppression d'une commande scannée, +qty
    'deposit'                 -- hérité de fulfill_order_transition, plus écrit
  ));

COMMENT ON COLUMN public.inventory_log.reason IS
  'Motif du mouvement. Vocabulaire fermé : toute nouvelle valeur passe par une '
  'migration qui élargit inventory_log_reason_check, jamais par du texte libre.';

-- ── 2. Registres réellement append-only ─────────────────────────────────────
--
-- RLS refuse déjà UPDATE et DELETE au rôle `authenticated` (aucune policy). Ce
-- trigger ferme la porte restée ouverte : service_role et SECURITY DEFINER.
-- Il est volontairement sans échappatoire — le teardown du fixture E2E le
-- désactive explicitement, ce qui est une trace, pas un contournement.

CREATE OR REPLACE FUNCTION public.ledger_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% est append-only : ni UPDATE ni DELETE', TG_TABLE_NAME
    USING ERRCODE = '42501',
          DETAIL  = '{"code":"LEDGER_APPEND_ONLY"}',
          HINT    = 'Écrivez une ligne compensatoire au lieu de corriger celle-ci.';
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_log_append_only ON public.inventory_log;
CREATE TRIGGER trg_inventory_log_append_only
  BEFORE UPDATE OR DELETE ON public.inventory_log
  FOR EACH ROW EXECUTE FUNCTION public.ledger_append_only();

DROP TRIGGER IF EXISTS trg_order_history_append_only ON public.order_history;
CREATE TRIGGER trg_order_history_append_only
  BEFORE UPDATE OR DELETE ON public.order_history
  FOR EACH ROW EXECUTE FUNCTION public.ledger_append_only();

-- ── 3. carrier_type : la contrainte n'a jamais connu Darb ───────────────────
--
-- CHECK (carrier_type IN ('navex','dexpress')) depuis 007. Les deux lignes Darb
-- n'existent que parce que la colonne a une valeur par défaut 'navex' : écrire
-- le vrai type aurait levé. La colonne n'est lue par aucun adaptateur — `code`
-- fait le travail — donc la contrainte part plutôt que de grandir.

ALTER TABLE public.carriers DROP CONSTRAINT IF EXISTS carriers_carrier_type_check;

COMMENT ON COLUMN public.carriers.carrier_type IS
  'Hérité de la session 5, non lu : l''adaptateur est choisi par `code`. '
  'La contrainte navex|dexpress a été retirée le 2026-09-09 (les lignes Darb '
  'portaient ''navex'' par défaut).';
