-- ============================================================
-- 20260920000007_investor_v1_drop_legacy.sql
-- Investor domain v2 — remove the v1 model.
--
-- v1 (capital ÷ total capital incl. a "house" position, 10 % reserve held 90
-- days, 3-day rollup window) is fully replaced by v2 (deals with a fixed
-- negotiated share %, versioned terms, per-order facts, carried loss, manual
-- close). Production held fixture rows only. All v1 code was deleted from the
-- app in the same change; nothing reads these objects any more.
-- ============================================================

DROP FUNCTION IF EXISTS apply_investor_settlement(JSONB, JSONB, UUID);
DROP FUNCTION IF EXISTS request_withdrawal(UUID, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS post_investor_correction(UUID, TEXT, NUMERIC, TEXT, UUID, UUID, UUID);
DROP FUNCTION IF EXISTS release_investor_reserve(UUID, NUMERIC);

DROP TABLE IF EXISTS investor_ledger CASCADE;
DROP TABLE IF EXISTS investor_statements CASCADE;
DROP TABLE IF EXISTS withdrawal_requests CASCADE;
DROP TABLE IF EXISTS investment_positions CASCADE;
DROP TABLE IF EXISTS investor_daily_product_stats CASCADE;

ALTER TABLE investors DROP COLUMN IF EXISTS reserve_pct;

COMMENT ON TABLE investors IS
  'Investor profile (v2): legal name, payout method/details, notes. Commercial terms live on investor_deals / investor_deal_terms.';
