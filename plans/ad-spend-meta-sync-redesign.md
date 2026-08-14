# Ad Spend → Acquisition Console, with live Meta Ads sync

> Durable copy to save at `Ordra/plans/ad-spend-meta-sync-redesign.md` per the global plan-storage rule.

## Context

`/finance/ad-spend` is today a **manual data-entry screen wearing a dashboard's clothes**. Someone opens Meta Ads Manager, reads a number, and types it into a form as a date-range row. Production proves nobody sustains that: the `ad_spend` table holds **9 rows total** across the entire life of the system — 3 of them soft-deleted, 2 of them literally named "E2E Test Product" — against **7,137 real orders** and ~157k TND/LYD of delivered revenue. Every ROAS, CPA and margin figure downstream (P&L, product margins, investor settlements) is therefore computed against a cost line that is essentially empty. The finance section is confidently reporting profit it has not verified.

The fix is not a nicer form. It is **removing the human from the ingest path**: connect the OMS to Meta Marketing API, pull campaign-level spend and delivery metrics every hour, map campaigns to products once, and rebuild the page around the question the manual page never answered — *is this campaign making or losing money, and how do I know before the delivery data catches up?*

That last clause is the hard part and it is specific to COD. Spend leaves the account today; leads arrive today; **delivery — the moment revenue is real — lands 7–15 days later**. Libya's data shows exactly this: 156 leads on 11 Aug, 44 confirmed, 12 delivered so far. A page that only shows ROAS on delivered revenue is always reporting on decisions made two weeks ago. A page that only shows CPL is flying blind on whether those leads convert. The redesign shows **both, side by side, clearly labelled** — a live layer that is actionable today and a cohort layer that is truthful once matured.

## What exists today

**Page** — [page.tsx](Ordra/src/app/[locale]/(dashboard)/finance/ad-spend/page.tsx) (21-line server gate, `canViewFinanceSection` = super_admin only) → [AdSpendClient.tsx](Ordra/src/app/[locale]/(dashboard)/finance/ad-spend/AdSpendClient.tsx) (374-line client shell, all state + CRUD). Fixed 12-week window. Renders a prompt and nothing else when market scope is `all`.

**Components** — `src/components/ad-spend/`: `AdSpendRollups` (4 KPI cards), `AdSpendTimeline` (Recharts stacked area, dynamic `ssr:false`), `AdSpendCampaignList` + `AdSpendCampaignCard` (288 lines), `AdSpendEntryModal`, `AdSpendCsvImport` (397-line 3-step modal), `theme.ts`. All inline-styled, **zero tests**, and they ignore the shared `src/components/finance/` kit (`FinanceHeroCard`, `FinanceKpiCard`, `FinancePanel`, `FinanceSparkline`, `FinanceFunnel`, `CostCompositionBars`) that every other finance page uses.

**API** — `src/app/api/ad-spend/{route,[id]/route,import/route}.ts`. No server actions anywhere in this repo; everything is REST + SWR.

