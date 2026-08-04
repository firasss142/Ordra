# Investor portal — UI/UX restructure (both gates)

## Context

The investor domain computes correctly — verified end to end against production.
The problem is that it **explains nothing**, and the UI is the reason.

Three numbers that describe the same money sit on one screen with no stated
relationship (`settledShare` 672,600 · `netProfit` 38 041,498 · `unsettledEstimate`
14 543,999). Four balance buckets render in identical greyscale, so "money you can
take" looks exactly like "money already gone". Nothing on the portfolio is clickable,
so an investor can never ask *why* about any figure. Money moves — a correction, a
reserve release, a paid withdrawal — with no visible cause on either gate. And the
admin who approves the payouts cannot see what any investor is owed.

Meanwhile the payload already carries the fix and the UI throws it away:
`PositionSummary.sharePct` and `PositionSummary.yours` (the investor's share of all
seven cost lines) are computed and never rendered; `PortfolioResult.reserveReleaseAfter`
is computed and never reaches `BalanceCard`; the settlement preview returns
`reconciliation[]` / `unreconciled[]` / `alreadySettled` and the admin sees three numbers.

Full behavioural context: `Ordra/docs/investor-domain.md`.

**This plan is layout, structure and design only.** No new financial math, no change to
the settlement engine, no capital-rule change. TDD is waived for this task by explicit
instruction — existing suites are updated alongside the components, not written first.

### Decisions taken
1. **Extend the design system, with written rules.** A new §10 in `docs/design-system.md`
   scopes four allowances to the investor portal and nothing more.
2. **Two levels of depth.** Compact tappable product cards on the overview; funnel,
   waterfall and dates move to a real route `/investor/products/[productId]`.
3. **Investor gate ships first**, admin gate second.

---

## §10 — Investor portal (the design-system extension)

The admin system is written for staff at a desk all day: flat, greyscale, zero
decoration. The investor portal is an outsider checking their money on a phone. It
inherits everything **except** these four, which are permitted **only** under
`src/components/investor/` and `src/app/[locale]/(investor)/`:

| Allowance | Rule |
|---|---|
| **Money-direction colour** | `status-success #008060` for money coming in, `status-critical #D72C0D` for money going out or lost. Functional, not decorative — it is status *for money*. Never on a neutral figure. |
| **Product imagery** | `products.image_url` via `ProductAvatar`. The only imagery allowed; product identity is the investor's mental model. |
| **Hover/press elevation** | `shadow-hover-row` on *tappable* cards only — already sanctioned by §2 for interactive rows. Resting cards stay flat. |
| **Hero type scale** | One figure per screen may use the `KpiCard` 28px scale. Exactly one. |

Still forbidden here: gradients, accent green outside its two reserved slots,
decorative colour, shadows on resting non-interactive cards.

---

## Phase 1 — Investor gate

### 1.1 Product images (3 edits, no migration, no RLS change)

Every real product already has an image (9/9 in production; the only two without are
E2E fixtures, which fall back to the letter avatar).

- `src/lib/investors/portfolio.ts` ~line 238 — `products(name)` → `products(name, image_url)`
- same file — widen `PositionRow.products` to `{ name: string; image_url: string | null }`,
  add `imageUrl: string | null` to `PositionSummary`
- reuse **`src/components/orders/ProductAvatar.tsx` verbatim** (raw `<img>`, lazy,
  `object-cover`, letter-avatar on error). Do **not** introduce `next/image` — 
  `next.config.mjs` has no `images` key, and raw `<img>` is the codebase convention for
  every remote image.

Drop-in points: investor product card (56px), product detail hero (72px), admin
positions table (28px), statement rows (28px).

### 1.2 Overview restructure — `PortfolioClient.tsx`

Today: `CapitalJourney` → `BalanceCard` → `CashCycleTimeline` → positions. Three
explainer bands before you reach the thing you own.

**The central simplification:** `BalanceCard`'s four buckets (En cours → Réserve →
Disponible → Retiré) and `CashCycleTimeline`'s three stages (Livré → Réglé → Retirable)
are *the same story told twice*, with different labels and different numbers. That
duplication is a direct cause of the "unclear / ambiguous" complaint. Merge them.

New order:

| # | Component | Notes |
|---|---|---|
| 1 | **`BalanceHero.tsx`** *(new)* | One number — **Disponible** at the 28px hero scale — with the withdraw CTA inline (`Button variant="primary" size="md"` → `/investor/withdrawals`). Today the portal's primary action is a 32px `size="sm"` button two taps away. Uses the existing `balance.claimedHint`. |
| 2 | **`BalanceFlow.tsx`** *(replaces `BalanceCard` + `CashCycleTimeline`)* | One horizontal money-flow strip: **En cours → Réserve → Retiré**, each stop showing its amount *and its next event*. The reserve stop finally renders `reserveReleaseAfter` ("libérée le 29 juin") — already computed, never displayed. `Disponible` is promoted out to the hero, so nothing competes with it. |
| 3 | **Vos produits** | grid of the new `PositionCard`. `sm:grid-cols-2` (not `lg:` — at `lg` the container is already at its `max-w-5xl` cap, so today the 2-col layout never engages on a tablet). |
| 4 | **`CapitalJourney.tsx`** *(demoted to last)* | It is context — "how we got here" — not the answer. Keep the 5 steps, add the connectors it never had, and fix the `multiple` figure, which counts settled profit only while a pending estimate sits above it: either base it on settled + pending or label it. |

