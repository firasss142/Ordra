# Investor domain — full context for refinement

Everything about the investor role, capital ledger, settlement engine and
portal, written from **driving both accounts end-to-end against production** and
reading the whole code path — not from design intent.

This document exists to be **edited**. Items are numbered so you can strike,
rewrite or annotate them directly. Markers used:

- `DECIDED` — settled, with the reason
- `OPEN` — needs your call
- `BROKEN` — verified defect, still present
- `MISSING` — designed for but never built

---

# PART 1 — The model

## 1.1 The core idea

An investor funds **a specific product**, not the business. In any period their
share of that product's net profit is:

```
share % = their capital ÷ TOTAL capital in that product
```

`TOTAL` includes **house capital** — an `investment_positions` row with
`investor_id IS NULL`. So when the business restocks with its own money the
denominator grows and every investor's percentage falls automatically, without
renegotiation. A partial exit is just an end-dated row.

## 1.2 Money precision

Investor path uses **millimes** (3dp, `NUMERIC(10,3)`) — TND and LYD are millime
currencies, so 3dp is exact for stored values and rounds nothing. The market P&L
path uses **cents**. Deliberately not unified; documented in
`src/lib/calculations/math.ts`. Consequence: a market P&L total and the sum of
investor statements over the same period can differ by sub-millime rounding.
**Statements are authoritative for payouts.**

## 1.3 The profit formula

```
net profit = revenue − COGS − delivery − returns − packing
             − processing − ad spend (direct) − ad spend (allocated)
```

Market-wide ad spend is allocated to products in proportion to the revenue each
produced that period.

## 1.4 The loss rule

