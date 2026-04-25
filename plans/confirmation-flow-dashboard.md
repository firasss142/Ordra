# Redesign: EN CONFIRMATION → Confirmation Flow Dashboard

## Context

Today, the "EN CONFIRMATION" sidebar item sends managers to `/[locale]/orders?status=assigned,attempt_1,attempt_2,attempt_3,callback_scheduled` — a filtered orders table with no funnel insight, no per-agent struggle signals, no time-to-confirmation distribution, no callback-due-soon list. Managers cannot answer their core question: **"What are my agents doing RIGHT NOW and who is struggling?"**

This plan introduces a dedicated manager oversight dashboard at `/[locale]/confirmation-flow` that visualizes the confirmation funnel (assigned → attempt_1 → attempt_2 → attempt_3 → callback_scheduled → confirmed | rejected), surfaces struggling agents, lists callbacks due imminently, and enables in-place manual intervention via reassignment. Realtime updates reflect agent actions without manual refresh.

User decisions confirmed:
- **Escalation**: skipped in v1. No new `orders.escalated_at` column. UI exposes a disabled slot tagged `TODO(v2)`.
- **"Ping agent now"**: UI-only confirmation flash in v1. Real notifications deferred.
- **Route name**: `/[locale]/confirmation-flow` (new dedicated route).

## Route Decision

New dedicated route: `src/app/[locale]/(dashboard)/confirmation-flow/page.tsx`. Manager + super_admin only; agents redirected to `/queue` using the same pattern as [team/page.tsx](src/app/[locale]/(dashboard)/team/page.tsx).

Sidebar repoint: change the `inConfirmation` item's `href` in [Sidebar.tsx](src/components/layout/Sidebar.tsx) from `orders?status=…` to `confirmation-flow`. The existing filtered `/orders` URL stays reachable for drilldowns — clicking a funnel bar navigates to `/[locale]/orders?status=<stage>&agent_id=<id>`.

## API Design

Two endpoints, not one fat aggregator — different refresh cadences (callbacks are time-sensitive, ~30s; funnel/TTFC are fine at ~60s). Mirrors the existing `/api/team` + `/api/team/sparklines` split.

### 2a. `GET /api/confirmation-flow/overview`

File: [src/app/api/confirmation-flow/overview/route.ts](src/app/api/confirmation-flow/overview/route.ts)

Query params: `market_id?`, `from_date?`, `to_date?`. Defaults to last 7 days.

Auth: `getActor(req)` → reject role `agent`. For `super_admin`, require `market_id`. For `market_manager`, force `actor.market_id`.

Response:
```ts
{
  funnel: Array<{
    stage: 'assigned' | 'attempt_1' | 'attempt_2' | 'attempt_3' | 'callback_scheduled';
    open_count: number;                    // current open orders in this stage
    entered_count: number;                 // order_history rows status_to=stage in window
    avg_time_in_stage_minutes: number | null;
    drop_off_rate_pct: number | null;      // vs previous stage, null for 'assigned'
  }>;
  stage_transitions: Array<{ from_stage: string; to_stage: string; count: number }>;
  agents: Array<{
    agent_id: string;
    full_name: string;
    avatar_url: string | null;
    in_attempt_3: number;
    overdue_callbacks: number;
    stuck_order_ids: string[];             // capped at 10
    ttfc_p50_minutes: number | null;
    ttfc_p90_minutes: number | null;
    ttfc_samples: number[];                // downsampled, max 100
  }>;
  ttfc_distribution: {
    bucket_minutes: number[];              // [0, 5, 15, 30, 60, 120, 240, 480, 1440]
    counts_total: number[];
    counts_by_agent: Record<string, number[]>;
  };
  window: { from: string; to: string };
  computed_at: string;
}
```

