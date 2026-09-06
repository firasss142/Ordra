-- One definition of "low stock".
--
-- The dashboard KPI and the low-stock banner come from this RPC, which used
-- `current_stock < low_stock_threshold`; the Stock screen (desk table, phone
-- cards, "sous le seuil" KPI) tests `current_stock <= low_stock_threshold`.
-- A product sitting exactly on its threshold was low on one screen and fine
-- on the other. "Seuil d'alerte" reads as "alert once we are down to this
-- many", so the inclusive test wins and the RPC follows the screen.

CREATE OR REPLACE FUNCTION public.get_low_stock_products(p_market_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid, name text, current_stock integer, low_stock_threshold integer, market_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id, name, current_stock, low_stock_threshold, market_id
  FROM products
  WHERE is_active = true
    AND deleted_at IS NULL
    AND low_stock_threshold > 0
    AND current_stock <= low_stock_threshold
    AND (p_market_id IS NULL OR market_id = p_market_id)
  ORDER BY current_stock ASC
  LIMIT p_limit;
$function$;
