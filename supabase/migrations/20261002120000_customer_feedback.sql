-- Voix du client — « صوت العميل » (plans/voix-du-client.md).
--
-- Ce que les agents entendent au téléphone — réclamations, objections, suggestions — vivait
-- dans des notes de rejet « Autre » et une feuille Google. Cette migration leur donne une
-- table, liée à la commande, au client et au produit.
--
--   * 3 CATÉGORIES fixes, par intention (enum) : réclamation (un souci à régler), objection
--     (pourquoi il hésite ou refuse), suggestion (ce qu'il aimerait ou apprécie). Seule la
--     réclamation a un cycle : open → in_progress → resolved.
--   * des SUJETS sous chaque catégorie, par marché (feedback_topics), sur le modèle de
--     rejection_reason_configs.
--   * le MOMENT (appel · en route · à la porte · après livraison) n'est jamais saisi : la RPC
--     le déduit du statut de la commande au moment de l'enregistrement.
--
-- Aucune écriture directe : INSERT/UPDATE/DELETE sont retirés à authenticated, tout passe par
-- les RPC ci-dessous, SECURITY DEFINER, dont l'acteur est TOUJOURS auth.uid().

-- ── Types ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.feedback_category AS ENUM ('reclamation', 'objection', 'suggestion');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.feedback_moment AS ENUM ('call', 'transit', 'door', 'after');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Le moment, déduit du statut ──────────────────────────────────────────────
-- Miroir exact de src/lib/feedback/moment.ts (la fenêtre de saisie l'affiche avant
-- l'enregistrement). « Annulée » ne veut dire « à la porte » que si le colis est parti :
-- en Libye, Darb annule aussi des colis déjà remis au livreur.
CREATE OR REPLACE FUNCTION public.feedback_moment_of(p_status TEXT, p_shipped BOOLEAN)
RETURNS public.feedback_moment
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT (CASE
    WHEN p_status = 'delivered' THEN 'after'
    WHEN p_status IN ('returning', 'to_be_returned', 'returned', 'received') THEN 'door'
    WHEN p_status = 'cancelled' AND coalesce(p_shipped, FALSE) THEN 'door'
    WHEN p_status IN ('confirmed', 'dispatch_scheduled', 'uploaded', 'scanned', 'dispatched', 'deposit',
                      'at_carrier', 'in_transit', 'out_for_delivery', 'delivery_delayed') THEN 'transit'
    ELSE 'call'
  END)::public.feedback_moment
$$;

-- ── Sujets ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback_topics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  category    public.feedback_category NOT NULL,
  key         TEXT NOT NULL,
  label_fr    TEXT NOT NULL,
  label_ar    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT feedback_topics_key_format CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT feedback_topics_market_key_unique UNIQUE (market_id, key)
);

COMMENT ON TABLE public.feedback_topics IS
  'Sujets de la Voix du client, par marché, sous l''une des 3 catégories fixes. Semés depuis les vraies notes « Autre » et remarques du livreur.';

-- Le semis : les phrases réelles des notes « Autre » et des remarques Darb (plan, « Taxonomie »).
INSERT INTO public.feedback_topics (market_id, category, key, label_fr, label_ar, sort_order)
SELECT m.id, v.category::public.feedback_category, v.key, v.label_fr, v.label_ar, v.sort_order
FROM public.markets m
CROSS JOIN (VALUES
  ('reclamation', 'nonconform',    'Non conforme à la commande',       'غير مطابق للطلب',                 0),
  ('reclamation', 'damaged',       'Abîmé ou incomplet',               'تالف أو ناقص',                    1),
  ('reclamation', 'never',         'Jamais reçu',                      'لم يصل',                          2),
  ('reclamation', 'slow',          'Trop long',                        'تأخر كثيراً',                      3),
  ('reclamation', 'calls',         'Appels répétés',                   'إزعاج بالاتصال',                  4),
  ('reclamation', 'conduct',       'Mauvais accueil',                  'سوء تعامل',                       5),
  ('objection',   'expensive',     'Trop cher',                        'السعر غالي',                      0),
  ('objection',   'nocash',        'Pas de cash maintenant',           'لا يملك المبلغ الآن',              1),
  ('objection',   'card',          'Veut payer par carte ou virement', 'يريد الدفع بالبطاقة أو التحويل',  2),
  ('objection',   'expect',        'Croyait autre chose',              'كان يظنه شيئاً آخر',               3),
  ('objection',   'elsewhere',     'Acheté ailleurs',                  'اشترى من مكان آخر',               4),
  ('objection',   'delivery',      'Livraison (délai, ville)',         'التوصيل (المدة، المدينة)',         5),
  ('suggestion',  'version',       'Autre version ou produit',         'نسخة أو منتج آخر',                0),
  ('suggestion',  'likes_product', 'Aime le produit',                  'أعجبه المنتج',                    1),
  ('suggestion',  'likes_service', 'Aime le service',                  'أعجبته الخدمة',                   2),
  ('suggestion',  'again',         'Va racheter',                      'سيطلب مجدداً',                     3)
) AS v(category, key, label_fr, label_ar, sort_order)
ON CONFLICT (market_id, key) DO NOTHING;

-- ── Les retours ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_feedback (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id            UUID NOT NULL REFERENCES public.markets(id),
  category             public.feedback_category NOT NULL,
  topic_id             UUID REFERENCES public.feedback_topics(id),
  -- Posé par la RPC depuis le statut de la commande. Jamais envoyé par le client.
  moment               public.feedback_moment NOT NULL,
  body                 TEXT NOT NULL,
  product_id           UUID REFERENCES public.products(id),
  order_id             UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  customer_id          UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  -- agent : saisie libre (touche F) · rejection : refus « Autre » · delivery : onglet Livraison
  -- courier : remarque du livreur Darb · import : ancienne note « Autre »
  source               TEXT NOT NULL,
  courier_shipment_id  UUID REFERENCES public.darb_shipments(id) ON DELETE SET NULL,
  -- Une suggestion (livreur, import) attend qu'un responsable la garde ou l'ignore.
  needs_review         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Le cycle d'une réclamation validée ; NULL pour tout le reste.
  status               TEXT,
  assigned_to          UUID REFERENCES public.users(id),
  resolved_at          TIMESTAMPTZ,
  resolved_by          UUID REFERENCES public.users(id),
  reviewed_at          TIMESTAMPTZ,
  reviewed_by          UUID REFERENCES public.users(id),
  -- NULL pour une remarque du livreur : aucun agent n'en est l'auteur.
  created_by           UUID REFERENCES public.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ,
  deleted_by           UUID REFERENCES public.users(id),
  CONSTRAINT customer_feedback_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  CONSTRAINT customer_feedback_source_check CHECK (source IN ('agent', 'rejection', 'delivery', 'courier', 'import')),
  CONSTRAINT customer_feedback_status_values CHECK (status IS NULL OR status IN ('open', 'in_progress', 'resolved')),
  -- Une réclamation validée a toujours un statut ; tout le reste n'en a jamais.
  CONSTRAINT customer_feedback_complaint_status CHECK ((category = 'reclamation' AND NOT needs_review) = (status IS NOT NULL))
);

COMMENT ON TABLE public.customer_feedback IS
  'Voix du client : ce que disent les clients, à chaque moment, lié à la commande, au client et au produit. Écriture par RPC seulement.';

CREATE INDEX IF NOT EXISTS customer_feedback_market_created_idx ON public.customer_feedback (market_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_feedback_product_idx ON public.customer_feedback (product_id);
CREATE INDEX IF NOT EXISTS customer_feedback_customer_idx ON public.customer_feedback (customer_id);
CREATE INDEX IF NOT EXISTS customer_feedback_created_by_idx ON public.customer_feedback (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_feedback_open_complaints_idx
  ON public.customer_feedback (market_id, status) WHERE category = 'reclamation' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS customer_feedback_review_idx
  ON public.customer_feedback (market_id) WHERE needs_review AND deleted_at IS NULL;
-- Chaque flux automatique est idempotent : une note importée par commande, une suggestion par colis.
CREATE UNIQUE INDEX IF NOT EXISTS customer_feedback_import_once
  ON public.customer_feedback (order_id) WHERE source = 'import';
CREATE UNIQUE INDEX IF NOT EXISTS customer_feedback_courier_once
  ON public.customer_feedback (courier_shipment_id) WHERE source = 'courier';

-- Le sujet, le produit, la commande et le client appartiennent au marché de la ligne — même
-- pour une écriture qui ne passerait pas par la RPC (l'import, le livreur).
CREATE OR REPLACE FUNCTION public.customer_feedback_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.topic_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.feedback_topics t
    WHERE t.id = NEW.topic_id AND t.market_id = NEW.market_id AND t.category = NEW.category
  ) THEN
    RAISE EXCEPTION 'invalid_topic' USING ERRCODE = '22023';
  END IF;
  IF NEW.product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = NEW.product_id AND p.market_id = NEW.market_id
  ) THEN
    RAISE EXCEPTION 'product_other_market' USING ERRCODE = '22023';
  END IF;
  IF NEW.order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = NEW.order_id AND o.market_id = NEW.market_id
  ) THEN
    RAISE EXCEPTION 'order_other_market' USING ERRCODE = '22023';
  END IF;
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id = NEW.customer_id AND c.market_id = NEW.market_id
  ) THEN
    RAISE EXCEPTION 'customer_other_market' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_customer_feedback_guard ON public.customer_feedback;
