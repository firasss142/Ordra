-- ============================================================
-- 20260930225232_ad_spend_adset_mapping.sql
-- Ad spend at ad-set grain, mapped to one or several products, with a history.
-- Plan: plans/ad-spend-adset-mapping.md. Prototype: prototypes/ad-spend-mapping-v1.html.
--
-- WHY: mapping was one CAMPAIGN → one PRODUCT, written once and baked into
-- ad_spend.product_id. Two things broke it on real Libya data (2026-09-30):
--
--   1. A campaign can sell several products. "BoxLyLong - relaunch" (16 696 LYD)
--      is mapped to the large boxing doll alone, yet while it ran most orders
--      were the medium size. Split by each day's orders it is 63 / 20 / 17 %, and
--      the large doll's CPL falls from 112.8 to 19.6 LYD.
--   2. The structure lives in ad sets. A CBO campaign with one ad set per product
--      is the normal way to launch several products, and the sync read
--      level=campaign, so it could never see it.
--
-- And a remap rewrote history silently, including periods already covered by a
-- settled investor statement. Mappings are now effective-dated: each change
-- says whether it applies to all history or from a date.
--
-- WHAT (additive only — the deployed app keeps working when this lands):
--   meta_ad_campaigns / meta_ad_sets   the Meta catalogue, incl. never-spent campaigns
--   meta_adset_daily                   raw Insights, one row per ad set per day, no product
--   ad_spend_mappings (+ _lines)       effective-dated, many-to-many mapping versions
--   ad_spend.+5 columns                which ad set, which share, which rule, which version
--   meta_ad_accounts.adset_history_from  how far back ad-set facts are complete
--   set_ad_spend_mapping()             the only writer of mappings (supersede + insert)
--   replace_meta_ad_spend()            atomically rewrites the meta rows of ad_spend
--   order_counts_by_product_day()      the weights of the automatic split
--
-- ad_spend stays the one ledger the six product readers and investor accrual sum
-- by product_id. None of them change: for source='meta' its rows simply become a
-- projection of meta_adset_daily × the mapping in force, rewritten by
-- replace_meta_ad_spend.
--
-- NOT HERE: dropping ad_spend_synced_key (the old ON CONFLICT arbiter). The
-- deployed sync upserts on it every hour; it goes in the cutover migration,
-- applied right after the new code is live. Until then replace_meta_ad_spend
-- fails on a campaign with two ad sets spending the same day, atomically — the
-- old rows stay and the run is logged as failed, which is the safe failure.
-- ============================================================

-- ---- catalogue -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS meta_ad_campaigns (
  ad_account_id        TEXT        NOT NULL,
  -- TEXT, never numeric: Meta ids are 17-18 digits, past 2^53.
  external_campaign_id TEXT        NOT NULL,
  market_id            UUID        NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  name                 TEXT,
  objective            TEXT,
  effective_status     TEXT,
  created_time         TIMESTAMPTZ,
  -- Refreshed on every sync that still sees the campaign. A campaign deleted in
  -- Ads Manager stops being seen; its history stays.
  last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ad_account_id, external_campaign_id)
);

