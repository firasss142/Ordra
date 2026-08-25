# Investor domain (v2) — model, tables, engine, surfaces

Rebuilt 2026-08-18 from 28 owner decisions (see `plans/investor-portal-v3-rebuild.md`).
Prototype that specifies the UI: `prototypes/investor-portal-v3.html`.

## 1. The model

- A **deal** = one investor × one product × terms. Terms are a **fixed negotiated
  share %** of the product's net profit, an informational **capital** amount
  (returned at maturity), a **fixed term** (`start_date` → `end_date`), and a
  **payout cadence** (indicative; closing is manual). Terms are **versioned** by
  `effective_from`; a settled period always keeps the terms in force on each of
  its days. An investor is a single-market user, so every deal (and every money
  row) carries that market's currency; `create_investor_deal` refuses a product
  from another market.
- **Deal membership is by cohort**: an order belongs to a deal iff its
  `orders.created_at` local day ∈ [start_date, end_date]. **Money lands by event
  day** (delivered / returned).
- **Net profit** = revenue − COGS − delivery − returns − packing − processing −
  **product-mapped ad spend only** (market-wide `ad_spend.product_id IS NULL` is
  ignored). Gross = revenue − COGS − delivery − returns.
- **Carrier cost = real billed amount only** (`darb_shipments.billed_shipping_amount`
  × line share). An outcome without a billed amount is `is_final=false`
  (`awaiting_billing`) and counts for nothing until billed. Per-carrier escape
  hatch `carriers.investor_billing_mode='flat_is_final'` accepts the flat fee
  (default `billed_only`; TN carriers have no billing feed — flip deliberately).
- **Dexpress-carried orders are excluded entirely** (`excluded_reason='dexpress'`,
  row kept, count printed everywhere). Deleted orders excluded too.
- Rates: **confirmed = uploaded ÷ received**, delivered ÷ uploaded,
  returned ÷ (delivered + returned).
- **Losses**: a negative period pays nothing and never claws back; the
  investor's share of the loss is **carried** per deal and recovered from later
  periods before anything is payable. **No holdback / reserve.**
- **Settlement is manual**: admin picks investor (or deals) + `period_end`;
  `period_start` is derived (last `period_end` + 1 or deal start). Preview →
  typed confirm. `preview_hash` makes commit idempotent and rejects stale previews.
- **Ledger** (`investor_ledger_entries`) is append-only; balance is always the
  fold: `available = settlement + correction − withdrawal`;
  `capital_outstanding = capital_in − principal_return`.
- **Rollup every 15 min** (pg_cron) recomputes facts and per-deal snapshots; the
  portal shows "updated X min ago" and a *stale* banner past 60 min.

## 2. Tables

| Table | Holds | Mutability |
|---|---|---|
| `investors` | profile (legal name, payout method/details, notes) | editable |
| `investor_deals` | deal (investor, product, market, currency, window, status active/matured/closed) | label/note editable; status via RPCs |
| `investor_deal_terms` | versioned terms (`effective_from`, share_pct, capital, cadence, maturity) | insert-only |
| `investor_order_facts` | one row per (order, product): cohort/event dates, stage, outcome, snapshots, money slice, `is_final`, `excluded_reason` | upsert by rollup; snapshots frozen at first outcome (trigger) |
| `investor_daily_product_facts` | per (product, day): cohort counts + event money (two-posting rule) + prorated ad spend | rebuilt by rollup |
| `investor_deal_snapshots` | per deal: accrual result (totals, yours, series, pending, in_flight, rates) | overwritten each rollup |
| `investor_rollup_runs` | run log + advisory-lock claim | insert/update by rollup |
| `investor_deal_statements` | immutable period statements (delta method, carried loss, `preview_hash`) | insert-only; `EXCLUDE` overlapping periods |
| `investor_ledger_entries` | capital_in ±, settlement, withdrawal, correction ±, principal_return | append-only |
| `investor_withdrawals` | request → approved → paid / rejected | RPC state machine |
| `investor_notifications` | in-app events, `dedupe_key`, realtime | insert by RPCs; read via RPC |

