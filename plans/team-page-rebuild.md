# Équipe — rebuild `/team` as one live, period-scoped agent page

Durable copy: save as `plans/team-page-rebuild.md` in phase 0 (user rule: plans live in `plans/`).

## Context

The "Salle de contrôle" (`/team`) and "Performance" (`/team/performance`) pages were designed
in a 2026-08 session around concepts the user never asked for: orphan queues, blocked-order
triage, "sans appel", three fixed daily goals (12 treated / 40 % rate / hygiene), streaks,
coaching targets. The user (super_admin) and both market managers open the team page several
times a day and today go to **Performance filtered to today** instead, because the live page
answers questions they do not have. Interview outcome (2026-09-25):

- **Real questions:** who is working right now and who is idle; who is underperforming and
  needs a talk; what each agent has done (on click, with a few insightful numbers); what I
  owe each agent.
- **Not a need on this page:** stuck orders. Commandes covers that. Reassign / retour au pool
  are not used from here.
- **What an agent is accountable for:** every new order called quickly, a good confirmation
  rate, a clean queue. **Not** a fixed daily count ("ignores inflow"), **not** "treated" as the
  unit of work (attempts and callbacks are work).
- **Biggest problem:** too many invented concepts.

Result: one page, `/team`, period selector with **Aujourd'hui (live) as default**, an agent
table judged on **speed to first call, confirmation rate vs the team, and work volume**, with
live presence/availability/idle on today only, an agent drawer, a pure ranking, per-product
rates, and commissions kept as they are (balance + Payer on the row, ledger in the drawer).

Out of scope, separate plan: **auto-reject at max attempts** (today the RPC rejects only on the
click *after* the max while the sheet hides that button, so orders sit at `attempt_3`;
`after_max_attempts_action` settings exist and nothing reads them).

## Decisions (all confirmed by the user)

| Topic | Decision |
|---|---|
| Structure | One page `/team`; presets Aujourd'hui (default, live) · Hier · 7 j · 30 j · custom; drawer on click; one market at a time (switcher; "all" → default market as today) |
| Deleted | À débloquer, Rappels à venir, files orphelines, tentatives épuisées, sans appel, verdict bar, 4 tiles, goals/GoalSegments/streaks/coaching/`agent_targets` reads, scatter chart, presence heatmap, day-cell drawer, Réassigner / Retour au pool, readiness panel, TeamStrip as-is, full Commissions table, Objectifs settings tab + `goal_*` keys |
| Speed ("Réactivité") | % of orders assigned to the agent in the period first-called within **2 h of `orders.assigned_at`**, plus median delay. Live: count "en attente > 2 h" per agent |
| Rate | confirmed / (confirmed + rejected) distinct orders; shown as **± pts vs team rate of the same period**; `x/y` under 10 treated (`MIN_TREATED_FOR_RATE`) |
| Volume | Appels (attempt_1/2/3, callback_scheduled, confirmed, rejected rows), Confirmées, Rejetées, active minutes (10-min buckets, unchanged) |
| Working signals (live) | presence from `users.last_seen_at` (online < 5 min / idle < 30 / offline, `src/lib/presence.ts`), availability `users.is_available`, last action, **idle flag = is_available AND holds ≥ 1 order AND no action ≥ 30 min** |
| Row action (live) | "Mettre en pause" → existing `POST /api/agent/availability {is_available:false, agent_id, reason}` (pattern in `AgentReadinessPanel.tsx:31-47`) |
| Top strip | live: au travail / disponibles / total · all periods: appels · confirmations · taux équipe. Nothing else |
| Below table | Classement (conf / active hour, pure: rank · conf/h · rate ± vs team · hours; eligibility ≥ 60 min & ≥ 10 treated from `rankAgents`) · Par produit (team rate + best/worst agent spread, existing `ProductsCard` logic) |
| Drawer | funnel (calls/confirmed/rejected/rate vs team) · réactivité (%, median, waiting > 2 h now when live) · queue by product with oldest age (live) · rejection reasons · per-product rate vs team · **per-day bars** (calls + confirmations) for multi-day periods · commission section (balance, period earned/paid, CSV link, Payer) |
| Commissions | unchanged: `/api/team/commissions`, `get_team_commissions`, `BalanceCell`, `PayoutModal`, `submitPayout` |