CREATE TABLE IF NOT EXISTS meta_ad_sets (
  ad_account_id        TEXT        NOT NULL,
  external_adset_id    TEXT        NOT NULL,
  external_campaign_id TEXT        NOT NULL,
  market_id            UUID        NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  name                 TEXT,
  effective_status     TEXT,
  created_time         TIMESTAMPTZ,
  last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ad_account_id, external_adset_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ad_sets_campaign
  ON meta_ad_sets (ad_account_id, external_campaign_id);

-- ---- raw fact ------------------------------------------------------------

-- One ad set on one day, exactly as Meta reported it, converted once. It names no
-- product: attribution is a separate, revisable decision, and keeping the fact
-- apart from it is what lets a remap rewrite ad_spend without asking Meta again.
CREATE TABLE IF NOT EXISTS meta_adset_daily (
  ad_account_id        TEXT          NOT NULL,
  external_adset_id    TEXT          NOT NULL,
  -- A day in the AD ACCOUNT's timezone (meta_ad_accounts.account_timezone).
  day                  DATE          NOT NULL,
  external_campaign_id TEXT          NOT NULL,
  market_id            UUID          NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  campaign_name        TEXT,
  adset_name           TEXT,
  spend_original       NUMERIC(14,4) NOT NULL DEFAULT 0,
  currency_original    TEXT          NOT NULL,
  -- Stamped at sync time and never re-derived for days past the rolling window,
  -- so correcting today's rate never rewrites last quarter.
  fx_rate              NUMERIC(12,6) NOT NULL,
  amount               NUMERIC(10,3) NOT NULL,
  impressions          BIGINT,
  reach                BIGINT,         -- DAILY ONLY, never summed (see ad_spend.reach)
  clicks               BIGINT,
  frequency            NUMERIC(8,4),   -- DAILY ONLY, never averaged
  platform_results     INTEGER,
  synced_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (ad_account_id, external_adset_id, day),
  CONSTRAINT meta_adset_daily_amount_non_negative CHECK (amount >= 0 AND spend_original >= 0)
);

CREATE INDEX IF NOT EXISTS idx_meta_adset_daily_campaign_day
  ON meta_adset_daily (ad_account_id, external_campaign_id, day);
CREATE INDEX IF NOT EXISTS idx_meta_adset_daily_market_day
  ON meta_adset_daily (market_id, day);

-- How far back meta_adset_daily is COMPLETE for an account. A history rebuild
-- never reaches before it: rewriting a day whose ad-set facts were never fetched
-- would delete the old campaign-level row and put nothing in its place — spend
-- would vanish, which overstates profit.
ALTER TABLE meta_ad_accounts
  ADD COLUMN IF NOT EXISTS adset_history_from DATE;

COMMENT ON COLUMN meta_ad_accounts.adset_history_from IS
  'Earliest day from which meta_adset_daily is complete up to today. NULL = no '
  'complete ad-set history yet. History rebuilds are clamped to it.';

-- ---- mappings ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ad_spend_mappings (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id            UUID        NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  ad_account_id        TEXT        NOT NULL,
  external_campaign_id TEXT        NOT NULL,
  -- NULL = campaign level, which every ad set follows unless it has its own.
  external_adset_id    TEXT,
  -- NULL = since the beginning. A version is in force from this day until the
  -- next live version of the same target.
  effective_from       DATE,
  -- products     : lines say which, split_mode says how (when more than one)
  -- market_level : deliberately no product (brand, test) — counts in the P&L only
  -- inherit      : an ad set going back to following its campaign
  kind                 TEXT        NOT NULL CHECK (kind IN ('products', 'market_level', 'inherit')),
  split_mode           TEXT        CHECK (split_mode IN ('auto_orders', 'manual')),
  created_by           UUID        REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A change never edits a version: it supersedes it. What was in force, and
  -- who replaced it when, stays readable — the drawer shows it as a timeline.
  superseded_at        TIMESTAMPTZ,
  superseded_by        UUID        REFERENCES ad_spend_mappings(id),
  CONSTRAINT ad_spend_mappings_inherit_is_adset
    CHECK (kind <> 'inherit' OR external_adset_id IS NOT NULL),
  CONSTRAINT ad_spend_mappings_split_only_for_products
    CHECK (split_mode IS NULL OR kind = 'products'),
  CONSTRAINT ad_spend_mappings_superseded_pair
    CHECK ((superseded_at IS NULL) = (superseded_by IS NULL))
);

-- One live version per target per start day.
CREATE UNIQUE INDEX IF NOT EXISTS ad_spend_mappings_one_live
  ON ad_spend_mappings (
    ad_account_id,
    external_campaign_id,
    COALESCE(external_adset_id, ''),
    COALESCE(effective_from, '-infinity'::DATE)
  )
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ad_spend_mappings_target
  ON ad_spend_mappings (ad_account_id, external_campaign_id);

CREATE TABLE IF NOT EXISTS ad_spend_mapping_lines (
  mapping_id  UUID         NOT NULL REFERENCES ad_spend_mappings(id),
  -- RESTRICT: deleting a product must not silently orphan the spend it carries.
  product_id  UUID         NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  -- Manual split only; the lines of one version sum to exactly 100.
  share_pct   NUMERIC(5,2) CHECK (share_pct IS NULL OR (share_pct >= 0 AND share_pct <= 100)),
  PRIMARY KEY (mapping_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_spend_mapping_lines_product
  ON ad_spend_mapping_lines (product_id);

-- History is the point of these two tables, so nothing rewrites it: a version
-- may only be marked superseded, once, and a line never changes.
CREATE OR REPLACE FUNCTION ad_spend_mappings_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ad_spend_mappings is history: supersede a version, never delete it'
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.superseded_at IS NOT NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.market_id IS DISTINCT FROM OLD.market_id
     OR NEW.ad_account_id IS DISTINCT FROM OLD.ad_account_id
     OR NEW.external_campaign_id IS DISTINCT FROM OLD.external_campaign_id
     OR NEW.external_adset_id IS DISTINCT FROM OLD.external_adset_id
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.split_mode IS DISTINCT FROM OLD.split_mode
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'ad_spend_mappings is history: only superseded_at/by may be set, once'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ad_spend_mappings_guard ON ad_spend_mappings;
CREATE TRIGGER trg_ad_spend_mappings_guard
  BEFORE UPDATE OR DELETE ON ad_spend_mappings
  FOR EACH ROW EXECUTE FUNCTION ad_spend_mappings_guard();

CREATE OR REPLACE FUNCTION ad_spend_mapping_lines_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'ad_spend_mapping_lines is history: insert a new version instead'
    USING ERRCODE = 'P0001';
END $$;

DROP TRIGGER IF EXISTS trg_ad_spend_mapping_lines_guard ON ad_spend_mapping_lines;
CREATE TRIGGER trg_ad_spend_mapping_lines_guard
  BEFORE UPDATE OR DELETE ON ad_spend_mapping_lines
  FOR EACH ROW EXECUTE FUNCTION ad_spend_mapping_lines_guard();

-- ---- ad_spend: the projection's provenance ------------------------------

ALTER TABLE ad_spend
  ADD COLUMN IF NOT EXISTS external_adset_id TEXT,
  ADD COLUMN IF NOT EXISTS adset_name        TEXT,
  -- The fraction of its ad set-day this row carries: 1 when unsplit.
  ADD COLUMN IF NOT EXISTS allocation_share  NUMERIC(9,8),
  ADD COLUMN IF NOT EXISTS allocation_basis  TEXT,
  ADD COLUMN IF NOT EXISTS mapping_id        UUID REFERENCES ad_spend_mappings(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ad_spend'::regclass AND conname = 'ad_spend_allocation_basis_check'
  ) THEN
    ALTER TABLE ad_spend ADD CONSTRAINT ad_spend_allocation_basis_check CHECK (
      allocation_basis IS NULL OR allocation_basis IN (
        'single', 'auto_orders', 'auto_trailing_7d', 'auto_equal', 'manual',
        'market_level', 'unmapped'
      )
    );
  END IF;
END $$;

COMMENT ON COLUMN ad_spend.allocation_basis IS
  'For source=meta: which rule produced this row. single = one product; '
  'auto_orders = that day''s orders; auto_trailing_7d = no order that day, the '
  'mix of the 7 days before; auto_equal = no order in 8 days, equal parts; '
  'manual = fixed percentages; market_level = deliberately no product; '
  'unmapped = nobody has decided yet. NULL on rows written before 2026-09-30.';

CREATE INDEX IF NOT EXISTS idx_ad_spend_meta_campaign_day
  ON ad_spend (ad_account_id, external_campaign_id, period_start)
  WHERE source = 'meta';

-- ---- migrate the existing decisions -------------------------------------

-- Every campaign mapped so far keeps exactly what it had, as a campaign-level
-- version in force since the beginning. A NULL product was an explicit
-- "market level" decision in the old table, and stays one.
INSERT INTO ad_spend_mappings (
  id, market_id, ad_account_id, external_campaign_id, external_adset_id,
  effective_from, kind, split_mode, created_by, created_at
)
SELECT gen_random_uuid(), m.market_id, m.ad_account_id, m.external_campaign_id, NULL,
       NULL, CASE WHEN m.product_id IS NULL THEN 'market_level' ELSE 'products' END, NULL,
       m.mapped_by, m.updated_at
FROM meta_campaign_mappings m
WHERE NOT EXISTS (
  SELECT 1 FROM ad_spend_mappings a
  WHERE a.ad_account_id = m.ad_account_id
    AND a.external_campaign_id = m.external_campaign_id
    AND a.external_adset_id IS NULL
    AND a.effective_from IS NULL
    AND a.superseded_at IS NULL
);

INSERT INTO ad_spend_mapping_lines (mapping_id, product_id, share_pct)
SELECT a.id, m.product_id, NULL
FROM meta_campaign_mappings m
JOIN ad_spend_mappings a
  ON a.ad_account_id = m.ad_account_id
 AND a.external_campaign_id = m.external_campaign_id
 AND a.external_adset_id IS NULL
 AND a.effective_from IS NULL
 AND a.superseded_at IS NULL
WHERE m.product_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ad_spend_mapping_lines l WHERE l.mapping_id = a.id);

COMMENT ON TABLE meta_campaign_mappings IS
  'SUPERSEDED 2026-09-30 by ad_spend_mappings (+ _lines). Kept read-only until the '
  'cutover migration drops it; nothing in the app reads or writes it any more.';

-- ---- RLS -----------------------------------------------------------------

-- Same rule as meta_campaign_mappings: this decides which product's P&L — and
-- which investor's share — absorbs which slice of spend. Super admin reads;
-- nobody writes except through the service-role RPCs below.
ALTER TABLE meta_ad_campaigns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_ad_sets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_adset_daily       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_spend_mappings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_spend_mapping_lines ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['meta_ad_campaigns','meta_ad_sets','meta_adset_daily',
                           'ad_spend_mappings','ad_spend_mapping_lines'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    -- (SELECT f()) and not a bare call: a bare helper in a policy is re-run for
    -- every row (the RLS InitPlan trap).
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING ((SELECT get_user_role()) = %L)',
      t || '_select', t, 'super_admin'
    );
    EXECUTE format('REVOKE ALL ON %I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I FROM authenticated', t);
  END LOOP;
END $$;

-- ---- RPC: the only writer of mappings -----------------------------------

-- Service-role EXECUTE only. The route authenticates the actor; p_actor_id is
-- recorded, never trusted to decide anything, because nobody but the server can
-- call this at all. (An actor id that decides the market is exactly how
-- isolation fell elsewhere — see the rpc-actor-id lesson.)
CREATE OR REPLACE FUNCTION set_ad_spend_mapping(
  p_actor_id       UUID,
  p_ad_account_id  TEXT,
  p_campaign_id    TEXT,
  p_adset_id       TEXT,
  p_effective_from DATE,
  p_kind           TEXT,
  p_split_mode     TEXT,
  p_lines          JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_market  UUID;
  v_new     UUID := gen_random_uuid();
  v_count   INT;
  v_sum     NUMERIC;
  v_foreign INT;
  v_nulls   INT;
BEGIN
  SELECT market_id INTO v_market FROM meta_ad_accounts WHERE ad_account_id = p_ad_account_id;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'unknown ad account %', p_ad_account_id USING ERRCODE = '22023';
  END IF;

  -- IS NULL first: `NULL NOT IN (...)` is NULL, and IF NULL does not fire.
  IF p_kind IS NULL OR p_kind NOT IN ('products', 'market_level', 'inherit') THEN
    RAISE EXCEPTION 'unknown kind %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'inherit' AND p_adset_id IS NULL THEN
    RAISE EXCEPTION 'only an ad set can inherit its campaign' USING ERRCODE = '22023';
  END IF;

  v_count := COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines END), 0);

  IF p_kind = 'products' THEN
    IF v_count = 0 THEN
      RAISE EXCEPTION 'a products mapping needs at least one product' USING ERRCODE = '22023';
    END IF;
    IF v_count > 1 AND (p_split_mode IS NULL OR p_split_mode NOT IN ('auto_orders', 'manual')) THEN
      RAISE EXCEPTION 'several products need a split mode' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(DISTINCT l->>'product_id') FROM jsonb_array_elements(p_lines) l) <> v_count THEN
      RAISE EXCEPTION 'a product appears twice' USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_foreign
    FROM jsonb_array_elements(p_lines) l
    LEFT JOIN products p ON p.id = (l->>'product_id')::UUID
    WHERE p.id IS NULL OR p.market_id <> v_market;
    IF v_foreign > 0 THEN
      RAISE EXCEPTION 'every product must belong to the ad account''s market' USING ERRCODE = '22023';
    END IF;
    IF v_count > 1 AND p_split_mode = 'manual' THEN
      SELECT sum((l->>'share_pct')::NUMERIC), count(*) FILTER (WHERE l->>'share_pct' IS NULL)
        INTO v_sum, v_nulls
      FROM jsonb_array_elements(p_lines) l;
      IF v_nulls > 0 OR v_sum <> 100 THEN
        RAISE EXCEPTION 'manual shares must sum to 100 (got %)', COALESCE(v_sum, 0) USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSIF v_count > 0 THEN
    RAISE EXCEPTION '% takes no products', p_kind USING ERRCODE = '22023';
  END IF;

  -- Serialise changes to one target; two people saving at once must not both
  -- supersede the same version.
  PERFORM 1 FROM ad_spend_mappings
  WHERE ad_account_id = p_ad_account_id
    AND external_campaign_id = p_campaign_id
    AND external_adset_id IS NOT DISTINCT FROM p_adset_id
    AND superseded_at IS NULL
  FOR UPDATE;

  -- "All history" supersedes every live version; "from D" only those starting
  -- on or after D. A version from before D stays in force up to D.
  UPDATE ad_spend_mappings
     SET superseded_at = now(), superseded_by = v_new
   WHERE ad_account_id = p_ad_account_id
     AND external_campaign_id = p_campaign_id
     AND external_adset_id IS NOT DISTINCT FROM p_adset_id
     AND superseded_at IS NULL
     AND (p_effective_from IS NULL
          OR (effective_from IS NOT NULL AND effective_from >= p_effective_from));

  -- superseded_by points at a row inserted in the same statement sequence; the
  -- FK is checked at statement end, so insert first would also do — but the
  -- UPDATE above must see the old set, hence this order and a deferred check.
  INSERT INTO ad_spend_mappings (
    id, market_id, ad_account_id, external_campaign_id, external_adset_id,
    effective_from, kind, split_mode, created_by
  ) VALUES (
    v_new, v_market, p_ad_account_id, p_campaign_id, p_adset_id,
    p_effective_from, p_kind,
    CASE WHEN p_kind = 'products' AND v_count > 1 THEN p_split_mode END,
    p_actor_id
  );

  IF p_kind = 'products' THEN
    INSERT INTO ad_spend_mapping_lines (mapping_id, product_id, share_pct)
    SELECT v_new, (l->>'product_id')::UUID,
           CASE WHEN v_count > 1 AND p_split_mode = 'manual' THEN (l->>'share_pct')::NUMERIC END
    FROM jsonb_array_elements(p_lines) l;
  END IF;

  RETURN v_new;
