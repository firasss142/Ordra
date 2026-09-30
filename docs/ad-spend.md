# Dépenses pub — ad spend, Meta sync, and the break-even floor

Finances → Dépenses pub. The page answers one question: **what is the most we may pay
for one more lead before the next lead costs us money** — and then, per product, whether
we are under or over that line.

---

## 1. The unit is a lead

`src/lib/ad-spend/break-even.ts` is the money math, and it is worth reading in the
original: the file's own comments carry the calibration notes and are the authority.
The shape of it:

A lead is what ad spend buys, so every figure is per lead, weighted by the probability
that a lead reaches the stage where each cost is incurred.

```
revenuePerLead   = deliveryRate × aov
  − cogsPerLead        = deliveryRate × unitsPerDelivered × unitCogs
  − deliveryPerLead    = deliveryRate × deliveryFee
  − returnPerLead      = returnRate   × returnFee
  − packingPerLead     = confirmRate  × packingCost
  − processingPerLead  = confirmRate  × processingCost
= contributionPerLead  ( = cplFloor )
```

`contributionPerLead` and `cplFloor` are the same number exposed twice on purpose: a
P&L reader asks what a lead *earned*, a media buyer asks what a lead *may cost*.

### Three calibrations that are easy to get wrong

1. **`unitsPerDelivered` is required.** COGS is per unit, not per order. Multi-buy
   offers push cohorts above 1.0 routinely; treating it as 1.0 understated COGS by
   **15.4%** on the Libya cohort this module was calibrated against.
2. **`deliveryFee` and `returnFee` must be cohort-weighted blends**, never one carrier's
   rate. In the Tunisia cohort, 141 of 1 099 delivered orders shipped Cosmos at 0.000
   while 958 shipped Navex at 6.000 — assuming either rate is wrong for every order.
   Compute as total cost ÷ delivered orders over the *same* cohort that produced
   `deliveryRate`.
3. **`processingCost` belongs in the floor.** Omitting it quotes a floor *higher* than
   the product can afford — the direction that makes a losing campaign look survivable.

### Nulls are deliberate

`costPerDeliveredFloor` is `null` when nothing delivered (a real mid-dispatch state, not
an error). `roasFloor` is `null` when the floor is **not positive** — a product that
loses money on a free lead has no ad efficiency that rescues it, and printing a ratio
there would invent a target instead of admitting the product is broken before
advertising enters the picture. Render the empty cell; do not coerce to 0.

The module is **pure** — no DB, no async, no Supabase. Rates and fees arrive as plain
numbers because the route handler that already read `settings` and `carriers` is the
only place allowed to know where they came from.

---

## 2. Cohort basis — why it will not tie out to the P&L

Dépenses pub is a **cohort** view: leads are orders *created* in the window, and they
are followed wherever they land. P&L global is **event-windowed**: it counts what
happened in the window.

**These two will not reconcile, and that is correct.** A young window is full of orders
that have not finished; `maturityPct` is exposed so it reads as unfinished rather than
as a bad result. The screenshot's "cohorte du 22 juin — 13 sept., mûre à 92 %" is that
number.

---

## 3. Data model

`ad_spend` is the base table (25 columns), extended by
`20260906000001_ad_spend_meta_sync.sql` rather than replaced: `source`, `ad_account_id`,
`external_campaign_id`, `campaign_name`, `campaign_status`, `amount_original`,
`currency_original`, `fx_rate`, `impressions`, `reach`, `clicks`, `frequency`,
`platform_results`, `synced_at`. `created_by` became nullable (a synced row has no human
author). CHECKs: `ad_spend_amount_non_negative`, `ad_spend_period_ordered`.

Plus `meta_ad_accounts` (15), `ad_sync_runs` (14, ~709 rows). All RLS-enabled.

**Since 2026-09-30 mapping is per ad set, many-to-many and dated.** Meta rows in
`ad_spend` are a projection of `meta_adset_daily` × `ad_spend_mappings`, rewritten
whole by `replace_meta_ad_spend`. `meta_campaign_mappings` is gone. It is all in
**`docs/ad-spend-mapping.md`**: the model, the automatic split, the sync, the
rollout, and why a past day keeps its FX rate.

The economics are computed in the route handler and in pure TS, not in SQL. The only
RPCs are the three service-role ones that the mapping writes through
(`set_ad_spend_mapping`, `replace_meta_ad_spend`, `order_counts_by_product_day`).

**A defensive detail worth keeping:** `/api/ad-spend/economics` asks for
`SPEND_COLUMNS_RICH` and falls back to `SPEND_COLUMNS_BASE`, because PostgREST answers
an unknown column with error 42703 rather than ignoring it. That guard exists so the
page survives a production database that has not taken the migration.

---

## 4. Surfaces

- Page: `src/app/[locale]/(dashboard)/finance/ad-spend/` (`page.tsx` gated by
  `canViewFinanceSection`, + `AdSpendClient.tsx`). Sidebar: Finances → Dépenses pub.
  `/settings/ad-spend` is now only a redirect here.
- Components: `src/components/ad-spend/AdSpendEconomics.tsx` exports `AdSpendChain`,
  `AdSpendCoverageBanner`, `AdSpendCplBars` (CPL vs max payable), `AdSpendCostStack`
  (where one delivered order's revenue goes), `AdSpendProductTable` (per-product
  verdicts), `AdSpendSyncStrip`, `AdSpendUnmappedBanner`; plus `AdSpendEntryModal`,
  `AdSpendCsvImport`, `AdSpendMappingDrawer` (+ `mapping/`: list, detail, editor).
- Mapping API: `/api/meta/mapping` (GET tree, POST save) and `/api/meta/mapping/preview`.
  `/api/meta/campaigns*` was removed on 2026-09-30.
- Lib: `break-even.ts`, `realized-metrics.ts`, `csv-parse.ts`, `period-lock.ts`,
  `enforce-lock.ts` (all tested); `src/lib/meta-ads/` for the API client and sync.
- API: `/api/ad-spend/{,[id],economics,import,sync,sync-status}`, `/api/meta/*`,
  `/api/cron/meta-ads-sync`, `/api/webhooks/meta/[sourceId]`.
- Cron: `meta-ads-sync`, hourly at :07.

---

## 5. Design

The page is **light**, using the `--ads-*` token family — see
`docs/design-system.md` §4.21 for the tokens and their contrast rules.

> `plans/ad-spend-campaign-redesign.md` is **stale and misleading**. It targets the old
> `/settings/ad-spend` route, names six components that were never built
> (`AdSpendRollups`, `AdSpendTimeline`, `AdSpendCampaignCard`, `AdSpendCampaignList` and
> two test files), claims "no `ad_spend` schema change" which `20260906000001`
> contradicts, and sanctions a **dark cinematic palette** against the console rule. Its
> central premise — a 4-card KPI strip of week/month/YTD/cost-per-confirmation — was
> deliberately repudiated by the shipped code, whose header comment says those totals
> "say how much was spent but never whether spending it was a good idea."
>
> **Treat `plans/ad-spend-meta-sync-redesign.md` as the accurate plan**; its data model
> matches the migration one-for-one.