**Math** — [realized-metrics.ts](Ordra/src/lib/ad-spend/realized-metrics.ts) (ROAS, cost-per-confirmation, weekly timeline, rollups), [acquisition.ts](Ordra/src/lib/calculations/acquisition.ts) (CPA/CPL), [ad-spend-allocation.ts](Ordra/src/lib/calculations/ad-spend-allocation.ts) (market-wide → per-product pro-rata, integer millimes, largest-remainder — **keep this, it's correct**), [period-lock.ts](Ordra/src/lib/ad-spend/period-lock.ts) + [enforce-lock.ts](Ordra/src/lib/ad-spend/enforce-lock.ts).

**Schema** — `ad_spend(id, market_id, product_id, amount, period_start, period_end, note, created_by, created_at, updated_at, is_active)`. No campaign identity, no platform, no currency, no unique key. One index: `(market_id, period_start, period_end)`.

### The blocking constraint

**Orders carry no ad attribution.** Verified across all 7,137 rows: zero `utm_*`, zero `fbclid`, zero campaign IDs in `orders.raw_payload` for both `converty` (6,091) and `easy_orders` (1,009). There is no click-level join between a Meta ad and an OMS order, and building one means changing the storefront platforms, which is out of scope. **Attribution is therefore campaign → product, declared once by a human, and every metric in this design respects that limit.**

### Bugs to fix in passing

1. `campaign_name` is parsed by [csv-parse.ts](Ordra/src/lib/ad-spend/csv-parse.ts), sent by the import client, and **silently dropped** by [import/route.ts](Ordra/src/app/api/ad-spend/import/route.ts) — campaign identity has never been persisted.
2. `PATCH /api/ad-spend/[id]` destructures only `{amount, note, period_start, period_end}` — **reassigning an entry's product does nothing while the UI reports success** ([\[id\]/route.ts:69](Ordra/src/app/api/ad-spend/[id]/route.ts#L69)).
3. CSV import never sends `x-confirm-locked-period`, so locked-period rows are always rejected, even for super_admin.
4. `overlay=metrics` nested-loops entries × order_history in Node, unpaginated — subject to PostgREST's 1000-row cap, so long periods **silently under-count**.
5. Invisible "Analyser" button in `AdSpendCsvImport.tsx:282` — `#000` text on `#1A1A1A` fill.
6. Dead `initialMarketId` prop; `docs/database-schema.md` missing `is_active`.

### Unrelated, urgent

`Ordra/.env.local.example` contains what appear to be **real** Supabase anon + service_role JWTs and a real `ENCRYPTION_KEY`. If that file is in git history, rotate all three. Not part of this work — raised because it was found.

---

---

## ⛔ Blockers found by adversarial verification — fix before writing the migration

32 challenges raised across four independent lenses, each then attacked by a skeptic that had to reproduce the evidence; **15 survived**. These six would have caused real damage.

**B1 — Read-time mapping join breaks every product-scoped consumer.** The design below says mapping is applied at read time, not baked into `ad_spend.product_id`. But **six read paths key directly off `ad_spend.product_id`** and none can see `meta_campaign_mappings`: [products/metrics.ts:193](Ordra/src/lib/products/metrics.ts#L193), [products/[id]/profitability/route.ts:63](Ordra/src/app/api/products/[id]/profitability/route.ts#L63), [profitability/product/[productId]/route.ts:117](Ordra/src/app/api/profitability/product/[productId]/route.ts#L117), [investors/load-rollup.ts:58](Ordra/src/lib/investors/load-rollup.ts#L58), [settlements/route.ts:183](Ordra/src/app/api/admin/investments/settlements/route.ts#L183), [ad-spend/route.ts:55](Ordra/src/app/api/ad-spend/route.ts#L55). Synced rows carry `product_id` NULL → per-product spend goes to **zero**, and settlements sweep 100% of synced spend into `marketWideAdSpend`, which redistributes it revenue-pro-rata — **silently replacing human-declared attribution inside investor payouts**.
→ **Bake `product_id` at write time and re-stamp on remap** (one UPDATE keyed on `ad_account_id + external_campaign_id` — still retroactive), or add an `ad_spend_resolved` view and repoint all six. The five dashboard RPCs need no change.

**B2 — `ON CONFLICT` cannot target a partial unique index; the first sync fails `42P10`.** PostgREST emits column names only. **This repo already fixed this exact bug once** — [20260812141346_sheet_sync_failed_rows_upsertable_key.sql](Ordra/supabase/migrations/20260812141346_sheet_sync_failed_rows_upsertable_key.sql). Reproduced live against this DB. A rolling 7-day re-sync at 24 runs/day against a never-deduping key inflates spend ~168× per window.
→ **Drop the `WHERE source <> 'manual'` clause** (safe: manual rows keep NULL `ad_account_id`/`external_campaign_id`, PG 17.6 defaults to NULLS DISTINCT). Do **not** use `NULLS NOT DISTINCT` — production already has 4 manual rows sharing `period_start = 2026-07-01`, so the index would fail to create.

**B3 — `ad_spend.created_by` is NOT NULL with an FK to `users(id)`; every machine INSERT fails `23502`.** A cron has no human creator.
→ `ALTER COLUMN created_by DROP NOT NULL`. Verified zero readers depend on it. Do **not** seed a system user: `public.users.id` FKs to `auth.users(id)` and `role` has no `system` value.

**B4 — Five `ad_spend` selects are unpaginated and silently truncate at 1000 rows.** At campaign×day, 10 campaigns cross 1000 rows in ~100 days. Truncation understates spend → **overstates net profit and every investor share**. Only `metrics.ts` already uses `fetchAllRows`.
→ Wrap all five in [fetchAllRows](Ordra/src/lib/supabase/fetch-all.ts), or replace with a SQL `SUM` RPC.

**B5 — COGS is `unit_cogs × quantity`, not per order.** Verified: 1,269 units across 1,099 delivered orders (avg 1.1547). The plan took revenue empirically (AOV already embeds units/order) while treating COGS as one unit per order — an asymmetry that understates COGS by 15.4%.
→ Add `unitsPerDelivered` to `computeBreakEven`'s signature.

**B6 — The break-even floors were wrong. Do not freeze 1.54 / 18.34 as a test fixture.** Corrected from production: revenue 2,829.00, COGS 625.43, delivery 283.29 (blended — **141 of 1,099 delivered shipped Cosmos at 0.000, not Navex at 6.000**), returns 59.93, packing 72.55, Converty 15.42 → contribution 1,772.38.
→ **CPL floor 17.72 · cost-per-delivered floor 32.72 · ROAS floor 1.596.** The old 1.54 was 3.4% optimistic — the exact direction that makes a losing campaign look like a winner.

### Also surfaced, worth acting on

- **The "Profit net" dashboard tile does not subtract ad spend.** [health.ts:390](Ordra/src/lib/dashboard/health.ts#L390) reads `adSpendAmount` and passes it through at 409 but `margin()` never deducts it. The tile labelled *Profit net* is gross margin, and its hint lists four costs while omitting pub. Pre-existing; daily rows make it worse.
- **Cohort vs event-window basis.** This plan's table is cohort-based (orders *created* in window); every production surface is event-window-based. Live Biovera 1 Mar–15 Apr shows delivered = **664**, not 1,099. Both are correct — they answer different questions — which is exactly why the page ships two clocks. Name the basis on every figure.
- **`ad_sync_runs` needs `reapStaleRuns()`**, not just the lock index — otherwise one process kill deadlocks the sync forever ([sync-runs.ts:164](Ordra/src/lib/google-sheets/sync-runs.ts#L164)).
- **`amount` is dinars at 3dp, not integer millimes.** Use `fromMillimes(Math.round(toMillimes(amount_original) * fx_rate))`.
- **Index should be `(product_id, period_start, period_end) WHERE is_active`** — the bare `(product_id)` doesn't cover the actual predicates.
- **Every Meta metric field is a numeric string**, not just `spend`. Parse at the boundary or `"12"+"34"="1234"`. Keep `campaign_id` as **text** — Meta IDs exceed `Number.MAX_SAFE_INTEGER`.

---

## Decisions locked

| Question | Decision |
|---|---|
| Ad accounts | One per market (TN, LY) |
| Auth | **System User token** — Business Manager, `ads_read`, non-expiring, no OAuth flow, no App Review |
| Attribution | **Manual mapping UI** — campaign → market + product, assigned once |
| Granularity | **Campaign × day** |
| Time basis | **Both** — live CPL/CPC + cohort ROAS, side by side |
| Currency | Both accounts bill **USD** → convert to TND/LYD |
| FX | **Manual rate in `settings`**, rate stored on each row at sync time |
| Metrics pulled | spend, impressions, reach, CPM, frequency, clicks, CTR, CPC, **Meta-reported results/leads** |
| Page leads with | **Money-in vs money-out** hero |
| Sync | **Hourly, rolling 7-day re-sync**, idempotent upsert |
| Unmapped spend | Counts as **market-level** (like today's `product_id IS NULL`) — never hidden from P&L |
| Mapping arity | **1 campaign = 1 product**; many campaigns may share a product |
| Targets | **Computed break-even floor + optional manual goal** |
| Also keep | Manual entries, CSV import, multi-platform schema (TikTok/Google ready), sync health surface |
| Prototype | **French / Tunisia layout, LTR** |

Not selected, noted: campaign status/objective. It arrives free in the same Insights call — I'll store `campaign_status` but not surface it, so turning it on later is a UI change only.

---

## Deliverable 1 — HTML prototype (before any migration)

`Ordra/prototypes/ad-spend-v1.html`, standalone, following the house convention (`stock-v2.html`, `products-ui-v5.html`): single file, Inter + Noto Sans Arabic from Google Fonts, CSS custom properties mirroring [design-system.md](Ordra/docs/design-system.md) tokens, `max-width:1520px`, `tabular-nums` on every figure, logical properties throughout, no build step.

**Populated with real production figures**, not lorem. Tunisia / Biovera, 1 Mar – 15 Apr 2026, which is the densest real window:

| Real figure | Value |
|---|---|
| Leads | 2,029 |
| Confirmed | 1,422 (70.1%) |
| Delivered | 1,099 (54.2% of leads) |
| Returned | 304 (15.0% of leads) |
| AOV delivered | 52.23 TND |
| Delivered revenue | 57,401 TND |
| `unit_cogs` / `packing_cost` | 10.000 / 1.000 TND |
| Navex `delivery_fee` / `return_fee` | 6.000 / 4.000 TND |

Ad spend figures are modelled (there is no real Meta data yet) but **derived from those rates**, so every ratio on the page is internally consistent and the break-even lines are the real ones.

### The break-even math, computed from the above

Per 100 leads at Biovera's actual rates — **corrected per B5/B6**, re-derived from production:

```
Revenue      54.2 delivered × 52.23              = 2 829.00 TND
COGS         62.54 units × 10.000                =   625.43   ← × quantity (1.1547 units/order), not per order
Delivery     blended 5.230/delivered             =   283.29   ← 958 Navex @6.000 + 141 Cosmos @0.000
Returns      15.0 × 4.000                        =    59.93
Packing      72.55 confirmed × 1.000             =    72.55
Converty (storefront fee)                        =    15.42
                                                   ─────────
Non-ad costs                                     = 1 056.62
Contribution before ad spend                     = 1 772.38
```

- **Break-even CPL = 17.72 TND** — above this, every lead loses money
- **Break-even cost per delivered = 32.72 TND**
- **Break-even ROAS = 2 829.00 / 1 772.38 = 1.596×**

That 1.60× is the number the page draws as a red line. It matters that it is *not* 1.0 — a campaign at ROAS 1.3 looks profitable to anyone reading Meta's own dashboard and is in fact burning money. Surfacing this is the single highest-value thing the redesign does.

> The earlier draft said 1.54× / 18.34. It was 3.4% optimistic — the exact direction that makes a losing campaign look like a winner. Two input errors (COGS ignoring quantity, delivery assuming Navex for all carriers) cancelled partway and hid each other. **Recompute the fixture from the DB; never hand-write these.**

### Prototype sections

1. **Hero — money in vs money out.** Four figures on one flat white card: ad spend (with `↻ synced 14 min ago` and the USD original in a sub-line), delivered revenue, **net contribution after all costs including ad spend**, and blended ROAS shown against the 1.54× break-even as a horizontal gauge — green above, red below. Coverage warning (`ad spend covers 12 of 46 days`) reusing the existing `days_covered` pattern from the dashboard health RPCs.
2. **Two-clock row.** Explicitly labelled and separated, because conflating them is the mistake the page exists to prevent:
   - *Live (today)* — spend, leads, CPL vs break-even CPL, cost per confirmation, confirmation rate.
   - *Cohort (matured)* — for orders **created** in the window: delivered revenue to date, cohort ROAS, cost per delivered, and a **maturity bar** (`68% of this cohort has reached a terminal status`) so a low number reads as "not finished yet" rather than "bad".
3. **Spend vs outcome chart.** One Recharts-shaped composed chart: daily spend as bars, leads as a line on a second axis, delivered revenue as a faint area. Break-even CPL as a dashed reference line. Neutral `--chart-line #8C9196` for axes per the design system; status hues reserved for the break-even line only.
4. **Campaign table.** One row per Meta campaign: name, mapped product (or an amber **Non mappé** chip), spend, impressions/CPM/frequency, clicks/CTR, Meta-reported results vs **OMS leads actually received** — the delta column is the lead-leakage signal — CPL vs target, cohort ROAS, and a maturity dot. Sortable, with the worst-CPL campaigns surfacing.
5. **Unmapped banner.** Persistent, dismissible-per-session: `3 campagnes · 4 210 TND non attribuées à un produit` → opens the mapping drawer.
6. **Mapping drawer.** Campaign → product assignment, one select per campaign, modelled on the existing `/mappings` UI. Shows recent spend so you can tell which campaign is which.
7. **Sync health strip.** Last run, rows written, next run, per-account status, last error. A silent sync failure must not read as "you spent nothing".
8. **CRUD affordances.** `Nouvelle dépense manuelle` (for influencers/offline), `Importer CSV`, row edit/delete. **Synced rows are visually read-only** — a lock glyph and a disabled edit button — since the next sync would overwrite an edit anyway.

I'll produce the prototype, screenshot it, and hand it over **before** writing a single migration.

---

## Deliverable 2 — Data model

New migration under `Ordra/supabase/migrations/`, timestamp-named per convention.

### `ad_spend` — extend, don't replace

Additive only; every existing row and every downstream consumer keeps working.

```sql
ALTER TABLE ad_spend
  ADD COLUMN source               TEXT NOT NULL DEFAULT 'manual',   -- manual | meta | tiktok | google | csv
  ADD COLUMN ad_account_id        TEXT,
  ADD COLUMN external_campaign_id TEXT,
  ADD COLUMN campaign_name        TEXT,
  ADD COLUMN campaign_status      TEXT,
  ADD COLUMN amount_original      NUMERIC(14,4),   -- as billed by Meta
  ADD COLUMN currency_original    TEXT,            -- 'USD'
  ADD COLUMN fx_rate              NUMERIC(12,6),   -- rate used at sync time
  ADD COLUMN impressions          BIGINT,
  ADD COLUMN reach                BIGINT,          -- DAILY ONLY — never SUM() across rows
  ADD COLUMN clicks               BIGINT,
  ADD COLUMN frequency            NUMERIC(8,4),    -- DAILY ONLY — derived, never AVG() across rows
  ADD COLUMN platform_results     INTEGER,         -- Meta-reported conversions
  ADD COLUMN synced_at            TIMESTAMPTZ;

COMMENT ON COLUMN ad_spend.reach IS
  'Daily unique people, from Meta time_increment=1. NOT additive: each person is attributed to one day, so SUM(reach) over-counts. For a period figure, query Meta un-incremented.';
COMMENT ON COLUMN ad_spend.frequency IS
  'Daily impressions/reach from Meta. NOT averageable across days; recompute from a period-level reach if needed.';

-- B3: a cron has no human creator
ALTER TABLE ad_spend ALTER COLUMN created_by DROP NOT NULL;

-- idempotent re-sync: one row per campaign per day per source.
-- B2: NO partial WHERE — PostgREST's on_conflict= emits column names only and
-- cannot infer a partial index (42P10). Manual rows keep NULL ad_account_id /
-- external_campaign_id and PG 17.6 defaults to NULLS DISTINCT, so they never collide.
CREATE UNIQUE INDEX ad_spend_synced_key
  ON ad_spend (source, ad_account_id, external_campaign_id, period_start);

-- B4/minor: covers the actual product-scoped predicates, which all range on both period cols
CREATE INDEX ad_spend_product_idx
  ON ad_spend (product_id, period_start, period_end) WHERE is_active;

-- integrity the table never had
ALTER TABLE ad_spend
  ADD CONSTRAINT ad_spend_amount_positive CHECK (amount >= 0),
  ADD CONSTRAINT ad_spend_period_ordered  CHECK (period_start <= period_end);
```

`amount` stays the market-currency converted value in `NUMERIC(10,3)` millimes, so **every existing consumer** — [load-summary.ts](Ordra/src/lib/profitability/load-summary.ts), [products/metrics.ts](Ordra/src/lib/products/metrics.ts), the `get_profitability_summary` RPC, the five dashboard-health RPCs, investor settlement — reads correct numbers with no change. `amount_original` + `fx_rate` preserve the audit trail. Synced rows are daily (`period_start = period_end`), which the existing overlap predicates already handle.

> One thing to verify during build: `aggregateWeeklyTimeline` buckets an entry entirely into its `period_start`'s Monday. Correct for daily rows, but it will now receive ~30× more of them. Confirm the weekly rollup still reads right, and that `computeRollups` isn't quadratic at that volume.

### `meta_ad_accounts` — credentials

Modelled on `dexpress_sessions`: RLS enabled with **zero policies**, `REVOKE ALL FROM authenticated, anon`, service-role only. Token encrypted with the existing [crypto.ts](Ordra/src/lib/crypto.ts) AES-256-CBC helper, same as `carriers.api_credentials`.

```sql
CREATE TABLE meta_ad_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       UUID NOT NULL REFERENCES markets(id),
  ad_account_id   TEXT NOT NULL UNIQUE,   -- 'act_XXXXXXXXX'
  business_id     TEXT,
  account_name    TEXT,
  account_currency TEXT NOT NULL DEFAULT 'USD',
  account_timezone TEXT,                  -- Meta 'timezone_name'; day boundaries are reported in THIS zone
  graph_version   TEXT NOT NULL DEFAULT 'v26.0',
  token_expires_at TIMESTAMPTZ,           -- NULL = non-expiring system user token
  access_token    TEXT NOT NULL,          -- encrypt()'d System User token
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_synced_at  TIMESTAMPTZ,
  last_sync_error TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `meta_campaign_mappings` — campaign → product

Shaped directly on [storefront_product_mappings](Ordra/supabase/migrations/20260624000001_storefront_product_mappings.sql), which is the established pattern for exactly this problem.

```sql
CREATE TABLE meta_campaign_mappings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id        TEXT NOT NULL,
  external_campaign_id TEXT NOT NULL,
  campaign_name        TEXT,
  market_id            UUID NOT NULL REFERENCES markets(id),
  product_id           UUID REFERENCES products(id) ON DELETE RESTRICT,  -- NULL = deliberately market-level
  mapped_by            UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ad_account_id, external_campaign_id)
);
```

Mapping is applied **at read time via join, not baked into `ad_spend.product_id` at write time** — so remapping a campaign retroactively corrects history instead of only affecting future syncs. Unmapped ⇒ resolves to `NULL` product ⇒ counts as market-level spend, per the locked decision.

### `ad_sync_runs` — observability

Copy [sheet_sync_runs](Ordra/supabase/migrations/20260902000001_sheet_sync_observability.sql) wholesale, including the **unique partial index on `(ad_account_id) WHERE status='running'` used as a concurrency lock** — `startRun` returns `null` on Postgres `23505`. That pattern is already proven here; reuse it rather than inventing locking.

### FX rate

`settings` row per market, key `ad_spend_fx_rates`, value `{"USD": 3.05}`. Plaintext JSONB, same as `google_sheets_sources`. Read at sync time, **stamped onto each row** so historical figures never shift when the rate changes.

---

## Deliverable 3 — Meta sync

### Client

`src/lib/meta-ads/client.ts` — thin Graph API wrapper, following the house external-call convention (`fetch` + `AbortSignal.timeout(15000)`, JSON-with-text-fallback) as in [darb-assabil-adapter.ts:580](Ordra/src/lib/carriers/darb-assabil-adapter.ts#L580).

**Pin `v26.0`** — released 29 July 2026, the current version. (Not v21.0, which an earlier draft of this plan had: it expires 21 Jan 2027. v23.0 already reached EOL on 9 June 2026 and **v24.0 is the minimum supported version**.)

```
GET /v26.0/act_{ad_account_id}/insights
  ?level=campaign
  &time_increment=1
  &time_range={"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}
  &fields=campaign_id,campaign_name,spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions,account_currency,date_start,date_stop
  &limit=200
```

All field names verified against the campaign-level Insights reference. `time_increment` accepts an integer `1–90` or `"monthly"`, so `1` is valid.

**Do not pass `action_attribution_windows` with view windows.** The Ads Insights API **removed 7-day and 28-day view attribution windows on 12 January 2026**, and the removed windows *silently return no data* rather than erroring — precisely the failure that makes a report quietly zero out. Leave it at the default (`7d_click`, `1d_view`).

`spend` is returned as a **string** in the account's currency — parse to `NUMERIC(14,4)`, then `amount = round(amount_original × fx_rate)` in integer millimes using the existing [math.ts](Ordra/src/lib/calculations/math.ts) discipline, **not** `realized-metrics.ts`'s float `round2`.

Leads come from `actions[]`, which is an array of `{action_type, value}`. Normalise in one place; `offsite_conversion.fb_pixel_lead` (pixel/website leads) and `onsite_conversion.lead_grouped` (on-Meta lead forms) both exist and both can appear for the same campaign, so **pick one by campaign objective rather than summing** — summing double-counts.

> ⚠️ **`reach` and `frequency` are not summable across daily rows.** With `time_increment=1` each unique person is attributed to a single day, so adding daily `reach` over a period over-counts unique people. `frequency` is `impressions ÷ reach`, so averaging daily values is equally wrong. Store them per day for day-level display, and if a **period** reach/frequency figure is ever needed, fetch it with a second un-incremented call. The prototype must not show a summed reach.

Handle cursor pagination (`paging.next`). Error envelope, verified:
- **`4`** — Business-Use-Case throttle (the main one). Also `17`, `613`, `80000+` for throttling variants.
- **`100` / subcode `1487534`** — too much data per call → narrow the window and retry.
- **`4` / subcode `1504022`** — global load shedding → back off.
- **`190`** — token invalid/expired.

Throttle errors back off and resume on the next run rather than failing it. `190` writes `last_sync_error` and surfaces in the sync-health strip immediately, because an invalid token silently zeroes ROAS.

Read the **`x-fb-ads-insights-throttle`** response header (*not* `X-Business-Use-Case-Usage`, which is the generic Graph header) — it carries `app_id_util_pct`, `acc_id_util_pct`, and `ads_api_access_tier`. Log `acc_id_util_pct` to `ad_sync_runs` and pause when it approaches 100.

### Rate limits — we do not need App Review

Two different things are both called "access", and conflating them is the classic mistake:

| | What it governs | Our status |
|---|---|---|
| **`ads_read` Standard Access** | *Permission* to read insights | Auto-granted to Business-type apps. Sufficient because we only touch **our own** ad accounts. **No App Review.** |
| **Marketing API Development tier** | *Rate limit* quota | Where every new app starts. Max score **60**, decay 300s, 300s block. Reads cost **1 point**. |

Advanced/Full Access would need App Review *plus* 500 successful calls in 15 days *plus* <15% error rate. **We don't need it.** Our sync is 2 accounts × ~1–2 calls per run, hourly ≈ **4 calls/hour** against a 60-point-per-5-minute budget. That is roughly two orders of magnitude of headroom, and it stays true even if campaign counts grow.

This is worth stating plainly because "Development tier / for development only" reads alarming in Meta's docs and invites over-engineering. At this volume it is simply fine.

### Cron — pg_cron, not Vercel

**Vercel Hobby caps crons at once per day**, and a sub-daily `crons` entry causes config-validation rejection of *every deployment* — documented in [notifications-cron.md](Ordra/docs/notifications-cron.md) and the reason all five live jobs run in pg_cron. Follow the [google-sheets pattern](Ordra/supabase/migrations/20260520000002_pg_cron_google_sheets_sync.sql) exactly:

```sql
CREATE OR REPLACE FUNCTION invoke_meta_ads_sync() RETURNS BIGINT ...
  -- reads app_url + cron_secret from vault.decrypted_secrets
  -- net.http_post → /api/cron/meta-ads-sync, timeout_milliseconds := 55000
SELECT cron.schedule('meta-ads-sync', '7 * * * *', $$ SELECT invoke_meta_ads_sync(); $$);
```

Minute 7 to stay off the existing jobs' minute boundaries.

`src/app/api/cron/meta-ads-sync/route.ts` — `x-cron-secret` header **or** `Authorization: Bearer`, constant-time `timingSafeEqual` against `CRON_SECRET`, exporting both `GET` and `POST`, matching [google-sheets-sync/route.ts](Ordra/src/app/api/cron/google-sheets-sync/route.ts). Add a `maxDuration: 60` entry in `vercel.json` (the `functions` key is fine — only `crons` is the problem).

**The 55s pg_net timeout is a hard budget.** Set `deadlineAt = Date.now() + 45_000`, process accounts sequentially, and stop cleanly when exceeded — a run that doesn't finish commits nothing. At 2 accounts × 7 days × campaign-level this is comfortable, but the guard must exist because it's the failure mode that already bit the Sheets sync.

**Rolling 7-day window**, upserting on the unique index. Restatements self-correct, and a missed run heals on the next one.

Also expose `POST /api/ad-spend/sync` for a manual "Sync now" button, same code path, super_admin only.

---

## What you need to create in Meta

You have Business Manager and the ad accounts. Remaining:

1. **Ad account IDs** — Business Settings → Accounts → Ad Accounts. Copy the numeric ID for each; the API form is `act_<id>`. One for Tunisia, one for Libya. Confirm each account's currency while you're there (this design assumes USD for both).
2. **Meta App** — [developers.facebook.com](https://developers.facebook.com) → My Apps → Create App → type **Business**.

   **Tick both use cases now: Marketing API *and* "Connect with customers through WhatsApp".** You've told me WhatsApp Business Platform is coming for a different page in a different context — it is explicitly *not* part of this ad-spend work, and nothing in this plan touches it. But one Meta App can host multiple products, and the app you create in this wizard is the one the System User token will be scoped to. Adding WhatsApp to the *same* app later is a checkbox; creating a second app later means a second System User asset assignment, a second App ID/Secret to store, and a second review surface. Tick it now, ignore it until you need it.

   Note the **App ID** and **App Secret**. No App Review is needed for the ads side: a System User token only touches your own assets. (WhatsApp Business Platform has its own onboarding — phone number, Business verification — which we'll deal with in that other context, not here.)
3. **System User** — Business Settings → **Users → System Users** → **Add**. Name it `OMS Sync`. Role: **Employee** (Admin is not needed to read insights; keep it least-privilege).

4. **Give the System User the app** — click the system user's name → **Assign assets** → **Apps** → select the app from step 2 → grant **Manage app**. Reload the page and confirm it shows full control of the app. *This step is required before a token can be generated* — the token is issued in the context of an app the system user controls.

5. **Give the System User the ad accounts** — **Assign assets** → **Ad Accounts** → tick both (TN and LY) → grant **View performance**. That is the asset-level equivalent of `ads_read` and is all a read-only sync needs. Do **not** grant *Manage campaigns* — this integration never writes to Meta.

6. **Generate token** — System User → **Generate token** → select the app → **scopes: `ads_read` only** → choose expiration.

   Meta offers **"Non-expiring access token"** and a **60-day expiring** token, and explicitly recommends the expiring one as a security practice. I'm recommending **non-expiring** here anyway, deliberately: this is a server-side sync with no human in the loop, and a token that expires silently at day 60 turns into a finance page reporting zero ad spend with no one watching. Non-expiring + the `190`-error alarm in the sync-health strip is the safer failure mode for *this* system. If you'd rather take the 60-day token, say so and I'll add a renewal reminder to the sync-health surface — but the code is the same either way.

   **Copy the token immediately — it is shown exactly once.**

7. **Hand over** — App ID, App Secret, both `act_` IDs, the System User token, and each account's currency. The token goes encrypted into `meta_ad_accounts.access_token` via the existing `encrypt()` helper. Nothing lands in git; send it however you'd normally send a secret, not in a commit.

**Verify before we wire anything** — this exact call should return one row per campaign per day:

```bash
curl -G "https://graph.facebook.com/v26.0/act_<AD_ACCOUNT_ID>/insights" \
  -d "level=campaign" \
  -d "time_increment=1" \
  -d 'time_range={"since":"2026-08-01","until":"2026-08-07"}' \
  -d "fields=campaign_id,campaign_name,spend,impressions,clicks,actions,account_currency" \
  -d "access_token=<TOKEN>" -i
```

`-i` prints headers so we can read `x-fb-ads-insights-throttle` and confirm the tier and utilisation on a real call. Also grab the account's currency and timezone once:

```bash
curl -G "https://graph.facebook.com/v26.0/act_<AD_ACCOUNT_ID>" \
  -d "fields=name,currency,timezone_name,timezone_offset_hours_utc,business" \
  -d "access_token=<TOKEN>"
```

> **Timezone matters more than it looks.** Meta reports days in the *ad account's* timezone, while `order_history` timestamps are UTC and the OMS reads them in market-local terms. If the ad account is set to, say, `America/Los_Angeles` while Libya trades on `Africa/Tripoli`, every "day" of spend is offset from every "day" of leads and the cohort ROAS is quietly wrong by a partial day. Read `timezone_name` at connect time, store it on `meta_ad_accounts`, and either align the ad account's timezone to the market or convert explicitly. **Check this before the first sync** — it is not fixable retroactively, because Meta will not re-report history in a different timezone.

---

## Deliverable 4 — The page

`src/app/[locale]/(dashboard)/finance/ad-spend/` rebuilt on the shared `src/components/finance/` kit (`FinanceHeroCard`, `FinanceKpiCard`, `FinancePanel`, `FinanceSparkline`, `FinanceFunnel`) instead of the private inline-styled duplicates. Server component keeps the `canViewFinanceSection` gate (super_admin); client shell keeps `useMarketScope()` as the market source of truth.

New pure modules, server-side only per the `lib/calculations/` rule:

- `src/lib/ad-spend/break-even.ts` — `computeBreakEven({ aov, unitCogs, packingCost, confirmationCost, deliveryFee, returnFee, confirmRate, deliverRate, returnRate })` → `{ cplFloor, costPerDeliveredFloor, roasFloor }`. Integer millimes.
- `src/lib/ad-spend/cohort.ts` — cohort attribution: spend on day D vs orders **created** on day D, plus `maturityPct` = terminal-status share.
- Extend `realized-metrics.ts` for the live layer; migrate its float `round2` to the millimes helpers while touching it.

The heavy `overlay=metrics` JS nested loop moves into a `SECURITY DEFINER` RPC, following the precedent of `get_profitability_summary` — which exists precisely because a per-row RLS predicate was timing out past 7 days. That also fixes the unpaginated 1000-row silent under-count.

New/changed routes: `GET /api/ad-spend` (extended), `GET|POST|PATCH /api/meta/campaigns/mappings`, `GET /api/meta/accounts` + `POST .../test` (connection test returning a staged result like [storefronts/[id]/test](Ordra/src/app/api/storefronts/[id]/test/route.ts)), `GET /api/ad-spend/sync-status`, `POST /api/ad-spend/sync`.

Meta account credentials get a settings surface at `settings/integrations` (or extend `settings/carriers`' pattern), reusing the `credentialFields` + `maskCredential()` `"••••••••"` convention from [CarriersSection.tsx](Ordra/src/components/settings/CarriersSection.tsx). Ad-spend stays a finance page; credentials stay in settings.

Per repo `CLAUDE.md`, TDD is non-negotiable and the current `src/components/ad-spend/` has **zero tests** — every new pure module gets a failing test first, and the three API routes get route tests alongside the existing ones.

---

## Verification

1. `npm run typecheck` — must be clean (the gate; lint is unconfigured and the suite has ~31 pre-existing failures unrelated to this work).
2. `npm test` on touched areas — `break-even`, `cohort`, `realized-metrics`, `csv-parse`, and the `api/ad-spend/*` route tests. New pure modules at 100%.
3. **Break-even unit test against the real Biovera figures above** — asserts `roasFloor ≈ 1.596`, `cplFloor ≈ 17.72`, `costPerDeliveredFloor ≈ 32.72`, with `unitsPerDelivered = 1.1547` and the **blended** delivery fee 5.230. Name the basis (cohort) in the test title, since the event-window basis gives 664 delivered rather than 1,099 and would produce different — also correct — numbers.
4. **Live Meta test** under the existing `vitest.live.config.ts` harness (the pattern `src/lib/google-sheets/__live__/` already establishes) — one real Insights call against a 7-day window, asserting parse + FX conversion.
5. **Sync idempotency** — run the sync twice over the same window, assert row count is unchanged and `amount` matches. This is the single most important test; the current CSV import fails it.
6. **pg_cron** — `SELECT invoke_meta_ads_sync();` manually, then check `cron.job_run_details` **and `net._http_response`**, because pg_cron reports "succeeded" for a job whose HTTP call timed out. Confirm `ad_sync_runs` has a `succeeded` row.
7. **Reconciliation** — after the first real sync, `/finance/ad-spend` total, `/dashboard/pnl` ad-spend line, and the products-page `ad_spend` column must all agree. They share `load-summary.ts`, so a mismatch means the daily-row change broke an overlap predicate.
8. Browser walkthrough as super_admin: TN scope, LY scope, `all` scope; unmapped banner → map a campaign → confirm the figure moves from market-level to product-level; synced row is read-only; manual entry still works; CSV import still works and now **persists `campaign_name`**.
9. RTL pass on the Arabic locale — the prototype is LTR/French by your choice, but the shipped page must mirror.

## Sequencing

Prototype → your review → migration → sync + cron → page rebuild → reconciliation. **No migration is written until you've seen and approved the prototype.**

## Out of scope

- **WhatsApp Business Platform.** Coming later, for a different page in a different context. The *only* thing it changes here is step 2 of the Meta setup: tick its use case while creating the app so the same App ID serves both. No schema, no route, no UI in this work.
- Click-level attribution (UTM/`fbclid` through Converty/Easy Orders into `orders`). It's the only way to get true per-ad ROAS, it's a bigger project touching the storefront platforms, and it's worth doing later. Noted, not started.
- TikTok/Google adapters — the schema supports them; no adapter is written.
- Campaign status/objective in the UI — stored, not surfaced.
- The `market_manager` permission question. RLS on `ad_spend` still permits market managers while `canViewFinanceSection` blocks them at the route. Left exactly as-is; flagged as an inconsistency, not touched here.
