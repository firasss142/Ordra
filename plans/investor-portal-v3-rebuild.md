# Investor portal v3 — rebuild as a transparency "trading app" on fixed-% deals

> Status 2026-08-18: **Phases 0–5 delivered** — prototype `prototypes/investor-portal-v3.html`; migrations `20260920000001..7` applied; engine `src/lib/investors/`; portal `(investor)/investor/*`; admin `finance/investors` (6 tabs); v1 dropped. Reference: `docs/investor-domain.md`. Fixture deals on `ilyes@oms.local` remain for demo; deploy needed for the cron to hit the new route.

## Context

The OMS already has an investor domain (6 tables, append-only ledger, settlement engine, a 4-tab
mobile portal, an admin surface). It computes, but the owner rejects **how data is shown, how it is
structured, and the CRUD** — no actionable insight, no clear KPIs — and wants an **immersive,
trading-app-like** investor interface built on transparency and trust, drawn chronologically the way
the ad-spend page draws its funnel chain and cost stack (inspiration, not copy). Explicit permission
to rebuild everything, including deleting existing logic.

**Verified facts that shape the plan (prod project `vshynigvgrlihngozuwb`, 2026-08-18):**

- Investor tables hold **fixture data only** (1 investor, 1 position, 0 daily-stats rows) → a schema
  rebuild has no migration burden. The rollup cron route exists but is **not scheduled** in pg_cron.
- The live business is **Libya**: 5 real products, May→Aug 2026, full `order_history` coverage
  (uploaded 1 431 · delivered 383 · returned 101 · rejected 1 512). TN/Biovera stopped in July and its
  legacy import lacks `confirmed`/`uploaded` transitions.
- Darb has **100 % billed coverage** (`darb_shipments.billed_shipping_amount`: 380/380 delivered,
  101/101 returned); real cost ≈ 24–29 LYD/parcel vs the flat 10; **returns bill ≈ 27 LYD, not 5**.
  Dexpress has **no billing** and 323 parcels in flight, 0 delivered.
- Prior audit (`prototypes/investor-portal-v2.html`, `docs/investor-domain.md`) found 6 engine bugs
  (return-side revenue reversal under-pays ~5×, corrections never reach `available`, estimate ≠
  settlement, capital not day-weighted, empty rollup, two "return rate" definitions). The new model
  designs all six out rather than patching them.

## Decisions (28, from seven AskUserQuestion rounds) — fixed

| Area | Decision |
|---|---|
| Deal | one investor × one product × terms; **fixed negotiated share %** of the product's net profit (no capital ÷ total, no house position); capital informational, **returned at maturity**; **fixed term**; **cadence per deal** (default quarterly, editable); terms editable mid-way **with effective date** (old periods keep old terms) |
| Profit | net = revenue − COGS − delivery − returns − packing − processing − **product-mapped ad spend only** (market-wide spend ignored); gross = revenue − COGS − delivery − returns; **no house fee** |
| Costs | delivery/return = **real billed only**; unbilled outcome → order is **pending** (not counted); **Dexpress-carried orders excluded entirely** (count printed); full waterfall **incl. per-unit costs** |
| Rates | "confirmed" stage = **uploaded ÷ received**; delivered ÷ uploaded; returned ÷ (delivered + returned); cohort = orders created in window |
| Losses | **carried loss** per deal (no payout, no clawback, earned back first); **no holdback**; late returns reduce next payout |
| Cadence of truth | app moves continuously (**rollup every 15 min**, "updated X min ago"); money becomes withdrawable only on a **fully manual** admin close (preview → confirm) |
| Investor UX | light, **ad-spend-inspired**; hero = **position value = capital + accrued share, with return %**; main chart = **cumulative share equity curve with payout markers**; range pills 1W/1M/3M/Period/All; **product 100 % beside your share** on every money line; **daily aggregates + per-order feed** (date · event · amounts only); **in-flight ghost figure** (never in the hero); metrics: ad spend, orders, uploaded %, delivered %, revenue, gross, net |
| Actions | investor: read + **withdraw settled profit**; admin: create investor+deal · close/settle · withdrawals · corrections · amend terms · mature/early-exit; **in-app notifications** only |
| Platform | **both markets ar + fr**, currency per deal, no cross-currency totals; **mobile-first installable PWA**, desktop works |
| Engine | **rebuild schema fresh, keep the append-only-ledger principle** |
| Prototype data | LY: one investor, **3 deals** (القرآن تدبر وعمل · كتاب الداء والدواء · دميه ملاكمه حجم صغير), ~30 000 LYD, 12-month term, quarterly |

