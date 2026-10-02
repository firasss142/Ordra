-- Voix du client — l'import des anciennes notes « Autre » qui portent un vrai retour.
--
-- 694 refus libyens « Autre » depuis le 2026-05-20, mais la plupart n'en sont pas : 47 % sont
-- des motifs connus mal rangés (« لم أطلب », faux numéro, doublon), 18 % un « الغي الطلب » sans
-- raison. Les règles de mots-clés ci-dessous sont celles du plan (relevé du 2026-09-30) : elles
-- gardent ~21 % — 148 notes au 30 septembre, 149 au 1er octobre — et laissent le reste.
--
--   paiement (carte, virement, Mobi Cash)  → Objection · Carte ou virement
--   prix                                   → Objection · Trop cher
--   pas d'argent maintenant (salaire…)     → Objection · Pas de cash
--   produit (rewāya, taille, appareil…)    → Suggestion · Autre version   si une version est nommée
--                                            Objection · Croyait autre chose sinon
--   acheté ailleurs                        → Objection · Acheté ailleurs
--   livraison (délai, ville)               → Objection · Livraison, ou Trop cher si « يشمل التوصيل »
--
-- Chaque ligne :
--   * arrive needs_review = TRUE, dans « à valider », pour qu'un responsable la garde d'un geste ;
--   * est datée par la ligne order_history du refus (status_to = 'rejected'), JAMAIS par
--     orders.updated_at — tous les refus libyens ont un updated_at ≥ 2026-09-19 (mise à jour en
--     masse) et un filtre dessus rend des totaux de toute la vie ;
--   * a pour auteur l'agent qui a refusé, et pour moment l'appel de confirmation.
--
-- Idempotent (index unique sur order_id pour source = 'import', y compris les lignes ignorées),
-- et zéro ligne sur une base vide : reconstruire depuis les migrations marche toujours.

CREATE OR REPLACE FUNCTION public.feedback_import_autre_notes()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  WITH notes AS (
    SELECT o.id AS order_id, o.market_id, o.product_id, o.customer_id,
           btrim(o.rejection_note) AS t, h.created_at AS rejected_at, h.actor_id
    FROM public.orders o
    JOIN LATERAL (
      SELECT oh.created_at, oh.actor_id
      FROM public.order_history oh
      WHERE oh.order_id = o.id AND oh.status_to = 'rejected'
      ORDER BY oh.created_at DESC
      LIMIT 1
    ) h ON TRUE
    WHERE o.status = 'rejected'
      AND o.rejection_reason = 'autre'
      AND coalesce(btrim(o.rejection_note), '') <> ''
  ), classed AS (
    SELECT n.*, CASE
      WHEN n.t ~ '(بطاقة|بالبطالة|تحويل|حوالة|موبي|بالخدمات|بطريقة اخرى|بطريقه اخرى|الدفع بالكاش)' THEN 'pay'
      WHEN n.t ~ '(غالي|غالية|تخفيض|بسعر اقل|سعرها 25|بعد سماع السعر|سمعت السعر)' THEN 'price'
      WHEN n.t ~ '(المبلغ|المال|فلوس|الراتب|رواتب|الكاش|كاش|ثمنها|القيمة|قادر على|حقه|فلوسي|السعر حاليا)' THEN 'nocash'
      WHEN n.t ~ '(حفص|قالون|رواية|مصحف ?العادي|مصحف عادي|متوسط|حجم|قفازات|جهاز|قلم|هواء|الكتروني|إلكتروني|دورة|تفسيد|معجبتنيش)' THEN 'product'
      WHEN n.t ~ '(مكان آخر|مكان اخر|مكان ثاني|مكان تاني|متجر اخر|متجر آخر|متجر تاني|محل|شخص تاني|المكان الثاني|وحدة اخرى|وحده فال|شروا غيرها|شريت|شرينا|شرت|اشترت|اشترى|خديت|اخذت من)' THEN 'elsewhere'
      WHEN n.t ~ '(تاخرتو|توصيل|التوصيل|مدة طويلة|الاستلام|مصر|خارج مدينتي|برا المدينة|منطقة اخرى|المجينة|المدينة)' THEN 'delivery'
    END AS cls
    FROM notes n
  ), mapped AS (
    SELECT c.*,
      CASE WHEN c.cls = 'product' AND c.t ~ '(حفص|قالون|رواية|مصحف ?العادي|مصحف عادي|متوسط|حجم|جهاز|قلم)'
           THEN 'suggestion' ELSE 'objection' END AS category,
      CASE c.cls
        WHEN 'pay'       THEN 'card'
        WHEN 'price'     THEN 'expensive'
        WHEN 'nocash'    THEN 'nocash'
        WHEN 'product'   THEN CASE WHEN c.t ~ '(حفص|قالون|رواية|مصحف ?العادي|مصحف عادي|متوسط|حجم|جهاز|قلم)'
                                   THEN 'version' ELSE 'expect' END
        WHEN 'elsewhere' THEN 'elsewhere'
        WHEN 'delivery'  THEN CASE WHEN c.t ~ 'يشمل التوصيل' THEN 'expensive' ELSE 'delivery' END
      END AS topic_key
    FROM classed c
    WHERE c.cls IS NOT NULL
  ), ins AS (
    INSERT INTO public.customer_feedback
      (market_id, category, topic_id, moment, body, product_id, order_id, customer_id,
       source, needs_review, created_by, created_at)
    SELECT m.market_id, m.category::public.feedback_category, t.id, 'call', left(m.t, 2000),
           m.product_id, m.order_id, m.customer_id, 'import', TRUE,
           (SELECT u.id FROM public.users u WHERE u.id = m.actor_id), m.rejected_at
    FROM mapped m
    LEFT JOIN public.feedback_topics t ON t.market_id = m.market_id AND t.key = m.topic_key
    ON CONFLICT (order_id) WHERE source = 'import' DO NOTHING
    RETURNING id, market_id
  )
  INSERT INTO public.customer_feedback_events (feedback_id, market_id, kind, data)
  SELECT i.id, i.market_id, 'created', '{"source":"import"}'::JSONB FROM ins i;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.feedback_import_autre_notes() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_n INTEGER := public.feedback_import_autre_notes();
BEGIN
  RAISE NOTICE 'voix du client : % note(s) « Autre » importée(s), à valider', v_n;
END $$;