`CashCycleTimeline.tsx` is **deleted** — its `cleared` flag is static, it has no dates,
and its meaning now lives in `BalanceFlow`.

### 1.3 Product detail — new route

- `src/app/[locale]/(investor)/investor/products/[productId]/page.tsx` — server
  component, same guards as `investor/page.tsx`, calls the existing `loadPortfolio()`
  and finds the position in the payload. **No new query** — `loadPortfolio` already
  returns every position. Redirect to `/investor` if the id isn't held.
- `src/components/investor/PositionDetailClient.tsx` *(new)* — SWR on
  `/api/investor/portfolio` with `fallbackData`, filtered by `productId`, so polling
  and cache stay shared with the overview.

Contents, in order:
1. Back link (`ArrowLeft`) + product hero: 72px `ProductAvatar`, name, capital,
   **`effectiveFrom` / `effectiveTo` / `status`** — all three currently fetched and never
   rendered anywhere.
2. **Two-column waterfall (layout B)** — `Produit (100%)` beside `Vous ({pct}%)`, using
   the already-present `sharePct` and `yours`, and the already-present translation keys
   `waterfall.columnProduct` / `waterfall.columnYours`. This is the block that makes
   672,600 + 14 543,999 = 15 216,599 = 40% × 38 041,498 visible instead of inferred.
   The **net-profit total becomes the largest figure in its block** — today it is 13px,
   smaller than the 18px gauges above it.
3. **Funnel, with returns split out.** `Retournées` is not a funnel stage, it is a leak;
   it currently renders in the same grey bar inside the same monotonic list. Move it
   below the funnel in `status-warning`.
4. Per-period statements for this product.

### 1.4 `PositionCard.tsx` — compact, image-led, tappable

Becomes a `<Link>` to the detail route (so it inherits the global `:focus-visible` ring
and works with keyboard and back button) with `hover:shadow-hover-row transition-shadow
duration-fast`.

Renders only: 56px image · name · `capital · sharePct%` · **your net profit** (the
number the investor cares about, at 20px) · the two rate gauges · chevron.
Funnel and waterfall move to the detail surface.