Implementation notes:
- Reuse `TERMINAL_STATUSES` and `ATTEMPT_STATUSES` from [src/types/order-status.ts](src/types/order-status.ts).
- Open counts: `SELECT status, assigned_to FROM orders WHERE market_id=$1 AND status IN (funnel stages)`; group in JS.
- Transitions + time-in-stage + TTFC: single `order_history` window query `.gte(created_at, from).lte(created_at, to).in(status_to, funnelStages ∪ ['confirmed','dispatched','rejected'])`. Walk per-order history to compute entries/exits.
- Overdue callbacks: `SELECT id, assigned_to FROM orders WHERE market_id=$1 AND status='callback_scheduled' AND callback_scheduled_at < now()`.
- Cap `order_history.limit(50000)` — match [src/app/api/team/route.ts](src/app/api/team/route.ts).
- Pure aggregation helpers live in [src/lib/confirmation-flow/aggregations.ts](src/lib/confirmation-flow/aggregations.ts) for easy unit testing.
- **Reuse**: extend [src/lib/team/ttfc.ts](src/lib/team/ttfc.ts) with `percentileMinutes(values, p)` rather than duplicating the existing `medianMinutes`/`computeTTFCMinutes`.

### 2b. `GET /api/confirmation-flow/callbacks-due`

File: [src/app/api/confirmation-flow/callbacks-due/route.ts](src/app/api/confirmation-flow/callbacks-due/route.ts)

Query params: `market_id?`, `within_minutes?` (default 30, max 240).

Response:
```ts
{
  data: Array<{
    order_id: string;
    external_id: string | null;
    customer_name: string;
    callback_scheduled_at: string;
    minutes_until: number;                 // negative → overdue
    agent_id: string | null;
    agent_full_name: string | null;
  }>;
  now: string;                             // server ISO to avoid client-clock drift
}
```

Implementation: single query on `orders` filtered `status='callback_scheduled' AND callback_scheduled_at BETWEEN now()-interval '5 min' AND now()+interval 'N min'` with join for agent name. Client computes `minutes_until` from `callback_scheduled_at - now`.

### 2c. Escalation — Skipped in v1

No schema change. No new endpoint. `AgentStrugglingTable` row actions include a disabled "Escalate" slot with `title="Coming in v2 — use reassign for now"`. Reassignment (existing `/api/orders/[id]/reassign` and `/api/orders/bulk-reassign`) covers manager intervention.

## Schema Changes

**None.** All data derivable from existing `orders` + `order_history`. If performance degrades at scale, add these indexes in a follow-up migration (verify against existing `supabase/migrations/019_performance_indexes.sql` and `20260424_orders_keyset_index.sql` first — `market_id, status` may already exist):

```sql
CREATE INDEX IF NOT EXISTS orders_callback_due_idx
  ON orders (market_id, callback_scheduled_at)
  WHERE status = 'callback_scheduled';
```

## UI Components

All under [src/components/confirmation-flow/](src/components/confirmation-flow/). Inline styles (dashboard convention — see [TeamWorkspace.tsx](src/components/team/TeamWorkspace.tsx)). Tokens: bg `#F6F6F7`, card `#FFFFFF`, border `#E1E3E5`, text `#1A1A1A`, muted `#6D7175`, action `#2C6ECB`, success `#008060`, warning `#B98900`, critical `#D72C0D`.

- **ConfirmationFlowWorkspace.tsx** — orchestrator. Props `{ role, marketId }`. Owns period selector state, selected-agent drilldown. Reuses [TeamPeriodSelector](src/components/team/TeamPeriodSelector.tsx). Layout: 2-col top (FunnelChart | CallbacksDueSoon), AgentStrugglingTable full-width, TtfcDistribution full-width.

- **FunnelChart.tsx** — recharts horizontal `BarChart` with drop-off annotations between bars. Clicking a bar navigates to `/[locale]/orders?status=<stage>`. Not a Sankey (extra lib weight for marginal value).

- **AgentStrugglingTable.tsx** — plain `<table>` following [TeamTable.tsx](src/components/team/TeamTable.tsx) pattern. Columns: agent, `in_attempt_3`, `overdue_callbacks`, `ttfc_p50`, `ttfc_p90`, actions. Default sort by struggle score (`in_attempt_3 + overdue_callbacks` desc). Warning tint when `in_attempt_3 ≥ 5` OR `overdue_callbacks ≥ 3`; critical tint when both.

