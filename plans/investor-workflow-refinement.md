# Investor domain — refine the whole workflow across both gates

## Context

The investor role, capital ledger, settlement engine and portal all work, and
the numbers are correct — verified end-to-end against production (20,000 TND in
Biovera, March 2026 settled, 672.600 share, 67.260 reserve, withdrawal paid,
balance reconciling to exactly 305.340).

The problem is not arithmetic. **The system computes correctly and explains
nothing.** Three unreconciled profit figures share one screen, money moves with
no visible cause, the reserve shows an amount but never a release date, and
closing a period dead-ends on "run the rollup first" with no way to run it.

Today's behaviour in full: `docs/investor-domain.md`.

This plan refines the **entire lifecycle across both gates**, stage by stage,
following one story end to end:

> onboard an investor → run a trading month → close the period → mature the
> reserve → pay them → exit them and return their capital

### Decisions taken
1. **Portfolio layout B** — each waterfall line shows the product figure beside
   the investor's share. Chosen because the numbers reconcile that way:
   672.600 settled + 14,543.999 pending = 15,216.599 = exactly 40% of the
   product's 38,041.498 net profit. That relationship is invisible today.
2. **Capital is pro-rated by days active** within a period.
3. Refine both gates together, driven by the scenario above.

---

## Stage 1 — Onboarding

**Admin gate.** Create the login on `/users` (role `investor`, market required
by `chk_users_role_market`), then configure the profile on `/finance/investors`
→ Investisseurs, then open **two** positions: the investor's capital and
**Maison** (house, `investor_id NULL`). *Built and working.*

Refine:
- The three steps are currently unrelated screens. Add an onboarding checklist
  on the Investisseurs panel showing where each investor is: login ✓ → profile ✓
  → position. `Profil incomplet` already exists; extend it to "Aucune position".
- Warn when a product has investor capital but **no house position**, because
  the denominator then counts only investor money and every share is overstated.

**Investor gate.** First login lands on an empty portfolio. Replace the bare
"pas encore configuré" dead-end with a state that says what is pending.

## Stage 2 — The trading month

**Admin gate.** `/api/cron/investor-rollup` folds `order_history` into
`investor_daily_product_stats` — 3 trailing days by default, `?date=` to
backfill, max 30. No UI at all.

Refine — **new `POST /api/admin/investments/rollup`**, gated on
`canManageInvestments`, reusing `computeDailyRollup` + `persistDailyRollup`
from `src/lib/investors/load-rollup.ts`. The cron route stays; this is the
operator path, because the cron needs `CRON_SECRET` and cannot be called from a
browser.

**Investor gate.** The live estimate. This is where layout B lands:

- `src/lib/investors/portfolio.ts` — add `sharePct` to `PositionSummary`,
  derived from the `allPositions` set the module already fetches for
  `estimateUnsettled` (no new query); expose each waterfall line as product
  figure + investor share; add `reserveReleaseAfter`.
- `src/components/investor/PositionCard.tsx` — two-column waterfall,
  `PRODUIT (100%)` vs `VOUS (n%)`, then a `VOTRE ARGENT` block splitting
  déjà réglé / estimation en cours.
- `src/components/investor/CapitalJourney.tsx` — the `1.03×` multiple counts
  only settled profit while a 14,543.999 estimate sits directly below it. Base
  it on settled + pending, or label it explicitly as settled-only.

## Stage 3 — Closing the period

**Admin gate.** Market + dates → Prévisualiser → Confirmer la clôture. The
preview reconciles investor + house shares against net profit and refuses to
settle if they disagree. *Built and working.*

Refine — in `src/components/investor/AdminInvestorsClient.tsx`, detect which
days in the chosen range have no `investor_daily_product_stats` rows and offer
to compute them before previewing. This removes the 422 dead-end (I hit it and
had to run the rollup 62 times by hand).

**Capital rule change** — `src/lib/calculations/investor-allocation.ts`,
`activeCapitalInPeriod`: weight each position by `overlapping days ÷ days in
period` instead of counting any overlap at full value. Reuse `daysInPeriod`
from `load-rollup.ts`.
- Both `computeSettlement` and `estimateUnsettled` call it, so both change.
- Settled statements are unaffected — they snapshot `capital_basis`.
- A position spanning the whole period is unchanged (weight = 1); only partial
  periods move, which is the point.
- Existing expectations in
  `src/lib/calculations/__tests__/investor-allocation.test.ts` encode the old
  rule — rewrite them first, watch them fail, then change the function.
- State the rule in the UI so it is not a surprise.

**Investor gate.** A new statement appears. Show the capital basis and the
period's share alongside it.

## Stage 4 — Reserve maturity

**Admin gate.** Released automatically 90 days after `period_end` by the rollup
cron. Invisible. Surface upcoming and released reserves in the admin view.

**Investor gate.** `src/components/investor/BalanceCard.tsx` — the reserve tile
shows **when** it matures, not just how much is held.

## Stage 5 — Payout

**Investor gate.** Request → the amount is claimed against the balance. Both
surfaces now agree on "Disponible" after the earlier fix.

**Admin gate.** Demandes de retrait: Approuver / Refuser / Marquer payé with a
reference. The ledger entry is written **only** on mark-paid. *Built and
working.*

**Both gates — the missing narrative.** A `correction`, a `reserve_release` or
a paid withdrawal changes the balance with no visible cause anywhere. Add:
- **new `GET /api/investor/ledger`** (service-role, scoped to the session user,
  same pattern as `/api/investor/portfolio`) and a `Mouvements` section on
  `StatementsClient`;
- the same history per investor on the admin side, since an admin currently
  cannot see what anyone is owed or why.

This is the single highest-value addition: it is what turned the −67.260
correction from "money vanished" into an explainable line.

## Stage 6 — Exit and principal return

`principal_return` is in the `entry_type` CHECK and folded by
`investor-balance.ts`, but **nothing writes it** — returning capital needs a
hand-typed correction today.

Add an **Exit** flow on the admin gate: close the position (existing
`PATCH /api/admin/investments/[id]`) and post a `principal_return`, behind one
confirm. Reuse `post_investor_correction`, which already accepts that type.

On the investor gate, show the closed position and the returned capital rather
than having the product silently disappear.

---

## Deliberately out of scope

- `investor_statements.status` has three values but only `settled` is reachable
  (`computeSettlement` emits `draft`, the RPC overwrites it; nothing writes
  `paid`). Cleaning this up touches RLS — separate change.
- The house receives no statement, so its own share appears in no report.
- The funnel reads oddly on real data (1,634 delivered vs 2 confirmed) because
  `order_history` holds few `confirmed` transitions. That is a data question,
  not a UI bug — confirm before "fixing" it.

---

## Verification

- TDD throughout, per `CLAUDE.md`: failing test first, every stage.
- `npm run typecheck` and `npm run build` clean.
- Investor domain suite stays green (currently 144 tests across 14 files).
- Full suite: expect the **30 known pre-existing failures** across 14 unrelated
  files and no others — confirmed earlier against a clean `HEAD` worktree.
- Replay the whole six-stage scenario against the **local** `ordra_e2e` database
  (145 migrations replayed, `supabase/tests/validate-investor-domain.sql`
  passing) — not production, which still holds undeletable fixture rows from the
  walkthrough: 6 ledger entries, 1 settled statement, 1 paid withdrawal and the
  `investors` row for `ilyes@oms.local`.
- Drive the finished flow in the browser as both roles with Playwright, the way
  the original defects were found.