## Data layer — two RPCs, split by volatility

`supabase/migrations/<ts>_team_period_rpcs.sql` (SECURITY DEFINER, STABLE, `SET search_path = public`,
JSONB out, same market guard as `get_team_live` in `supabase/migrations/20260815154546_team_rpcs.sql:58-68`).
End of file: `REVOKE EXECUTE ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;` for both.

### `get_team_period(p_market_id, p_from, p_to, p_tz)` — everything judged over a period
Today = `from = to = today`. Local-day bounds as in the old `get_team_performance` (:311-313).

- `agents`: `role='agent' AND is_active AND deleted_at IS NULL AND market_id`.
- `hist`: the **only** time-bounded `order_history` scan (`created_at ∈ [v_from, v_to)`, actor in agents),
  joined to orders/products for product key, name, image, rejection_reason. No status filter (active
  minutes count every action).
- `per_agent`: calls (6 statuses), treated, confirmed, rejected (DISTINCT order), active_minutes, days_active.
- `daily`: same four per local day (for the drawer bars).
- `cohort` (réactivité population): `orders WHERE assigned_to IN agents AND assigned_at ∈ [v_from, v_to)
  AND status NOT IN ('cancelled','deleted')` (uses `idx_orders_market_assigned_at`).
- `first_call`: `LEFT JOIN LATERAL (SELECT min(created_at) FROM order_history WHERE order_id = c.order_id
  AND actor_id = c.agent_id AND created_at >= c.assigned_at AND status_to IN (6 statuses))` — bounded by
  the cohort not by time, so a yesterday-assigned order called this morning is found (`idx_order_history_order_id`).
- `reactivity` per agent + `team_reactivity`: `assigned`, `judged` (first call exists OR assigned ≤ now − 2 h),
  `within_2h`, `pending` (no call, assigned < 2 h ago; excluded from %), `median_min`
  (`percentile_cont(0.5)` over called orders only).
- `agent_products`, `motifs`, `team_products` (with nested per-agent spread), `team` totals: as today's RPC.
- Output: `{from, to, tz, market_id, computed_at, team:{calls,treated,confirmed,rejected,active_minutes,reactivity},
  agents:[{agent_id,name,avatar_url,calls,treated,confirmed,rejected,active_minutes,days_active,reactivity,daily[],products[],motifs[]}],
  products:[...]}`.

**Documented limitations of réactivité** (RPC comment + docs): a reassigned order belongs to the current
holder's cohort; return-to-pool nulls `assigned_at` (trigger `trg_orders_assigned_at`) so the order leaves
every cohort; orders assigned before 2026-09-19 were backfilled with `assigned_at = created_at`, so periods
before that date measure delay since creation (irrelevant for the presets from 2026-10-19).

### `get_team_now(p_market_id)` — the light live overlay
- `agents` with `last_seen_at, is_available, available_since` (presence computed in TS via `getPresence()`,
  deleting the duplicated SQL CASE).
- `q`: held orders in confirmation-phase statuses.
- `uncalled`: held, status in pending/attempt_*/callback_scheduled, `assigned_at < now − 2 h`, and
  `NOT EXISTS` a call row by the holder since `assigned_at` (replaces the old unbounded `attempted` CTE).
- Per agent: `queue {total, oldest_hours, waiting_over_2h, oldest_waiting_hours, by_product[{product_name,status,n,oldest_hours}]}`,
  `last_action` via `LEFT JOIN LATERAL ... ORDER BY created_at DESC LIMIT 1` (`idx_order_history_actor_created`).

### Drop migration (phase 5)
`<ts>_drop_old_team_rpcs.sql`: `DROP FUNCTION IF EXISTS get_team_live(UUID,TEXT), get_team_performance(UUID,DATE,DATE,TEXT), get_agent_day_detail(UUID,UUID,DATE,TEXT);`.
`agent_targets` table and `goal_*` settings rows stay (nothing reads them).