- **CallbacksDueSoon.tsx** — compact list. Rows colored by urgency: green ≥15min, amber 5–15min, red <5min / overdue. "Ping agent" button → v1 UI flash only (`TODO(v2): notifications channel`). Uses [EmptyState](src/components/shared/EmptyState.tsx).

- **TtfcDistribution.tsx** — recharts stacked `BarChart` by bucket, with [Select](src/components/shared/Select.tsx) to switch "All agents" / individual. Buckets: `0-5m, 5-15m, 15-30m, 30-60m, 1-2h, 2-4h, 4-8h, 8-24h, 24h+`. Histogram over heatmap — safer at narrower viewports and RTL.

- **ReassignActionMenu.tsx** — thin wrapper around existing [ReassignControls.tsx](src/components/team/ReassignControls.tsx), passing stuck order IDs. Calls `mutate` on overview + callbacks hooks on success. No edits to ReassignControls.

- **NewEventsBanner.tsx** — "N updates · refresh" banner fed by the realtime debounce counter.

- **AgentStrugglingTable.test.tsx** under `__tests__/` — minimal RTL test for sort + tint logic.

## SWR Hooks

- **[src/hooks/useConfirmationFlowOverview.ts](src/hooks/useConfirmationFlowOverview.ts)** — `refreshInterval: 60_000`, `revalidateOnFocus: false`, `keepPreviousData: true`.
- **[src/hooks/useCallbacksDueSoon.ts](src/hooks/useCallbacksDueSoon.ts)** — `refreshInterval: 30_000`, `revalidateOnFocus: true`.
- **[src/hooks/useConfirmationFlowRealtime.ts](src/hooks/useConfirmationFlowRealtime.ts)** — NEW, not extending `useOrdersRealtime` (which is coupled to the infinite orders cache invariant).

## Realtime Strategy

- Channels: `orders:market:{marketId}` (add listener alongside existing orders hook — no conflict) **and** new `order_history:market:{marketId}` with `postgres_changes` filter `market_id=eq.{marketId}` on INSERTs.
- Debounced invalidation, **not** client recompute. Events collected in a ref; after 3s quiet → `mutateOverview()`; if any event touched `status='callback_scheduled'` or `callback_scheduled_at` → also `mutateCallbacks()`.
- Debounce 3s active, 10s when `document.visibilityState === 'hidden'`.
- Counter exposed to `NewEventsBanner` so manager can force-flush.
- Cleanup on unmount — mirror [useFollowUpsRealtime.ts](src/hooks/useFollowUpsRealtime.ts).

## Files Created / Modified

### Created

Server (TDD — write test first for each route):
- [src/app/api/confirmation-flow/overview/route.ts](src/app/api/confirmation-flow/overview/route.ts)
- [src/app/api/confirmation-flow/overview/route.test.ts](src/app/api/confirmation-flow/overview/route.test.ts)
- [src/app/api/confirmation-flow/callbacks-due/route.ts](src/app/api/confirmation-flow/callbacks-due/route.ts)
- [src/app/api/confirmation-flow/callbacks-due/route.test.ts](src/app/api/confirmation-flow/callbacks-due/route.test.ts)
- [src/lib/confirmation-flow/aggregations.ts](src/lib/confirmation-flow/aggregations.ts)
- [src/lib/confirmation-flow/aggregations.test.ts](src/lib/confirmation-flow/aggregations.test.ts)

Hooks:
- [src/hooks/useConfirmationFlowOverview.ts](src/hooks/useConfirmationFlowOverview.ts)
- [src/hooks/useCallbacksDueSoon.ts](src/hooks/useCallbacksDueSoon.ts)
- [src/hooks/useConfirmationFlowRealtime.ts](src/hooks/useConfirmationFlowRealtime.ts)