CREATE TRIGGER trg_customer_feedback_guard
  BEFORE INSERT OR UPDATE OF market_id, category, topic_id, product_id, order_id, customer_id, status, needs_review, deleted_at
  ON public.customer_feedback
  FOR EACH ROW EXECUTE FUNCTION public.customer_feedback_guard();

-- ── Le journal ───────────────────────────────────────────────────────────────
-- Qui a créé, gardé, ignoré, pris en charge, résolu, rouvert, annulé — en écriture seule,
-- par le même déclencheur que order_history.
CREATE TABLE IF NOT EXISTS public.customer_feedback_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id  UUID NOT NULL REFERENCES public.customer_feedback(id),
  market_id    UUID NOT NULL REFERENCES public.markets(id),
  kind         TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}'::JSONB,
  actor_id     UUID REFERENCES public.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_feedback_events_kind_check CHECK (kind IN ('created', 'kept', 'ignored', 'status', 'deleted'))
);

CREATE INDEX IF NOT EXISTS customer_feedback_events_feedback_idx ON public.customer_feedback_events (feedback_id, created_at);

DROP TRIGGER IF EXISTS trg_customer_feedback_events_append_only ON public.customer_feedback_events;
CREATE TRIGGER trg_customer_feedback_events_append_only
  BEFORE UPDATE OR DELETE ON public.customer_feedback_events
  FOR EACH ROW EXECUTE FUNCTION public.ledger_append_only();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Tout le marché lit les retours du marché (la fenêtre de saisie montre l'historique du client
-- au bout du fil, quel que soit l'agent qui l'a noté). L'entrepôt et les investisseurs : rien.
ALTER TABLE public.feedback_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_feedback_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feedback_topics_select ON public.feedback_topics;
CREATE POLICY feedback_topics_select ON public.feedback_topics FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR ((SELECT public.get_user_role()) IN ('market_manager', 'agent') AND market_id = (SELECT public.get_user_market_id()))
  );

