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

> **2026-10-06:** the manager console is now the recovery desk — docs/prospects-recovery.md.
> `components/crm/` (the kanban) and its dead API routes are deleted.

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

Rebuilt 2026-10-03 from `prototypes/team-v5.html` (v5, co-designed with the owner).
Two bands: the day (strip, agents with a done-vs-left bar, the agent panel) and the
agents over a period (assigned → uploaded → delivered, with commission balances).
Definitions, RPCs, settings and the bell's three alerts: **docs/team-control-room.md**.

Agents hitting this route are redirected to `/queue`. For super_admin with scope "all"
it falls back to the default market — a cross-market roster is deliberately not a thing,
because an agent belongs to one market and a merged list would imply otherwise.
`get_team_live` and `AgentDrawer` survive only for Performance équipe below.

> The Darb "control room" that lived on Tableau livraison was deleted with that page
> (2026-10-03); Darb sync freshness now shows in the Transporteurs header.

### Performance équipe — `(dashboard)/team/performance`

Rebuilt 2026-10-04 from `prototypes/team-performance-v3.html` (« Aurore »); the plan and
every definition are in `plans/team-performance-redesign.md`. One question: **why do agents
lose orders?** Five blocks — the outcome rows (a sentence with the counts, then one bar per
outcome; the waffle of 100 was retired on 2026-10-05, « Aurore calme »), one card per agent (thin ring with her delivered count, biggest leak,
« À lui dire »), Débit × taux, Par produit, Présence (shift timelines).

- **Data:** `get_team_performance_v2(market, from, to, tz, prev_from, prev_to)` returns
  facts only (orders assigned per agent with flags, decisions, action minutes per local
  day). Every rule is TypeScript with tests: `src/lib/team/performance/` (`model.ts`
  outcomes / ranking / leaks / map / default day / products; `build.ts` facts → view,
  run in `GET /api/team/performance`).
- **Score** = livrées pour 100 attribuées, ranked from 30 (same as Salle de contrôle v5).
  **Hours on shift** use the room's `stretchesOf` (gaps over 60 min removed), shared.
- **Leaks** compare her with the rest of the team in orders; the advice lines are the
  `teamPerformance.say.*` keys — the owner's to validate.
- Components: `src/components/team/performance/` with the prototype's own stylesheet
  scoped under `.tpf`.

Gone with the rebuild: conf/h ranking, goals on this page, the agent and day drawers,
`useTeamPerformance`, `src/lib/team/{view-models,goals,heat,day-view,format}`. Still in
place without a caller: `/api/team/{live,agent-day,targets}`, and the old
`get_team_performance` RPC (drop after deploy). `agent_targets` and the `goal_*` settings
stay in the database, unread.

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
