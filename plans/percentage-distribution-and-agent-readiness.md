# Distribution par pourcentages + disponibilité agent

> Durable copy to save at `plans/percentage-distribution-and-agent-readiness.md`
> as step 0 (project rule: every Claude-created plan lives under `/plans`).
> Companion doc at `docs/order-distribution.md` at the end.

## Context

Ordra distributes incoming orders to confirmation agents automatically, but a manager
cannot say *how much* of the day each agent should get. The four existing algorithms
answer "whose turn is it" (`round_robin`), "who is least busy" (`workload`), or "who owns
this product/region" — none answer "Ahmed handles 40% of Tunisia, Sara 30%, Karim 30%".

Worse, **no algorithm knows whether an agent is actually working.** `fetchAgentCapacity`
filters on `role='agent' AND is_active=true` — the HR flag — and nothing else. An agent on
leave, asleep, or logged out still receives webhook orders all night. Presence
(`users.last_seen_at`) is computed in five places and consulted by zero of them.

This adds two things that only work together:

1. **A `percentage` algorithm** — per-agent shares of the market's daily volume.
2. **An agent-controlled readiness toggle** — « je suis prêt à prendre des commandes » —
   which gates *every* algorithm, not just the new one.

Percentages without readiness would keep handing quota to absent agents. Readiness without
percentages would leave the split to chance. Intended outcome: a manager sets the split
once, agents declare when they are working, and orders land only on people who can pick up
the phone.

---

## What already exists (this is an extension, not a greenfield build)