Facts are per **product** and shared by every deal on that product; share % is
applied at read time.

## 3. Engine (`src/lib/investors/`)

- `facts/order-facts.ts` `deriveOrderFacts` — the correctness core (pure).
- `facts/daily-facts.ts` — two-posting projection; `facts/ad-spend-daily.ts` —
  largest-remainder proration; `facts/load-order-facts.ts` — batched loader/upsert.
- `accrual.ts` `computeDealAccrual` — **one function, two callers**: the rollup
  (cutoff = today → snapshot) and the settlement preview/commit (cutoff =
  `period_end` → statement draft). Delta method vs the last statement,
  restatement delta, carried loss, in-flight ghost (gross-margin basis).
- `settlement.ts` `buildStatementDraft` + `previewHash`; `settlement-preview.ts`.
- `rollup-run.ts` — incremental (changed orders/history/billing since watermark
  − 5 min, + last 7 ad-spend days) and full (per product) modes; snapshots;
  maturity flip. Called by `/api/cron/investor-rollup` and the admin run route.
- `portfolio-summary.ts`, `feed.ts`, `ledger-fold.ts`, `terms.ts`, `carried-loss.ts`.

## 4. RPCs (SECURITY DEFINER; admin ones assert `super_admin`)

`create_investor_deal`, `amend_investor_deal_terms` (409 `TERMS_BEFORE_SETTLED`),
`commit_investor_settlements` (atomic, idempotent on `preview_hash`, contiguity
check), `request_investor_withdrawal` (available − open claims),
`decide_investor_withdrawal` (approve/reject/paid; ledger entry only on paid),
`post_investor_adjustment` (correction, note mandatory), `close_investor_deal`
(early exit / final statement + `principal_return`), `mark_investor_notifications_read`,
`investor_available_balance`, `claim/finish_investor_rollup_run`,
`investor_rollup_cron_status`.

## 5. Surfaces

- Portal `/[locale]/investor` (mobile-first PWA, ar/fr, RTL): home (position
  value, equity curve, money strip, deal cards), `deals/[dealId]` (conversion
  chain, curve, two-column waterfall with unit costs, per-order stack,
  statements, order feed), activity (ledger + statements archive), withdrawals,
  account. APIs under `/api/investor/*` take the investor id from the **session
  only** and read with the service role (investors have no RLS on facts/deals).
- Admin `/[locale]/finance/investors` tabs: Investisseurs · Contrats · Clôtures ·
  Retraits · Corrections · Rollup. APIs under `/api/admin/investments/*`.

## 6. Ops

- pg_cron: `investor-rollup-15min` (`4-59/15 * * * *`), `investor-rollup-nightly`
  (`41 2 * * *`, full per deal product). Verify: `investor_rollup_runs`, then
  `net._http_response`, then `cron.job_run_details`.
- Manual: `POST /api/admin/investments/rollup/run {mode, product_id?}`.
- Fixture data in production (2026-08-18): investor `ilyes@oms.local` (moved to
  the LY market), three `FIXTURE —` deals on the LY books + small boxing dummy,
  one settled period (20 May → 31 Jul), one paid withdrawal, one correction.
  Remove before onboarding real investors (terms/ledger triggers must be
  disabled to delete; they are fixtures).

## 7. Known edges

- Multi-product orders are split by `order_items` line value (revenue, carrier,
  packing) and quantity (COGS) — the engine sees more orders than a
  `orders.product_id`-only count.
- Late Darb billing / late returns after a close appear as `restatement_delta`
  in the next statement; after a deal is closed they need a correction.
- Amendments must post-date the last settled `period_end`.
- Excluding Dexpress removes revenue but not the ad spend that produced it
  (net understated while Dexpress carries volume) — printed on every screen.
