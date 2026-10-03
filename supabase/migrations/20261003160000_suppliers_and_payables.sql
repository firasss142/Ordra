-- ════════════════════════════════════════════════════════════════════════════
-- FOURNISSEURS ET DETTE FOURNISSEUR
-- plans/reception-v4-quai-et-bureau.md · étape 1
--
-- POURQUOI CETTE TABLE N'EXISTAIT PAS, ET POURQUOI IL LA FAUT MAINTENANT.
-- Le plan de la v1 disait : « pas de table fournisseurs. Elle gagne une table
-- quand quelqu'un demande "qu'est-ce qu'on achète chez X", pas avant. » C'était
-- juste — et c'est arrivé. `reception_payments` existe depuis le 30 septembre,
-- il est lu par trois routes et la projection, et par RIEN dans Finances. On
-- peut donc enregistrer « acompte 40 % · reste 11 232,000 » sur un document, et
-- le système ne pourra jamais répondre à « combien je dois à ce fournisseur »,
-- « combien ai-je acheté ce mois-ci », ni « quel paiement est en retard ».
-- Une donnée captée à un grain qui n'agrège pas est une donnée écrite, jamais
-- lue — alors que la plus grosse sortie de trésorerie de l'entreprise est la
-- seule chose qu'Ordra ne suit pas, quand elle suit au dinar le coût
-- transporteur de 4 202 commandes.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS. Elle ne touche à aucun stock, ne change
-- aucun statut, ne supprime aucune colonne et n'appelle aucune RPC existante.
-- `supplier_name` reste en place et reste la source d'affichage tant qu'une
-- réception n'a pas de `supplier_id` : rien ne casse si on s'arrête ici.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · La table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.suppliers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id  UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  -- Trois champs de contexte, pas un carnet d'adresses. Ils tiennent sur la
  -- sous-ligne de l'écran Achats (« livres · Misrata · 6 réceptions ») et c'est
  -- tout ce qu'on a besoin de savoir pour choisir le bon dans une liste.
  category   TEXT,
  city       TEXT,
  phone      TEXT,
  note       TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT suppliers_name_not_blank CHECK (length(btrim(name)) > 0)
);

-- Un fournisseur appartient à UN marché : « مكتبة الرسالة » en Libye et un
-- homonyme en Tunisie sont deux ardoises, deux devises, deux histoires.
-- L'unicité est insensible à la casse et aux espaces de bord, parce que le
-- doublon qu'on crée vraiment est « Biovera » / « biovera  ».
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_market_name_key
  ON public.suppliers (market_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS suppliers_market_active_idx
  ON public.suppliers (market_id) WHERE is_active;

COMMENT ON TABLE public.suppliers IS
  'Fournisseurs de marchandises, par marché. Créés depuis l''écran de soldage '
  'd''une réception ou depuis Finances › Achats.';

-- ── 2 · Ce qu'une réception doit ───────────────────────────────────────────

ALTER TABLE public.receptions
  ADD COLUMN IF NOT EXISTS supplier_id   UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_total NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS due_at        DATE;

-- LE DÛ EST LA FACTURE, PAS LE COÛT DE REVIENT. `invoice_total` est ce que le
-- fournisseur réclame pour la marchandise ; le transport et la douane sont dus
-- à d'autres et n'entrent pas ici. Les additionner ferait payer deux fois dans
-- la tête du lecteur.
COMMENT ON COLUMN public.receptions.invoice_total IS
  'Total de la facture fournisseur, marchandises seules — frais d''approche '
  'exclus. NULL tant que la réception n''est pas chiffrée : on doit quelque '
  'chose, on ne sait pas combien. Jamais 0 pour dire « inconnu ».';

COMMENT ON COLUMN public.receptions.due_at IS
  'Échéance convenue. NULL = personne ne l''a posée ; la ligne est alors « due » '
  'et jamais « en retard » — inventer un retard ferait crier une ligne saine.';

CREATE INDEX IF NOT EXISTS receptions_supplier_idx
  ON public.receptions (supplier_id) WHERE supplier_id IS NOT NULL;

-- L'échéancier ne lit que ce qui reste à payer : index partiel sur ce qui a un
-- montant réclamé.
CREATE INDEX IF NOT EXISTS receptions_due_idx
  ON public.receptions (market_id, due_at) WHERE invoice_total IS NOT NULL;

-- ── 3 · RLS ─────────────────────────────────────────────────────────────────
-- `get_user_role()` et `get_user_market_id()` sont enveloppés dans (SELECT …)
-- pour rester dans l'InitPlan : sans cela le helper est ré-évalué PAR LIGNE.

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- LIRE : les trois rôles d'entrepôt. Le NOM d'un fournisseur n'est pas une
-- information de coût — un agent voit déjà « مكتبة الرسالة » en tête de la
-- feuille de réception. Les prix, eux, restent retirés côté serveur par la
-- projection, comme avant.
DROP POLICY IF EXISTS suppliers_select ON public.suppliers;
CREATE POLICY suppliers_select ON public.suppliers FOR SELECT TO authenticated
USING (
  (SELECT get_user_role()) = 'super_admin'
  OR ((SELECT get_user_role()) IN ('market_manager', 'warehouse_agent')
      AND market_id = (SELECT get_user_market_id()))
);

-- ÉCRIRE : le bureau seulement. Créer un fournisseur est un geste comptable, et
-- l'agent du quai n'en rencontre jamais un — sa surface n'affiche ni prix ni
-- fournisseur.
DROP POLICY IF EXISTS suppliers_write ON public.suppliers;
CREATE POLICY suppliers_write ON public.suppliers FOR INSERT TO authenticated
WITH CHECK (
  (SELECT get_user_role()) = 'super_admin'
  OR ((SELECT get_user_role()) = 'market_manager'
      AND market_id = (SELECT get_user_market_id()))
);

DROP POLICY IF EXISTS suppliers_update ON public.suppliers;
CREATE POLICY suppliers_update ON public.suppliers FOR UPDATE TO authenticated
USING (
  (SELECT get_user_role()) = 'super_admin'
  OR ((SELECT get_user_role()) = 'market_manager'
      AND market_id = (SELECT get_user_market_id()))
)
WITH CHECK (
  (SELECT get_user_role()) = 'super_admin'
  OR ((SELECT get_user_role()) = 'market_manager'
      AND market_id = (SELECT get_user_market_id()))
);

-- PAS DE SUPPRESSION. Un fournisseur porte un historique d'achat ; on le
-- désactive (`is_active = false`) et il disparaît des listes sans emporter les
-- réceptions qui le nomment. Même discipline que les motifs de rejet retirés.

-- ── 4 · Privilèges ─────────────────────────────────────────────────────────
-- Les privilèges de table sont accordés colonne par colonne en production sur
-- certaines tables ; ici la table est neuve, donc un GRANT simple suffit — mais
-- `anon` n'y touche jamais.
GRANT SELECT, INSERT, UPDATE ON public.suppliers TO authenticated;
REVOKE ALL ON public.suppliers FROM anon;

-- `updated_at` suit la convention des autres tables du domaine.
CREATE OR REPLACE FUNCTION public.suppliers_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS suppliers_touch ON public.suppliers;
CREATE TRIGGER suppliers_touch
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.suppliers_touch_updated_at();
