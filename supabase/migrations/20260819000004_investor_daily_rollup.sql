-- ============================================================
-- 20260819000004_investor_daily_rollup.sql
-- Pre-computed daily per-product stats powering the investor portal.
--
-- WHY: /api/profitability already times out between a 7- and 14-day window for
-- market_manager. Investors want since-inception views — every chart on the
-- portal is cumulative. Aggregating order_history live at that range is not
-- viable, so a cron job folds each day once and the portal reads this table.
--
-- It also gives the daily sparkline and the cumulative profit curve for free.
--
-- One row per (day, market, product). The unique constraint makes the rollup
-- job safely re-runnable: recomputing a day overwrites rather than duplicates,
-- which matters because a day is recomputed whenever a late carrier event
-- lands.
--
-- ad_spend_direct only. Market-wide ad spend (product_id IS NULL) is allocated
-- at settlement time, because the pro-rata split depends on revenue across ALL
-- products in the period and cannot be resolved one product at a time.
-- ============================================================

CREATE TABLE investor_daily_product_stats (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_date        DATE          NOT NULL,
  market_id        UUID          NOT NULL REFERENCES markets(id),
  product_id       UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  -- Funnel
  leads_count      INTEGER       NOT NULL DEFAULT 0,
  confirmed_count  INTEGER       NOT NULL DEFAULT 0,
  uploaded_count   INTEGER       NOT NULL DEFAULT 0,
  delivered_count  INTEGER       NOT NULL DEFAULT 0,
  returned_count   INTEGER       NOT NULL DEFAULT 0,

  -- Waterfall, all attributed to this product
  revenue          NUMERIC(14,3) NOT NULL DEFAULT 0,
  cogs             NUMERIC(14,3) NOT NULL DEFAULT 0,
  delivery_cost    NUMERIC(14,3) NOT NULL DEFAULT 0,
  return_cost      NUMERIC(14,3) NOT NULL DEFAULT 0,
  packing_cost     NUMERIC(14,3) NOT NULL DEFAULT 0,
  processing_cost  NUMERIC(14,3) NOT NULL DEFAULT 0,
  ad_spend_direct  NUMERIC(14,3) NOT NULL DEFAULT 0,

  computed_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_daily_stats UNIQUE (stat_date, market_id, product_id)
);

CREATE INDEX idx_daily_stats_product_date
  ON investor_daily_product_stats (product_id, stat_date);
CREATE INDEX idx_daily_stats_market_date
  ON investor_daily_product_stats (market_id, stat_date);

COMMENT ON TABLE investor_daily_product_stats IS
  'Daily per-product rollup for the investor portal. Recomputed idempotently by /api/cron/investor-rollup; never hand-edited.';

-- ============================================================
-- RLS
-- Investors do NOT read this table directly — the portal goes through
-- server-computed endpoints that scope to the products they hold a position
-- in. Granting them a policy here would expose every product in the market.
-- ============================================================

ALTER TABLE investor_daily_product_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_stats_select_super_admin
  ON investor_daily_product_stats FOR SELECT
  USING ((SELECT get_user_role()) = 'super_admin');

CREATE POLICY daily_stats_select_manager
  ON investor_daily_product_stats FOR SELECT
  USING (
    (SELECT get_user_role()) = 'market_manager'
    AND market_id = (SELECT get_user_market_id())
  );

CREATE POLICY daily_stats_all_super_admin
  ON investor_daily_product_stats FOR ALL
  USING ((SELECT get_user_role()) = 'super_admin')
  WITH CHECK ((SELECT get_user_role()) = 'super_admin');
