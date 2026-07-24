# Round 3 — Dashboard (Accueil) Overhaul

## Context

Round 3 of the section-by-section admin redesign (round 1 = Accueil/COMMANDES nav+orders, round 2 = FINANCES). The user chose the **Dashboard** page for this round. Audit (3 Explore agents) found: the dashboard is a two-tier design system (Panel/KpiCard tokenized, everything else inline hex), has no Skeleton and no error state, uses a hex pill FilterBar instead of the shared underline-tab PeriodSelector, computes revenue/net-profit through a different calc module than P&L (and **double-counts packing cost** — every order confirmed AND delivered in-window pays packing twice), and the sidebar prefetch warms a dead endpoint (`/api/metrics`). The all-markets ~52-query fan-out and the RLS statement-timeout share a root cause with P&L but are **explicitly out of scope** (user decision).

**Branch**: `feat/dashboard-overhaul` stacked on `feat/finances-overhaul`. First action when implementing: save this plan verbatim to `plans/dashboard-redesign.md` (project rule).

## User decisions (binding)

1. **No backend perf work** — no migration, no RLS change, no fan-out batching, no fetchAllRows changes.
2. **Period UI unified** — extend shared `PeriodSelector` (custom range + controlled preset + preset list), migrate dashboard, P&L, team, confirmation-flow; delete `FilterBar` **and** `TeamPeriodSelector` (verified: FilterBar is used by dashboard+pnl only; team/confirmation-flow use TeamPeriodSelector).
3. **Financial KPI unification on the P&L path** — dashboard revenue/netProfit computed with `lib/calculations/profitability.ts` functions (cents math, packing on confirmed-events only). Numbers change slightly by design.
4. **Full visual overhaul** — layout rework, token migration, Skeleton, error state, dashboard-shaped `loading.tsx`, prefetch fix. TDD waived (round-2 mode): update touched tests + cover changed server behavior in same commit.

## Verified key facts (Plan agent, code-checked)

- `TrendChart.tsx` orphaned (0 importers). Hero **revenue sparkline is a dead flat-zero line** (`buildDailyTrend` called without revenue map at `summary.ts:655`) → remove, don't restyle.
- `page.tsx` fallbackData key mismatches the client mount key whenever scope cookie ≠ tn → first paint refetch; fix with `getActiveMarketScope`.
- `/api/metrics` consumed only by the stale prefetch + own test → delete after repoint. (`settings/MarketsSection.tsx` calls `/api/metrics/cross-market` which never existed — pre-existing 404, out of scope, note only.)
- Dashboard vs P&L divergence: packing double-count (above) + float vs cents; revenue & ad-spend definitions already identical.
- `fetchFinancials`'s `totalOrders`/`rejectedCount` head queries feed discarded outputs → delete (6→4 queries/call).
- FilterBar "week"/"month" are ROLLING windows (`lastNDaysPeriod(7/30)`) → must map to `last7`/`last30` tabs, NOT PeriodSelector's calendar week/month presets.
- `DateRangePicker.tsx` is orphaned + broken (missing i18n namespace) — do not use; custom range = plain date inputs.
- `business-profitability.ts` becomes orphaned (tests only) after unification — flagged, NOT deleted (spec'd model, user's call later).

## Phases & commits

### Phase 1 — Period selector unification

**C1 `feat(shared): extend PeriodSelector with controlled preset, preset list and custom range`**
- `src/components/shared/PeriodSelector.tsx`: props `{ period, onChange(p, preset), presets? (default ["today","week","month","last7","last30"]), activePreset?, maxDate? }`; add `yesterday` preset (`daysAgoISO(1)`); `custom` tab reveals row 2 with `from`/`to` labels + two native date inputs (`h-8 rounded-[6px] border border-line bg-surface-card px-2 text-[13px]`), from `max={to}`, to `min={from} max={maxDate}`; underline tabs per §4.11 unchanged (accent only on active underline). Backward compatible with products consumers.
- New `src/components/shared/__tests__/PeriodSelector.test.tsx` (ports FilterBar.test.tsx rolling-window cases + presets/controlled/custom/maxDate).
- i18n both files: `periodSelector.yesterday/custom/from/to`.