**Flagged concerns (stated, proceeding):** (a) excluding Dexpress removes revenue but not the ad spend
that produced it → investor net is understated while Dexpress carries volume; realized impact today is
zero (0 Dexpress deliveries) and the app prints the excluded count. (b) TN carriers (Navex) have no
billed source, so under "real billed only" a TN deal would never accrue — the schema carries a per-carrier
escape hatch `carriers.investor_billing_mode` (`billed_only` default, `flat_is_final` opt-in) that the
owner flips only if a TN deal is opened. (c) A single `billed_shipping_amount` per shipment is bucketed
by outcome (delivered → delivery cost, returned → return cost) — verify against `shipping_breakdown`
before go-live.

---

## Phase 0 — Prototype first (review gate before any code)

`Ordra/prototypes/investor-portal-v3.html`, house convention (`agent-queue-v2.html`, `pnl-v2.html`):
self-contained, no CDN, `--oms-*` tokens restated from `src/app/globals.css`, Inter/Cairo base64,
light + dark, chrome bar with views **Portefeuille · Produit · Activité · Retraits · Admin: Clôture · Notes**,
390 px phone frames + one 1280 px desktop frame, **fr and ar (RTL)** variants of the home + deal screens.
Every figure from production SQL (read-only) for the three LY products, May–Aug 2026, with the deal
terms above applied (share %: 30 / 30 / 25 as placeholders, printed as such). Load `dataviz` and read
`docs/design-system.md` §4.15 before drawing. The Notes view names each element and the rule behind it
(one hero, ghost never in hero, n<10 delta suppression, excluded-count line, unit-cost disclosure).

Screens the prototype must show (this is also the UI spec for Phase 3):

**Home (Portefeuille)**
1. Header: name · market · `updated 12 min ago` (from `investor_rollup_runs`) · bell with unread badge.
2. Hero (34 px, one per currency, stacked if two): **position value** = capital outstanding + available +
   unsettled share; chip `▲ +12.4 %` total return; "since 1 May · matures 30 Apr 2027".
3. Equity curve (recharts `AreaChart`, `initialDimension` seeded): cumulative share since start; dots
   at payouts; shaded unsettled tail from last `period_end`; scrubber tooltip; range pills.
4. Money strip (3 `FinanceKpiCard`): Capital (returned on <date>, day 110/365 progress) · Available
   (withdraw CTA) · Accrued, not yet settled ("à la prochaine clôture").
5. Deals: one tappable card per deal — `ProductAvatar` 56 px, name, `30 % · 12 000 LYD`, net share in
   range (money-direction colour), sparkline, mini chain `943 → 21 % → 39 %`, `+N in flight` ghost.
6. Recent activity (5 lines, ledger + statements) → Activité.

**Deal detail (`/investor/deals/[dealId]`)**
1. Product hero 72 px + terms line + maturity progress; range pills.
2. **Conversion chain** (ad-spend grammar, rebuilt as `investor/ConversionChain.tsx`): Ad spend →
   Orders received → Uploaded (`21 %` pill) → Delivered (`39 %` pill) → Revenue → Gross profit → Net
   profit; every money step shows product 100 % on top and **yours** beneath; ghost "in flight ≈" after
   Delivered; footnote `N via Dexpress excluded · N awaiting billing`.
3. Equity curve for the deal (same component).
4. **Waterfall table**, two columns `PRODUIT (100 %)` | `VOUS (30 %)`: revenue · − COGS (`24.998 × 121`) ·
   − delivery (`avg 29.43 billed`) · − returns (`avg 26.9 billed`) · − packing · − processing · = gross ·
   − ads · = net; carried loss line when non-zero.
5. **"Where a delivered order's money goes"** stacked bar (ad-spend §3 grammar) per average delivered order.
6. Statements for this deal (period · net · share · payable · status) → statement sheet with day rows.
7. **Order feed** (`useSWRInfinite`): `17 Aug · delivered · +179 rev −25 COGS −29.4 delivery → yours +37.4`;
   returns and billing flips as red/grey lines; no ref, city, or customer.

