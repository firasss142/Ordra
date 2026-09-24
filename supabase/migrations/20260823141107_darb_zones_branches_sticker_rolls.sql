-- Entrepôt — the sticker roll a parcel needs, and the guard that enforces it.
--
-- WHY
--   A Darb parcel is routed by a pre-printed sticker peeled off a COLOURED
--   roll, and the colour is chosen by destination. Darb accepts any number
--   without checking it belongs to us — a probe bound a number 2.4M outside our
--   stock with no error — so a sticker off the wrong roll binds silently and
--   the parcel goes on the wrong truck. The OMS has to be the guard.
--
-- WHERE THE COLOUR COMES FROM
--   Darb's own directory: GET /api/local/branches/public returns a `color` hex
--   on every branch record (undocumented, like `toZoneCode`; see
--   scripts/probe-darb-branches.ts). Nine colours, one per branch group, and
--   both accounts publish the same directory. darb_branches mirrors it;
--   nothing here is hand-authored except the human NAME of each colour.
--
-- NO ARABIC IN SQL
--   Matching a free-text customer_city onto Darb's names needs hamza/alef
--   folding, which lives in src/lib/carriers/darb-destination.ts and is tested
--   there. The scan-out route resolves the branch group in TypeScript and
--   persists it to orders.carrier_extra->>'darb_branch_group'; every check
--   below is then a plain equality join. One implementation, not two.
--
-- INERT ON APPLY
--   The roll guard fires only when the carrier has at least one OPEN roll.
--   There are none yet, so applying this changes nothing at the bench until
--   somebody registers the first roll.

-- ── 1. The nine colours ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.darb_zones (
  color_hex   TEXT PRIMARY KEY CHECK (color_hex ~ '^#[0-9a-f]{6}$'),
  colour_fr   TEXT NOT NULL,
  colour_ar   TEXT NOT NULL,
  name_fr     TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);

COMMENT ON TABLE public.darb_zones IS
  'The nine Darb sticker-roll colours. Darb''s branch directory is the authority '
  'on which branch is which colour; this table only names them. Kept in step with '
  'src/lib/carriers/darb-zones.ts by darb-zones.test.ts.';

INSERT INTO public.darb_zones (color_hex, colour_fr, colour_ar, name_fr, name_ar, sort_order) VALUES
  ('#d80a0a', 'Rouge',       'أحمر',       'Tripoli et banlieue', 'طرابلس وضواحيها', 1),
  ('#fc6401', 'Orange',      'برتقالي',    'Ouest de Tripoli',    'غرب طرابلس',      2),
  ('#f9fc01', 'Jaune',       'أصفر',       'Est de Tripoli',      'شرق طرابلس',      3),
  ('#5a3001', 'Brun',        'بني',        'Sud de Tripoli',      'جنوب طرابلس',     4),
  ('#091d96', 'Bleu marine', 'أزرق داكن',  'Djebel occidental',   'الجبل الغربي',    5),
  ('#ed00ff', 'Magenta',     'أرجواني',    'Région centrale',     'المنطقة الوسطى',  6),
  ('#339307', 'Vert',        'أخضر',       'Région orientale',    'المنطقة الشرقية', 7),
  ('#0cbceb', 'Cyan',        'سماوي',      'Région méridionale',  'المنطقة الجنوبية',8),
  ('#8fff00', 'Vert lime',   'أخضر فاتح',  'Sud-Est',             'الجنوب الشرقي',   9)
ON CONFLICT (color_hex) DO UPDATE SET
  colour_fr = EXCLUDED.colour_fr, colour_ar = EXCLUDED.colour_ar,
  name_fr   = EXCLUDED.name_fr,   name_ar   = EXCLUDED.name_ar,
  sort_order = EXCLUDED.sort_order;

-- ── 2. Darb's branch directory, mirrored ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.darb_branches (
  branch_group TEXT NOT NULL,
  branch_code  TEXT,
  city         TEXT NOT NULL,
  area         TEXT NOT NULL DEFAULT '',
  -- Null on EXP (زناتة) and RGG (الرياضية) only, and every area they serve is
  -- also served by TR, which does publish one. No destination is left colourless.
  color        TEXT REFERENCES public.darb_zones (color_hex),
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_group, city, area)
);

CREATE INDEX IF NOT EXISTS darb_branches_group_idx ON public.darb_branches (branch_group);

