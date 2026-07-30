# Investor Role & Portal — Ordra OMS


## Context

Ordra tracks COD e-commerce across two markets (TN/LY) and already computes a full per-product P&L. The business is funded in part by outside investors who put capital into specific products, and today their reporting is manual — screenshots and WhatsApp messages.

This adds a fifth role, `investor`: a read-only, mobile-first portal where an investor sees the live operational story of the products they funded (orders in → confirmed → uploaded → delivered), the full profit waterfall, their share of it, and a balance they can actually withdraw against.

The calculation engine mostly exists. [`calculateProductProfitability()`](../../Documents/CODE/XPAND/Internal-tools/ORDER%20MANAGMENT%20SYSTEM/oms-cloned-/Ordra/src/lib/calculations/product-profitability.ts) already produces per-product, per-period revenue / COGS / delivery / returns / packing / ad spend / processing / net profit. What's missing is a **capital ledger**, an **allocation rule**, and a **settlement + payout ledger**.

`src/lib/investors/`, `src/app/api/investor/{portfolio,withdrawals}/`, `src/app/api/admin/investments/settlements/` and `src/app/[locale]/investor/` already exist as **empty directories** from an abandoned session. They are placeholders, not partial work.

### Decisions taken

| Decision | Choice |
|---|---|
| Unit of investment | Capital-weighted per product — share% = investor capital ÷ total capital in that product, per period |
| Profit line shared | **Net profit**, after COGS, delivery, returns, packing, ad spend, processing |
| Cash-out model | Live accrual → monthly settlement lock (with reserve) → withdrawable |
| Visibility | Full waterfall, but only for products they hold a position in |
| Security | `actor.ts` impersonation hole fixed **first**, as a blocking Phase 0 |
| Market-wide ad spend | Allocated across products pro-rata by delivered revenue |

### The non-negotiable design rule

**A settlement snapshots its inputs. It never recomputes from a live join.**

Today the P&L recomputes from `order_history` joined against *current* `products.unit_cogs` and *current* `carriers.delivery_fee`. Fine for a dashboard, fatal for payouts — a late return, or an admin editing a cost, silently rewrites a period you already paid out on. Every `investor_statements` row therefore stores both the computed figures **and** the cost inputs used. Late-arriving returns become a **correction line on the next period**, never a retroactive edit.

---

## Phase 0 — Security hardening (blocking)

Nothing external-facing ships until this is done.

**1. Close the actor impersonation hole.** [`src/lib/auth/actor.ts:25-37`](../../Documents/CODE/XPAND/Internal-tools/ORDER%20MANAGMENT%20SYSTEM/oms-cloned-/Ordra/src/lib/auth/actor.ts) unconditionally trusts `x-oms-role` / `x-oms-actor-id` / `x-oms-market-id` request headers. Middleware never sets them, and its matcher excludes `/api/*` entirely — so any authenticated user can send `x-oms-role: super_admin` to ~165 route handlers, many of which then use `createAdminClient()` and bypass RLS.

Fix: delete the header-trust branch. Replace it with verification of the existing signed profile cookie — [`src/lib/auth/profile-cookie.ts`](../../Documents/CODE/XPAND/Internal-tools/ORDER%20MANAGMENT%20SYSTEM/oms-cloned-/Ordra/src/lib/auth/profile-cookie.ts) already does HMAC-SHA256 sign/verify with a 5-minute TTL, and `getServerUser()` already uses it as a fast path. Same performance, no new infrastructure, unforgeable. Fall back to `auth.getUser()` on cookie miss, exactly as today.

**2. Enforce account status at auth time.** Neither `middleware.ts`, `src/lib/auth/server-user.ts`, nor `actor.ts` checks `is_active` or `deleted_at`. Deactivating a user does not stop them logging in. Add the check to both resolvers and to the profile-cookie payload; on deactivation, also revoke the Supabase auth session rather than only flipping the flag.

**3. Update the tests** in `src/lib/auth/__tests__/actor.test.ts`, which currently construct actors via those headers.

---

