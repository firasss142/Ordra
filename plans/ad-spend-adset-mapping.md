# Dépenses pub — mapping au niveau ensemble de publicités, plusieurs produits par campagne

> **Status: live since 2026-09-30 23:00 UTC.** The rollout went as follows:
>
> 1. Migrations `20260930225232` and then `20260930230226` were applied around the
>    deploy of `a9cf03d`.
> 2. The first sync (23:07) backfilled 312 ad-set facts since 23 May.
> 3. Reconciliation matched the legacy rows exactly: 253 of 253 campaign-days, and
>    73 148,048 LYD in total, identical per product to the millime.
>
> No campaign has been remapped yet: the relaunch split is the owner's call.
> The reference is now `docs/ad-spend-mapping.md`. Where the build deviated from this
> plan:
>
> 1. **The sync re-projects the whole complete history every run**, not just the
>    window. This makes a remap whose own rebuild failed heal within the hour.
> 2. **The settled investor statement is a warning**, with a "start the day after"
>    button, not a lock. The owner has not answered yet whether it should be a lock.
> 3. **The economics route now counts spend charged to a product with no lead in
>    the window.** It used to drop it from `total_spend`, a pre-existing bug that
>    splits would have made common.
> 4. **A past day keeps its booked FX rate** when ad-set history is re-fetched. That
>    rate comes from its fact, else from the legacy campaign row.