### SQL test (first, TDD)
`supabase/tests/team_period_test.sql`, pattern of `supabase/tests/stock_actor_and_rls_test.sql` (`\i _helpers.sql`,
tagged fixture, `set_config('request.jwt.claims', …, true)` in a `DO`). Gotcha: the trigger stamps `assigned_at`
on INSERT, so set custom stamps with `UPDATE orders SET assigned_at = …` afterwards. Assert: per-agent
calls/confirmed/rejected; réactivité on a 3-order cohort (30 min, 3 h, never-called-old) → `within_2h=1,
judged=3, median_min=105`; cancelled order excluded; a reassigned order counted only under the new holder;
daily rows split at a Tripoli local midnight; LY manager JWT on TN market → `{}`; anon has no EXECUTE on
either function; `get_team_now.waiting_over_2h` counts the never-called old order and not the one the holder called.

## API + hooks

- `src/app/api/team/period/route.ts` → `rpc("get_team_period", {p_market_id, p_from, p_to, p_tz})`; market via
  `resolveTeamMarket` (`src/lib/team/api-market.ts`); validate dates, from ≤ to, ≤ 92 days (copy `performance/route.ts`).
- `src/app/api/team/now/route.ts` → `rpc("get_team_now", {p_market_id})`.
- `src/hooks/useTeamPeriod.ts`: key `/api/team/period?market_id&from_date&to_date`; `refreshInterval` 60 s when
  the period is today, 300 s otherwise; realtime nudge only when today.
- `src/hooks/useTeamNow.ts`: key `/api/team/now?market_id`; 30 s poll; nudge on `orders` + `order_history`.
- Extract the debounce/nudge block of `src/hooks/useTeamLive.ts` into `src/hooks/useRealtimeNudge.ts`, shared.
- Delete `useTeamLive.ts`, `useTeamPerformance.ts`.

## Lib (`src/lib/team/`)

- `types.ts`: rewrite to the two payloads (`TeamPeriod`, `PeriodAgent`, `PeriodReactivity`, `PeriodDaily`,
  `PeriodProduct`, `TeamNow`, `NowAgent`, `NowLastAction`, `NowQueueProduct`). Delete all `Live*`, `Perf*`,
  `Blocked*`, `Upcoming*`, `Day*`, `AgentTargets`, `TargetMetric`.
- `goals.ts` → `git mv` to `metrics.ts`: keep `rateOf`, `MIN_TREATED_FOR_RATE`, `MIN_ACTIVE_MINUTES_FOR_RANK`,
  `confirmationsPerHour`, `rankAgents`, `formatActiveMinutes`; delete `GoalTargets`, `DEFAULT_GOAL_TARGETS`,
  `evaluateDailyGoals`, `computeGoalStreak`, `suggestCoachingTarget`. Move + trim `goals.test.ts` accordingly.
- `view-models.ts`: rewrite. Keep `localDaysBetween`, `medianOf`, `productSpread`. New pure, tested:
  - `IDLE_AFTER_MS = 30 min`, `REACTIVITY_WINDOW_H = 2`
  - `rateVsTeam(agent, team) → {value, delta, shown}` (shown iff treated ≥ 10; delta = round1(agent − team), null when hidden or team treated = 0)
  - `isIdle({is_available, queueTotal, lastActionAt}, now)`
  - `reactivityOf(r) → {pct|null, medianMin|null, judged, withinWindow, pending}` (pct null when judged = 0)
  - `sortRows(rows, live)`: live → presence group (online, idle, offline), idle flag first within group, queue desc, name; period → confirmed desc, name
  - `buildTeamView(period: TeamPeriod, now: TeamNow | null, clock: Date) → TeamView {days, isLive, strip, rows, byId, ranking, products, otherProducts}`
- `format.ts`: add `fmtDelay(locale, minutes)` ("12 min" / "1 h 40" / "2 j") and `fmtHours(locale, hours)`.
- Delete `day-view.ts` (+ test), `heat.ts`, `reassign-queue.ts` (+ test), `readiness-summary.ts` (+ test). Keep `api-market.ts`.

## Components (`src/components/team/control-room/`)