COMMENT ON TABLE public.darb_branches IS
  'Mirror of GET /api/local/branches/public. Refreshed by '
  'scripts/probe-darb-branches.ts --sync. Never hand-edited: Darb owns it. '
  'Not keyed on carrier_id — both accounts publish an identical directory.';

-- ── 3. Sticker rolls ────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS public.sticker_rolls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Rolls belong to an ACCOUNT: Tripoli and Benghazi hold their own physical
  -- stock, and their number ranges are independent.
  carrier_id  UUID NOT NULL REFERENCES public.carriers (id) ON DELETE CASCADE,
  color_hex   TEXT NOT NULL REFERENCES public.darb_zones (color_hex),
  -- What is printed on the roll's band, when it carries one.
  band_code   TEXT,
  label       TEXT,
  range_start BIGINT NOT NULL CHECK (range_start > 0),
  range_end   BIGINT NOT NULL CHECK (range_end > 0),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'exhausted', 'void')),
  opened_by   UUID REFERENCES public.users (id) ON DELETE SET NULL,
  opened_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ,
  CONSTRAINT sticker_rolls_range_ordered CHECK (range_end >= range_start),
  -- A roll is a roll, not a licence to accept any number. Live stickers cluster
  -- in blocks of ~100 (889188–889277, 496946–496957); 10k is generous.
  CONSTRAINT sticker_rolls_range_sane CHECK (range_end - range_start < 10000),
  -- Two live rolls must never claim the same number, or a scan is ambiguous.
  CONSTRAINT sticker_rolls_no_overlap EXCLUDE USING gist (
    carrier_id WITH =,
    int8range(range_start, range_end, '[]') WITH &&
  ) WHERE (status <> 'void')
);

CREATE INDEX IF NOT EXISTS sticker_rolls_open_idx
  ON public.sticker_rolls (carrier_id, range_start, range_end)
  WHERE status = 'open';

COMMENT ON TABLE public.sticker_rolls IS
  'A physical roll of Darb pre-printed stickers held by one account. The colour '
  'is Darb''s (darb_zones); we record only which number range came off which roll.';

ALTER TABLE public.sticker_rolls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.darb_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.darb_zones    ENABLE ROW LEVEL SECURITY;

-- Reference data: readable by any authenticated user, written only by the
-- service role (the sync script) or through the SECURITY DEFINER RPCs below.
DROP POLICY IF EXISTS darb_zones_read ON public.darb_zones;
CREATE POLICY darb_zones_read ON public.darb_zones FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS darb_branches_read ON public.darb_branches;
CREATE POLICY darb_branches_read ON public.darb_branches FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS sticker_rolls_read ON public.sticker_rolls;
CREATE POLICY sticker_rolls_read ON public.sticker_rolls FOR SELECT TO authenticated USING (true);

-- ── 4. Which colour does this parcel need, and which roll is this sticker? ───