END $$;

-- The UPDATE above names v_new before its row exists; make that FK deferrable
-- so it is checked at COMMIT, when the row is there.
ALTER TABLE ad_spend_mappings DROP CONSTRAINT IF EXISTS ad_spend_mappings_superseded_by_fkey;
ALTER TABLE ad_spend_mappings
  ADD CONSTRAINT ad_spend_mappings_superseded_by_fkey
  FOREIGN KEY (superseded_by) REFERENCES ad_spend_mappings(id)
  DEFERRABLE INITIALLY DEFERRED;

-- ---- RPC: rewrite the meta rows of ad_spend, atomically -----------------

CREATE OR REPLACE FUNCTION replace_meta_ad_spend(
  p_ad_account_id TEXT,
  p_since         DATE,
  p_until         DATE,
  p_campaign_ids  TEXT[],
  p_rows          JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_market   UUID;
  v_outside  INT;
  v_inserted INT;
BEGIN
  SELECT market_id INTO v_market FROM meta_ad_accounts WHERE ad_account_id = p_ad_account_id;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'unknown ad account %', p_ad_account_id USING ERRCODE = '22023';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_since > p_until THEN
    RAISE EXCEPTION 'bad window % → %', p_since, p_until USING ERRCODE = '22023';
  END IF;

  -- A row outside the scope being replaced would survive the next replace of its
  -- own scope and be counted twice. Refuse the whole batch instead.
  SELECT count(*) INTO v_outside
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
  WHERE (r->>'period_start')::DATE NOT BETWEEN p_since AND p_until
     OR r->>'ad_account_id' IS DISTINCT FROM p_ad_account_id
     OR (r->>'market_id')::UUID IS DISTINCT FROM v_market
     OR (p_campaign_ids IS NOT NULL AND NOT (r->>'external_campaign_id' = ANY (p_campaign_ids)));
  IF v_outside > 0 THEN
    RAISE EXCEPTION '% row(s) fall outside the replaced scope', v_outside USING ERRCODE = '22023';
  END IF;

  DELETE FROM ad_spend
   WHERE source = 'meta'
     AND ad_account_id = p_ad_account_id
     AND period_start BETWEEN p_since AND p_until
     AND (p_campaign_ids IS NULL OR external_campaign_id = ANY (p_campaign_ids));

  INSERT INTO ad_spend (
    market_id, product_id, amount, period_start, period_end, source,
    ad_account_id, external_campaign_id, external_adset_id, campaign_name, adset_name,
    amount_original, currency_original, fx_rate,
    impressions, reach, clicks, frequency, platform_results, synced_at,
    allocation_share, allocation_basis, mapping_id
  )
  SELECT v_market, r.product_id, r.amount, r.period_start, r.period_start, 'meta',
         p_ad_account_id, r.external_campaign_id, r.external_adset_id, r.campaign_name, r.adset_name,
         r.amount_original, r.currency_original, r.fx_rate,
         r.impressions, r.reach, r.clicks, r.frequency, r.platform_results, COALESCE(r.synced_at, now()),
         r.allocation_share, r.allocation_basis, r.mapping_id
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::JSONB)) AS r(
    product_id UUID, amount NUMERIC, period_start DATE,
    external_campaign_id TEXT, external_adset_id TEXT, campaign_name TEXT, adset_name TEXT,
    amount_original NUMERIC, currency_original TEXT, fx_rate NUMERIC,
    impressions BIGINT, reach BIGINT, clicks BIGINT, frequency NUMERIC, platform_results INTEGER,
    synced_at TIMESTAMPTZ, allocation_share NUMERIC, allocation_basis TEXT, mapping_id UUID
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END $$;

-- ---- RPC: the automatic split's weights ---------------------------------

-- Orders created per product per day, the day cut in p_tz (the ad account's
-- timezone, so it matches Meta's day). Every status counts: it is the same
-- "lead" the economics route divides spend by, so CPL stays coherent.
CREATE OR REPLACE FUNCTION order_counts_by_product_day(
  p_market_id   UUID,
  p_since       DATE,
  p_until       DATE,
  p_tz          TEXT,
  p_product_ids UUID[]
)
RETURNS TABLE (day DATE, product_id UUID, orders INT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT (o.created_at AT TIME ZONE p_tz)::DATE, o.product_id, count(*)::INT
  FROM orders o
  WHERE o.market_id = p_market_id
    AND o.product_id = ANY (p_product_ids)
    AND o.created_at >= (p_since::TIMESTAMP AT TIME ZONE p_tz)
    AND o.created_at <  ((p_until + 1)::TIMESTAMP AT TIME ZONE p_tz)
  GROUP BY 1, 2
$$;

-- ---- grants: service role only ------------------------------------------

-- REVOKE from PUBLIC first: EXECUTE is granted to PUBLIC by default, and anon
-- and authenticated inherit through it.
REVOKE ALL ON FUNCTION set_ad_spend_mapping(UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION replace_meta_ad_spend(TEXT, DATE, DATE, TEXT[], JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION order_counts_by_product_day(UUID, DATE, DATE, TEXT, UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ad_spend_mappings_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ad_spend_mapping_lines_guard() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION set_ad_spend_mapping(UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION replace_meta_ad_spend(TEXT, DATE, DATE, TEXT[], JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION order_counts_by_product_day(UUID, DATE, DATE, TEXT, UUID[]) TO service_role;
