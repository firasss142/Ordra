-- Le site d'une commande suit son compte transporteur, automatiquement.
--
-- Plutôt que d'ajouter la ligne à dispatch_order, à la dispatch groupée, au
-- script de reprise et à tout futur appelant, la règle vit là où elle ne peut
-- pas être oubliée : sur la colonne qui la décide. Une commande sans
-- transporteur n'a pas de site (delete_carrier_barcode la ramène là), et une
-- commande expédiée depuis l'entrepôt du transporteur n'en a jamais eu.
--
-- Et un agent ne scanne pas le bâtiment d'en face : c'est la faute que le modèle
-- à deux comptes rend coûteuse, un colis monté sur le compte Benghazi et remis à
-- Darb Tripoli n'existe pas dans leur système. Le garde ne s'arme que lorsque
-- l'agent ET la commande ont un site, donc il reste inerte tant qu'un manager
-- n'a pas affecté les agents.
-- Corps exact appliqué en production ; régénéré depuis pg_get_functiondef.

CREATE OR REPLACE FUNCTION public.orders_set_warehouse_from_carrier()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_from_carrier_wh BOOLEAN;
BEGIN
  v_from_carrier_wh := COALESCE(NEW.carrier_extra->>'fulfil_from_carrier_warehouse','false') = 'true';
  IF NEW.carrier_id IS NULL OR v_from_carrier_wh THEN
    NEW.warehouse_id := NULL;
  ELSE
    SELECT c.warehouse_id INTO NEW.warehouse_id FROM public.carriers c WHERE c.id = NEW.carrier_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_orders_set_warehouse ON public.orders;
CREATE TRIGGER trg_orders_set_warehouse
  BEFORE INSERT OR UPDATE OF carrier_id, carrier_extra ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_set_warehouse_from_carrier();

CREATE OR REPLACE FUNCTION public.precheck_scan_out(
  p_order_id uuid, p_actor_id uuid, p_sticker_ref text DEFAULT NULL::text
) RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER AS $function$
DECLARE
  v_status TEXT; v_market_id UUID; v_branch_group TEXT; v_carrier_slug TEXT;
  v_order_site UUID; v_actor_role TEXT; v_actor_market UUID; v_actor_site UUID;
  v_sticker TEXT; v_needed_color TEXT;
BEGIN
  SELECT role, market_id, warehouse_id INTO v_actor_role, v_actor_market, v_actor_site
  FROM public.users WHERE id = p_actor_id;
  IF v_actor_role IS NULL THEN
    RETURN json_build_object('ok', false, 'code', 'ACTOR_NOT_FOUND');
  END IF;

  SELECT o.status::TEXT, o.market_id, o.carrier_extra->>'darb_branch_group',
         o.carrier_status_slug, o.warehouse_id
  INTO v_status, v_market_id, v_branch_group, v_carrier_slug, v_order_site
  FROM public.orders o WHERE o.id = p_order_id;

  IF v_status IS NULL THEN
    RETURN json_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  END IF;
  IF v_actor_role <> 'super_admin' AND v_actor_market IS DISTINCT FROM v_market_id THEN
    RETURN json_build_object('ok', false, 'code', 'MARKET_MISMATCH');
  END IF;
  IF v_status <> 'uploaded' THEN
    RETURN json_build_object('ok', false, 'code', 'INVALID_STATUS', 'status', v_status);
  END IF;
  IF v_carrier_slug IN ('released','completed','returning','returned') THEN
    RETURN json_build_object('ok', false, 'code', 'GONE_AT_CARRIER', 'carrier_status', v_carrier_slug);
  END IF;
  IF v_actor_role = 'warehouse_agent'
     AND v_actor_site IS NOT NULL AND v_order_site IS NOT NULL
     AND v_actor_site IS DISTINCT FROM v_order_site THEN
    RETURN json_build_object('ok', false, 'code', 'WRONG_SITE',
      'warehouse_id', v_order_site,
      'warehouse_name', (SELECT name_fr FROM public.warehouses WHERE id = v_order_site));
  END IF;

  v_sticker := NULLIF(btrim(COALESCE(p_sticker_ref, '')), '');
  IF v_sticker IS NOT NULL AND v_sticker !~ '^[0-9]+$' THEN
    RETURN json_build_object('ok', false, 'code', 'STICKER_NOT_NUMERIC', 'sticker', v_sticker);
  END IF;

  v_needed_color := public.darb_color_for_branch_group(v_branch_group);

  IF v_sticker IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.orders
    WHERE market_id = v_market_id AND carrier_sticker_ref = v_sticker AND id <> p_order_id
  ) THEN
    RETURN json_build_object('ok', false, 'code', 'STICKER_ALREADY_USED', 'sticker', v_sticker);
  END IF;

  RETURN json_build_object('ok', true, 'sticker', v_sticker,
    'required_color', v_needed_color, 'branch_group', v_branch_group,
    'warehouse_id', v_order_site);
END; $function$;

GRANT EXECUTE ON FUNCTION public.precheck_scan_out(UUID, UUID, TEXT) TO PUBLIC;