| File | Action |
|---|---|
| `TeamWorkspace.tsx` | NEW, replaces both workspaces: period state (default today), `useTeamPeriod` + `useTeamNow` (only when today) + `useTeamCommissions` (same period), `buildTeamView`, drawer, `PayoutModal`, pause action, toasts |
| `PeriodControls.tsx` | MODIFY: presets `today | yesterday | 7d | 30d | custom`, today first + default |
| `TeamStrip.tsx` | REWRITE: au travail / disponibles / total (live only) · Appels · Confirmations · Taux équipe |
| `AgentTable.tsx` (+ inner `PauseButton`) | NEW, replaces `AgentRoster`. Columns: Agent (avatar, presence dot, Disponible chip — live) · Dernière action (live) · Appels · Confirmées · Rejetées · Taux (`x/y` or `xx % (+3,2 pts)`) · Réactivité (`71 % ≤ 2 h · méd. 38 min`) · File (live: count, oldest, "n en attente > 2 h") · Solde + Payer (`BalanceCell`) · Action (Mettre en pause, live, only when available). Idle flag = small amber chip "inactif n min", no stripe |
| `RankingCard.tsx` | MODIFY: remove target, progress bar, streak, coaching CTA, product filter; row = rank · avatar · name · conf/h · rate ± vs team · active hours; keep "Hors classement" footer |
| `ProductsCard.tsx` | KEEP, props from `TeamView` |
| `AgentDrawer.tsx` | REWRITE content (sections listed in Decisions); receives `TeamView` + `agentId`, no self-fetch |
| `DailyBars.tsx` | NEW: calls + confirmations per local day, plain divs, only when `days.length > 1` |
| `AgentAvatar`, `Card`, `CommissionSection`, `CommissionsCard` (for `BalanceCell`), `PayoutModal` | KEEP (`CommissionsCard` table not rendered; CSV link moves into the drawer's commission section) |
| `TeamLiveWorkspace`, `TeamPerformanceWorkspace`, `LiveTiles`, `GoalSegments`, `BlockedOrdersCard`, `UpcomingCallbacksCard`, `AgentReadinessPanel` (+ test), `PresenceHeatmap` (+ test), `ThroughputRateChart`, `AgentDayDrawer` (+ test), `AgentRoster` | DELETE |

Pages & nav:
- `src/app/[locale]/(dashboard)/team/page.tsx` renders `TeamWorkspace` (keep agent redirect + "all" fallback).
- `team/performance/page.tsx` → bare `redirect` to `/${locale}/team`; delete its `loading.tsx`.
- `src/app/[locale]/(dashboard)/commissions/page.tsx:17` redirect → `/team`.
- `src/components/layout/Sidebar.tsx:198-211`: Équipe = `team` ("Équipe") + `access`; drop `performanceLive`.
- `src/components/layout/prefetch.ts:31` preloads a non-existent `/api/team` — remove.

i18n (`src/messages/fr.json`, `ar.json`): delete `team.live`, `team.perf`, `team.drawer`, `team.dayDrawer`,
`nav.controlRoom`, `nav.performanceLive`; add `nav.team`; keep `team.presence`, `team.relative`, `team.commissions`;
new `team.page` with `periods`, `strip`, `table`, `ranking`, `products` (moved from `perf.products`), `drawer`.
Status/reason labels keep coming from `orders.statuses` / `orders.rejectionReasons`. No hardcoded strings
(the old readiness panel had them). Logical CSS props for RTL.

Settings cleanup: delete `src/components/settings/general/ObjectifsSection.tsx`, its tab in
`GeneralSettingsGroups.tsx` (:40, :141-144, :262), and the `goal_*` keys in `src/types/settings.ts`
(:186-191, :288-291, :353-356, :568-571) + their i18n. DB rows stay.

## TDD order

1. SQL: `supabase/tests/team_period_test.sql` → `supabase/tests/run.sh team_period_test.sql` fails → migration → green.
2. Lib: `metrics.test.ts` (moved), `view-models.test.ts` rewritten (`rateVsTeam` hidden/rounding/team-0; `isIdle`
   unavailable→false, empty queue→false, no action ever→true, 29 min→false, 30 min→true; `reactivityOf` judged 0→null;
   `sortRows`; `buildTeamView` with and without `now`; ranking eligibility; product spread), `format.test.ts` for `fmtDelay`.
3. API: `period/route.test.ts`, `now/route.test.ts` with the `vi.mock("@/lib/auth/actor")` + `mockRpc` pattern of
   `src/app/api/team/commissions/payouts/route.test.ts`: 401, 403 agent, 400 bad dates / > 92 d / missing market for
   super_admin, manager pinned to own market, rpc args, 500 on rpc error.
4. Components (`NextIntlClientProvider` inline messages as in `CommissionsCard.test.tsx`): `PeriodControls`
   (today first, `aria-pressed`), `AgentTable` (live columns absent when `isLive=false`; `x/y` under 10; delta sign;
   idle chip; Pause posts `agent_id`, hidden for unavailable), `TeamStrip`, `RankingCard` (no target text),
   `DailyBars`, `AgentDrawer` (bars only multi-day; waiting-now only live).
5. Hooks are not unit-tested in this repo: verify in the Network tab that a realtime tick does not refetch
   `/api/team/period` when the preset is 7 j.

## Deletion double-checks (verified)
- `useAgentCapacity` + `/api/agents/capacity`: used by `src/components/assign/*` and `prefetch.ts` → **keep**.
- `readiness-summary.ts`: only `AgentReadinessPanel` → delete.
- `get_agent_day_detail`: only `agent-day/route.ts`, `types.ts`, `day-view.ts` → drop after those go.
- `agent_targets`: read only by the two old RPCs and `targets/route.ts` → table stays, route deleted.
- Delete routes: `src/app/api/team/{live,performance,agent-day,targets}/route.ts`, `src/app/api/team/[agentId]/queue/route.ts` (+ test).
  Keep `availability/reset` (cron) and all `commissions/*`.

## Phases
0. **Prototype built 2026-09-25: `prototypes/team-v1.html`** — real Libya data read at 16:01 Tripoli with the
   exact definitions of this plan (the queries double as a dry run of `get_team_period` / `get_team_now`).
   All four presets, drawer, FR/AR (stage mirrored), toggles for the open decisions. **Awaiting user review.**
   Open decisions surfaced by the real data:
   - Idle rule: "Disponible + file + 30 min" flags nobody — `agent_availability_log` is empty for Libya since
     2026-09-23, so nobody uses the toggle. Recommended: "Disponible **or en ligne** (seen < 30 min)".
   - Small samples: réactivité % and team rate hidden under 10 (shown as x/y), same rule as the agent rate.
   - Active time is formatted in hours only (67 h, never "3 j").
   - Per-product spread shown as text (worst → best, gap in pts); the old range strip was unreadable.
1. Migration + SQL test.
2. `types.ts`, `metrics.ts`, `view-models.ts`, `format.ts` + tests.
3. Routes + tests; hooks.
4. Components + tests; `page.tsx`; performance redirect; Sidebar; i18n `team.page`.
5. Cleanup: deletion list, drop migration, `commissions/page.tsx` redirect, `prefetch.ts`, i18n groups, Objectifs settings.
6. Docs: `docs/crm-and-team.md` (control room + performance sections → one section with the three definitions and the
   réactivité limitations), `CLAUDE.md` navigation line (Équipe → Équipe, Accès) and the `lib/team/` line,
   `docs/agent-commissions.md:43-44` surfaces, `docs/order-distribution.md` §6 bis (readiness panel → chip + pause on the
   table), superseded note in `plans/team-control-room-redesign.md` and `plans/team-performance-day-drawer-redesign.md`.
   Follow-up plan to open: auto-reject at max attempts.

## Verification
- `npm run typecheck` · `npx vitest run src/lib/team src/components/team src/app/api/team` · `supabase/tests/run.sh team_period_test.sql`
  · `supabase db reset --no-seed` (both migrations apply in chain) · `npm run build`. (`npm run lint` lints nothing in this repo — do not report it.)
- Supabase security advisors: no `anon_security_definer_function_executable` for the two new functions.
- `EXPLAIN ANALYZE SELECT get_team_period(<ly>, today-29, today, 'Africa/Tripoli')` on local prod-sized data: target < 200 ms,
  plan uses `idx_orders_market_assigned_at` and `idx_order_history_order_id`.
- Manual: `manager.tn` → `/fr/team` opens on Aujourd'hui with presence dots, Disponible chips, idle chip on a
  qualifying agent; switch 7 j → live columns and the working/available cell vanish; click a row → drawer with per-day
  bars; Payer opens `PayoutModal`; Mettre en pause on an available agent flips the chip and toasts the released count.
  `manager.ly` → `/ar/team` RTL mirrored, delta signs correct. `admin` with switcher on "all" → default market; switching
  market changes data. `agent1.tn` → `/queue`. `/fr/team/performance` → redirects. Paramètres no longer shows Objectifs.