## Phase 1 — Schema, ledger, and calculation engine

### Migration: `supabase/migrations/<ts>_investor_role_and_positions.sql`

**Role.** Widen the `users_role_check` constraint to include `investor`. The constraint is auto-named — copy the `pg_constraint` lookup-and-recreate pattern from `supabase/migrations/20260421_warehouse_schema.sql:13-33`. `chk_users_role_market` needs no change: investors are market-scoped (one currency, no FX).

**Tables.**

- `investors` — `id` → `users.id`, legal name, payout method, `payout_details JSONB`, notes
- `investment_positions` — `investor_id` (NULL = **house capital**), `product_id`, `market_id`, `amount NUMERIC(12,3)`, `effective_from`, `effective_to` (NULL = open), `status`, `created_by`
  - House capital as `investor_id IS NULL` rows keeps the pro-rata denominator honest and time-varying, so a restock funded by the business automatically dilutes correctly.
- `investor_statements` — `investor_id`, `product_id`, `period_start/end`, the full snapshotted waterfall (revenue, cogs, delivery, returns, packing, ad_spend_direct, ad_spend_allocated, processing, net_profit), `cost_inputs JSONB`, `share_pct`, `investor_share`, `reserve_held`, `status` (`draft|settled|paid`), `settled_at/by`
  - Unique on `(investor_id, product_id, period_start, period_end)` → settlement is idempotent.
- `investor_ledger` — **append-only**, mirroring the `order_history` / `inventory_log` house style. `type` ∈ `accrual | settlement | reserve_hold | reserve_release | withdrawal | correction | principal_return`, signed `amount`, `statement_id`, `created_by`, `note`. Add a trigger rejecting UPDATE and DELETE.
- `withdrawal_requests` — `amount`, `status` (`requested|approved|rejected|paid`), timestamps, `decided_by`, `payout_reference`

**RLS.** Investors get an allow-list of exactly their own rows on the five tables above (`get_user_role() = 'investor' AND investor_id = auth.uid()`). They are deliberately granted **no** policy on `orders`, `order_history`, `products`, `users`, or `ad_spend` — the portal reads server-computed endpoints and rollups only. Since every existing policy is an explicit allow-list, the new role defaults to zero access, which is the behaviour we want.

**Also apply the pending denormalization** from `plans/profitability-timeout-denormalize-order-history-market-id.md` (`order_history.market_id` + trigger + composite index). It was planned and never shipped; `/api/profitability` already times out at ~14 days for `market_manager`, and investors want since-inception views.

### Calculation modules — `src/lib/calculations/` (server-only, TDD, pure)

- `ad-spend-allocation.ts` — split `product_id IS NULL` ad spend across products pro-rata by delivered revenue in the period. This also closes the documented reconciliation gap in `plans/finances-restructure-redesign.md` where product profits don't sum to the market P&L.
- `order-revenue-attribution.ts` — **no existing P&L code reads `order_items`**; 100% of `orders.total_price` is attributed to the denormalized `orders.product_id`. Harmless on a dashboard, wrong when it decides who gets paid. Attribute per product as `total_price × (line_total ÷ SUM(line_total))`, which correctly spreads the `delivery_fee` and the Libya card surcharge across lines.
- `investor-allocation.ts` — `computeSharePct({ investorCapital, totalCapital })` and `computeInvestorShare(netProfit, sharePct)`. **Loss rule: a negative period carries forward against future profit and never produces a negative payout or a clawback.**
- `investor-balance.ts` — fold the append-only ledger into `{ pending, reserve, available, withdrawn, lifetimeProfit, principal }`.

**Fix `math.ts` precision.** [`toCents`/`fromCents`](../../Documents/CODE/XPAND/Internal-tools/ORDER%20MANAGMENT%20SYSTEM/oms-cloned-/Ordra/src/lib/calculations/math.ts) round to 2 decimals, but every money column is `NUMERIC(10,3)` (millimes). Move to 3-decimal precision globally rather than forking a second helper — a divergence between investor math and business math is exactly the thing that destroys trust in a settlement. Existing calculation tests will need their expected values updated.