Gauge fixes: the track is currently `bg-surface-card` (white) inside a `bg-surface-sunken`
(#FAFAFB) tile — the empty portion is invisible; use `bg-surface-selected`. The return-rate
gauge is amber at every value; give it thresholds (`success` < 15%, `warning` 15–25%,
`critical` > 25%).

**`PositionCard.test.tsx`** (10 tests, 9 currently red) was written for layout B on the
card. Layout B now lives on the detail surface → move it to
`PositionDetailClient.test.tsx` and update; write a smaller new `PositionCard.test.tsx`
for the compact card. The red suite goes green as part of this step — nothing is reverted.

### 1.5 Ledger — the missing narrative (highest-value addition)

Money changes with no visible cause. Add:

- `src/app/api/investor/ledger/route.ts` *(new)* — GET, mirroring the auth pattern of
  `src/app/api/investor/portfolio/route.ts` exactly: `getServerUser` →
  `canViewOwnPortfolio` → `createAdminClient`, investor id from the **session only**,
  never from input. Response `{ data: [{ id, entry_type, amount, note, created_at,
  product_id, product_name, statement_id, period_start, period_end }] }`,
  `order created_at desc`, `.limit(200)`.
- A **Mouvements** section on `StatementsClient`, money-direction coloured. This is what
  turns "money vanished" into an explainable line.

### 1.6 Remaining screens

**Statements** — the API returns ~25 fields and the UI renders 8. Make each row expand to
its full cost breakdown plus `cost_inputs.reserve_release_after` (the answer to "when do I
get the reserve back"). Give the payout figure real emphasis: today the emphasized
`Montant` differs from its neighbours only by `font-semibold` vs `font-medium` at the same
14px. Add the page `<h1>` the screen has never had.

**Withdrawals** — hero the available amount, add a "Tout retirer" shortcut, promote the
submit button to `size="md"`, and render the full lifecycle (`requested_at` → `decided_at`
→ `paid_at` → `payout_reference`); three of those four are fetched today and dropped.
Explain the disabled state instead of just disabling. Unify the `h2` — it is the only
15px sentence-case section heading in a portal where every other one is 13px uppercase.

**Account** — currently name + email + logout. Add market, currency, reserve % and payout
method; all four are already in the payload or one query away, and all four directly
explain the numbers on the other tabs.

### 1.7 States, correctness and a11y sweep

| Fix | File |
|---|---|
| Skip link `<a href="#main-content">` from the root layout has **no target** in the investor portal — add `id="main-content"` | `InvestorShell.tsx` |
| Hardcoded French "profil non configuré" bypasses i18n although `investor.profileNotConfigured` exists in **both** locales — an Arabic investor sees French | `investor/page.tsx` |
| Error branch is dead code: `fallbackData` means `portfolio` is never falsy, so a failing 30s poll shows stale money silently. Key off SWR `error` and use the already-translated, never-used `errors.stale` | `PortfolioClient.tsx` |
| No skeletons on the heaviest page | `PortfolioClient.tsx` |
| Hint text is `ink-muted` #9CA3AF on white ≈ **2.6:1** at 11px — fails WCAG AA. Move to `ink-secondary` #6D7175 (4.7:1) | all investor components |
| `surface-sunken` #FAFAFB tiles on #FFFFFF cards are a ~1% step — visually invisible. Use `bg-surface-page` or add `border-line-subtle` | `BalanceFlow`, `PositionCard` |
| `border-line-DEFAULT` is a **dead class** — Tailwind flattens `line.DEFAULT` → `line`, so all 18 usages silently fall back to preflight `#e5e7eb` and the agent-theme override can never reach them. Use `border-line` | all investor inputs, both gates |

---

## Phase 2 — Admin gate

**Shell.** `finance/investors/page.tsx` renders a bare `<h1>` with **no page padding and
no background**. Match the app's richest header (`AdSpendClient`):
`bg-surface-page min-h-screen px-4 sm:px-6 pt-5 pb-16 flex flex-col gap-5`, plus subtitle
and market chip.

**Navigation.** Five panels stacked with no way to focus one. Introduce underline tabs
(design-system §4.11 — reuse the existing `OrdersPresetPills` implementation):
`Investisseurs · Positions · Clôtures · Retraits · Corrections`.

**Per-investor detail — the biggest missing surface.** An admin currently cannot see what
any investor is owed or why, yet approves their payouts. Add a drawer using the existing
**`src/components/ui/Sheet.tsx`** primitive (`placement="end"`, focus trap, ESC, scroll
lock — it exists and is unused across this whole surface): positions, the same four
balance buckets the investor sees, statements, ledger, withdrawals. Backed by
`src/app/api/admin/investments/investors/[id]/ledger/route.ts` *(new)*, gated
`canViewInvestorAdmin`.

**Settlement close — stage it.** Today: three fields, a preview showing three numbers, and
one button that writes an irreversible ledger entry with no confirmation. The API already
returns `reconciliation[]`, `unreconciled[]`, `alreadySettled`, `reserveReleaseAfter` and
the full per-investor `statements[]` — **all discarded**. An operator can preview an
already-settled period, see a clean total, click confirm, and get a raw 409 in the same
red 12px line as a network error. Restructure as: range & market → rollup coverage →
preview surfacing reconciliation per product and every statement row → typed confirm.

**Irreversible actions look ordinary.** `Refuser` (withdrawal), `Poster l'écriture`
(correction) and `Confirmer la clôture` all write immutable ledger state and all render as
`primary`/`secondary`. The `destructive` variant exists and is used nowhere here — the
ad-spend delete modal already does this correctly.

**Also:** withdrawals `?status=` filter (the API supports it, the UI never passes it) and a
market column, since TN and LY requests interleave with only the currency symbol to tell
them apart · product images in the positions table · surface the `detail` field that both
409 and 422 responses return and the UI drops · fix the positions table rendering "Aucune
position" when the *fetch failed* (it claims there is no capital when the request merely
errored) · replace the text-only `Chargement…` that §4.12 explicitly forbids · move errors
next to the control that raised them instead of the panel footer.

**i18n.** The entire admin surface is hardcoded French, violating the app-wide
`useTranslations()` rule. Add a `finance.investors.*` namespace to **both** `fr.json` and
`ar.json` (which currently have zero drift in the `investor` namespace — keep it that way).

---

## Out of scope

Business logic of every kind: the capital pro-rata rule, the rollup-trigger endpoint, the
`principal_return` exit flow, `investor_statements.status` cleanup, house statements. Those
belong to the workflow refinement, not this restructure.

The funnel reading oddly on real data (1 634 delivered vs 2 confirmed) is an `order_history`
pipeline gap, **not** a UI bug — "fixing" the display would paper over it.

---

## Verification

- `npm run typecheck` and `npm run build` clean.
- Suites updated alongside (TDD waived): `PositionCard.test.tsx` (moves to
  `PositionDetailClient.test.tsx`), `BalanceCard.test.tsx`, `WithdrawalsClient.test.tsx`,
  and the three `Admin*.test.tsx`. Full run: expect the **30 known pre-existing failures**
  across 14 unrelated files and no others.
- Playwright as both roles at **390px and 1280px**, in **fr and ar** — the portal is the
  only mobile-first surface in the OMS and the only one where RTL is load-bearing.
- Confirm images render for Biovera (TN) and the LY catalogue, and that the letter-avatar
  fallback holds for the two E2E fixtures with no `image_url`.
- Contrast-check every text token that changed against WCAG AA.
- Keyboard pass: every product card reachable and activatable, drawer traps focus, ESC
  closes, skip link lands on `#main-content`.

Durable copy to be saved at `Ordra/plans/investor-portal-ux-restructure.md` on approval.
