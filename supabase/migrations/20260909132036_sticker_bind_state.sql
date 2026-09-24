-- Ce que Darb tient vraiment comme référence, colis par colis.
--
-- POURQUOI CETTE COLONNE EXISTE
--   Un PATCH accepté n'est pas une liaison. Deux comportements du transporteur,
--   tous deux observés en production le 2026-09-08 sur 19 colis :
--
--     · 7 colis (Sebha, Koufra) ont été RE-STICKERISÉS par la réception Darb à
--       la réservation : notre 11870086 est devenu leur 1279049. Notre
--       carrier_sticker_ref ment, et c'est le champ sur lequel find_return_by_code
--       retrouve un retour physique.
--     · 1 colis (sticker 1633019) a reçu un « status: true » et Darb tient
--       toujours SH2171145, sans même un événement `referenced`. Le colis est
--       parti avec un numéro que le transporteur ne connaît pas.
--
-- POURQUOI PERSISTÉE PLUTÔT QUE CALCULÉE
--   La liste des colis scannés doit trier et filtrer là-dessus, et darb_shipments
--   n'a de ligne que pour les envois appariés par la sync — or le cas le plus
--   grave (« jamais enregistré ») est précisément celui dont le miroir est
--   incertain. Un état stocké au moment où on l'observe est un fait daté ;
--   une jointure serait une déduction refaite à chaque affichage.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS sticker_bind_state TEXT,
  ADD COLUMN IF NOT EXISTS sticker_bind_checked_at TIMESTAMPTZ,
  -- La référence que Darb tient quand elle diffère de la nôtre. Sans elle
  -- l'écran ne peut dire que « ça a échoué », ce qui n'est pas actionnable.
  ADD COLUMN IF NOT EXISTS carrier_reference_actual TEXT;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_sticker_bind_state_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_sticker_bind_state_check CHECK (
    sticker_bind_state IS NULL
    OR sticker_bind_state IN ('confirmed', 'restickered', 'not_registered', 'unknown')
  );

COMMENT ON COLUMN public.orders.sticker_bind_state IS
  'confirmed = Darb tient notre sticker · restickered = Darb l''a remplacé par le '
  'sien (carrier_reference_actual) · not_registered = Darb tient encore son SH… '
  'donc la liaison n''a jamais pris · unknown = jamais vérifié.';

CREATE INDEX IF NOT EXISTS orders_sticker_bind_state_idx
  ON public.orders (market_id, sticker_bind_state)
  WHERE sticker_bind_state IS NOT NULL AND sticker_bind_state <> 'confirmed';

-- ── L'écriture ──────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER pour la même raison que cache_darb_shipment_ref : la policy
-- UPDATE de `orders` n'a aucun bras warehouse_agent, donc un update de session
-- touche zéro ligne sans lever la moindre erreur (20260921000004:20-28).

CREATE OR REPLACE FUNCTION public.record_sticker_bind_state(
  p_order_id        UUID,
  p_actor_id        UUID,
  p_state           TEXT,
  p_darb_reference  TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_market_id     UUID;
  v_actor_role    TEXT;
  v_actor_market  UUID;
BEGIN
  IF p_state NOT IN ('confirmed', 'restickered', 'not_registered', 'unknown') THEN
    RAISE EXCEPTION 'État de liaison inconnu: %', p_state
      USING DETAIL = '{"code":"BAD_BIND_STATE"}';
  END IF;

  SELECT market_id INTO v_market_id FROM public.orders WHERE id = p_order_id;
  IF v_market_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id
      USING DETAIL = '{"code":"ORDER_NOT_FOUND"}';
  END IF;

  -- La sync passe p_actor_id NULL : c'est le système qui observe, pas un agent.
  IF p_actor_id IS NOT NULL THEN
    SELECT role, market_id INTO v_actor_role, v_actor_market
    FROM public.users WHERE id = p_actor_id;
    IF v_actor_role IS NULL
       OR (v_actor_role <> 'super_admin' AND v_actor_market IS DISTINCT FROM v_market_id) THEN
      RAISE EXCEPTION 'Order belongs to a different market'
        USING DETAIL = '{"code":"MARKET_MISMATCH"}';
    END IF;
  END IF;

  UPDATE public.orders
  SET sticker_bind_state = p_state,
      sticker_bind_checked_at = now(),
      -- Gardée seulement quand elle diffère : sur un colis confirmé, une copie
      -- du sticker n'apprend rien et se périmerait toute seule.
      carrier_reference_actual =
        CASE WHEN p_state = 'confirmed' THEN NULL ELSE NULLIF(BTRIM(COALESCE(p_darb_reference, '')), '') END
  WHERE id = p_order_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'sticker_bind_state', p_state,
    'carrier_reference_actual', p_darb_reference
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_sticker_bind_state(UUID, UUID, TEXT, TEXT) TO PUBLIC;