Branch `feat/ad-spend-adset-mapping` (worktree `.claude/worktrees/adset-mapping`), cut from
`origin/main` at `1033900`. Supersedes the mapping sections of
`plans/ad-spend-meta-sync-redesign.md` (§ `meta_campaign_mappings`, "Mapping arity: 1 campaign
= 1 product"). Everything else in that plan stands.

## Why

Mapping today is **one campaign → one product**, written into `meta_campaign_mappings` and
baked into `ad_spend.product_id` at sync time. Two things break that.

1. **A campaign can sell several products.** Real case, read 2026-09-30: *BoxLyLong - relaunch*
   (6 juil. → 10 sept., **16 696 LYD**) is mapped to the **large** boxing doll alone. While it
   ran, the orders were mostly the medium size (11 août: 84 medium, 52 small, 17 large). Split
   by each day's orders (with the trailing-7-day fallback below), it reads **medium 63,2 %
   (10 544) · small 19,7 % (3 295) · large 17,1 % (2 857)**. Today the large doll carries all
   of it: a 112,8 LYD CPL on 146 leads that looks like a disaster, while the medium doll
   looks free. Applied "from 1 Aug" instead of "all history", the small doll's settled
   investor period stays untouched. "All history" moves 227 LYD into it (6 July).
2. **Ad sets are where the structure lives.** The Libya account has 15 campaigns and 25 ad
   sets. Today every ad set belongs to one product: they are creative batches ("batch 1 /
   batch 2") and audience tests ("Vo" vs "Music"). But a CBO campaign with one ad set per
   product is the normal way to launch several products, and the sync cannot see it
   because it reads `level=campaign`.

The reverse direction, one product fed by several campaigns, already works (spend sums) and
stays.

## Decisions (2026-09-30, owner)

| Question | Decision |
|---|---|
| Split rule when a campaign / ad set → several products | **Automatic by orders**, with a **manual % override** per mapping |
| What a change does to recorded spend | **Chosen on each change**: "all history" or "from a date". Mappings are **effective-dated** |
| Where the interface lives | **Wide side drawer** over Finances › Dépenses pub (redesigned, master–detail) |
| Which campaigns are listed | **Full Meta catalogue**, including paused and never-spent campaigns, so a campaign can be mapped before its first dinar |
| Ad set vs campaign | An ad set **inherits** its campaign's mapping unless it has its own (override) |

## Findings that shape the build (read 2026-09-30)

- **"Meta results" are wrong everywhere.** All 15 campaigns are `OUTCOME_SALES`, and the
  storefront pixel fires **Purchase** on a COD order. `extractLeadCount` only reads
  `offsite_conversion.fb_pixel_lead` / `onsite_conversion.lead_grouped`, so it stores stray
  "2"s. Meta's real count for *DA2 batch 2* in September alone is **474 purchases**. Fixed
  here: for `OUTCOME_SALES`, read `offsite_conversion.fb_pixel_purchase`.
- **The product breakdown lists one row per day.** Expanding a product on the ad-spend page
  lists every `ad_spend` row. That is 51 rows for QuranTadabr, each with a "CPL" that divides
  one day's spend by the whole window's leads. It is replaced by a campaign → ad set breakdown.
- **Investor exposure is real.** 3 Libya deals (QuranTadabr, DA2, small boxing doll) each
  have a **settled** statement for 20 mai → 31 juil. Investor accrual reads
  `ad_spend.product_id`, and `investor_deal_statements.restatement_delta` exists. So a
  history-rewriting remap is legal but must say out loud which statements it touches.
- 10 of the relaunch campaign's 40 day-rows had **zero** orders for any of its three
  products. 8 of those had zero spend too, and 2 (9 and 10 Aug) had real spend. The automatic
  split therefore needs a fallback (below).

## Phase 0 — prototype (gate: nothing under `src/` or `supabase/` before approval)

`prototypes/ad-spend-mapping-v1.html`, with real Libya data read 2026-09-30. Presets:
`?lang=fr|ar` and `?screen=`:

| `?screen=` | What it shows |
|---|---|
| `list` | Drawer, filter "À mapper", nothing selected yet: the coverage strip and the tree |
| `split` | *BoxLyLong - relaunch* → 3 sizes, automatic split, "tout l'historique", impact box with the investor warning |
| `manual` | Same campaign, manual percentages, the sum check |
| `adset` | *QuranTadabr*, an ad set with its own override next to inherited siblings |
| `page` | The ad-spend page with a product expanded: campaign → ad set breakdown, share labels, Meta purchases |

## Data model

### Catalogue (new)

```
meta_ad_campaigns (ad_account_id, external_campaign_id) PK
  market_id, name, objective, effective_status, created_time, last_seen_at
meta_ad_sets      (ad_account_id, external_adset_id) PK
  external_campaign_id, market_id, name, effective_status, created_time, last_seen_at
```

Filled every sync run from `/act_X/campaigns` and `/act_X/adsets`. That is two calls against a
60-point budget, which is nothing. Upsert on the PK, which is a total index (no 42P10).
RLS: super_admin SELECT. Writes are service-role only.

### Raw fact (new): `meta_adset_daily`

One row per ad set per day, exactly as Meta reports it. It carries no product. PK
`(ad_account_id, external_adset_id, day)`. Columns: `external_campaign_id`, `market_id`,
`spend_original`, `currency_original`, `fx_rate`, `amount` (market currency, millime-rounded
once), `impressions`, `reach`, `clicks`, `frequency`, `platform_results`, `synced_at`. This
is what makes a remap possible without re-asking Meta, and what the drawer reads for
"how much did this ad set spend".

### Mappings (new, replaces `meta_campaign_mappings`): effective-dated, many-to-many

```
ad_spend_mappings
  id, market_id, ad_account_id, external_campaign_id,
  external_adset_id   NULL = campaign level (the default for every ad set)
  effective_from      DATE NULL = since the beginning
  kind                'products' | 'market_level' | 'inherit'   (inherit: ad set only)
  split_mode          'auto_orders' | 'manual'                  (NULL unless >1 product)
  created_by, created_at, superseded_at, superseded_by
ad_spend_mapping_lines
  mapping_id, product_id, share_pct NUMERIC(5,2) NULL (manual only; the lines sum to 100)
```

- **Insert-only in spirit.** A change never edits a version. "All history" supersedes every
  live version of that target and inserts one with `effective_from NULL`. "From D" supersedes
  live versions with `effective_from >= D` and inserts one at D. Superseded rows stay: the
  drawer shows them as the timeline.
- **Resolution for (ad set, day):** the ad set's own live version in force that day, unless
  its kind is `inherit`. Otherwise the campaign's live version in force that day. Otherwise
  **unmapped**. "In force" = the largest `effective_from <= day`, with NULL lowest.
- One partial unique index on the live versions per (target, effective_from).
- Written only through `set_ad_spend_mapping(...)`, an RPC that supersedes and inserts in
  one transaction. **Service-role EXECUTE only** (REVOKE from PUBLIC, anon, authenticated),
  so `p_actor_id` cannot be borrowed. The route authenticates the actor
  (see the RPC-actor-id and DROP-FUNCTION-grants lessons).
- The 9 existing `meta_campaign_mappings` rows migrate as campaign-level versions with
  `effective_from NULL`. The old table is left in place, unread, and dropped in a later
  migration, because the deployed app reads it until the deploy lands.

### `ad_spend`: meta rows become a projection

`ad_spend` stays the one ledger all six product readers and investor accrual sum by
`product_id`. **None of them change.** For `source = 'meta'`, its rows are now *derived*: one
row per (ad set, day, product share). New columns: `external_adset_id`, `adset_name`,
`allocation_share NUMERIC(7,6)`, `allocation_basis` (`single` | `auto_orders` |
`auto_trailing_7d` | `auto_equal` | `manual` | `market_level` | `unmapped`), `mapping_id`.

Rewritten by `replace_meta_ad_spend(p_ad_account_id, p_since, p_until, p_campaign_ids, p_rows)`,
which does DELETE + INSERT in one transaction, service-role only. Nothing upserts meta rows
any more. So `ad_spend_synced_key` (the old ON CONFLICT arbiter) is replaced by an integrity
index, `UNIQUE (ad_account_id, external_adset_id, period_start, product_id) NULLS NOT DISTINCT
WHERE source = 'meta'`. It is partial and safe, because nothing names it in ON CONFLICT.

## Allocation — `src/lib/ad-spend/allocation.ts` (pure, TDD first)

For each `meta_adset_daily` row:

1. Resolve the version (above). If it is unmapped or market-level, write one row with
   `product_id NULL`. That is market-level spend, never hidden from the P&L, as before.
2. One product → one row, share 1.
3. Manual → shares from `share_pct`.
4. Automatic → weights = **orders created that day** per product. "Day" is cut in the **ad
   account's timezone** so it matches Meta's day. An order counts by `orders.product_id`, all
   statuses, which is the same "lead" definition `/api/ad-spend/economics` uses, so CPL stays
   coherent. **Fallback when every weight is 0:** use the product mix over the trailing 7 days.
   If that is 0 too, split equally. `allocation_basis` records which rule applied.
5. Money: integer millimes with largest remainder, so the parts always sum to the ad set-day
   exactly. `impressions`, `clicks` and `platform_results` split with the same shares
   (integers, largest remainder). `reach` and `frequency` are **NULL on split rows**, because
   they are not divisible.

Order counts come from `order_counts_by_product_day(p_market_id, p_since, p_until, p_tz,
p_product_ids)`, a service-role RPC that runs one GROUP BY instead of paging raw orders.

## Sync (`src/lib/meta-ads/`)

Per account, inside the existing 45 s budget and the `ad_sync_runs` lock:

1. Catalogue: campaigns + ad sets, upserted.
2. Insights at `level=adset`, `time_increment=1`, sliced as today, upserted into
   `meta_adset_daily`. Objective-aware result count (the Purchase fix).
3. Rebuild `ad_spend` for the window: resolve, allocate, `replace_meta_ad_spend`.

A remap rebuilds the affected campaign over the chosen range (all history, or D → today).
There are no Meta calls in that path.

## API

- `GET /api/meta/mapping?market_id&from_date&to_date` → the tree. For each campaign and its
  ad sets: status, objective, spend in the window and lifetime (from `meta_adset_daily`),
  Meta purchases, the version in force today, the version timeline, and the coverage totals
  (attributed / market-level / to map).
- `POST /api/meta/mapping/preview` → the same body as a save. Returns the **impact**:
  spend moved per product (before → after), days touched, and every issued investor
  statement whose period overlaps the rewritten range. No writes.
- `POST /api/meta/mapping` → `set_ad_spend_mapping`, then rebuild. Returns the rows
  rewritten and the same impact block.
- `/api/meta/campaigns` + `/api/meta/campaigns/mappings` are removed once the drawer moves.

All routes: `canViewFinanceSection`, and `market_id` checked against the account's market.

## UI

**Drawer** (`AdSpendMappingDrawer`, rebuilt): wide (≈1120 px, 94vw max), master–detail.
- **Header:** account, currency path (USD → LYD × rate), last sync.
- **Coverage bar:** attributed / market-level / to map, over the page's window.
- **List pane:** search; filters *À mapper · Actives · Toutes*; campaign rows (status dot,
  name, ad-set count, spend, mapping chips). They expand to ad sets, which show *hérite* or
  their override.
- **Detail pane:** identity, daily spend bars, KPIs (spend, Meta purchases, Meta cost per
  purchase), the mapping in force, the editor, and the version timeline.
- **Editor:**
  - Kind (products / market-level / inherit).
  - Product picker with thumbnail, SKU and orders over 30 days.
  - Split: *Automatique* shows the computed shares over the campaign's own spend days;
    *Manuel* offers % inputs, "répartir également", and a live sum check.
  - Scope: *tout l'historique* / *à partir du*.
  - **Impact box** from `/preview`: money moved per product, and any issued statement
    touched, which will show up as a restatement.
  - One *Appliquer* per change, because each change carries its own history decision.
    There is no batch "save 5 changes".

**Page:** the product row expands to campaign → ad set, not days. Each line shows the spend
charged to this product, a share label (`62 % · auto`, `40 % · manuel`), Meta purchases
(shared the same way, marked `≈` when split) and Meta cost per purchase. The unmapped banner
opens the drawer on *À mapper*, and any breakdown line opens the drawer on that campaign.

Design: `docs/design-system.md` + the `--ads-*` family (§4.21). Light surfaces, brand green
for chrome only, amber only for "à mapper", full RTL mirror.

## Rollout — the DB is ahead of the deployed app

The deployed sync upserts on `ad_spend_synced_key` every hour at :07. So:

1. **Migration A (additive):** the catalogue, `meta_adset_daily`, the mapping tables and the
   migrated rows, the new `ad_spend` columns, and the three RPCs. The old index and table are
   untouched, so the deployed app keeps working.
2. **Deploy** the new code.
3. **Backfill:** a manual sync from the earliest meta row (2026-05-23) to today, at ad-set
   level, then a full rebuild.
4. **Reconcile:** for every campaign × day, the sum of the new `ad_spend` rows = the old
   campaign row (± 0.001). Capture the totals **before** step 3.
5. **Migration B (cutover):** drop `ad_spend_synced_key`, create the integrity index, and
   drop `meta_campaign_mappings`.

## Verification

- TDD: `allocation.test.ts` (resolution precedence, effective dating, the three auto rules,
  largest remainder, reach NULL on split rows), `insights.test.ts` (Purchase for
  OUTCOME_SALES), route tests for mapping GET/POST/preview, component tests for the drawer
  (filter, inherit, manual sum < 100 blocks Apply, scope choice).
- SQL tests in `supabase/tests/`: the resolution precedence, the supersede semantics, and
  the RPC grants (anon and authenticated cannot EXECUTE).
- `npm run typecheck`, targeted `vitest`. `npm run lint` is unconfigured, so it is never
  claimed.
- A JWT-level check that `authenticated` cannot call the three RPCs.
- A browser pass FR + AR on the drawer and the page. The step-4 reconciliation on prod
  data after the deploy.

## Out of scope

- Ad-level (creative) mapping.
- Click-level attribution (UTM / fbclid into orders). This is still the only real fix and
  is still not started.
- TikTok / Google.
- Mapping to a product **variant** (size). The sizes are still separate products today, see
  `plans/product-variants.md`.
