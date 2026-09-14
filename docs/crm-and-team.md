# Clients and Équipe — prospects, relances, control room, performance

Two sidebar sections that had no reference page until 2026-09-13. Both are fully
shipped.

---

## Part 1 — Clients

### The word "client" means two different things

This is the trap in this part of the codebase.

| | `leads` | `customers` |
|---|---|---|
| What it is | A **prospect**: a contact who has not ordered yet | A **buyer identity**: one person, across every order |
| Created by | Capture, import, campaign, social adapter | Trigger on `orders` — never written directly |
| Worked in | Clients → Prospects (kanban / queue) | Nothing. **No UI reads it.** |
| Ends as | An `orders` row (`converted_order_id`) | Never ends; counters refresh forever |

In the Prospects surface, **lead = prospect**. `customers` is a newer, unrelated entity
that belongs to the delivery engine — see `docs/delivery-worklist.md`. The sidebar entry
`activeProspects` points at `leads`. There is no `/clients` route.

### Prospects (leads) — shipped

- **DB**: `leads`, `lead_history`; enums `lead_status` (new → assigned → attempt_1/2/3 →
  callback_scheduled → qualified → won | lost | archived), `lead_source` (manual_call,
  facebook_comment, facebook_dm, instagram_dm, whatsapp, tiktok_comment, campaign,
  other), `lead_lost_reason`. `prospect_campaigns` — renamed from `follow_up_campaigns`,
  with the old name kept as a compatibility **view**, so both names resolve.
- **RPCs**: `rpc_transition_lead_status`, `assign_lead`, `unassign_lead`,
  `convert_lead_to_order`, `rpc_run_prospect_campaign`.
- **Routes**: `(dashboard)/leads` + `[id]`; API `/api/leads/**` (assign, attempt,
  callback, convert, transition, campaigns, campaigns/[id]/run, duplicates, import,
  metrics) and `/api/agent/leads/queue`.
- **Components**: `src/components/crm/` — `LeadsKanban`, `LeadsTable`, `LeadCard`,
  `LeadDetailCard`, `LeadsKpiStrip`, `LeadsFilterBar`, `NewLeadModal`,
  `ConvertLeadModal`, `ReassignLeadModal`, `AgentLeadsQueue`, `ProspectCampaignPanel`.
- **Lib**: `src/lib/leads/` (assignment, attempt-logic, conversion, csv, duplicates,
  hot, metrics, phone, queue-sort, transition) + `adapters/` (manual, meta, whatsapp) +
  `lead-permissions.ts`.

> **The agent half of the rebuild shipped on 2026-09-14.** `/[locale]/leads` now
> renders « Prospects » — six derived buckets, one recommended move per row, the
> call outcome in one sheet — for `role = agent`, built from
> `prototypes/prospects-v3.html`. See **docs/prospects-worklist.md**.
>
> **Managers still get `LeadsKanban.tsx` on the same route**, and the prototype's
> manager console (KPIs, pipeline table, campaign funnels) is not built. Campaign
> distribution (decision 33) does not exist either, so the 1 982 campaign leads have
> no `assigned_to` and no agent sees them yet.

### Relances (follow-ups)

`order_follow_ups` + `order_follow_up_entries`, enum `follow_up_status` (open →
in_progress → resolved | escalated). RPCs `create_order_follow_up`,
`rpc_transition_follow_up_status`, `bulk_create_campaign_follow_ups`,
`follow_ups_status_counts`, `follow_ups_overdue_by_agent`. Routes
`(dashboard)/follow-ups` + API `/api/follow-ups/**`.

> `plans/suivi-livraison.md` marks this whole surface — and Livraison → Tableau
> livraison — **for deletion**, replaced by the delivery worklist. That deletion has not
> happened and the replacement has no UI. Both are live. Do not delete either expecting
> the new engine to cover it.

---

## Part 2 — Équipe

### Salle de contrôle — `(dashboard)/team`

"Who is working, what is moving, what is stuck — right now."

`get_team_live(p_market_id, p_tz)` — SECURITY DEFINER, and it guards itself: a
non-super_admin asking for another market gets `{}`, not an error. Presence is **three**
states off `users.last_seen_at`: `online` within 5 minutes, `idle` within 30, `offline`
beyond. Goals fall back to `goal_daily_treated` = 12 and `goal_min_rate` = 40 when the
market has not set them.

Agents hitting this route are redirected to `/queue`. For super_admin with scope "all"
it falls back to the default market — a cross-market roster is deliberately not a thing,
because an agent belongs to one market and a merged list would imply otherwise.

Renders `TeamLiveWorkspace` with `LiveTiles`, `AgentRoster`, `BlockedOrdersCard`,
`UpcomingCallbacksCard`, `ProductsCard`, `TeamStrip`.

> A different "control room" exists for the Darb carrier
> (`/api/darb/control-room`, `components/in-delivery/DarbControlRoom.tsx`). Unrelated
> surface, same word. `plans/suivi-livraison.md` decision 10 folds it into the future
> manager delivery page — unstarted.

### Performance équipe — `(dashboard)/team/performance`

"The period review: débit × taux, goals, presence." `get_team_performance(market, from,
to, tz)` reading goals `daily`, `rate`, `cph`, `team`; day drill-down via
`get_agent_day_detail(...)`.

The two measures that matter are **débit** (traitées per active hour) and **taux**
(confirmation rate) — the ranking is their product (conf/h), which is why an agent can
lead on neither column alone and still rank first. `ThroughputRateChart` plots them
against the team median and the target, so "fast but leaky" and "careful but slow" are
visibly different failures. `PresenceHeatmap` bins active hours per day
(`src/lib/team/heat.ts`). Agents under a minimum volume are held out of the ranking
rather than shown with a meaningless rate.

Components: `src/components/team/control-room/` — `RankingCard`, `ThroughputRateChart`,
`PresenceHeatmap`, `AgentDayDrawer`, `GoalSegments`, `PeriodControls`,
`CommissionsCard`, `PayoutModal`. Lib: `src/lib/team/` (view-models, day-view, goals,
heat, format, reassign-queue).

Goals live in `agent_targets`, written append-style — the latest row per
`(agent_id, metric)` wins via `agent_targets_latest_idx`, so a target's history survives.

### Commissions

`docs/agent-commissions.md` is the reference. RPCs `accrue_agent_commissions` (cron,
every 15 min at :08), `get_team_commissions`, `get_agent_commission_ledger`,
`post_agent_commission_adjustment`, `record_agent_payout`, `get_my_commissions`.
`agent_commission_ledger` is **append-only**; a balance is `SUM(amount)`, never a stored
figure.

### Accès — `(dashboard)/users`

User CRUD. This is where a `warehouse_agent` is given their `warehouse_id`; without one
they can see and scan nothing. Only 2 of 9 warehouse agents currently have one set —
see `docs/warehouse-sites-and-statuses.md`.
