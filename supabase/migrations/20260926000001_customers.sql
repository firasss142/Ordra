-- ============================================================
-- 20260926000001_customers.sql
-- `customers` — one row per normalised phone per market.
--
-- WHY: three surfaces each recompute "who is this buyer" from scratch by
-- scanning `orders` on a phone string: get_customer_history_batch
-- (20260611000001), the duplicate-sibling probes (20260720000004) and the
-- repeat-buyer badge's TS classifier (src/lib/customer-history/classify.ts).
-- None of them agree: the TS rule counts rejections only, the RPC counts
-- rejections and returns, and neither is readable from SQL that needs to rank a
-- delivery worklist. The delivery page needs "has this person failed us before"
-- as a column it can join and index, not as a subquery per row, and the leads
-- rebuild needs the same entity to answer "do we already know this number".
--
-- WHAT: a market-scoped customer row keyed by normalize_phone(customer_phone),
-- linked from orders.customer_id by trigger, with counts refreshed by trigger
-- and a risk class computed from them.
--
-- RISK CLASS — this is a behaviour change, announced deliberately:
--   risk   = 2+ orders AND (returned + rejected) / (delivered+returned+rejected) >= 0.5
--   repeat = 1+ orders
--   none   = no history
-- The TS rule in classify.ts counted rejections ONLY; adding returns means some
-- badges that read "client fidèle" will flip to "risque". That is the point: a
-- buyer who accepted nothing and returned twice is not a loyal customer. The TS
-- rule is aligned in the same phase so the badge and this column agree.
--
-- A first-time customer is deliberately NOT a risk input (plan decision 8):
-- treating every new buyer as suspicious would flag most of the list and teach
-- agents to ignore the mark.
--
-- WRITES: only through the triggers below and refresh_customer_stats(). No
-- client INSERT/UPDATE/DELETE policy exists, so an agent cannot edit a counter
-- that decides whether their own parcel looks risky.
-- ============================================================

-- ── 1. The table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.customers (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id                 uuid NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  phone_normalized          text NOT NULL,
  phones                    text[] NOT NULL DEFAULT '{}',
  name                      text,
  last_address              text,
  last_city                 text,
  last_city_id              uuid,
  last_darb_destination_id  text,
  orders_count              integer NOT NULL DEFAULT 0,
  delivered_count           integer NOT NULL DEFAULT 0,
  returned_count            integer NOT NULL DEFAULT 0,
  rejected_count            integer NOT NULL DEFAULT 0,
  cancelled_count           integer NOT NULL DEFAULT 0,
  risk_class                text NOT NULL DEFAULT 'none'
                              CHECK (risk_class IN ('none', 'repeat', 'risk')),
  first_order_at            timestamptz,
  last_order_at             timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_market_phone_key UNIQUE (market_id, phone_normalized)
);

COMMENT ON TABLE public.customers IS
  'One row per normalised phone per market. Written only by trigger / refresh_customer_stats.';
COMMENT ON COLUMN public.customers.risk_class IS
  'none | repeat | risk. risk = 2+ orders and >=50% of decided orders failed (returned or rejected).';

CREATE INDEX IF NOT EXISTS idx_customers_market_risk
  ON public.customers (market_id, risk_class);

-- ── 2. orders.customer_id + the functional index the trigger looks through ──

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_customer_id
  ON public.orders (customer_id) WHERE customer_id IS NOT NULL;

-- The recount in refresh_customer_stats reads by customer_id; the upsert reads
-- by (market, normalised phone). normalize_phone is IMMUTABLE (20260611000001),
-- so it is indexable.
CREATE INDEX IF NOT EXISTS idx_orders_market_phone_norm
  ON public.orders (market_id, public.normalize_phone(customer_phone));

