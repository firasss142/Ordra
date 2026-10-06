-- Voix du client v2 (2026-10-06) — plans/voix-du-client-et-messages-redesign.md,
-- prototype prototypes/voix-du-client-et-messages-v2.html.
--
-- 1. Plus de file « à valider ». Tout compte dès l'arrivée ; le responsable « écarte » le bruit
--    (un ou plusieurs, avec « Annuler »). Le 6 oct. la file cachait 184 retours sur 196, et
--    personne ne l'avait jamais ouverte. La colonne needs_review reste (lue nulle part) ; elle
--    tombera dans une migration suivante, une fois le nouveau code en ligne.
-- 2. Une réclamation a TOUJOURS un statut. L'ancienne contrainte liait le statut à NOT
--    needs_review : les 14 remarques « non conforme » du livreur n'avaient jamais été ouvertes,
--    et la règle des 48 h ne pouvait pas les voir. Celles de plus de 14 jours sont classées
--    « résolue » (le journal dit pourquoi) ; les autres s'ouvrent.
-- 3. « Notre réponse » : une ligne par raison, écrite par le responsable
--    (feedback_topics.response).
-- 4. « Changer la raison » : un ou plusieurs retours, vers une raison d'objection ou de
--    suggestion. La catégorie suit la raison (une réclamation ne change pas de raison ici).
-- 5. Une source de plus, « whatsapp » : « Garder dans Voix du client » depuis la boîte Messages.
--
-- Rejouable : chaque étape vérifie l'état avant d'agir.

-- ── 1. La réponse par raison ─────────────────────────────────────────────────
ALTER TABLE public.feedback_topics
  ADD COLUMN IF NOT EXISTS response     TEXT,
  ADD COLUMN IF NOT EXISTS response_by  UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS response_at  TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE public.feedback_topics
    ADD CONSTRAINT feedback_topics_response_length CHECK (response IS NULL OR char_length(response) BETWEEN 1 AND 500);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.feedback_topics.response IS
  '« Notre réponse » : ce que l''équipe fait quand un client donne cette raison. Écrite par un responsable.';

-- ── 2. Le journal accepte les nouveaux gestes ────────────────────────────────
ALTER TABLE public.customer_feedback_events DROP CONSTRAINT IF EXISTS customer_feedback_events_kind_check;
ALTER TABLE public.customer_feedback_events ADD CONSTRAINT customer_feedback_events_kind_check
  CHECK (kind IN ('created', 'kept', 'ignored', 'status', 'deleted', 'discarded', 'restored', 'topic'));

-- ── 3. La source « whatsapp » ────────────────────────────────────────────────
ALTER TABLE public.customer_feedback DROP CONSTRAINT IF EXISTS customer_feedback_source_check;
ALTER TABLE public.customer_feedback ADD CONSTRAINT customer_feedback_source_check
  CHECK (source IN ('agent', 'rejection', 'delivery', 'courier', 'import', 'whatsapp'));

-- ── 4. Fin de la file « à valider » ──────────────────────────────────────────
-- L'ancienne contrainte d'abord : la mise à jour ci-dessous passe par l'état intermédiaire
-- qu'elle interdisait.
ALTER TABLE public.customer_feedback DROP CONSTRAINT IF EXISTS customer_feedback_complaint_status;

WITH opened AS (
  UPDATE public.customer_feedback f
     SET needs_review = FALSE,
         status = CASE
           WHEN f.category <> 'reclamation' THEN NULL
           WHEN f.status IS NOT NULL THEN f.status
           WHEN f.created_at < now() - interval '14 days' THEN 'resolved'
           ELSE 'open'
         END,
         resolved_at = CASE
           WHEN f.category = 'reclamation' AND f.status IS NULL AND f.created_at < now() - interval '14 days' THEN now()
           ELSE f.resolved_at
         END
   WHERE f.needs_review
  RETURNING f.id, f.market_id, f.category, f.status
)
INSERT INTO public.customer_feedback_events (feedback_id, market_id, kind, data)
SELECT o.id, o.market_id, 'status',
       jsonb_build_object('from', NULL, 'to', o.status,
                          'why', CASE WHEN o.status = 'resolved'
                                      THEN 'migration : remarque de plus de 14 jours, classée'
                                      ELSE 'migration : fin de la file à valider' END)
FROM opened o
WHERE o.category = 'reclamation';

-- Une réclamation a un statut ; rien d'autre n'en a.
ALTER TABLE public.customer_feedback ADD CONSTRAINT customer_feedback_complaint_status
  CHECK ((category = 'reclamation') = (status IS NOT NULL));

DROP INDEX IF EXISTS public.customer_feedback_review_idx;

