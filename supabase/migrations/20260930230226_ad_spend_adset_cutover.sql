-- ============================================================
-- 20260930230226_ad_spend_adset_cutover.sql
-- The cutover half of 20260930225232_ad_spend_adset_mapping.sql.
--
-- APPLY AFTER THE NEW CODE IS LIVE, not with the first half. Until the deploy,
-- the running sync upserts campaign-level rows with
-- ON CONFLICT (source, ad_account_id, external_campaign_id, period_start), and
-- dropping that arbiter makes every hourly run fail 42P10. Once the new code is
-- live the arbiter is what blocks it instead: an ad set-day split across
-- products, or two ad sets of one campaign spending on the same day, are several
-- rows for one (campaign, day) — replace_meta_ad_spend refuses them atomically
-- and the old rows stay until this lands.
--
-- WHAT
--   · ad_spend_synced_key goes. Nothing upserts meta rows any more: they are
--     rewritten as a whole by replace_meta_ad_spend.
--   · Its replacement is an integrity index, not an arbiter: at most one row per
--     (campaign, ad set, day, product). Partial is safe here because nothing
--     names it in ON CONFLICT — the 42P10 trap only bites an arbiter.
--   · meta_campaign_mappings goes. Its rows were copied into ad_spend_mappings by
--     the first half, and nothing reads it once the new code is live.
-- ============================================================

DROP INDEX IF EXISTS ad_spend_synced_key;

-- NULLS NOT DISTINCT: a legacy campaign-level row has no ad set, and an
-- unattributed row has no product; two such rows for the same day are still
-- the same row twice.
CREATE UNIQUE INDEX IF NOT EXISTS ad_spend_meta_allocation_key
  ON ad_spend (ad_account_id, external_campaign_id, external_adset_id, period_start, product_id)
  NULLS NOT DISTINCT
  WHERE source = 'meta';

DROP TABLE IF EXISTS meta_campaign_mappings;
