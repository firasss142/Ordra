-- Voix du client — les remarques du livreur Darb deviennent des suggestions à valider.
--
-- La synchronisation Darb classe déjà la dernière remarque de chaque colis (remark_class,
-- 20260913153539_darb_remark_class.sql). Quatre classes portent une opinion du client ; les
-- autres sont de la logistique (« لا يرد », « غدا يستلم ») et ne deviennent jamais rien.
--
--   wrong_item      → Réclamation · Non conforme      (« مش نفس لي في نت »)
--   payment_method  → Objection · Carte ou virement   (« البطاقة مش مفعلة »)
--   no_cash         → Objection · Pas de cash         (« معنديش فلوس »)
--   refused         → Objection, sujet « Croyait autre chose » si la remarque dit « لم تعجبه »
--
-- Chaque suggestion arrive needs_review = TRUE : c'est le RESPONSABLE qui la garde ou l'ignore
-- (décision du propriétaire, 2026-10-01). Une seule par colis (index unique), datée de la
-- remarque, sans auteur. Les colis dont la commande n'a pas de produit sont laissés de côté.
--
-- Le déclencheur ne peut JAMAIS faire échouer la synchronisation Darb : toute erreur devient
-- un WARNING et la mise à jour du colis passe.

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
     source, courier_shipment_id, needs_review, created_at)
  VALUES
    (v_o.market_id, v_cat,
     (SELECT t.id FROM public.feedback_topics t WHERE t.market_id = v_o.market_id AND t.key = v_topic),
     -- Un colis Darb existe : il est parti, « annulée » veut donc dire « à la porte ».
     public.feedback_moment_of(v_o.status, TRUE),
     left(v_text, 2000), v_o.product_id, v_o.id, v_o.customer_id,
     'courier', v_s.id, TRUE, coalesce(v_at, now()))
  ON CONFLICT (courier_shipment_id) WHERE source = 'courier' DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.customer_feedback_events (feedback_id, market_id, kind, data)
  VALUES (v_id, v_o.market_id, 'created', jsonb_build_object('source', 'courier', 'remark_class', v_s.remark_class));
  RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION public.darb_shipments_suggest_feedback()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    PERFORM public.feedback_suggest_from_shipment(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'voix du client : suggestion ignorée pour le colis % (%)', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_darb_shipments_feedback_ins ON public.darb_shipments;
CREATE TRIGGER trg_darb_shipments_feedback_ins
  AFTER INSERT ON public.darb_shipments
  FOR EACH ROW
  WHEN (NEW.remark_class IN ('wrong_item', 'payment_method', 'no_cash', 'refused'))
  EXECUTE FUNCTION public.darb_shipments_suggest_feedback();

DROP TRIGGER IF EXISTS trg_darb_shipments_feedback_upd ON public.darb_shipments;
CREATE TRIGGER trg_darb_shipments_feedback_upd
  AFTER UPDATE OF remark_class ON public.darb_shipments
  FOR EACH ROW
  WHEN (NEW.remark_class IN ('wrong_item', 'payment_method', 'no_cash', 'refused')
        AND OLD.remark_class IS DISTINCT FROM NEW.remark_class)
  EXECUTE FUNCTION public.darb_shipments_suggest_feedback();

REVOKE ALL ON FUNCTION public.feedback_suggest_from_shipment(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.darb_shipments_suggest_feedback() FROM PUBLIC, anon, authenticated;

-- Rattrapage : les remarques déjà classées. Zéro ligne sur une base vide.
DO $$
DECLARE
  v_n INTEGER;
BEGIN
  SELECT count(*) FILTER (WHERE public.feedback_suggest_from_shipment(s.id)) INTO v_n
  FROM public.darb_shipments s
  WHERE s.remark_class IN ('wrong_item', 'payment_method', 'no_cash', 'refused');
  RAISE NOTICE 'voix du client : % suggestion(s) du livreur', v_n;
END $$;