---

## Phase 2 — Daily rollup

Since-inception aggregation over `order_history` will not survive live querying. Add `investor_daily_product_stats` (`product_id`, `market_id`, `date`, leads / confirmed / uploaded / delivered / returned counts, revenue, cogs, delivery_cost, return_cost, packing_cost, processing_cost) populated by a cron route under `src/app/api/cron/`, following the existing cron pattern and `vercel.json` config.

The portal reads this table, never `order_history`. It also gives the sparklines and cumulative-profit curves for free.

---

## Phase 3 — API surface

Fill the empty directories. Every investor route: `getActor()` → assert `role === 'investor'` → scope every query by `actor.id`. **Never accept an `investor_id` from the client.**

| Route | Purpose |
|---|---|
| `GET /api/investor/portfolio` | Positions, balance breakdown, per-product summary |
| `GET /api/investor/products/[productId]` | Full waterfall, funnel, rates, stock burn-down |
| `GET /api/investor/statements` + `/[id]` | Statement archive |
| `GET /api/investor/pulse` | Lightweight recent-activity feed for the live ticker |
| `GET/POST /api/investor/withdrawals` | Request + history |
| `GET/POST/PATCH /api/admin/investments` | Position CRUD (super_admin) |
| `POST /api/admin/investments/settlements` | Close a period |
| `PATCH /api/admin/investments/withdrawals/[id]` | Approve / reject / mark paid |

**Settlement must be a Postgres RPC**, not app code: `settle_investor_period(market_id, period_start, period_end)` computes shares, inserts statements and ledger rows, and moves pending → reserve + available in a single transaction. Idempotent via the unique constraint above. Follow the existing RPC style in `supabase/migrations/` (e.g. `transition_order_status`).

Mirror every server guard on the corresponding page — the codebase deliberately duplicates the check in both places (see the comment in `src/lib/finance-permissions.ts`).

---

## Phase 4 — Investor portal UI

New route group `src/app/[locale]/(investor)/investor/` with its own shell, mirroring `src/app/[locale]/(warehouse)/layout.tsx`. **Mobile-first** — the only part of this desktop-first OMS that should be.

**`/investor` — portfolio home**
- *Capital journey* hero: `10,000 TND → 340 units → 412 orders → 287 delivered → 41,200 revenue → your share 3,180 → 1.32×`
- *Balance card*: Pending / Reserve / Available / Withdrawn
- *Cash cycle timeline*: `confirmed → shipped → delivered → carrier remits → settled → withdrawable`, with an amount at each stage. This is what stops the "why can't I withdraw yet?" messages.
- Position cards, payback progress bar, live pulse feed

**`/investor/products/[id]` — deep dive**
- Funnel (leads → confirmed → uploaded → delivered), cost waterfall, delivery-rate and return-rate gauges — the two numbers that actually decide whether a COD investor makes money
- Stock burn-down (`product_inventory_view` already exists), daily net-profit sparkline, cumulative profit curve

**`/investor/statements`** — archive with CSV export · **`/investor/withdrawals`** — request + history

**Reuse, don't rebuild:** `Panel`/`EmptyState`, the `KpiCard`/`HeroKpiStrip` composition, `HorizontalBars`, `CostCompositionBars`, `FinanceFunnel`, `GoalBar`, `Sparkline` (lazy-loaded recharts via `next/dynamic({ ssr: false })`), `PeriodSelector`, `Pagination`, `formatCurrency` from `src/lib/format.ts`, and the `ui/` primitives. Tailwind semantic tokens only — no inline hex.

⚠️ **Realtime won't work here.** The existing `postgres_changes` bus requires SELECT on `orders`, which investors deliberately do not have. Use SWR polling (`refreshInterval: 30_000`) against `/api/investor/pulse` instead. Do not widen RLS to make realtime work.

---

## Phase 5 — Admin surface