| Piece | Where | State |
|---|---|---|
| Pure engine, 4 algorithms | [auto-assignment.ts](src/lib/orders/auto-assignment.ts) | `selectAgent(order, agents, algorithm, config)`, tested |
| Orchestrator | [auto-assignment-orchestrator.ts](src/lib/orders/auto-assignment-orchestrator.ts) | `tryAutoAssign()`, called on every webhook order |
| Agent pool builder | [agent-capacity.ts](src/lib/orders/agent-capacity.ts) | `fetchAgentCapacity()` — shared by automatic **and manual** surfaces |
| `assignment_rules` | [001_initial_schema.sql:287](supabase/migrations/001_initial_schema.sql#L287) | one row per market; RLS already lets managers write their own market |
| Presence | [presence.ts](src/lib/presence.ts) + [heartbeat](src/app/api/presence/heartbeat/route.ts) | 60s/tab, `ONLINE_THRESHOLD_MS` 5min, `IDLE_THRESHOLD_MS` 30min |
| Assignment RPCs | [20260505233818](supabase/migrations/20260505233818_pending_assignment_model.sql) | `assign_order`, `unassign_order`, `return_order_to_pool` |
| Append-only trigger fn | [20260922000001:60](supabase/migrations/20260922000001_scan_rpc_hardening.sql#L60) | `ledger_append_only()` — reuse for the new log |
| Market timezone in SQL | `market_tz(uuid)` in [20260918010002](supabase/migrations/20260918010002_agent_commissions_rpcs.sql#L28) | pinned `search_path`; **reuse, do not add a `markets.timezone` column** |
| Market day in TS | [market-day.ts](src/lib/dates/market-day.ts) | `marketDayStartUtc`, `todayInMarket` |
| Batch distribution precedent | [prospects/distribution.ts](src/lib/prospects/distribution.ts) | pure planner + `?preview=1` — copy this shape |

**Six team settings are stored, validated, and read by no code:** `max_open_orders_per_agent`,
`agent_inactivity_minutes`, `orphan_reassign_*`, `outside_hours_policy`, `shift_config` —
plus `auto_assign_on_intake`, which the UI presents as an intake gate while `tryAutoAssign`
fires unconditionally. This feature makes that vocabulary real, and must not add a seventh
unread knob.

---

## Decisions taken

| Question | Decision |
|---|---|
| Agent not ready → their share | **Strict daily quota.** Targets are absolute shares of the day's total. A returning agent catches up. |
| Turning ready ON | **Drains the unassigned pool**, split by deficit across all ready agents. |
| Scope | **Gates every algorithm.** |
| Readiness | Toggle ON **and** fresh heartbeat. |
| Day boundary | Auto-reset everyone to not-ready at local midnight, per market. |
| Manual assignments | **Count toward the share.** |
| Per-agent hard cap | **None.** (See *Consequences*.) |
| Agent with no share | **Saving blocked** until every active agent is covered. |
| Turning ready OFF | **Untouched orders return to the pool.** Attempted/confirmed work stays. |
| Toggle placement | Topbar status slot, absorbing the live-connection chip. |

---

## The quota model

Among **ready** agents, give the next order to whoever is furthest behind their absolute
target:

```
denominator D = Σ assigned_today over ALL agents in the market (ready or not)
winner = argmax over ready agents of:  share_i × (D + 1)  −  assigned_today_i
tie-break: higher share_pct, then lower queue_size, then id
```

`assigned_today` counts every order assigned to the agent today, manual included.

Shares are **absolute, not renormalised over ready agents.** Renormalising is the
"redistribute pro-rata" model that was considered and rejected; under strict quota an
absent agent's orders are absorbed by whoever is working (pushing them over target), and
the absent agent catches up on return. This is why shares must total exactly 100 — with
absolute targets, a column summing to 80 under-covers the day's volume.

Two properties that matter:

- **It is stateless.** `updated_config` is `null`; counts are read from `orders`.
  Round-robin's `last_assigned_index` is read, then written *after* the RPC — two
  concurrent webhooks both read index 3 and the cursor drifts permanently. The percentage
  engine cannot drift: a race costs at most one order and the next assignment corrects it.
  **Do not "optimise" this into a stored counter.** (The drain is different — see Step 7.)
- **Catch-up is automatic**, which is the chosen model, not a bug.

Put this formula in the function's doc comment. It is the whole algorithm.

---

## Hazards that shape the design

### ⚠ The lock-guard landmine — read before writing any SQL
[20260925000003_order_lock_guard.sql](supabase/migrations/20260925000003_order_lock_guard.sql)
patched `assign_order`, `unassign_order`, `return_order_to_pool` **in place**, by rewriting
`pg_get_functiondef()` output to splice in `assert_order_unlocked(...)`. That guard exists
in no readable function body on disk. A `CREATE OR REPLACE` from the 20260505233818 source
silently removes it and nothing fails. The migration says so itself.

Consequences, both mandatory:
- Maintain `orders.assigned_at` with a **trigger**, never by re-emitting those three
  functions. This is the primary justification for the trigger, not line count.
- Any migration here that does touch them must end with
  `SELECT public.assert_lock_guards_installed();`.

### ⚠ `assignment_rules.is_active` can be switched off from a different page
The seed sets `is_active = true`, so picking an algorithm in Système › Paramètres *does*
work today — until someone picks « Manuel » on the `/assign` board, where
[AssignBoard.tsx:154](src/components/assign/AssignBoard.tsx#L154) writes
`patch.is_active = false`. The settings page never writes that column back. From then on a
manager can select `percentage`, see « Paramètres enregistrés », and have `tryAutoAssign`
return at `if (!rule || !rule.is_active) return;` on every intake — silently, with no
feedback anywhere.

Second divergence: the settings page never writes `assignment_rules.algorithm` either, so
that column reads `'manual'` in production while the market actually runs something else.
Two columns claim to be the algorithm and one of them lies. This is also why shares belong
in their own table rather than `assignment_rules.config`.

### ⚠ `users` RLS already permits privilege escalation
[030_presence_rls_policy.sql](supabase/migrations/030_presence_rls_policy.sql) is
`USING (id = auth.uid()) WITH CHECK (id = auth.uid())` with no column list — RLS cannot
express one — and no `TO authenticated`. Any logged-in user can
`PATCH /rest/v1/users?id=eq.<self>` with `{"role":"super_admin","market_id":null}`.
No trigger, no column grant, and no later migration narrows it. `get_user_role()` reads
that column, so every policy in the system would then treat the caller as super_admin
across both markets.

This feature does not create the hole, but it makes it newly exploitable: `is_available`
would become directly writable, bypassing the RPC — no log row, no order release, while the
drain and the midnight reset believe otherwise. Column-level GRANTs are checked before RLS
and there are none on `users`:

```sql
revoke update on public.users from authenticated;
grant  update (last_seen_at) on public.users to authenticated;
```

Audit the session-client writes to `users` first — the heartbeat and logout
(`last_seen_at`) are the ones to preserve; `/api/agents/[id]`, `/api/users` and
`/api/me/avatar` all mutate through `createAdminClient()` (service role bypasses both RLS
and column grants). If a full revoke proves disruptive, the fallback is a guard trigger
using the same `current_user = 'authenticated'` seam `orders_assert_unlocked` uses.
Confirm the escalation against the live database before shipping, and confirm it closed
after.

### ⚠ `auto-assign-bulk` has two defects that break percentage
[route.ts:162](src/app/api/orders/auto-assign-bulk/route.ts#L162):
- `runningConfig = decision.updated_config` — a stateless selector returns `null`, so the
  route **overwrites `assignment_rules.config` with null**, destroying stored
  `last_assigned_index` / `product_rules` / `region_rules`. One `workload` bulk-assign
  already does this today. Fix: only assign when non-null.
- The loop feeds the next iteration by incrementing `queue_size` only. A deficit selector
  reads `assigned_today`, which never changes inside the loop, so **every order in the
  batch goes to the same agent.** `AvailableAgent` needs `assigned_today` and the loop must
  increment it.

---

## Data model

### 1. `users.is_available` + `users.available_since`
`boolean not null default false`, `timestamptz`. `is_active` stays the HR flag;
`is_available` is the self-service one. Default `false` = inert until agents opt in.
`available_since` duplicates `max(created_at)` from the log and will drift the first time
anything writes `users` outside the RPC — **keep it only if the column grant above ships
with it.**

### 2. `agent_availability_log` — append-only
`user_id, market_id, is_available, changed_by, actor_type, reason, released_count,
created_at`. `actor_type` in `('self','manager','super_admin','system')`.
`released_count` is denormalised on purpose: without it, "how many orders did this OFF
return" needs a fuzzy time-window join against `order_history`.

Reuse `ledger_append_only()` for the UPDATE/DELETE trigger. **Give it no INSERT policy at
all** — writes go only through `set_agent_availability` (SECURITY DEFINER, does not see
RLS), which makes "the RPC is the only way" structural rather than conventional.
`order_history` has an INSERT policy for `authenticated`; do not copy that here.

Needs a partial index on `(market_id, created_at desc) where actor_type='system' and
reason='daily_reset'` — the cron's idempotency guard must be an index read.

### 3. `orders.assigned_at timestamptz` — new column, maintained by trigger
Does not exist today; [QueuePage.tsx:97](src/components/queue/QueuePage.tsx#L97) fakes it
from `created_at`. Trigger is `BEFORE INSERT OR UPDATE OF assigned_to`, stamping `now()`
when `assigned_to` becomes non-null and `NULL` when it clears. `UPDATE OF` means the
~117k/day Darb status writes never fire it; `IS DISTINCT FROM` handles a SET list that
mentions the column without changing it.

Sites that set `assigned_to` today: the three SQL RPCs above (`bulk_assign_orders` is a
`PERFORM assign_order` loop, so covered transitively) and exactly one TypeScript path,
[orders/route.ts:289](src/app/api/orders/route.ts#L289). The trigger covers all of them and
cannot be forgotten by the next writer added.

Backfill: **do not parse `order_history.note`** — the wording changed across five eras
(`021_translate_assignment_notes_fr.sql` rewrote one set) and the table has no
`assigned_to` column, so there is no structural signal. The column feeds a same-day quota,
so no pre-migration value can affect a decision. Set `assigned_at = created_at` for
assigned rows in the same transaction as the `ADD COLUMN`, and say so in a comment.

Indexes — two, for two questions:
```sql
create index idx_orders_market_assigned_at on orders (market_id, assigned_at desc)
  include (assigned_to) where assigned_to is not null;   -- the grouped deficit scan
create index idx_orders_assigned_to_at on orders (assigned_to, assigned_at)
  where assigned_to is not null;                          -- one agent's day
```
Compute deficits with **one grouped scan** of the day slice, never N per-agent counts.

**Accept deliberately:** `assigned_at` is mutable, so reassigning an order from A to B in
the afternoon decrements A's day and increments B's — A's next order then arrives as
catch-up for work A already did. Ship the column first; moving the count to an append-only
source is a larger change.

### 4. `agent_distribution_shares`
`(market_id, agent_id, share_pct numeric(5,2) check 0–100, updated_by, created_at,
updated_at)`, `unique (market_id, agent_id)`. The unique constraint already serves the only
read ("all shares for market M"); no extra index.

A real table, not `assignment_rules.config`: FK to `users`, per-market RLS, `updated_by`,
and it is not in the blast radius of the `auto-assign-bulk` config-wipe above. Follows
[20261003000001_rejection_reason_configs.sql](supabase/migrations/20261003000001_rejection_reason_configs.sql)
— per-verb policies, `drop policy if exists`, helpers wrapped as `(SELECT get_user_role())`
(bare calls re-run per row). Nothing seeded: absence of a row = the coded default.

The sum-to-100 rule cannot be a table constraint (it needs a statement trigger, and then
"remove an agent" fails with a constraint violation instead of doing the obvious thing). It
lives in the pure validator and in the UI.

Agents are **soft**-deleted, so shares for departed agents linger and keep claiming a
percentage — exclude `deleted_at is not null` at read time and hide them in the UI.

---

## Implementation steps

TDD throughout: failing test first, pure logic before I/O.

### Step 1 — Migration
`20261003000002_percentage_distribution_and_readiness.sql`, French WHY header per house
style: the two `users` columns + the column GRANT fix, `orders.assigned_at` + trigger +
backfill + indexes, `agent_availability_log`, `agent_distribution_shares`, RLS for both.
Touches no existing function body, so no lock-guard assertion needed — verify that claim
before merging.

### Step 2 — Pure engine (`src/lib/orders/`)
- `auto-assignment-types.ts` — `AvailableAgent` gains `assigned_today: number`,
  `is_available: boolean`, `last_seen_at: string | null`, `deleted_at: string | null`.
- `auto-assignment.ts` — `selectByPercentage()`, `case "percentage"`. Returns
  `updated_config: null`.
- `agent-readiness.ts` — `isReadyForOrders(agent, now)`. Requires `is_available`,
  `is_active`, `deleted_at IS NULL`, and a fresh heartbeat. **Do not add a fifth presence
  threshold** — reuse a named constant from [presence.ts](src/lib/presence.ts) and comment
  which one and why (see Step 9 on the heartbeat window).
- `agent-shares.ts` — pure validation: every active agent covered, each 0–100, total 100.
- `planAssignments(orders, agents, algorithm, config)` — loops `selectAgent` incrementing
  **both** `queue_size` and `assigned_today`, returns `{ assignments, leftover }`. Mirrors
  `planDistribution()` so preview and write cannot disagree.

Tests: exact split over 100 orders; catch-up after an absence; 0% excluded; deterministic
ties; nobody ready → `null`; totals of 99/101 rejected; a soft-deleted agent with a share
is ignored.

### Step 3 — Types
`src/types/settings.ts`: add `"percentage"` to the union, the const, **and**
`VALID_ALGORITHMS`. `isValidMarketSettings` is a whole-object validator, so one unknown
algorithm 400s every unrelated setting on the page.

### Step 4 — Fix `auto-assign-bulk`
Both defects above. This is a prerequisite, not a follow-up — the manager's bulk button
runs the same engine.

### Step 5 — Readiness gate
`fetchAgentCapacity` **returns** the new fields and filters nothing: it is shared with
`/api/agents/capacity`, which feeds the manager's manual-assign panel, and a manager must
be able to hand an order to a specific person regardless of readiness. Apply
`isReadyForOrders` in the two *automatic* callers only (`tryAutoAssign`, `auto-assign-bulk`).

Add `deleted_at is null` while here — `assign_order` checks only `is_active`, so a
soft-deleted agent can currently receive orders. `get_team_live` already gets this right.

**Remove the `active_agents_only` filter.** Its label claims "agents en ligne — jamais hors
ligne" while the code checks "acted today", then silently falls back to *all* active agents.
Readiness is the honest version. Drop the toggle; leave the key readable.

`tryAutoAssign`'s outermost bare `catch {}` swallows everything — a malformed share row
would fail invisibly. Log before swallowing.

### Step 6 — `set_agent_availability` RPC
`SECURITY DEFINER`, `SET search_path = public`, `scan_order_out` guard idiom with
machine-readable `DETAIL='{"code":"..."}'`. Callable by an agent on themselves, a
market_manager on their own market's agent, or a super_admin. `SELECT ... FOR UPDATE` on
the user row serialises concurrent toggles. Idempotent: re-toggling the same state writes
nothing and releases nothing.

On OFF, release untouched orders set-based — `status='pending'` **and**
`callback_scheduled_at IS NULL` **and** `attempts_count = 0` (all three; the first alone
lets through an order whose call was already rescheduled). Bulk-insert `order_history` in
the same CTE chain: `ledger_append_only` is `BEFORE UPDATE OR DELETE` only, so set-based
INSERT is fine, and `bulk_assign_leads` already does exactly this on an append-only table.
Supply `market_id` explicitly to short-circuit `trg_order_history_market_id`'s N lookups.
`status_to` is NOT NULL, so write `pending → pending` (thousands of such rows exist).
`order_history.actor_type` admits only `system|agent|manager` — it was never widened.

**Reproduce the `order_presence` lock check inline.** The UPDATE runs as the function
owner, so `trg_orders_lock_guard` (SECURITY INVOKER, short-circuits unless
`current_user = 'authenticated'`) will not fire, and the release would otherwise yank an
order out from under a colleague with the panel open.

`assigned_at` is not mentioned anywhere in this function — the trigger clears it. That is
the payoff of the trigger design.

**Keep the drain out of this RPC.** The toggle must return in milliseconds; bundling a
400-order redistribution makes toggle latency a function of pool size and every concurrent
toggle a lock contender.

### Step 7 — The drain
Separate `drain_unassigned_pool(p_market_id, p_actor_id)` RPC, called right after a
successful ON.

The stateless self-correction argument **does not hold here**: the drain decides N orders
from one snapshot, so two agents flipping ready in the same second both plan over the same
pool and `assign_order`'s per-order `FOR UPDATE` lets the loser overwrite rather than error.
Need both:
```sql
perform pg_advisory_xact_lock(hashtext('ordra:pool:' || p_market_id::text));
```
and `and o.assigned_to is null` in the drain's WHERE. The lock serialises planning; the
predicate keeps the write honest if the lock is ever bypassed.

Bound the batch (`MAX_DRAIN = 500`). Support `?preview=1` through the same pure planner, as
[prospects/distribute](src/app/api/prospects/distribute/route.ts) does.

Correction to an earlier note in this plan: `bulk_assign_orders` is **not** skip-and-report.
It is a `FOREACH … PERFORM assign_order` loop that raises and rolls back the entire batch on
the first failure, handles one agent only, and never checks that an order is still free — so
one order taken between planning and writing would discard the other 499. The drain therefore
gets its own `apply_pool_assignments(p_market_id, p_assignments, p_actor_id, p_actor_type)`,
which takes the advisory lock, re-checks `status='pending' AND assigned_to IS NULL` per order,
and wraps each `assign_order` call in a subtransaction so one refusal skips one order.

**Measure broadcast fan-out before shipping.** `trg_orders_broadcast_upd` fires per row on
an `assigned_to` change, one `realtime.send()` each — a 300-order drain is 300 inserts into
the very table [20260924000002](supabase/migrations/20260924000002_orders_broadcast.sql)
was written to relieve. If it hurts, collapse to one message carrying the id array and let
clients refetch.

### Step 8 — API routes
Standard preamble: `dynamic = "force-dynamic"`, `getActor(req)`, role guard, hand-rolled
type guards (not zod), `{ error }` / `{ data }` shapes.
- `GET|POST /api/agent/availability` — own state and toggle.
- `POST /api/agent/availability/drain` — Step 7, with `?preview=1`.
- `GET|PUT /api/settings/agent-shares` — its own endpoint, like `RejectionReasonsSection`,
  not through the monolithic `MarketSettings` PATCH. Validate everything before writing
  anything.
- `POST /api/team/availability/reset` — super_admin manual trigger for the cron function
  (the investor-rollup migration's "stalled schedule" lesson).
- Extend `/api/agents/capacity` with `is_available`, `available_since`, `assigned_today`,
  `share_pct`.
- **Fix `/api/auth/logout`**: it nulls `last_seen_at` but leaves `is_available = true` and
  releases nothing, so an agent's untouched orders sit in a queue nobody is watching until
  midnight. Call `set_agent_availability(..., false, 'logout')`.

### Step 9 — Settings UI (Équipe tab)
[TeamSection.tsx](src/components/settings/general/TeamSection.tsx), "Affectation":
- `percentage` in `ALGORITHM_OPTIONS` **and** in `ALGO_OPTIONS` in `AutoAssignBar.tsx`.
- An `AgentSharesEditor` when selected: row per active agent, running total, « Reste : X % »
  turning red off 100. Save disabled while the total ≠ 100 or an active agent is uncovered.
- `PreviewBanner` — « Sur les 340 commandes d'hier, Ahmed aurait reçu ≈ 136 ».
- Remove the `active_agents_only` toggle.
- Make `PATCH /api/settings/[marketId]` mirror `algorithm` + `is_active` into
  `assignment_rules`, the way `PUT /api/assignment-rules` already mirrors the other way.
  Without this the `/assign` board can permanently disable the feature (see Hazards).
- `AutoAssignBar` must refuse `percentage` when shares are unset rather than silently
  doing nothing.
- Leave `product_based` / `region_based` disabled — out of scope, but note the
  inconsistency (implemented and tested, yet "bientôt disponible").

**Ship an explainer.** Between `assignment_rules.is_active` on another page, three dead
settings that look like intake gates, and now readiness, "why did this order not get
assigned" is unanswerable from the UI. Put a reason string on the unassigned pool:
« aucun agent prêt » / « algorithme inactif » / « manuel ».

### Step 10 — Agent toggle UI
`AgentAvailabilityToggle.tsx` in the Topbar `statusSlot`, replacing the inline connection
chip in [AgentDashboardShell.tsx](src/components/layout/AgentDashboardShell.tsx). Readiness
is the headline; live-connection folds into the sub-line.

Three constraints the in-flight shell redesign measured (`plans/agent-shell-redesign.md`
§2, §4) — do not reintroduce them: **fixed width in FR and AR** (an unstable trailing slot
shifted the cluster 13px in Arabic; there is a `?check=ruler` probe), **≥44px hit area**
(`SettingToggle` is 22px and fails the shell's own rule), and **not `#15803D` on `#BBF7D0`**
(4.14:1, fails) — use `#166534` / `#991B1B`.

**Decide the heartbeat window explicitly.** [usePresenceHeartbeat.ts:9](src/hooks/usePresenceHeartbeat.ts#L9)
returns early when `visibilityState === "hidden"`, so an agent who backgrounds the tab for
six minutes silently stops being ready, then gets a catch-up burst on return with no UI
event explaining either. Either keep beating while hidden when `is_available`, or use
`IDLE_THRESHOLD_MS` (30 min) as the *distribution* window while 5 min stays the *display*
window. Whichever — a named constant with its own comment, not a fourth definition of
"online".

Turning off opens a confirm naming how many orders will be released (the RPC returns
`released`). New `useAgentAvailability` hook. New i18n keys in `fr.json` + `ar.json`; the
existing `delivery.shell.online` keys mean *socket connected* — do not reuse them.

### Step 11 — Manager visibility
Readiness pill + `assigned_today / target` on
[AgentCapacityCard](src/components/assign/AgentCapacityCard.tsx); availability in the
`get_team_live` agents CTE, with force-off from `AgentRoster`.

### Step 12 — Midnight reset (pg_cron)
`reset_agent_availability_daily()`, `SECURITY DEFINER`, `SET search_path = public`.
Resolve the zone with the existing `market_tz(uuid)` — **not** `warehouse_market_tz`, which
has no pinned `search_path`, and **do not add a `markets.timezone` column** (the one time
someone assumed it existed, `/api/warehouse/operator-stats` 500'd on every call).

Hourly, not two fixed UTC jobs: neither country observes DST *today*, so fixed offsets
would be right now and silently wrong the day either reinstates it —
[market-day.ts](src/lib/dates/market-day.ts) made the same choice for the same reason. Act
only within the first hour of local midnight, and guard idempotency on the log, or an agent
who goes ready at 00:20 is killed at 01:00. One statement per market so every CTE sees the
same snapshot. Release untouched orders too (`actor_type = 'system'`, `actor_id NULL`), and
deliberately **do not** honour `order_presence` here — at local midnight nobody holds a
lock, and honouring one would strand an order on a now-unready agent.

Schedule at `:22` — free of every existing offset (`:00 :03 :04 :07 :08 :17 :41`, plus the
`*/5 */10 */15` series). Use the unschedule-then-schedule idiom. Add the row to
`docs/notifications-cron.md`, which says "There are 12 active jobs" and "keep that spread".

### Step 13 — Docs
`docs/order-distribution.md`: the quota formula, why the engine is stateless, the readiness
definition, what replaced `active_agents_only`, the day boundary. Link from CLAUDE.md with
a one-line summary — do not inline it.

Update, because each is now wrong: `docs/database-schema.md` (two tables, four columns —
read from the live DB, as its header requires), CLAUDE.md's queue-sort and status sections,
`docs/crm-and-team.md`, `docs/notifications-cron.md`.

---

## Consequences worth stating plainly

**The catch-up burst is real and unthrottled.** Strict daily quota + drain-on-turn-on + no
per-agent cap: a market has done 200 orders by 14:00, an agent with a 40% share turns on
having done none. Their deficit is 80, so the drain hands them the whole pool and every
order after it, back to back, until they are level. That is the chosen model working
correctly. `max_open_orders_per_agent` is already stored and unread — it is the one-line
brake if this proves too sharp.

**Orders can now sit unassigned.** Today every order lands on someone. After this, if
nobody is ready the pool grows. `/orders?preset=unassigned` shows it with age buckets; the
control room should surface the count so a silent pool is not discovered the next morning.

**Readiness gates all algorithms**, so round_robin and workload markets change behaviour
the moment this ships. Agents must be told to flip the toggle before their first shift or
their queues go quiet — the same failure shape as the warehouse `warehouse_id` rollout,
where unassigned meant "sees nothing".

---

## Verification

1. `npm test` / `npm run test:run`. Baseline before starting is 596 passed / 6 skipped with
   4 pre-existing failures in `DarbStatusSection` and `Sidebar` — do not attribute those
   here.
2. `npm run typecheck`, `npm run lint`, `npm run build`.
3. **Split accuracy** — 100 webhook orders against 40/30/30, all ready: assert 40/30/30 ± 1.
4. **Catch-up** — one agent off, push 50, turn them back on: the drain moves them toward
   target and the split converges over the next 50.
5. **Bulk path** — run `auto-assign-bulk` over 20 orders under `percentage` and assert they
   spread; assert a `workload` bulk run no longer nulls `assignment_rules.config`.
6. **Readiness gate** — toggle ON with a stale `last_seen_at`: receives nothing. Toggle OFF
   with a fresh heartbeat: same. Soft-deleted agent with a share: excluded.
7. **Release on OFF** — 5 untouched + 3 attempted: exactly 5 return, `assigned_at` cleared,
   3 remain. Repeat with a colleague holding `order_presence` on one of the 5: it stays.
8. **Concurrency** — two simultaneous drains on one market assign each order exactly once.
9. **RLS under a real JWT, never as owner.** As `agent1.tn@oms.local`: can read/write only
   their own `is_available`, cannot see another market's shares, and cannot INSERT into
   `agent_availability_log` directly. Owner-level SQL bypasses RLS and has hidden exactly
   this class of bug before (`20260926000009_rls_helpers_pin_search_path.sql`).
10. **The escalation** — confirm `PATCH users?id=eq.<self>` with `{"role":"super_admin"}`
    works before the migration and is refused after.
11. **Lock guards** — `SELECT public.assert_lock_guards_installed();` returns clean.
12. **Cron** — run the reset by hand for one market, check `cron.job_run_details`, then
    confirm a second run in the same local day is a no-op.
13. `count(*)` for every row count, never `pg_stat_user_tables.n_live_tup`.