DROP POLICY IF EXISTS customer_feedback_select ON public.customer_feedback;
CREATE POLICY customer_feedback_select ON public.customer_feedback FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR ((SELECT public.get_user_role()) IN ('market_manager', 'agent') AND market_id = (SELECT public.get_user_market_id()))
  );

DROP POLICY IF EXISTS customer_feedback_events_select ON public.customer_feedback_events;
CREATE POLICY customer_feedback_events_select ON public.customer_feedback_events FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'super_admin'
    OR ((SELECT public.get_user_role()) IN ('market_manager', 'agent') AND market_id = (SELECT public.get_user_market_id()))
  );

REVOKE ALL ON public.feedback_topics, public.customer_feedback, public.customer_feedback_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.feedback_topics, public.customer_feedback, public.customer_feedback_events FROM authenticated;
GRANT SELECT ON public.feedback_topics, public.customer_feedback, public.customer_feedback_events TO authenticated;

-- ── RPC : créer ──────────────────────────────────────────────────────────────
-- Le marché vient de la commande, sinon du client, sinon de l'agent (un super_admin doit le
-- nommer). Le moment vient du statut de la commande ; sans commande, c'est l'appel.
CREATE OR REPLACE FUNCTION public.create_customer_feedback(
  p_category     TEXT,
  p_body         TEXT,
  p_topic_id     UUID DEFAULT NULL,
  p_order_id     UUID DEFAULT NULL,
  p_customer_id  UUID DEFAULT NULL,
  p_product_id   UUID DEFAULT NULL,
  p_source       TEXT DEFAULT 'agent',
  p_market_id    UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       UUID;
  v_role      TEXT;
  v_umarket   UUID;
  v_body      TEXT := btrim(coalesce(p_body, ''));
  v_cat       public.feedback_category;
  v_market    UUID;
  v_customer  UUID;
  v_product   UUID := p_product_id;
  v_moment    public.feedback_moment := 'call';
  v_order     RECORD;
  v_id        UUID := gen_random_uuid();
BEGIN
  SELECT u.id, u.role, u.market_id INTO v_uid, v_role, v_umarket
  FROM public.users u
  WHERE u.id = auth.uid() AND u.is_active AND u.deleted_at IS NULL;
  IF v_uid IS NULL OR v_role NOT IN ('agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_category IS NULL OR p_category NOT IN ('reclamation', 'objection', 'suggestion') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  v_cat := p_category::public.feedback_category;
  IF char_length(v_body) < 1 OR char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'invalid_body' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_source, 'agent') NOT IN ('agent', 'rejection', 'delivery') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = '22023';
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT o.id, o.market_id, o.customer_id, o.product_id, o.status::TEXT AS status, o.tracking_number
      INTO v_order
    FROM public.orders o WHERE o.id = p_order_id;
    IF v_order.id IS NULL THEN
      RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_market   := v_order.market_id;
    v_customer := v_order.customer_id;
    v_product  := coalesce(p_product_id, v_order.product_id);
    v_moment   := public.feedback_moment_of(v_order.status, v_order.tracking_number IS NOT NULL);
  ELSIF p_customer_id IS NOT NULL THEN
    SELECT c.market_id INTO v_market FROM public.customers c WHERE c.id = p_customer_id;
    IF v_market IS NULL THEN
      RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_customer := p_customer_id;
  ELSE
    v_market := CASE WHEN v_role = 'super_admin' THEN p_market_id ELSE v_umarket END;
  END IF;

  IF v_market IS NULL THEN
    RAISE EXCEPTION 'market_required' USING ERRCODE = '22023';
  END IF;
  IF v_role <> 'super_admin' AND v_market IS DISTINCT FROM v_umarket THEN
    RAISE EXCEPTION 'other_market' USING ERRCODE = '42501';
  END IF;
  IF p_topic_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.feedback_topics t
    WHERE t.id = p_topic_id AND t.market_id = v_market AND t.category = v_cat
  ) THEN
    RAISE EXCEPTION 'invalid_topic' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.customer_feedback
    (id, market_id, category, topic_id, moment, body, product_id, order_id, customer_id,
     source, status, created_by)
  VALUES
    (v_id, v_market, v_cat, p_topic_id, v_moment, v_body, v_product, p_order_id, v_customer,
     coalesce(p_source, 'agent'), CASE WHEN v_cat = 'reclamation' THEN 'open' END, v_uid);

  INSERT INTO public.customer_feedback_events (feedback_id, market_id, kind, actor_id, data)
  VALUES (v_id, v_market, 'created', v_uid, jsonb_build_object('source', coalesce(p_source, 'agent')));

  RETURN v_id;