**Activité**: unified chronological list — ledger movements (settlement / withdrawal / correction /
capital in / principal return) + notifications, filter chips; statements archive with CSV.
**Retraits**: available hero, amount + "tout retirer", request lifecycle (requested → approved → paid, reference).
**Compte**: legal name, market, currency, deals summary, payout method, sign out.
**Admin · Clôture** (desktop): choose investor or deals + `period_end` → preview table per deal
(period, net, restatement Δ, carried loss, payable, warnings PENDING/IN_FLIGHT/NEGATIVE) → typed confirm.

---

## Phase 1 — Facts & rollup (schema + pure engine, no money yet)

Migrations (after `20260918010003`), all `NUMERIC(14,3)` millimes, RLS on, `btree_gist`:

| File | Contents |
|---|---|
| `20260920000001_investor_v2_drop_legacy.sql` | drop `apply_investor_settlement`, `request_withdrawal`, `post_investor_correction`, `release_investor_reserve`; `DROP TABLE … CASCADE` the six legacy tables; keep `assert_money_actor`, `users.role='investor'`, `chk_users_role_market` |
| `20260920000002_investor_deals.sql` | `investors` (profile, no reserve_pct) · `investor_deals` (investor, product, market, currency, start_date, end_date, status active/matured/closed, close_reason, final_statement_id) · `investor_deal_terms` (versioned by `effective_from`: share_pct, capital_amount, payout_cadence, maturity_date; insert-only trigger) · `carriers.investor_billing_mode` |
| `20260920000003_investor_facts.sql` | `investor_order_facts` (PK order_id+product_id; cohort_date local day; uploaded/delivered/returned_at = MIN per stage; stage/outcome/reversal_applies; unit-cost **snapshots frozen at first outcome** via BEFORE-UPDATE trigger; revenue, cogs, delivery, return, packing, processing, `carrier_billed_amount`, `is_final`, `pending_reason`, `excluded_reason` dexpress/deleted/no_product, `expected_revenue`, `updated_at` moves only on content change) · `investor_daily_product_facts` (per product/day: cohort family counts + event family money via two-posting rule + `ad_spend_direct` prorated largest-remainder + generated `net_profit`) · `investor_deal_snapshots` (portal read: totals/series/pending/in_flight JSON) · `investor_rollup_runs` + `claim_investor_rollup_run` advisory lock |
| `20260920000006_pg_cron_investor_rollup.sql` | `invoke_investor_rollup(mode, product_id)` via pg_net + `x-cron-secret`; jobs `investor-rollup-15min` `'4-59/15 * * * *'` incremental, `investor-rollup-nightly` `'41 2 * * *'` full per deal product; `investor_rollup_cron_status()`; add route `maxDuration` in `vercel.json` |

Pure TS under `src/lib/investors/` (tests first, Vitest):
`facts/order-facts.ts` `deriveOrderFacts` (multi-product split via existing
`src/lib/calculations/order-revenue-attribution.ts`; MIN-per-stage dedupe; "first shipped-stage
timestamp" fallback for TN legacy; dexpress/deleted exclusion; pending→final; reversal only if
delivered_at < returned_at; snapshot preservation) · `facts/daily-facts.ts` `buildDailyFacts` ·
`facts/ad-spend-daily.ts` (move `prorateAdSpend`/`daysInPeriod` from `load-rollup.ts`, largest remainder) ·
`facts/load-order-facts.ts` (batches of 500 via `src/lib/supabase/fetch-all.ts`, PostgREST upsert) ·
`rollup-run.ts` (incremental: candidates = `orders.updated_at`/`order_history.created_at`/
`darb_shipments.updated_at` > watermark−5 min, restricted to deal products, + last 7 ad-spend days;
full: per product since earliest open deal; flips `active→matured`; writes snapshots) ·
`src/app/api/cron/investor-rollup/route.ts` (rewrite; 207 on partial) ·
`POST /api/admin/investments/rollup/run`, `GET …/rollup/status`.

**Gate:** dry-run script over prod (read-only) prints per-product totals from derived facts and
reconciles against `/api/ad-spend/economics` figures for the same window; Dexpress excluded count printed.

