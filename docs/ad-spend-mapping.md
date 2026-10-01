# Ad spend mapping: ad sets, several products, dated history

Since 2026-09-30, Meta spend is synced **per ad set per day**, and a campaign or an
ad set can be attributed to **one or several products**. Every change says whether it
rewrites **all history** or applies **from a date**.

- Plan: `plans/ad-spend-adset-mapping.md`
- Prototype (the design source of truth): `prototypes/ad-spend-mapping-v1.html`
- Surrounding context (the break-even math, the cohort basis, the Meta sync): `docs/ad-spend.md`

---

## 1. Why

- **A campaign can sell several products.** "BoxLyLong - relaunch" (16 696 LYD) was
  mapped to the large boxing doll alone, yet it sold mostly the medium size. The
  large doll showed a 112,8 LYD CPL on 146 leads; split by that day's orders, it is
  about 19,6.
- **The structure lives in ad sets.** A CBO campaign with one ad set per product is
  the usual way to launch several products, and a campaign-level sync cannot see it.
- **A remap moves money between investors.** Three Libya products have settled
  statements. A silent rewrite of history would contradict them.

---

## 2. The model

```text
meta_ad_campaigns / meta_ad_sets   catalogue, incl. never-spent (mappable before the first dinar)
meta_adset_daily                   RAW FACT: one ad set × one day, no product
ad_spend_mappings (+ _lines)       mapping VERSIONS: target, effective_from, kind, split
          │
          ▼  lib/ad-spend/allocation.ts (pure)  +  lib/meta-ads/rebuild.ts
ad_spend (source = 'meta')         PROJECTION: one row per (ad set, day, product share)
```

`ad_spend` stays the ledger that the six product readers and investor accrual sum by
`product_id`. **None of them changed.** For `source = 'meta'` its rows are *derived*:
they are rewritten whole by `replace_meta_ad_spend` (DELETE + INSERT, one
transaction). Never edit them by hand, because the next sync replaces them.

**The target.** A version targets a campaign (`external_adset_id` NULL) or one ad set.

**The kind.** It is one of three:

- `products`: with lines, and a `split_mode` when there is more than one product.
- `market_level`: deliberately no product.
- `inherit`: an ad set going back to following its campaign.

**Resolution for (ad set, day).**

1. The ad set's own version in force that day, unless its kind is `inherit`.
2. Otherwise the campaign's version in force that day.
3. Otherwise the spend is **unmapped** and counts as market-level spend.

"In force" means the latest `effective_from ≤ day`, with NULL as the earliest.

**Versions are history.** A change never edits a version:

- "All history" supersedes every live version of the target.
- "From D" supersedes only the versions that start on or after D.

A trigger forbids UPDATE (except marking superseded, once) and DELETE on both tables.

**The split.** Three rules, in order:

- A single product carries 100 %.
- *Manual*: fixed `share_pct` values that sum to 100.
- *Automatic*: weights are the **orders created that day** per product, and a day is
  cut in the **ad account's timezone** (Libya's account runs on Africa/Tunis, not
  Tripoli). A day with no order for any of the products uses the mix of the 7 days
  before it. Eight silent days in a row fall back to equal parts.

`allocation_basis` records which rule produced each row. Money is split in integer
millimes with largest remainder, so the parts always add back to the ad set-day.
Split rows carry no reach and no frequency, because those count people and cannot be
divided.

**Meta "results" are purchases for Sales campaigns.** Every Libya campaign is
`OUTCOME_SALES`, and the storefront pixel fires Purchase. Until 2026-09-30 the sync
read *lead* actions and stored 1–2 where Meta reported hundreds.

---

## 3. The sync (`lib/meta-ads/sync.ts`)

Each account runs through these steps, inside the existing lock and 45 s budget:

1. **Catalogue.** Every campaign and ad set is upserted.
2. **Facts.** Ad-set insights over the window are upserted into `meta_adset_daily`,
   stamped with the run time.
3. **Stale facts.** Any fact older than that stamp in the re-fetched range is
   deleted: Meta stopped reporting it.