An "Investisseurs" section in `NAV_SECTIONS` ([`src/components/layout/Sidebar.tsx:92-176`](../../Documents/CODE/XPAND/Internal-tools/ORDER%20MANAGMENT%20SYSTEM/oms-cloned-/Ordra/src/components/layout/Sidebar.tsx)) under FINANCES, `superAdminOnly: true`: positions, statements, settlement runner, withdrawal approvals, and a per-product capital table showing house vs investor split.

---

## Role plumbing

Follows the `warehouse_agent` precedent. The `Record<Role, …>` maps will fail typecheck until updated, which surfaces most sites automatically.

- **Type:** `src/types/index.ts:3`, and the **duplicate union** at `src/lib/role-permissions.ts:1` (it re-declares rather than importing — consider fixing while here)
- **Permission maps:** `PERMISSIONS` in `role-permissions.ts` (`investor: ["/investor"]`), `ROLE_PERMISSIONS` in `user-permissions.ts`
- **Domain helpers** — each is an `if` chain falling through to `return false`, so investor safely denies by default. Audit `order-`, `product-`, `settings-`, `finance-`, `lead-`, `follow-up-`, `mapping-`, `fulfillment-permissions.ts` and `auth/market-scope.ts`.
- **Middleware** `src/middleware.ts`: `getRoleHome()` → `/{locale}/investor`; add `/investor` to `knownRoutes`; add investor to the hardcoded `/dashboard` bounce at lines 158-171.
- **🔴 Route leak — must handle.** `knownRoutes` is an opt-in list that omits `/dashboard`, `/in-delivery`, `/follow-ups`, `/mappings`, `/finance`, `/admin`, `/confirmation-flow`, `/markets`. Those pages guard with *denial lists* (`role === "agent" || role === "warehouse_agent"`), so a new role falls straight through into manager pages. Add a surgical middleware rule: **if `role === 'investor'` and the path is not under `/{locale}/investor` or `/{locale}/profile`, redirect to `/{locale}/investor`.** Low-risk, closes the leak completely, no refactor of the other roles' routing.
- **User creation:** `CREATABLE_ROLES` in `src/app/api/users/route.ts:13` and `src/components/settings/UsersSection.tsx:29`, plus `SUPER_ADMIN_CREATABLE` in `CreateUserPanel.tsx`. Investor = **super_admin only**. Consider real email addresses rather than the synthetic `username@oms.local` scheme, since investors are external.
- **Labels:** `nav.roles.investor` and `users.sections.investor` in `src/messages/{fr,ar}.json`; `ROLE_LABEL` in `Topbar.tsx`; `ROLE_ORDER` in `UsersPageClient.tsx`; `ROLE_LABELS` in `profile/page.tsx` (already stale — missing `warehouse_agent`)

---

## Verification

TDD is non-negotiable per `CLAUDE.md` — failing test first, every time.

**Known-numbers test (mandatory before any investor sees a figure).** Seed one product with fixed `unit_cogs`, carrier fees, packing and processing costs; N delivered, M returned, a known ad spend; one investor holding 40% of capital. Assert the exact investor share by hand-calculation. Repeat for: zero delivered orders, a negative period, and a period where a return lands after the delivery period closed.

**Reconciliation test.** `SUM(all investor shares) + house share === market net profit` for the same period. This currently fails in the codebase and is the single best proof the ad-spend allocation and `order_items` attribution fixes landed correctly.

**Ledger tests.** Balance folds correctly from the append-only rows; the trigger rejects UPDATE and DELETE; settlement run twice produces one set of statements.

**Security tests.** `x-oms-role: super_admin` no longer escalates on any route. An investor session cannot read `orders`, `products`, `users`, or another investor's rows through RLS. A deactivated investor cannot log in.

**Manual end-to-end.** `npm run dev` → create an investor + position as super_admin → log in as the investor → walk portfolio → product deep dive → request a withdrawal → back to super_admin → settle the period → confirm the balance moves pending → reserve + available → approve and mark paid → confirm the ledger and statement archive.

**Gates.** `npm run typecheck` after each file · `npm test` continuously · `npm run lint` and `npm run build` before commit.