**C2 `refactor(dashboard): migrate dashboard and P&L period selection to shared PeriodSelector`**
- `DashboardClient.tsx`: presets `["today","last7","last30","custom"]`, initial `today`; periodLabel remap (today→vsYesterday, last7→vsLastWeek, last30→vsLastMonth, custom→vsPrevious); FilterBar card wrapper gone — tabs sit on page.
- `pnl/ProfitabilityClient.tsx`: same presets, initial `last30` (period unchanged); drop labels plumbing.
- i18n: delete `dashboard.filters.{today,week,month,custom}` (keep the rest).

**C3 `refactor(team): migrate team and confirmation-flow to shared PeriodSelector`**
- `TeamWorkspace.tsx`: presets `["yesterday","last7","last30","custom"]`, `maxDate={todayISO()}`, initial `yesterday`; `Period` type import repointed.
- `ConfirmationFlowWorkspace.tsx`: same swap, initial `last7` (keep its pre-existing 8-day initial period as-is).
- Delete `src/components/team/TeamPeriodSelector.tsx`; delete `teamPerf.periods` from both i18n files (grep first).

**C4 `chore(dashboard): delete legacy FilterBar`** — delete `FilterBar.tsx` + `FilterBar.test.tsx`.

### Phase 2 — Financial KPI unification (Option A: calc-module swap, keeps query shape)

**C5 `refactor(dashboard): compute financial KPIs with the P&L calc module`**
- `src/lib/dashboard/summary.ts`: drop `calculateBusinessProfitability` import; in `fetchFinancials` delete the two dead head-count queries; new exported pure `computeFinancialSummary({delivered, returned, confirmedPacking, adSpend})` → `{revenue, netProfit}` implemented ONLY with `calculateRevenue/calculateCogs/calculateDeliveryCost/calculateReturnCost/calculatePackingCost/calculateNetProfit` from `@/lib/calculations/profitability` (server-side only). Return shape unchanged → call sites untouched.
- Definitional change accepted: packing counted once (confirmed-events in window only); cents math. Revenue/ad-spend/topProducts/trend unchanged.
- `summary.test.ts`: `computeFinancialSummary` describe block pinning parity with `profitability.test.ts` fixtures.

**C6 `refactor(dashboard): single role-gate helper for financial stripping`**
- `summary.ts`: export `stripFinancials(summary)`; `route.ts` + `page.tsx` both use `canViewFinanceSection(actor.role) ? summary : stripFinancials(summary)` (from `@/lib/finance-permissions`). route.test.ts assertions unaffected. Unit-test stripFinancials.

### Phase 3 — Prefetch + fallback alignment

**C7 `fix(dashboard): prefetch the summary endpoint and honor the scope cookie in the server fallback`**
- `prefetch.ts`: dashboard block drops `/api/metrics` + `/api/markets`; preloads `/api/dashboard/summary?from_date=<today>&to_date=<today>&market_id=<mid>` byte-identical to `buildSummaryKey` (mid from scope cookie / user.market_id, default tn).
- `page.tsx`: use `getActiveMarketScope(user)` so server fallback key equals client mount key for every cookie state.

**C8 `chore(api): remove orphaned /api/metrics route`** — delete route + its test (post-repoint reference check).

### Phase 4 — Visual overhaul

Grammar: cards `bg-surface-card border border-line-subtle rounded-[8px]`, labels `text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary`, values `font-bold tabular-nums text-ink-primary`, hover `hover:shadow-hover-row`; replace `useIsMobile` with responsive classes; logical properties only; `FinanceHeroCard`/pnl states are the visual reference.

