# Salle de contrôle v5 — build plan

Spec: `prototypes/team-v5.html` (co-designed with the owner over three review rounds,
2026-10-03; supersedes v2–v4 and `plans/team-page-rebuild.md`). The owner asked on
2026-10-03 to implement it "as much as you can within the boundaries of our data logic",
plus one addition: **a custom period (a month, or any range) on the agents table**.

## Phase 0 — the spec

`prototypes/team-v5.html` is the acceptance criterion. Every section of it is built; where the
data cannot say what the prototype shows, the deviation is named below, not silently dropped.

## What the page shows (top to bottom)

1. **Header** — title, market · day, chip (En direct · HH:MM / Journée terminée / Jour de repos),
   day stepper (◀ day ▶, "Revenir à aujourd'hui"), link "Réglages" → Réglages › Équipe.
2. **Intake banner** — no order received in the market for > 6 h.
3. **Band "Aujourd'hui" + strip (6 cells)** — Agents actifs · Reçues · Uploadées (taux) ·
   Rejetées (taux) · Livrées · Non appelées > N h (past day: Appelées > N h).
4. **Agents card** — per agent: who + state line + amber "confirmée non uploadée" tag ·
   done-vs-left bar · Assignées · Uploadées · Rejetées · Tentatives · Non app. > N h · WhatsApp.
   Dormant accounts (no action in 7 days) on one line below.
5. **Band "Agents · période" + funnel table** — period control (30 derniers jours · a month ·
   custom range), rank, funnel bar (Livrée / En route / Retournée / Non uploadée), Assignées,
   Uploadées (% of assigned), Livrées (% of finished parcels), Livrées / 100 with trend arrow vs
   the previous period of the same length, Solde + Payer; "À payer" total in the band.
6. **Agent panel** (drawer) — Ce jour / 7 jours; 4 tiles; delivered line (her uploads of the last
   30 days: livrées · retournées · en route); La journée (timeline + Début / Actif / Dernier appel,
   day view only); Par produit; Motifs de rejet (groups, red + group icon); Commission
   (balance, earned − taken back − paid, 14-day earnings with pay days, in flight, last payout).
7. **Bell** — three new alert types in the existing alerts engine: `intake_silent`,
   `agent_uncalled`, `agent_idle`.
8. **Settings** — Réglages › Équipe › new card "Salle de contrôle" (super_admin edits; managers
   read): call delay (h), idle (min), tolerated lateness (min), team planning (reuses the existing
   `shift_config` key), per-agent overrides.

## Definitions (identical to the prototype's queries)

- Call statuses = attempt_1/2/3, callback_scheduled, confirmed, rejected.
- **Assignées** = orders whose `assigned_at` falls in the period and are still held by the agent.
- **Uploadées / Rejetées** = distinct orders with an `order_history` row `uploaded` / `rejected`
  by the agent in the period. **Tentatives** = rows attempt_* + callback_scheduled.
- **Taux** = uploadées ÷ (uploadées + rejetées).
- **Non appelée** = an order in the holder's queue (pending/new/assigned/attempt/callback) with no
  call-status row by the holder since `assigned_at`, held > call delay. A reassigned order counts
  for its new holder.
- Past day: **Appelées > N h** = orders assigned that day not called by the holder within N h.
- **Funnel** cohort = orders assigned to the agent in the period (status ≠ deleted): uploaded =
  ever reached `uploaded`; delivered = status delivered; en route = uploaded and in carrier
  statuses; retournée = uploaded and cancelled/returned/returning/to_be_returned/received;
  score = delivered ÷ assigned × 100; ranked from 30 assigned; trend vs the previous period of
  the same length.
- **Agent states** (live): working (action < idle min) · idle (online by heartbeat, no action ≥
  idle min) · left / early stop · late (no action, shift started + tolerance) · before · rest.

## Data layer — one migration, paste-ready

`supabase/migrations/20261003200000_team_control_room_v5.sql`, four SECURITY DEFINER STABLE
RPCs with the `get_team_commissions` market guard, `REVOKE … FROM PUBLIC, anon` then
`GRANT … TO authenticated`:

| RPC | Feeds |
|---|---|
| `get_team_day(market, day, tz)` | header, strip, agents card, timeline, settings in force |
| `get_team_funnel(market, from, to, tz)` | the period table (+ previous period) |
| `get_team_agent_panel(market, agent, from, to, tz)` | products, rejection groups, 30-day delivered line, commission breakdown |
| `get_team_alerts(market or NULL)` | the three bell alerts |

Commission balances for the table keep coming from `get_team_commissions` (unchanged).

## App layer

- `src/lib/team/room/` — pure, tested view models (day view, funnel view, panel view, period,
  settings). Thresholds are applied here from the settings the RPC returns.
- API: `/api/team/day`, `/api/team/funnel`, `/api/team/agent-panel` (+ route tests).
- `src/components/team/room/` — the page; `/team` renders it. The old live workspace and its
  components that nothing else uses are deleted.
- Alerts: `src/lib/alerts/catalogue.ts` + `/api/alerts/summary` gain the three types.
- Settings: `MarketSettings` gains `team_call_delay_hours`, `team_idle_minutes`,
  `team_late_minutes`, `team_shift_overrides`.
- i18n: `team.room.*` in fr.json and ar.json.

## Known deviations (data, not taste)

- The **WhatsApp** button needs `users.phone`; no agent has one (0/6). The button is disabled
  with "Aucun numéro — à saisir dans Accès" until one is entered.
- **`shift_config`** in production is the untouched default (08:00–18:00, Mon–Fri) for both
  markets; until someone sets the real planning, Libya agents will read "en retard" and Saturday
  as a rest day.
- **Presence** comes from the heartbeat; an agent whose browser never heartbeats (roqaya) can
  never be flagged "idle", only "working" / "left".