END $$;

-- ── RPC : garder / ignorer (la file « à valider ») ───────────────────────────
CREATE OR REPLACE FUNCTION public.keep_customer_feedback(p_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID; v_role TEXT; v_umarket UUID; v_n INTEGER;
BEGIN
  SELECT u.id, u.role, u.market_id INTO v_uid, v_role, v_umarket
  FROM public.users u WHERE u.id = auth.uid() AND u.is_active AND u.deleted_at IS NULL;
  IF v_uid IS NULL OR v_role NOT IN ('market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH kept AS (
    UPDATE public.customer_feedback f
       SET needs_review = FALSE,
           reviewed_at  = now(),
           reviewed_by  = v_uid,
           status       = CASE WHEN f.category = 'reclamation' THEN 'open' END
     WHERE f.id = ANY (coalesce(p_ids, ARRAY[]::UUID[]))
       AND f.needs_review AND f.deleted_at IS NULL
       AND (v_role = 'super_admin' OR f.market_id = v_umarket)
    RETURNING f.id, f.market_id
  )
  INSERT INTO public.customer_feedback_events (feedback_id, market_id, kind, actor_id)
  SELECT k.id, k.market_id, 'kept', v_uid FROM kept k;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.ignore_customer_feedback(p_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID; v_role TEXT; v_umarket UUID; v_n INTEGER;
BEGIN
  SELECT u.id, u.role, u.market_id INTO v_uid, v_role, v_umarket
  FROM public.users u WHERE u.id = auth.uid() AND u.is_active AND u.deleted_at IS NULL;
  IF v_uid IS NULL OR v_role NOT IN ('market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Seulement ce qui attend une validation : « Ignorer » n'est pas une gomme pour les retours
  -- déjà gardés.
  WITH ignored AS (
    UPDATE public.customer_feedback f
       SET deleted_at = now(), deleted_by = v_uid
     WHERE f.id = ANY (coalesce(p_ids, ARRAY[]::UUID[]))
       AND f.needs_review AND f.deleted_at IS NULL
       AND (v_role = 'super_admin' OR f.market_id = v_umarket)
    RETURNING f.id, f.market_id
  )
  INSERT INTO public.customer_feedback_events (feedback_id, market_id, kind, actor_id)
  SELECT i.id, i.market_id, 'ignored', v_uid FROM ignored i;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ── RPC : le cycle d'une réclamation ─────────────────────────────────────────
-- « Prendre en charge » = in_progress ; « Marquer résolue » ; « Rouvrir » = open. Celui qui
-- bouge une réclamation sans responsable en devient le responsable.
CREATE OR REPLACE FUNCTION public.set_feedback_complaint_status(p_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID; v_role TEXT; v_umarket UUID;
  v_f public.customer_feedback;
BEGIN
  SELECT u.id, u.role, u.market_id INTO v_uid, v_role, v_umarket
  FROM public.users u WHERE u.id = auth.uid() AND u.is_active AND u.deleted_at IS NULL;
  IF v_uid IS NULL OR v_role NOT IN ('market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('open', 'in_progress', 'resolved') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_f FROM public.customer_feedback WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF v_f.id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_role <> 'super_admin' AND v_f.market_id <> v_umarket THEN
    RAISE EXCEPTION 'other_market' USING ERRCODE = '42501';
  END IF;
  IF v_f.category <> 'reclamation' OR v_f.needs_review THEN
    RAISE EXCEPTION 'not_a_complaint' USING ERRCODE = '22023';
  END IF;
  IF v_f.status = p_status THEN
    RETURN;
  END IF;

  UPDATE public.customer_feedback
     SET status      = p_status,
         assigned_to = coalesce(assigned_to, v_uid),
         resolved_at = CASE WHEN p_status = 'resolved' THEN now() END,
         resolved_by = CASE WHEN p_status = 'resolved' THEN v_uid END
   WHERE id = p_id;

  INSERT INTO public.customer_feedback_events (feedback_id, market_id, kind, actor_id, data)
  VALUES (p_id, v_f.market_id, 'status', v_uid, jsonb_build_object('from', v_f.status, 'to', p_status));
END $$;

-- ── RPC : annuler (le toast « Enregistré · Annuler ») ────────────────────────
-- L'auteur, dans les dix minutes. Une suppression douce : la ligne et son journal restent.
CREATE OR REPLACE FUNCTION public.delete_customer_feedback(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_f public.customer_feedback;
BEGIN
  SELECT u.id INTO v_uid FROM public.users u WHERE u.id = auth.uid() AND u.is_active AND u.deleted_at IS NULL;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_f FROM public.customer_feedback WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF v_f.id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_f.created_by IS DISTINCT FROM v_uid OR v_f.created_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.customer_feedback SET deleted_at = now(), deleted_by = v_uid WHERE id = p_id;
  INSERT INTO public.customer_feedback_events (feedback_id, market_id, kind, actor_id)
  VALUES (p_id, v_f.market_id, 'deleted', v_uid);
END $$;

-- ── Lecture : le cube de la page responsable ─────────────────────────────────
-- Les comptes par jour (heure du marché) × catégorie × sujet × produit × auteur. Tout le reste
-- — cartes, tendances, top sujets, saisies par agent, familles de produits — se calcule en
-- TypeScript à partir de ce cube (src/lib/feedback/overview.ts). SECURITY INVOKER : la RLS
-- s'applique, un manager ne voit que son marché quoi qu'il passe en p_market_id.
CREATE OR REPLACE FUNCTION public.feedback_cube(p_market_id UUID, p_from DATE, p_to DATE, p_tz TEXT)
RETURNS TABLE (
  day         DATE,
  category    public.feedback_category,
  topic_id    UUID,
  product_id  UUID,
  created_by  UUID,
  source      TEXT,
  n           INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT (f.created_at AT TIME ZONE p_tz)::DATE, f.category, f.topic_id, f.product_id, f.created_by, f.source, count(*)::INTEGER
  FROM public.customer_feedback f
  WHERE f.market_id = p_market_id
    AND f.deleted_at IS NULL
    AND NOT f.needs_review
    AND f.created_at >= (p_from::TIMESTAMP AT TIME ZONE p_tz)
    AND f.created_at <  ((p_to + 1)::TIMESTAMP AT TIME ZONE p_tz)
  GROUP BY 1, 2, 3, 4, 5, 6
$$;

-- ── Privilèges des fonctions ─────────────────────────────────────────────────
-- EXECUTE va à PUBLIC par défaut : on retire à PUBLIC ET à anon avant d'accorder
-- (20260924120000_revoke_anon_execute_security_definer.sql).
REVOKE ALL ON FUNCTION public.feedback_moment_of(TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customer_feedback_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_customer_feedback(TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.keep_customer_feedback(UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ignore_customer_feedback(UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_feedback_complaint_status(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_customer_feedback(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.feedback_cube(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.feedback_moment_of(TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_feedback(TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.keep_customer_feedback(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ignore_customer_feedback(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_feedback_complaint_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_customer_feedback(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.feedback_cube(UUID, DATE, DATE, TEXT) TO authenticated;