**C9 `feat(dashboard): tokenize hero KPI band and sparkline`** — `HeroKpiStrip.tsx` HeroCard rebuilt on FinanceHeroCard pattern, grid `grid-cols-2 lg:grid-cols-4`, remove dead revenue sparkline, remaining sparklines use neutral `--chart-line` `#8C9196`; `Sparkline.tsx` tooltip dark→card style (recharts contentStyle inline = allowed exception); update `HeroKpiStrip.test.tsx`.

**C10 `feat(dashboard): attention bar and insights band token redesign`** — `AlertAttentionBar.tsx`: white card + status-token pill chips, lucide `TriangleAlert`/`Check` replace glyphs; `InsightsBand.tsx`: white pills, tone survives in icon only (`TrendingUp/TrendingDown/Sparkles`), keep `data-tone`. Update both tests.

**C11 `feat(dashboard): pipeline bars, top performers, top products and markets strip token redesign`** — `HorizontalBars.tsx`: `barClassName` (default `bg-ink-primary`, kills decorative blue), track `bg-surface-selected`; `TopPerformers.tsx` / `TopPerformingProducts.tsx` / `MarketsStrip.tsx` / `KpiCard.tsx` fully tokenized (MarketsStrip drops decorative green/red on rates; drill button = outline secondary; drop useState hovers). Update touched tests.

**C12 `feat(dashboard): page layout, footer cards, error state and skeleton loading`**
- `DashboardClient.tsx`: root → token classes; SWR destructures `error`, adds `keepPreviousData: true`, `summary = data?.data ?? null` with branches: null+loading → in-page Skeleton band (`role="status"`); null+error → `role="alert"` critical card + retry (pattern from `ProfitabilityClient.tsx:180-188`); data+error → slim stale-data banner.
- `FooterLinks.tsx` → proper KPI cards grid.
- New `src/app/[locale]/(dashboard)/dashboard/loading.tsx` (dashboard-shaped Skeleton, overrides group generic).
- i18n both files: `dashboard.loadError`, `dashboard.retry`.

**C13 `chore(dashboard): remove orphaned TrendChart, tokenize group loading skeleton, relocate periodDeltaProps`** — delete `charts/TrendChart.tsx`; tokenize group-level `loading.tsx`; move `PeriodDeltaBadge.tsx` → `components/finance/periodDelta.ts` (+test), repoint single pnl import. Leave `business-profitability.ts` (flag only).

## Verification

1. `npm run typecheck`; targeted vitest: PeriodSelector, summary, dashboard route, components/dashboard, profitability route+calc, team/confirmation-flow suites; `npm run build`. (14 pre-existing failing files from variant work — judge only touched suites.)
2. Playwright (dev :3000): super_admin fr — first-paint fallback (no dup fetch), tab presets + custom range, all-markets → MarketsStrip → drill, **dashboard vs P&L same-range revenue/netProfit identical**; ar RTL mirror; manager fr+ar — financials stripped; error state via route abort + retry; throttled reload for loading.tsx. Screenshots of every state; kill dev server + delete stray screenshots after.

## Risks

- SWR key byte-equality (prefetch/page/client build the same raw string; no URLSearchParams).
- `keepPreviousData` + nullable summary: verify no null-crash paths; managers keep instant paint via fallbackData.
- Preset semantics trap: rolling week/month → `last7`/`last30`, never calendar presets.
- Sparkline shared with team page — only tooltip restyled, `color` prop contract kept.
- i18n deletions land in same commit as last usage removal (grep fr AND ar).
- MarketsStrip drill (`marketIdToCode` TN/LY only) preserved as-is; realtime `mutateSummary` identity stable.
- NEVER touch: `src/app/api/orders/**`, `src/app/api/products/[id]/variants/**`, `src/lib/orders/webhook-handler*`, `src/lib/product-calculations*`, `src/types/product.ts`, variant migration, `tsconfig.tsbuildinfo`.
