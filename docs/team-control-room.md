# Salle de contrôle (/team) — v5

Spec: `prototypes/team-v5.html` (owner's final review, 2026-10-03). Plan:
`plans/team-control-room-v5.md`. Code: `src/components/team/room/`, view models in
`src/lib/team/room/`, migration `supabase/migrations/20261003200000_team_control_room_v5.sql`.

## What each number means

The definitions are the prototype's own queries; change them here and in the SQL together.

| On screen | Definition |
|---|---|
| Assignées | orders whose `assigned_at` falls in the period and that the agent still holds (`assigned_to`) |
| Uploadées / Rejetées | distinct orders with an `order_history` row `uploaded` / `rejected` by the agent in the period |
| Tentatives | rows `attempt_1/2/3` + `callback_scheduled` by the agent |
| taux | uploadées ÷ (uploadées + rejetées) — the only rate on the page |
| Non appelées > N h (today) | in the holder's queue (pending/new/assigned/attempt/callback), no call-status row **by the holder** since `assigned_at`, held longer than N h. A reassigned order counts for its new holder. |
| Appelées > N h (past day) | orders assigned that day, called by the holder late or never; cancelled ones excluded |
| Reçues · Livrées | orders created that day in the market · distinct orders reaching `delivered` that day |
| Confirmée non uploadée | amber tag: `confirmed` orders in her queue |
| Livrées / 100 | delivered ÷ assigned × 100 over the period's cohort; ranked from 30 assigned; trend = rounded score − rounded score of the previous period (a month → the month before) |
| Retournée | uploaded, then `cancelled` / `returning` / `to_be_returned` / `returned` / `received` — about half of Libyan confirmations die as a Darb `cancelled` after upload |

Call statuses (what "called" means): attempt_1/2/3, callback_scheduled, confirmed, rejected.

## Agent states (live)

`working` (an action < idle minutes ago) · `idle` (online by heartbeat, silent ≥ idle
minutes) · `early` (offline, last action before shift end − tolerance) · `left` ·
`late` (no action, shift start + tolerance passed) · `before` · `rest` (not a planned day).
Past day: `done` / `absent` / `rest`. **Without a planning** there is no late / early /
rest — only what happened. Presence needs the heartbeat: an agent whose browser never
heartbeats (roqaya, 2026-10) can be "working" or "left", never "idle".

## Data — four read-only RPCs (one migration)

| RPC | Route | Feeds |
|---|---|---|
| `get_team_day(market, day, tz)` | `/api/team/day` | header, strip, agents card, timeline; returns the settings in force |
| `get_team_funnel(market, from, to, tz, prev_from?, prev_to?)` | `/api/team/funnel` | the period table |
| `get_team_agent_panel(market, agent, from, to, tz)` | `/api/team/agent-panel` | products, rejection groups, 30-day delivered line, commission |
| `get_team_alerts(market or NULL)` | `/api/alerts/summary` | the bell |

All SECURITY DEFINER with the `get_team_commissions` guard (manager pinned to own market,
others `{}`), `REVOKE … FROM PUBLIC, anon` then `GRANT … TO authenticated`. Money is
summed in SQL (commission fold, 14-day sum, « à venir » = in-flight × today's rate,
in-flight = last confirmer is the agent, uploaded < 21 days ago). Table balances still
come from `get_team_commissions`.

## Settings (Réglages › Équipe › Salle de contrôle, super_admin edits)

`team_call_delay_hours` (2) · `team_idle_minutes` (30) · `team_late_minutes` (15) ·
`team_shift_overrides` (agent id → {start, end}) · the planning is the existing
`shift_config` (start, end, days). Not in `MANAGER_EDITABLE_SETTING_KEYS`: the owner asked
for administrator settings. **Production `shift_config` was the untouched default
(08:00–18:00, Mon–Fri) for both markets on 2026-10-03** — set the real planning before
reading "en retard".

## The bell

Three types in `lib/alerts/catalogue.ts`, built by `lib/team/room/alerts.ts`:
`intake_silent` (no order for 6 h; expires after 30 days so a dormant market stops
shouting), `agent_uncalled` (one row per agent, anchored on her oldest), `agent_idle`.
A failed `get_team_alerts` drops these three and leaves the rest of the bell standing.

## Known limits

- WhatsApp needs `users.phone`; with none the button is disabled and says so (0/6 agents
  had one on 2026-10-03).
- "Assignées" follows the current holder: a reassigned order leaves the first agent's count.
- The panel's product is the order's first line (`orders.product_id`).