-- The colour Darb assigns to a branch group. One row per group in practice;
-- MIN() rather than LIMIT 1 so the answer cannot depend on scan order.
CREATE OR REPLACE FUNCTION public.darb_color_for_branch_group(p_branch_group TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT MIN(color) FROM public.darb_branches
  WHERE branch_group = p_branch_group AND color IS NOT NULL;
$$;

-- plpgsql, not sql: the ::BIGINT cast must run only AFTER the shape is proven.
-- In a single SQL predicate the planner is free to evaluate the cast first and
-- a lettered sticker would raise instead of simply not matching.
CREATE OR REPLACE FUNCTION public.sticker_roll_for(p_carrier_id UUID, p_sticker TEXT)
RETURNS TABLE (id UUID, color_hex TEXT, label TEXT, range_start BIGINT, range_end BIGINT)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_n BIGINT;
BEGIN
  IF p_sticker IS NULL OR p_sticker !~ '^[0-9]{1,18}$' THEN
    RETURN;
  END IF;
  v_n := p_sticker::BIGINT;

  RETURN QUERY
  SELECT r.id, r.color_hex, r.label, r.range_start, r.range_end
  FROM public.sticker_rolls r
  WHERE r.carrier_id = p_carrier_id
    AND r.status = 'open'
    AND v_n BETWEEN r.range_start AND r.range_end
  ORDER BY r.opened_at DESC
  LIMIT 1;
END;
$$;

-- ── 5. Rolls with their consumption, derived ────────────────────────────────
--
-- `consumed` is COUNTED from orders.carrier_sticker_ref, never stored. Storing
-- it would be a fourth thing that mutates on scan, and a fourth thing to drift.

CREATE OR REPLACE FUNCTION public.get_sticker_rolls(p_market_id UUID DEFAULT NULL)
RETURNS TABLE (
  id           UUID,
  carrier_id   UUID,
  carrier_name TEXT,
  color_hex    TEXT,
  colour_fr    TEXT,
  name_fr      TEXT,
  name_ar      TEXT,
  band_code    TEXT,
  label        TEXT,
  range_start  BIGINT,
  range_end    BIGINT,
  status       TEXT,
  capacity     INTEGER,
  consumed     INTEGER,
  remaining    INTEGER,
  next_number  BIGINT,
  opened_at    TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  -- MATERIALIZED so the regex filter is applied before the cast. Inlined, the
  -- planner could cast a lettered sticker_ref and raise instead of skipping it.
  WITH numeric_refs AS MATERIALIZED (
    SELECT o.carrier_id, o.carrier_sticker_ref::BIGINT AS n
    FROM public.orders o
    WHERE o.carrier_sticker_ref ~ '^[0-9]{1,18}$'
  ),
  used AS (
    SELECT r.id AS roll_id, nr.n
    FROM public.sticker_rolls r
    JOIN numeric_refs nr
      ON nr.carrier_id = r.carrier_id
     AND nr.n BETWEEN r.range_start AND r.range_end
  )
  SELECT
    r.id, r.carrier_id, c.name::TEXT, r.color_hex, z.colour_fr, z.name_fr, z.name_ar,
    r.band_code, r.label, r.range_start, r.range_end, r.status,
    (r.range_end - r.range_start + 1)::INT,
    COALESCE(u.n_used, 0)::INT,
    (r.range_end - r.range_start + 1 - COALESCE(u.n_used, 0))::INT,
    -- The lowest number in the range nobody has bound yet.
    (SELECT MIN(g) FROM generate_series(r.range_start, r.range_end) g
      WHERE NOT EXISTS (SELECT 1 FROM used WHERE used.roll_id = r.id AND used.n = g)),
    r.opened_at
  FROM public.sticker_rolls r
  JOIN public.carriers c ON c.id = r.carrier_id
  JOIN public.darb_zones z ON z.color_hex = r.color_hex
  LEFT JOIN (SELECT roll_id, COUNT(*) AS n_used FROM used GROUP BY roll_id) u
    ON u.roll_id = r.id
  WHERE p_market_id IS NULL OR c.market_id = p_market_id
  ORDER BY r.status, z.sort_order, r.range_start;
$$;

GRANT EXECUTE ON FUNCTION public.get_sticker_rolls(UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sticker_roll_for(UUID, TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.darb_color_for_branch_group(TEXT) TO PUBLIC;

-- ── 6. Precheck — refuse a doomed scan BEFORE we write to the carrier ───────
--
-- The scan-out route calls Darb's PATCH /shipments/reference before committing
-- anything locally, because a committed scan whose parcel Darb cannot route is
-- worse than a refused one. That makes it worth knowing the scan is hopeless
-- first: this runs every cheap check, so a wrong-roll sticker never causes a
-- carrier write. scan_order_out re-checks — this is an optimisation, not the
-- authority.

CREATE OR REPLACE FUNCTION public.precheck_scan_out(
  p_order_id    UUID,
  p_actor_id    UUID,
  p_sticker_ref TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_status         TEXT;
  v_market_id      UUID;
  v_carrier_id     UUID;
  v_branch_group   TEXT;
  v_actor_role     TEXT;
  v_actor_market   UUID;
  v_sticker        TEXT;
  v_has_rolls      BOOLEAN;
  v_roll_id        UUID;
  v_roll_color     TEXT;
  v_roll_label     TEXT;
  v_needed_color   TEXT;
BEGIN
  SELECT role, market_id INTO v_actor_role, v_actor_market FROM public.users WHERE id = p_actor_id;
  IF v_actor_role IS NULL THEN
    RETURN json_build_object('ok', false, 'code', 'ACTOR_NOT_FOUND');
  END IF;

  SELECT o.status::TEXT, o.market_id, o.carrier_id, o.carrier_extra->>'darb_branch_group'
  INTO v_status, v_market_id, v_carrier_id, v_branch_group
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

  v_sticker := NULLIF(btrim(COALESCE(p_sticker_ref, '')), '');
  v_needed_color := public.darb_color_for_branch_group(v_branch_group);

  IF v_sticker IS NULL THEN
    RETURN json_build_object('ok', true, 'required_color', v_needed_color, 'branch_group', v_branch_group);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE market_id = v_market_id AND carrier_sticker_ref = v_sticker AND id <> p_order_id
  ) THEN
    RETURN json_build_object('ok', false, 'code', 'STICKER_ALREADY_USED', 'sticker', v_sticker);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.sticker_rolls WHERE carrier_id = v_carrier_id AND status = 'open'
  ) INTO v_has_rolls;

  -- No rolls registered yet → the guard is dormant rather than blocking the
  -- bench on day one. The console says so; it does not silently pass.
  IF NOT v_has_rolls THEN
    RETURN json_build_object(
      'ok', true, 'unguarded', true,
      'required_color', v_needed_color, 'branch_group', v_branch_group
    );
  END IF;

  SELECT sr.id, sr.color_hex, sr.label INTO v_roll_id, v_roll_color, v_roll_label
  FROM public.sticker_roll_for(v_carrier_id, v_sticker) sr;

  IF v_roll_id IS NULL THEN
    RETURN json_build_object(
      'ok', false, 'code', 'STICKER_NOT_IN_ROLL', 'sticker', v_sticker,
      'required_color', v_needed_color, 'branch_group', v_branch_group
    );
  END IF;

  IF v_needed_color IS NOT NULL AND v_roll_color IS DISTINCT FROM v_needed_color THEN
    RETURN json_build_object(
      'ok', false, 'code', 'STICKER_WRONG_ROLL', 'sticker', v_sticker,
      'sticker_color', v_roll_color, 'required_color', v_needed_color,
      'branch_group', v_branch_group, 'roll_label', v_roll_label
    );
  END IF;

  RETURN json_build_object(
    'ok', true, 'sticker', v_sticker, 'roll_id', v_roll_id,
    'sticker_color', v_roll_color, 'required_color', v_needed_color,
    'branch_group', v_branch_group
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.precheck_scan_out(UUID, UUID, TEXT) TO PUBLIC;

-- ── 7. scan_order_out — the same guards, as the authority ───────────────────
--
-- Recreated in full rather than patched, so the whole committed sequence stays
-- readable in one place. Everything outside the two new roll checks is
-- unchanged from 20260822000001: still one inventory_log row and one
-- order_history row per scan, still the same three stock mutation paths.

CREATE OR REPLACE FUNCTION public.scan_order_out(
  p_order_id UUID,
  p_actor_id UUID,
  p_sticker_ref TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id UUID;
  v_current_status order_status;
  v_product_id UUID;
  v_quantity INTEGER;
  v_market_id UUID;
  v_carrier_id UUID;
  v_branch_group TEXT;
  v_actor_market_id UUID;
  v_actor_role TEXT;
  v_carrier_labels BOOLEAN;
  v_has_label BOOLEAN;
  v_has_rolls BOOLEAN;
  v_roll_id UUID;
  v_roll_color TEXT;
  v_needed_color TEXT;
  v_current_stock INTEGER;
  v_new_stock INTEGER;
  v_sticker TEXT;
  v_log_id UUID;
  v_history_id UUID;
  v_updated_at TIMESTAMPTZ;
BEGIN
  SELECT role, market_id INTO v_actor_role, v_actor_market_id
  FROM users WHERE id = p_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found: %', p_actor_id;
  END IF;
  IF v_actor_role NOT IN ('warehouse_agent', 'market_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Actor role % cannot scan out', v_actor_role;
  END IF;

  SELECT id, status, product_id, quantity, market_id, carrier_id,
         carrier_extra->>'darb_branch_group'
  INTO v_order_id, v_current_status, v_product_id, v_quantity, v_market_id,
       v_carrier_id, v_branch_group
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  IF v_actor_role <> 'super_admin' AND v_actor_market_id IS DISTINCT FROM v_market_id THEN
    RAISE EXCEPTION 'Order belongs to a different market';
  END IF;

  IF v_current_status <> 'uploaded' THEN
    RAISE EXCEPTION 'Order is not in uploaded status (current: %)', v_current_status;
  END IF;

  -- The label guard applies only when WE are the ones who print. An order with
  -- no carrier yet cannot have had a carrier label, so it still needs ours.
  SELECT COALESCE(supplies_own_labels, FALSE) INTO v_carrier_labels
  FROM carriers WHERE id = v_carrier_id;
  v_carrier_labels := COALESCE(v_carrier_labels, FALSE);

  IF NOT v_carrier_labels THEN
    SELECT EXISTS (SELECT 1 FROM label_prints WHERE order_id = p_order_id) INTO v_has_label;
    IF NOT v_has_label THEN
      RAISE EXCEPTION 'Order has no printed label — print label before scanning';
    END IF;
  END IF;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Order has no linked product for stock adjustment';
  END IF;

  v_sticker := NULLIF(BTRIM(COALESCE(p_sticker_ref, '')), '');

  IF v_sticker IS NOT NULL THEN
    -- Checked up front so the operator gets the real reason, not a raw
    -- constraint error. The unique index below is still the authority: it
    -- closes the gap between this SELECT and the UPDATE.
    IF EXISTS (
      SELECT 1 FROM orders
      WHERE market_id = v_market_id
        AND carrier_sticker_ref = v_sticker
        AND id <> p_order_id
    ) THEN
      RAISE EXCEPTION 'Sticker % is already bound to another order', v_sticker;
    END IF;

    -- Roll guards. Dormant until the account has an open roll, so applying
    -- this migration changes nothing at the bench until one is registered.
    SELECT EXISTS (
      SELECT 1 FROM sticker_rolls WHERE carrier_id = v_carrier_id AND status = 'open'
    ) INTO v_has_rolls;

    IF v_has_rolls THEN
      SELECT sr.id, sr.color_hex INTO v_roll_id, v_roll_color
      FROM public.sticker_roll_for(v_carrier_id, v_sticker) sr;

      IF v_roll_id IS NULL THEN
        RAISE EXCEPTION 'Sticker % is not in any registered roll', v_sticker;
      END IF;

      -- The one that catches the real floor mistake: right number, wrong roll.
      -- Skipped when the destination could not be resolved to a Darb branch —
      -- the operator is already told the colour is unconfirmed, and refusing on
      -- an unknown would block a parcel we simply cannot classify.
      v_needed_color := public.darb_color_for_branch_group(v_branch_group);
      IF v_needed_color IS NOT NULL AND v_roll_color IS DISTINCT FROM v_needed_color THEN
        RAISE EXCEPTION 'Sticker % is from the % roll but this parcel needs the % roll',
          v_sticker, v_roll_color, v_needed_color;
      END IF;
    END IF;
  END IF;

  SELECT current_stock INTO v_current_stock
  FROM products
  WHERE id = v_product_id
  FOR UPDATE;

  IF v_current_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found: %', v_product_id;
  END IF;

  v_new_stock := v_current_stock - v_quantity;
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'stock cannot go below zero';
  END IF;

  UPDATE products SET current_stock = v_new_stock WHERE id = v_product_id;

  INSERT INTO inventory_log (product_id, order_id, change, reason, balance_after, is_damaged, actor_id, note)
  VALUES (v_product_id, p_order_id, -v_quantity, 'scanned', v_new_stock, false, p_actor_id,
          COALESCE('Scan sortie entrepôt · sticker ' || v_sticker, 'Scan sortie entrepôt'))
  RETURNING id INTO v_log_id;

  BEGIN
    UPDATE orders
    SET status = 'scanned',
        carrier_sticker_ref = COALESCE(v_sticker, carrier_sticker_ref)
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Sticker % is already bound to another order', v_sticker;
  END;

  INSERT INTO order_history (order_id, status_from, status_to, actor_id, actor_type, note)
  VALUES (p_order_id, 'uploaded', 'scanned', p_actor_id, 'agent',
          COALESCE('Scanné par l''entrepôt · sticker ' || v_sticker, 'Scanné par l''entrepôt'))
  RETURNING id INTO v_history_id;

  RETURN json_build_object(
    'order_id', p_order_id,
    'status', 'scanned',
    'stock_after', v_new_stock,
    'sticker_ref', v_sticker,
    'sticker_color', v_roll_color,
    'required_color', v_needed_color,
    'updated_at', v_updated_at,
    'history_id', v_history_id,
    'inventory_log_id', v_log_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.scan_order_out(UUID, UUID, TEXT) TO PUBLIC;