A negative period never produces a negative payout or a clawback. The
investor's share of the loss becomes a **carried loss** per `(investor,
product)` that must be earned back before anything is payable again.

Rationale in code: clawing back money already withdrawn is unenforceable and
destroys trust.

## 1.5 The reserve

`reserve_held = payable × reserve_pct` (default 10%), held against returns that
arrive after the period closes, released **90 days** after `period_end`.

---

# PART 2 — Data model

| Table | Holds | Mutability |
|---|---|---|
| `investors` | legal name, payout method/details, `reserve_pct`, notes | Editable |
| `investment_positions` | investor-or-house, product, market, amount, `effective_from/to`, status | **Create + close only** |
| `investor_daily_product_stats` | per (day, market, product) funnel + waterfall | Recomputed idempotently |
| `investor_statements` | immutable per-period snapshot + `cost_inputs` JSONB | Insert only |
| `investor_ledger` | signed money movements | **Append-only by trigger** |
| `withdrawal_requests` | payout requests + state machine | Status transitions |

## 2.1 Ledger entry types and what they move

| Entry | pending | reserve | available | withdrawn |
|---|---|---|---|---|
| `accrual` | + | | | |
| `correction` | ± | | | |
| `settlement` | − | | + | |
| `reserve_hold` | | + | − | |
| `reserve_release` | | − | + | |
| `withdrawal` | | | − | + |
| `principal_return` | | | − | |

Balance is **never stored** — always a fold over the ledger. There is no column
to drift out of sync.

## 2.2 Why the ledger is append-only

A trigger rejects UPDATE and DELETE. The only repair is a compensating entry via
`post_investor_correction`. This is deliberate and should stay — but it means
**every mistake is permanent**, which raises the bar on every write path.

---

# PART 3 — The super admin workflow

## 3.1 Create the login — `/users`
Role `investor`, super_admin only. Requires a `market_id`
(`chk_users_role_market`). Writes `auth.users` + `users`.

## 3.2 Configure the profile — `/finance/investors` → Investisseurs
Legal name, payout method, `reserve_pct`, notes. Writes the `investors` row.

## 3.3 Open capital positions — Positions de capital
**Two rows per product are required:**
1. the investor's capital
2. **Maison** — house capital, `investor_id NULL`

Amount is immutable after creation; a position can only be **closed**
(end-dated), because settled statements were computed from it.

## 3.4 The rollup runs — invisible
`/api/cron/investor-rollup` folds `order_history` into
`investor_daily_product_stats`. Default **3 trailing days**, `?date=` for one
day, max 30.

Attribution rule: a metric belongs to the day its `order_history` transition
landed, **not** the order's creation date. Leads are the exception (counted by
`orders.created_at`).

## 3.5 Close the period — Clôture de période
Market + dates → **Prévisualiser** (dry run) → **Confirmer la clôture**.
Preview reconciles investor + house shares against net profit and refuses to
settle if they disagree. Commit writes atomically, per investor per product:
`accrual` +share, `settlement` +share, `reserve_hold` −reserve.
Re-running the same period 409s.

## 3.6 Reserve release — invisible
Cron, 90 days after `period_end`.

## 3.7 Withdrawal decisions — Demandes de retrait
`requested → approved → paid`, rejectable from either.
**The ledger entry is written only on mark-paid** — approving is an intent, not
a movement.

## 3.8 Corrections — Corrections
The only repair path. Note mandatory, confirm step.

---

# PART 4 — The investor workflow

## 4.1 Login
Middleware allow-lists `/investor` only — deny-by-default, because the staff
route guards use denial lists a fifth role would fall through.
**Verified:** 10 staff routes redirect away; both admin money APIs return 403.

## 4.2 Portefeuille
Capital + multiple · balance in four buckets · cash-cycle timeline · one card
per funded product with funnel, two rate gauges, and the full waterfall.

## 4.3 Relevés
One row per settled statement: period, share %, net profit, amount, reserve.
CSV export. Drafts hidden by RLS.

## 4.4 Retraits
Available figure, amount field, request history with status badges. Server
enforces the balance and blocks double-spend; open requests count as claimed.

## 4.5 Compte
Legal name, email, sign out. No password change, no payout details.

## 4.6 What investors deliberately cannot see
No RLS grant on `orders`, `order_history`, `products` or `ad_spend`. Everything
is computed server-side under the service role and scoped to products they hold
a position in.

---

# PART 5 — Scenario inventory

## 5.1 Investor scenarios
1. Login, no `investors` row → dead-end message
2. Profile, no position → empty portfolio
3. Position, no rollup data → all zeros
4. Rollup but no settlement → pending estimate only, nothing withdrawable
5. Settled period → available balance + statement
6. Reserve held → available reduced
7. Reserve matured → released by cron
8. Late-return correction → balance drops
9. Request withdrawal → claimed against available
10. Approved → status badge changes only
11. Paid → available −, withdrawn +
12. Rejected → claim released
13. Loss period → statement with zero payable, carried loss set
14. Carried loss absorbed by a later period
15. Position closed / partial exit
16. Diluted by a house restock
17. Multiple products settled at different times
18. Logout

## 5.2 Admin scenarios
1. Create investor login → 2. Configure profile → 3. Edit terms
4. Open position (investor or house) → 5. Close position
6. Run rollup *(cron only)* → 7. Preview settlement → 8. Commit
9. Re-settle same period → 409
10. Approve / reject / mark paid → 11. Post correction
12. Reserve release *(cron only)*

---

# PART 6 — What's wrong (the 80%)

The through-line: **the system computes correctly and explains nothing.**
Nearly every complaint is a missing narrative, not a wrong number.

### F1 `BROKEN` Three unreconciled profit figures on one screen
The portfolio shows the product's net profit (38 041,498), the settled share
(605,340) and a pending estimate (14 543,999). The investor's actual
entitlement — 40%, ≈15 216,599 — appears **nowhere**.

They do reconcile, but only if expressed as the investor's share:
`672,600 + 14 543,999 = 15 216,599 = 40% × 38 041,498`.

### F2 `OPEN` Capital is not day-weighted
`activeCapitalInPeriod` counts any position *overlapping* the period at **full
value**. Funding on 31 March earns the same share of March as funding on 1
March. The code defends this ("capital buys inventory that keeps working"), but
it is not what anyone assumes.

### F3 `MISSING` No transaction history anywhere
Neither investor nor admin can see the ledger. A `correction` or
`reserve_release` changes the balance with no visible cause. Observed live: a
−67,260 correction moved "votre part" from 672,600 to 605,340 and **nothing in
the product could explain it**.

### F4 `BROKEN` The reserve never states when it matures
Amount shown, release date never. Reads as an open-ended deduction.

### F5 `BROKEN` Settlement can dead-end
422 "Run /api/cron/investor-rollup for these dates first" — and no UI can run
it. The cron needs `CRON_SECRET` and can't be called from a browser. I had to
run it 62 times by hand.

### F6 `MISSING` No exit path
`principal_return` is in the enum and folded by the balance, but **nothing
writes it**. Returning capital needs a hand-typed correction.

### F7 `MISSING` The house is a ghost
It sits in the denominator, receives no statement, and appears in no report.
You cannot see what the business earned.

### F8 `BROKEN` Two of three statement statuses are unreachable
`computeSettlement` emits `draft`; the RPC overwrites it with `settled`;
nothing ever writes `paid`. RLS hides `draft` from investors — guarding a state
that cannot occur.

### F9 `OPEN` Rollup window is 3 days
COD carrier events routinely land later. Anything beyond the window is silently
missing until someone backfills by hand.

### F10 `OPEN` Funnel counts look impossible
Real production data shows **1 634 delivered vs 2 confirmed, 0 transmitted**,
because `order_history` holds almost no `confirmed` transitions for tn. Likely a
recording gap upstream, not a UI bug — needs confirming before "fixing".

### F11 `MISSING` Carried loss is invisible
Lives only in `cost_inputs` JSON. Neither side can see that an investor must
earn back X before anything is payable.

### F12 `OPEN` Position amounts can't be corrected
Close-only by design. A typo'd capital amount means closing and reopening.

### F13 `MISSING` No notifications
Nothing tells an investor a statement was issued or a withdrawal was paid.

---

# PART 7 — Decisions taken so far

### D1 `DECIDED` Portfolio layout — product and share side by side
Each waterfall line shows the product figure beside the investor's share:

```
                     PRODUIT (100%)     VOUS (40%)