## Phase 2 — Money: accrual, settlement, ledger, RPCs, APIs

| File | Contents |
|---|---|
| `20260920000004_investor_money.sql` | `investor_statements` (immutable; period figures 100 %, `investor_share` signed **delta** vs `cumulative_share_through`, `restatement_delta`, carried_loss before/applied/after, `payable ≥ 0`, `capital_amount`, `snapshot` JSONB with day rows + terms versions + watermark, `preview_hash` UNIQUE, `EXCLUDE` overlapping periods per deal, kind periodic/final) · `investor_ledger` (append-only trigger; entry types **capital_in ±, settlement +, withdrawal +, correction ±, principal_return +**; CHECKs tie each type to its FK) · `withdrawal_requests` · `investor_notifications` (dedupe_key UNIQUE, realtime publication) |
| `20260920000005_investor_money_rpcs.sql` | `SECURITY DEFINER` + `assert_money_actor`: `create_investor_deal` (deal + first terms + `capital_in`), `amend_investor_deal_terms` (409 if `effective_from ≤` last settled `period_end`; capital delta; maturity → `end_date`), `commit_investor_settlements(jsonb[], actor)` (row lock, contiguity, `ON CONFLICT (preview_hash) DO NOTHING`, ledger `settlement` if payable>0, notification), `investor_available_balance`, `request_investor_withdrawal` (available − open claims), `decide_investor_withdrawal` (state machine; ledger on `paid`, re-check available), `post_investor_correction` (note mandatory), `close_investor_deal` (early exit sets end_date; final statement + `principal_return` + status closed), `mark_investor_notifications_read` |

Pure TS: `terms.ts` `sharePctOn(d)` · `carried-loss.ts` (port of `settleInvestorShare`) ·
**`accrual.ts` `computeDealAccrual`** — one function, two callers (rollup snapshot at today; settlement
draft at `period_end`): per-day two-posting money for **final** facts in the deal's cohort window,
ad spend per day, share applied **per day** (terms versioning), delta method vs last statement,
restatement Δ, carried loss, pending bucket, in-flight ghost (`expected_revenue × trailing 90-d net
margin × share`), rates, counts · `load-accrual.ts` · `settlement.ts` `buildStatementDraft` +
`preview_hash` · `feed.ts` (facts → events, keyset cursor) · `portfolio.ts` (hero per currency:
position value, return %) · rewritten `src/lib/calculations/investor-balance.ts` fold
(available = settlement + correction − withdrawal; capital_outstanding = capital_in − principal_return).

APIs (conventions: `force-dynamic`, `getActor` + `src/lib/investor-permissions.ts`, investor id from
session only, service-role client, investor GETs `private, max-age=15, stale-while-revalidate=45`):

- Investor: `GET /api/investor/portfolio` · `GET /api/investor/deals/[dealId]?range=` ·
  `GET /api/investor/deals/[dealId]/feed?cursor=` · `GET /api/investor/ledger` ·
  `GET /api/investor/statements[/id]` · `GET|POST /api/investor/withdrawals` ·
  `GET /api/investor/notifications`, `POST …/notifications/read`.
- Admin: `GET|POST /api/admin/investments/deals`, `GET|PATCH …/deals/[id]`, `GET|POST …/deals/[id]/terms`,
  `POST …/settlements/preview`, `POST …/settlements` (409 `PREVIEW_STALE`), `GET …/settlements`,
  `POST …/deals/[id]/close/preview`, `POST …/deals/[id]/close`, `GET …/withdrawals?status=`,
  `POST …/withdrawals/[id]/{approve|reject|paid}`, `POST …/corrections`, investors profile CRUD (keep shapes).

Each route gets a `route.test.ts` (auth + shape) as the current admin routes do.

## Phase 3 — Investor portal UI + PWA + i18n

- Route group `src/app/[locale]/(investor)/investor/` : `page.tsx` (home), `deals/[dealId]/page.tsx`,
  `activity/page.tsx`, `withdrawals/page.tsx`, `account/page.tsx`; keep `layout.tsx` guard pattern
  (middleware allow-list `/investor` + layout + page). Server component loads → SWR `fallbackData`
  on the same key, `refreshInterval: 60_000`.