UI:
- [src/app/[locale]/(dashboard)/confirmation-flow/page.tsx](src/app/[locale]/(dashboard)/confirmation-flow/page.tsx)
- [src/components/confirmation-flow/ConfirmationFlowWorkspace.tsx](src/components/confirmation-flow/ConfirmationFlowWorkspace.tsx)
- [src/components/confirmation-flow/FunnelChart.tsx](src/components/confirmation-flow/FunnelChart.tsx)
- [src/components/confirmation-flow/AgentStrugglingTable.tsx](src/components/confirmation-flow/AgentStrugglingTable.tsx)
- [src/components/confirmation-flow/CallbacksDueSoon.tsx](src/components/confirmation-flow/CallbacksDueSoon.tsx)
- [src/components/confirmation-flow/TtfcDistribution.tsx](src/components/confirmation-flow/TtfcDistribution.tsx)
- [src/components/confirmation-flow/ReassignActionMenu.tsx](src/components/confirmation-flow/ReassignActionMenu.tsx)
- [src/components/confirmation-flow/NewEventsBanner.tsx](src/components/confirmation-flow/NewEventsBanner.tsx)
- [src/components/confirmation-flow/__tests__/AgentStrugglingTable.test.tsx](src/components/confirmation-flow/__tests__/AgentStrugglingTable.test.tsx)

i18n:
- Add `confirmationFlow.*` keys in `src/i18n/messages/{fr,en,ar}.json` (or wherever message files live — verify during implementation).

Plan copy (per CLAUDE.md):
- `plans/confirmation-flow-dashboard.md` (mirror of this plan inside the repo)

### Modified
- [src/components/layout/Sidebar.tsx](src/components/layout/Sidebar.tsx) — repoint `inConfirmation` item href to `confirmation-flow`.
- [src/components/layout/prefetch.ts](src/components/layout/prefetch.ts) — add prefetch for the two new endpoints at default params.
- [src/lib/team/ttfc.ts](src/lib/team/ttfc.ts) — export `percentileMinutes(values, p)`.
- [src/lib/team/ttfc.test.ts](src/lib/team/ttfc.test.ts) — add percentile cases.

## Verification

### Seed data (scratch SQL, not a migration)
- 3+ orders in each stage (assigned, attempt_1, attempt_2, attempt_3, callback_scheduled) across 3 agents.
- One agent with 6 orders at `attempt_3` (should trigger warning tint).
- 2 overdue callbacks (`callback_scheduled_at` ~10 min ago) + 1 due in 5 min.
- 10 historical confirmed orders over last 7 days with varied assigned→confirmed durations.

### Manual walkthrough
1. Log in as `tn_manager` → `/fr/confirmation-flow`. Funnel bars, agent table, callback list render with correct counts.
2. Second tab as `tn_agent_1`: transition an order from attempt_2 → attempt_3. Within ~3s the banner appears in the manager tab; clicking refreshes funnel.
3. Reassign stuck orders from the struggling agent → overview revalidates, row counts drop.
4. Log in as `tn_agent_1` → `/fr/confirmation-flow` → redirects to `/fr/queue`.
5. Log in as `admin` (super_admin), don't pick a market → overview returns 400 with clear message.
6. RTL sanity: `/ar/confirmation-flow` — alignment, chart labels, logical properties.

### Automated
```
npm test -- confirmation-flow
npm test
npm run typecheck
npm run lint
npm run build
```

## Risks & Trade-offs

- **Attempt-derivation cost**: walking `order_history` per request is O(rows). 50k cap + 60s cadence is safe for current scale. If `orders.attempts_count` (per migration `20260418_attempts_count_and_retry_times.sql`) is already populated, prefer reading it over re-counting.
- **Realtime fan-out**: bulk reassigns fire many events. 3s debounce + 5s min between `mutateOverview` calls prevents thrashing. Documented in hook.
- **Percentile noise at small N**: UI shows `—` when `ttfc_samples.length < 5` — matches the existing `ttfc_median` nullability convention.
- **Sidebar href change**: managers who bookmarked `/orders?status=…` still work (route unchanged); only the sidebar target moves.
- **TDD order**: per CLAUDE.md, write failing route.test.ts first → watch fail → implement route. Same for aggregation helpers.