Chiffre d'affaires   66 613,498 DT   26 645,399 DT
− Coût marchandises −15 730,000 DT   −6 292,000 DT
− Livraison          −8 958,000 DT   −3 583,200 DT
− Retours            −1 688,000 DT     −675,200 DT
− Emballage          −2 056,000 DT     −822,400 DT
− Publicité            −140,000 DT      −56,000 DT
─────────────────────────────────────────────────
= Bénéfice net       38 041,498 DT   15 216,599 DT

VOTRE ARGENT
  Déjà réglé                          672,600 DT
  Estimation en cours              14 543,999 DT
```

Chosen because the arithmetic explains itself on every row and the share column
adds up to the share of the total.

### D2 `DECIDED` Capital pro-rated by days active
Weight each position by `overlapping days ÷ days in period`. Settled statements
are unaffected (they snapshot `capital_basis`); only future calculations move.

### D3 `DECIDED` Refine both gates together, driven by one scenario
> onboard → run a month → close the period → mature the reserve → pay → exit

---

# PART 8 — Open questions for you

1. **Q1** — Should the investor see the product's full P&L at all, or only
   their own column? (D1 assumes both. Reversible.) yes 
2. **Q2** — Is the funnel gap (F10) a data-recording problem upstream? That
   changes whether we fix the UI or the pipeline.
3. **Q3** — Should the house get statements too (F7), making it just another
   holder? Cleaner model, more rows.
4. **Q4** — Should an investor be notified of anything (F13), and by what
   channel?
5. **Q5** — What is the intended real-world cadence — monthly closes? Who runs
   them, and on what day?
6. **Q6** — On exit (F6), is capital returned at book value, or adjusted for an
   outstanding carried loss?
7. **Q7** — Should `market_manager` see investor data at all? Today they can
   read it via API but the page is super_admin-only — an inconsistency.
8. **Q8** — Is the 90-day reserve window right, and should `reserve_pct` be
   per-investor (today) or per-product?

---

# PART 9 — Current state of the code

Built and verified working: the six migrations, the rollup, settlement with
dry-run reconciliation, the withdrawal state machine, RLS containment, the
admin CRUD (investors, positions, withdrawal queue, corrections).

Fixed during the walkthrough: reserve confiscation, the withdrawal form's float
arithmetic and unreachable error, the wrong-currency capital table, the two-page
"Disponible" contradiction, the hardcoded-zero cycle stage, the header title,
negative-zero rendering.

**Uncommitted and partially applied** — `portfolio.ts` has new
`sharePct` / `yours` / `reserveReleaseAfter` fields, fr/ar messages have new
keys, and `PositionCard.test.tsx` has 9 failing tests because `PositionCard.tsx`
was not rewritten. Either finish D1 or revert those four files.

Production still holds undeletable fixture rows from the walkthrough: 6 ledger
entries, 1 settled statement, 1 paid withdrawal, and the `investors` row for
`ilyes@oms.local`.