- Components `src/components/investor/` (delete the 14 old ones): `InvestorShell` (bottom tabs < sm,
  top nav ≥ sm, `id="main-content"`), `PositionHero`, `EquityCurve` (recharts, seeded
  `initialDimension`, payout markers, unsettled shading, scrubber), `RangePills`, `MoneyStrip`,
  `DealCard`, `ConversionChain`, `WaterfallTable`, `OrderMoneyStack`, `OrderFeed`, `ActivityList`,
  `StatementSheet` (uses `ui/Sheet`), `WithdrawForm`, `NotificationsBell`, `FreshnessLine`.
- Hooks `src/hooks/useInvestor{Portfolio,Deal,Feed,Ledger,Statements,Withdrawals,Notifications}.ts`
  (`fetcher` from `src/lib/swr-config.ts`; notifications via Realtime on `investor_notifications`).
- Tokens: `--oms-*` warm palette + money-direction colour on figures only (design-system §4.15
  extended: allow the equity-curve area fill and range pills; keep one hero per screen; logical
  properties everywhere; `MetricTile`'s n<10 delta suppression via `lib/dashboard/confidence.ts`).
- PWA: `src/app/manifest.ts` (name, icons, `display: standalone`, `theme-color`), apple-touch icon,
  `start_url: /investor`.
- i18n: new `investor.*` namespace in **both** `src/messages/fr.json` and `ar.json` (zero hardcoded
  strings); money via the dashboard formatter (0 decimals, currency as suffix, LRI/PDI wrap for LYD).

## Phase 4 — Admin UI

`src/app/[locale]/(dashboard)/finance/investors/` with underline tabs (§4.11):
**Investisseurs** (profile CRUD + onboarding state) · **Deals** (create form: investor, product,
start, term months, share %, capital, cadence; list with maturity countdown; `AdminDealDrawer` = the
investor's deal view + terms history + amend-terms form + close/exit flow) · **Clôtures** (investor or
deals + period_end → preview table with warnings → typed confirm; irreversible = `destructive` variant)
· **Retraits** (queue, status filter, market column, approve/reject/paid + reference) · **Corrections**
(signed amount, mandatory note, confirm) · **Rollup** (last runs, cron status, "run now"). All strings
in `finance.investors.*` for fr + ar.

## Phase 5 — Cleanup & docs

Delete: `src/lib/investors/{rollup,load-rollup,settlement,portfolio,reserve-release}.ts` + tests,
`src/lib/calculations/{investor-allocation,ad-spend-allocation}.ts` + tests, old
`src/app/api/investor/**`, `src/app/api/admin/investments/**` (rewritten), old components/tests,
`prototypes/investor-portal-{app,v2}.html` (superseded), old plans marked superseded.
Rewrite `docs/investor-domain.md` (model, tables, RPCs, rules, edge cases from design §G); add the
`/investor` route + `lib/investors/` to `Ordra/CLAUDE.md` stack layout (one line each, link to doc);
five-role list. Update memory: cadence/holdback decisions, Dexpress exclusion, real-billed rule.

---

## Verification

- `npm run typecheck` clean after every phase; `npm run build` before Phase 3/4 hand-off.
- Vitest: every new pure module red → green first; full run expects only the **31 known pre-existing
  failures** in unrelated files (lint is unconfigured — gate on typecheck).
- Local `ordra_e2e` DB: replay all migrations incl. the drop; run `deriveOrderFacts` over a fixture set
  covering: multi-product order, re-confirmed order, TN legacy without `uploaded`, Dexpress order,
  unbilled delivered order flipping to billed, delivered-then-returned, order created before deal start.
- Prod read-only reconciliation: facts-derived per-product revenue/delivered/returned for May–Aug LY
  vs the ad-spend economics endpoint and vs `SELECT` on `order_history`; print Dexpress excluded and
  awaiting-billing counts.
- End-to-end scenario on local DB as super_admin + investor: create investor → create 3 deals → run
  rollup → open portal (hero, curve, chain, waterfall, feed) → amend terms with effective date → close
  a period (preview → confirm) → withdraw → approve → paid → post correction → early-exit one deal
  (final statement + principal return) → notifications appear.
- Playwright at **390 px and 1280 px, fr and ar (RTL)**; keyboard pass (cards are real links, sheet
  traps focus, skip link lands); contrast check on every new text token; PWA installability check.