-- ── 3. Risk classification ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.customer_risk_class(
  p_orders_count integer,
  p_delivered    integer,
  p_returned     integer,
  p_rejected     integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN COALESCE(p_orders_count, 0) >= 2
     AND (COALESCE(p_delivered, 0) + COALESCE(p_returned, 0) + COALESCE(p_rejected, 0)) > 0
     AND (COALESCE(p_returned, 0) + COALESCE(p_rejected, 0))::numeric
         / (COALESCE(p_delivered, 0) + COALESCE(p_returned, 0) + COALESCE(p_rejected, 0))::numeric
         >= 0.5
      THEN 'risk'
    WHEN COALESCE(p_orders_count, 0) >= 1 THEN 'repeat'
    ELSE 'none'
  END;
$$;

COMMENT ON FUNCTION public.customer_risk_class(integer, integer, integer, integer) IS
  'Counts returns AND rejections as failures. Mirrored in src/lib/customer-history/classify.ts.';

-- ── 4. Recount one customer from orders ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_customer_stats(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  s RECORD;
BEGIN
  IF p_customer_id IS NULL THEN RETURN; END IF;

  SELECT
    count(*)                                                       AS orders_count,
    count(*) FILTER (WHERE o.status = 'delivered')                 AS delivered_count,
    count(*) FILTER (WHERE o.status = 'returned')                  AS returned_count,
    count(*) FILTER (WHERE o.status = 'rejected')                  AS rejected_count,
    count(*) FILTER (WHERE o.status IN ('cancelled', 'deleted'))   AS cancelled_count,
    min(o.created_at)                                              AS first_order_at,
    max(o.created_at)                                              AS last_order_at
  INTO s
  FROM public.orders o
  WHERE o.customer_id = p_customer_id
    AND o.archived_at IS NULL;

  UPDATE public.customers c
  SET orders_count    = COALESCE(s.orders_count, 0),
      delivered_count = COALESCE(s.delivered_count, 0),
      returned_count  = COALESCE(s.returned_count, 0),
      rejected_count  = COALESCE(s.rejected_count, 0),
      cancelled_count = COALESCE(s.cancelled_count, 0),
      first_order_at  = s.first_order_at,
      last_order_at   = s.last_order_at,
      risk_class      = public.customer_risk_class(
                          COALESCE(s.orders_count, 0)::integer,
                          COALESCE(s.delivered_count, 0)::integer,
                          COALESCE(s.returned_count, 0)::integer,
                          COALESCE(s.rejected_count, 0)::integer),
      updated_at      = now()
  WHERE c.id = p_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_customer_stats(uuid) FROM PUBLIC;

-- ── 5. Link an order to its customer, creating the customer if needed ───────
--
-- BEFORE INSERT/UPDATE on the phone columns, so it sets NEW.customer_id in
-- place. A second UPDATE on orders would re-fire the lock guard
-- (20260925000003) and the broadcast trigger (20260924000002); this does not.

CREATE OR REPLACE FUNCTION public.orders_link_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_norm  text;
  v_id    uuid;
BEGIN
  IF NEW.market_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_norm := public.normalize_phone(NEW.customer_phone);
  IF v_norm IS NULL OR length(v_norm) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.customers (market_id, phone_normalized, phones, name,
                                last_address, last_city, last_city_id)
  VALUES (
    NEW.market_id,
    v_norm,
    ARRAY(SELECT DISTINCT p FROM unnest(ARRAY[NEW.customer_phone, NEW.customer_phone_2]) p
          WHERE p IS NOT NULL AND length(btrim(p)) > 0),
    NEW.customer_name,
    NEW.customer_address,
    NEW.customer_city,
    NEW.city_id
  )
  ON CONFLICT (market_id, phone_normalized) DO UPDATE
    SET name         = COALESCE(EXCLUDED.name, public.customers.name),
        last_address = COALESCE(EXCLUDED.last_address, public.customers.last_address),
        last_city    = COALESCE(EXCLUDED.last_city, public.customers.last_city),
        last_city_id = COALESCE(EXCLUDED.last_city_id, public.customers.last_city_id),
        phones       = ARRAY(SELECT DISTINCT unnest(public.customers.phones || EXCLUDED.phones)),
        updated_at   = now()
  RETURNING id INTO v_id;

  NEW.customer_id := v_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.orders_link_customer() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_orders_link_customer ON public.orders;
CREATE TRIGGER trg_orders_link_customer
  BEFORE INSERT OR UPDATE OF customer_phone, customer_phone_2 ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_link_customer();

-- ── 6. Keep the counters honest ─────────────────────────────────────────────
--
-- Column list is deliberate: `status` and the address fields only. The Darb
-- sweep rewrites carrier_status_slug, carrier_status_synced_at, tracking_number
-- and updated_at on ~117k rows a day (see 20260924000002); none of them are
-- listed here, so this trigger costs that sweep nothing.

CREATE OR REPLACE FUNCTION public.orders_refresh_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    PERFORM public.refresh_customer_stats(NEW.customer_id);
  END IF;
  -- A phone correction moves the order to another customer; the one it left
  -- must lose the order from its counts.
  IF TG_OP = 'UPDATE'
     AND OLD.customer_id IS NOT NULL
     AND OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
    PERFORM public.refresh_customer_stats(OLD.customer_id);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.orders_refresh_customer() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_orders_refresh_customer ON public.orders;
CREATE TRIGGER trg_orders_refresh_customer
  AFTER INSERT OR UPDATE OF status, customer_id, customer_address, customer_city, archived_at
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_refresh_customer();

-- ── 7. RLS ──────────────────────────────────────────────────────────────────
--
-- Read: super_admin everywhere, everyone else their own market. No write
-- policy at all — writes go through the SECURITY DEFINER functions above.

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_select ON public.customers;
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'super_admin'
    OR market_id = public.get_user_market_id()
  );

-- ── 8. Backfill, in one transaction ─────────────────────────────────────────

INSERT INTO public.customers (market_id, phone_normalized, phones, name,
                              last_address, last_city, last_city_id)
SELECT DISTINCT ON (o.market_id, public.normalize_phone(o.customer_phone))
       o.market_id,
       public.normalize_phone(o.customer_phone),
       ARRAY(SELECT DISTINCT p
             FROM unnest(ARRAY[o.customer_phone, o.customer_phone_2]) p
             WHERE p IS NOT NULL AND length(btrim(p)) > 0),
       o.customer_name,
       o.customer_address,
       o.customer_city,
       o.city_id
FROM public.orders o
WHERE o.market_id IS NOT NULL
  AND length(public.normalize_phone(o.customer_phone)) > 0
ORDER BY o.market_id,
         public.normalize_phone(o.customer_phone),
         o.created_at DESC
ON CONFLICT (market_id, phone_normalized) DO NOTHING;

UPDATE public.orders o
SET customer_id = c.id
FROM public.customers c
WHERE c.market_id = o.market_id
  AND c.phone_normalized = public.normalize_phone(o.customer_phone)
  AND o.customer_id IS DISTINCT FROM c.id;

-- Counts for every customer the backfill just created.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.customers LOOP
    PERFORM public.refresh_customer_stats(r.id);
  END LOOP;
END;
$$;
