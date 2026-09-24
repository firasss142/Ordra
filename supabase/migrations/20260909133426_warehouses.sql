-- Deux entrepôts physiques, pas un marché.
--
-- POURQUOI
--   La Libye prépare et remet ses colis depuis DEUX bâtiments, Tripoli et
--   Benghazi, chacun avec ses agents et ses rayonnages. Le système n'en
--   connaissait qu'un : products.current_stock est un total marché, donc un scan
--   à Benghazi décrémentait le stock de Tripoli, et la file de préparation
--   mélangeait des colis que deux équipes différentes doivent emballer.
--
--   Le lien n'est pas arbitraire : un site correspond à un compte Darb Assabil.
--   Une commande montée sur le compte Benghazi est préparée à Benghazi et remise
--   à Darb Benghazi — remise à Darb Tripoli, elle n'existe pas dans leur système.
--   C'est donc `orders.carrier_id` qui décide du site, à l'upload.
--
--   La Tunisie a un seul site ; elle en reçoit un par défaut pour que le modèle
--   soit le même partout et qu'aucune requête n'ait à traiter NULL comme un cas.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS
--   Elle ne touche pas au stock. product_site_stock arrive en 20260922000011 et
--   reste vide jusqu'au comptage physique d'ouverture : c'est ce comptage, pas
--   une estimation, qui répartit les unités entre les deux bâtiments.

CREATE TABLE IF NOT EXISTS public.warehouses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   UUID NOT NULL REFERENCES public.markets (id),
  code        TEXT NOT NULL,
  name_fr     TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  -- Le site qui reçoit tout ce qui n'est pas explicitement rattaché ailleurs.
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouses_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT warehouses_market_code_key UNIQUE (market_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS warehouses_one_default_per_market
  ON public.warehouses (market_id) WHERE is_default;

DROP TRIGGER IF EXISTS trg_warehouses_updated_at ON public.warehouses;
CREATE TRIGGER trg_warehouses_updated_at
  BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.warehouses IS
  'Un bâtiment réel où des colis sont préparés et remis au transporteur. '
  'En Libye il y en a deux, et chacun correspond à un compte Darb Assabil : '
  'une commande montée sur le compte Benghazi ne peut pas être remise à Tripoli.';

-- ── Les sites ───────────────────────────────────────────────────────────────
-- Rattachés par le code marché, jamais par un uuid en dur.

INSERT INTO public.warehouses (market_id, code, name_fr, name_ar, is_default)
SELECT m.id, 'tripoli', 'Tripoli', 'طرابلس', TRUE
FROM public.markets m WHERE m.code = 'ly'
ON CONFLICT (market_id, code) DO NOTHING;

INSERT INTO public.warehouses (market_id, code, name_fr, name_ar, is_default)
SELECT m.id, 'benghazi', 'Benghazi', 'بنغازي', FALSE
FROM public.markets m WHERE m.code = 'ly'
ON CONFLICT (market_id, code) DO NOTHING;

INSERT INTO public.warehouses (market_id, code, name_fr, name_ar, is_default)
SELECT m.id, 'tunis', 'Tunis', 'تونس', TRUE
FROM public.markets m WHERE m.code = 'tn'
ON CONFLICT (market_id, code) DO NOTHING;

-- ── Qui appartient à quel site ──────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES public.warehouses (id);

COMMENT ON COLUMN public.users.warehouse_id IS
  'Le bâtiment où travaille cet agent d''entrepôt. NULL pour tout autre rôle : '
  'un manager voit les deux sites, un agent de confirmation n''en voit aucun.';

ALTER TABLE public.carriers
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES public.warehouses (id);

COMMENT ON COLUMN public.carriers.warehouse_id IS
  'Le site depuis lequel ce compte transporteur expédie. C''est ce qui donne '
  'son site à une commande au moment de l''upload.';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES public.warehouses (id);

COMMENT ON COLUMN public.orders.warehouse_id IS
  'Le site qui prépare ce colis, hérité du compte transporteur à l''upload. '
  'NULL quand le transporteur expédie depuis son propre entrepôt '
  '(carrier_extra.fulfil_from_carrier_warehouse) : la marchandise n''a jamais '
  'touché nos rayonnages.';

CREATE INDEX IF NOT EXISTS orders_warehouse_status_idx
  ON public.orders (warehouse_id, status) WHERE warehouse_id IS NOT NULL;

-- ── Rattachement des comptes existants ──────────────────────────────────────
-- Par le nom affiché, qui est déjà le discriminant des deux comptes Darb
-- (UNIQUE (market_id, code, name), cf. 20260816000003).

UPDATE public.carriers c
SET warehouse_id = w.id
FROM public.warehouses w, public.markets m
WHERE m.code = 'ly' AND w.market_id = m.id AND c.market_id = m.id
  AND w.code = 'tripoli' AND c.name ILIKE '%tripoli%';

UPDATE public.carriers c
SET warehouse_id = w.id
FROM public.warehouses w, public.markets m
WHERE m.code = 'ly' AND w.market_id = m.id AND c.market_id = m.id
  AND w.code = 'benghazi' AND c.name ILIKE '%benghazi%';

-- Tout le reste tombe sur le site par défaut de son marché.
UPDATE public.carriers c
SET warehouse_id = w.id
FROM public.warehouses w
WHERE c.warehouse_id IS NULL AND w.market_id = c.market_id AND w.is_default;

-- ── Les commandes héritent du compte sur lequel elles sont montées ───────────
-- Sauf celles que le transporteur expédie de son propre entrepôt : elles n'ont
-- pas de site, et c'est une information, pas un trou.

UPDATE public.orders o
SET warehouse_id = c.warehouse_id
FROM public.carriers c
WHERE o.carrier_id = c.id
  AND o.warehouse_id IS NULL
  AND COALESCE(o.carrier_extra->>'fulfil_from_carrier_warehouse', 'false') <> 'true';

-- ── Lecture ─────────────────────────────────────────────────────────────────

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouses_select ON public.warehouses;
CREATE POLICY warehouses_select ON public.warehouses
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'super_admin'
    OR market_id = public.get_user_market_id()
  );

-- Écriture : super_admin uniquement, comme les marchés et les transporteurs.
DROP POLICY IF EXISTS warehouses_write ON public.warehouses;
CREATE POLICY warehouses_write ON public.warehouses
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');