-- Le livreur : ses remarques arrivent directement dans la feuille, une réclamation ouverte.
CREATE OR REPLACE FUNCTION public.feedback_suggest_from_shipment(p_shipment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_s       RECORD;
  v_o       RECORD;
  v_text    TEXT;
  v_at      TIMESTAMPTZ;
  v_cat     public.feedback_category;
  v_topic   TEXT;
  v_id      UUID;
BEGIN
  SELECT s.id, s.order_id, s.remark_class, s.remark_class_source,
         s.latest_remark, s.latest_remark_at, s.latest_comment, s.latest_comment_at
    INTO v_s
  FROM public.darb_shipments s WHERE s.id = p_shipment_id;
  IF v_s.id IS NULL OR v_s.order_id IS NULL
     OR v_s.remark_class NOT IN ('wrong_item', 'payment_method', 'no_cash', 'refused') THEN
    RETURN FALSE;
  END IF;

  SELECT o.id, o.market_id, o.customer_id, o.product_id, o.status::TEXT AS status
    INTO v_o
  FROM public.orders o WHERE o.id = v_s.order_id;
  IF v_o.id IS NULL OR v_o.product_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_s.remark_class_source = 'latest_comment' THEN
    v_text := btrim(v_s.latest_comment);
    v_at   := v_s.latest_comment_at;
  ELSE
    v_text := btrim(v_s.latest_remark);
    v_at   := v_s.latest_remark_at;
  END IF;
  IF v_text IS NULL OR v_text = '' THEN
    RETURN FALSE;
  END IF;

  CASE v_s.remark_class
    WHEN 'wrong_item'     THEN v_cat := 'reclamation'; v_topic := 'nonconform';
    WHEN 'payment_method' THEN v_cat := 'objection';   v_topic := 'card';
    WHEN 'no_cash'        THEN v_cat := 'objection';   v_topic := 'nocash';
    ELSE                       v_cat := 'objection';   v_topic := CASE WHEN v_text ~ 'تعجبه' THEN 'expect' END;
  END CASE;

  INSERT INTO public.customer_feedback
    (market_id, category, topic_id, moment, body, product_id, order_id, customer_id,
     source, courier_shipment_id, needs_review, status, created_at)
  VALUES
    (v_o.market_id, v_cat,
     (SELECT t.id FROM public.feedback_topics t WHERE t.market_id = v_o.market_id AND t.key = v_topic),
     -- Un colis Darb existe : il est parti, « annulée » veut donc dire « à la porte ».
     public.feedback_moment_of(v_o.status, TRUE),
     left(v_text, 2000), v_o.product_id, v_o.id, v_o.customer_id,
     'courier', v_s.id, FALSE, CASE WHEN v_cat = 'reclamation' THEN 'open' END, coalesce(v_at, now()))
  ON CONFLICT (courier_shipment_id) WHERE source = 'courier' DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.customer_feedback_events (feedback_id, market_id, kind, data)
  VALUES (v_id, v_o.market_id, 'created', jsonb_build_object('source', 'courier', 'remark_class', v_s.remark_class));
  RETURN TRUE;
END $$;

-- L'import « Autre » a tourné une fois (stoppé le 1er oct.) ; il n'a plus de raison d'exister.
DROP FUNCTION IF EXISTS public.feedback_import_autre_notes();

-- La file n'existe plus : ses deux gestes non plus.
DROP FUNCTION IF EXISTS public.keep_customer_feedback(UUID[]);
DROP FUNCTION IF EXISTS public.ignore_customer_feedback(UUID[]);

-- Le cube compte tout ce qui n'est pas écarté.
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
    AND f.created_at >= (p_from::TIMESTAMP AT TIME ZONE p_tz)
    AND f.created_at <  ((p_to + 1)::TIMESTAMP AT TIME ZONE p_tz)
  GROUP BY 1, 2, 3, 4, 5, 6
$$;

-- Le cycle d'une réclamation ne regarde plus needs_review.
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
  IF v_f.category <> 'reclamation' THEN
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

-- ── 5. Écarter / remettre ────────────────────────────────────────────────────
-- Une suppression douce, par un responsable du marché, sur n'importe quel retour vivant.
CREATE OR REPLACE FUNCTION public.discard_customer_feedback(p_ids UUID[])
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

  WITH gone AS (
    UPDATE public.customer_feedback f
       SET deleted_at = now(), deleted_by = v_uid
     WHERE f.id = ANY (coalesce(p_ids, ARRAY[]::UUID[]))
       AND f.deleted_at IS NULL
       AND (v_role = 'super_admin' OR f.market_id = v_umarket)
    RETURNING f.id, f.market_id
  )
  INSERT INTO public.customer_feedback_events (feedback_id, market_id, kind, actor_id)
  SELECT g.id, g.market_id, 'discarded', v_uid FROM gone g;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- « Annuler » : seulement ce qui a été ÉCARTÉ (dernier geste du journal), jamais l'annulation
-- d'un agent sur sa propre saisie.
CREATE OR REPLACE FUNCTION public.restore_customer_feedback(p_ids UUID[])
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

  WITH back AS (
    UPDATE public.customer_feedback f
       SET deleted_at = NULL, deleted_by = NULL
     WHERE f.id = ANY (coalesce(p_ids, ARRAY[]::UUID[]))
       AND f.deleted_at IS NOT NULL
       AND (v_role = 'super_admin' OR f.market_id = v_umarket)
       AND (SELECT e.kind FROM public.customer_feedback_events e
             WHERE e.feedback_id = f.id ORDER BY e.created_at DESC LIMIT 1) = 'discarded'
    RETURNING f.id, f.market_id
  )
  INSERT INTO public.customer_feedback_events (feedback_id, market_id, kind, actor_id)
  SELECT b.id, b.market_id, 'restored', v_uid FROM back b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ── 6. Changer la raison ─────────────────────────────────────────────────────
-- p_topic_id NULL = « Sans raison » (le retour passe « à vérifier »). Une raison d'objection
-- ou de suggestion seulement ; la catégorie suit la raison. Les réclamations sont laissées.
CREATE OR REPLACE FUNCTION public.set_customer_feedback_topic(p_ids UUID[], p_topic_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID; v_role TEXT; v_umarket UUID; v_n INTEGER;
  v_t public.feedback_topics;
BEGIN
  SELECT u.id, u.role, u.market_id INTO v_uid, v_role, v_umarket
  FROM public.users u WHERE u.id = auth.uid() AND u.is_active AND u.deleted_at IS NULL;
  IF v_uid IS NULL OR v_role NOT IN ('market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_topic_id IS NOT NULL THEN
    SELECT * INTO v_t FROM public.feedback_topics t WHERE t.id = p_topic_id;
    IF v_t.id IS NULL THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_t.category = 'reclamation' THEN
      RAISE EXCEPTION 'invalid_topic' USING ERRCODE = '22023';
    END IF;
    IF v_role <> 'super_admin' AND v_t.market_id <> v_umarket THEN
      RAISE EXCEPTION 'other_market' USING ERRCODE = '42501';
    END IF;
  END IF;

  WITH moved AS (
    UPDATE public.customer_feedback f
       SET topic_id = p_topic_id,
           category = coalesce(v_t.category, f.category)
      FROM (SELECT x.id, x.topic_id AS old_topic, x.category AS old_category
              FROM public.customer_feedback x
             WHERE x.id = ANY (coalesce(p_ids, ARRAY[]::UUID[]))) o
     WHERE f.id = o.id
       AND f.deleted_at IS NULL
       AND f.category <> 'reclamation'
       AND (v_role = 'super_admin' OR f.market_id = v_umarket)
       AND (p_topic_id IS NULL OR f.market_id = v_t.market_id)
       AND f.topic_id IS DISTINCT FROM p_topic_id
    RETURNING f.id, f.market_id, o.old_topic, o.old_category, f.category
  )
  INSERT INTO public.customer_feedback_events (feedback_id, market_id, kind, actor_id, data)
  SELECT m.id, m.market_id, 'topic', v_uid,
         jsonb_build_object('from', m.old_topic, 'to', p_topic_id, 'category_from', m.old_category, 'category_to', m.category)
  FROM moved m;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ── 7. Écrire « Notre réponse » ──────────────────────────────────────────────
-- Un texte vide efface la réponse.
CREATE OR REPLACE FUNCTION public.set_feedback_topic_response(p_topic_id UUID, p_response TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID; v_role TEXT; v_umarket UUID;
  v_market UUID;
  v_text TEXT := nullif(btrim(coalesce(p_response, '')), '');
BEGIN
  SELECT u.id, u.role, u.market_id INTO v_uid, v_role, v_umarket
  FROM public.users u WHERE u.id = auth.uid() AND u.is_active AND u.deleted_at IS NULL;
  IF v_uid IS NULL OR v_role NOT IN ('market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_text IS NOT NULL AND char_length(v_text) > 500 THEN
    RAISE EXCEPTION 'invalid_response' USING ERRCODE = '22023';
  END IF;

  SELECT t.market_id INTO v_market FROM public.feedback_topics t WHERE t.id = p_topic_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_role <> 'super_admin' AND v_market <> v_umarket THEN
    RAISE EXCEPTION 'other_market' USING ERRCODE = '42501';
  END IF;

  UPDATE public.feedback_topics
     SET response    = v_text,
         response_by = CASE WHEN v_text IS NULL THEN NULL ELSE v_uid END,
         response_at = CASE WHEN v_text IS NULL THEN NULL ELSE now() END,
         updated_at  = now()
   WHERE id = p_topic_id;
END $$;

-- ── 8. Créer : la source « whatsapp » (un responsable, depuis Messages) ──────
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
  IF coalesce(p_source, 'agent') NOT IN ('agent', 'rejection', 'delivery', 'whatsapp') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = '22023';
  END IF;
  IF p_source = 'whatsapp' AND v_role NOT IN ('market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
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

-- ── Privilèges ───────────────────────────────────────────────────────────────
-- EXECUTE va à PUBLIC par défaut : on retire à PUBLIC ET à anon avant d'accorder.
REVOKE ALL ON FUNCTION public.feedback_suggest_from_shipment(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discard_customer_feedback(UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_customer_feedback(UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_customer_feedback_topic(UUID[], UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_feedback_topic_response(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_customer_feedback(TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_feedback_complaint_status(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.feedback_cube(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.discard_customer_feedback(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_customer_feedback(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_customer_feedback_topic(UUID[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_feedback_topic_response(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_feedback(TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_feedback_complaint_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.feedback_cube(UUID, DATE, DATE, TEXT) TO authenticated;