4. **Projection.** It runs over **the whole complete history**
   (`meta_ad_accounts.adset_history_from` → the end of the window), not just the
   window. That is what heals a remap whose own rebuild failed after the mapping was
   saved. Scale: a few thousand rows.

Rules the sync keeps:

- **A past day keeps its booked FX rate.** Only days inside the rolling 7-day window
  take today's rate. An older day reuses the rate already on its fact, or on the
  legacy campaign-level row.
- **`adset_history_from`.** It is set by the first clean run that reaches today. That
  first run backfills from the earliest synced day. A history rewrite (`clampToHistory`)
  never reaches before this date, because rewriting a day whose facts were never
  fetched would delete its row and replace it with nothing.

---

## 4. API and UI

| Route | What it does |
|---|---|
| `GET /api/meta/mapping` | The tree: catalogue, spend, the version in force, history, coverage, products with 30-day orders |
| `POST /api/meta/mapping/preview` | Money moved per product, the target's own split with the orders behind it, and issued investor statements whose period it rewrites. Writes nothing |
| `POST /api/meta/mapping` | `set_ad_spend_mapping`, then a rebuild of the previewed range. `pending_rebuild: true` = saved, and the amounts follow at the next sync |

All three are super_admin only (`canViewFinanceSection`). The three RPCs are
**service-role EXECUTE only**, and `p_actor_id` is recorded, never trusted.

**Drawer** (`components/ad-spend/AdSpendMappingDrawer.tsx` + `mapping/`):

- Master–detail layout.
- Filters: *À mapper* / *Actives* / *Toutes*.
- The detail pane shows the node's KPIs, the daily bars, what it sells today, its ad
  sets and the version timeline.
- The editor has three steps (what, how it splits, from when), a live impact box, and
  one Apply per change.
- A **settled** investor statement in the range is flagged, with a "start the day
  after" button. It is a warning, not a lock: `investor_deal_statements.restatement_delta`
  exists for exactly this.

**Page:** a product's breakdown lists campaigns → ad sets, with the share of the
campaign it carries (`64 % · auto`), Meta purchases (`≈` when split) and cost per
purchase. It no longer lists one row per day.

---

## 5. Rollout

**Done on 2026-09-30.**

- Migration A (`20260930225232`) went in, then the deploy of `a9cf03d`, then
  migration B (`20260930230226`).
- The first sync (23:07 UTC) backfilled 312 facts (15 campaigns, 25 ad sets) and
  projected 257 rows.
- Reconciliation against a snapshot of the legacy rows was **exact**: 253 of 253
  campaign-days, 73 148,048 LYD before and after, identical per product.

The order below is kept as the record of why it had to be done this way.

1. `20260930225232_ad_spend_adset_mapping.sql` is **additive**. The deployed app is
   unaffected.
2. Deploy the new code.
3. `20260930230226_ad_spend_adset_cutover.sql` drops `ad_spend_synced_key` (the old
   ON CONFLICT arbiter) and `meta_campaign_mappings`.

   **Apply it right after the deploy.** Until it lands, a rebuild fails *atomically*
   whenever a campaign has two ad sets or a split on the same day. The old rows stay,
   and the run is logged as failed.
4. The first sync backfills ad-set facts since the first synced day and re-projects
   everything.
5. **Reconcile:** for every campaign × day, the new `ad_spend` sum must equal the old
   one, within ± 0,001 per ad set for per-row rounding, plus whatever Meta has
   restated since.

---

## 6. Tests

- Vitest:
  - `lib/ad-spend/__tests__/allocation.test.ts`
  - `mapping-view.test.ts`
  - `lib/meta-ads/__tests__/{rebuild,sync,mapping,insights,client}.test.ts`
  - `app/api/meta/mapping/route.test.ts`
  - `components/ad-spend/mapping/__tests__/AdSpendMappingDrawer.test.tsx`
  - `components/ad-spend/__tests__/AdSpendProductTable.test.tsx`
  - the economics route tests
  - `messages/__tests__/ad-spend-mapping-parity.test.ts`
- SQL, local only: `supabase/tests/ad_spend_mapping_test.sql`. It covers the grants,
  the supersede rules, the history guards, the atomic replace and the timezone cut.
