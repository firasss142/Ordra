# Agent commissions

Confirmation agents earn a **flat commission per order they confirmed that the
carrier later marks `delivered`**. Built 2026-08-18 from
`plans/agent-commission-tracking.md` (decisions D1–D6 there are the source of
the rules below).

## Rules

| Rule | Value |
|---|---|
| Trigger | first `order_history` row with `status_to='delivered'`, and `orders.status` still `delivered` |
| Attribution | the agent whose `confirmed` transition is the **last one before** the delivered event (orders can be reopened and reconfirmed) |
| Rate | flat amount per delivered order — market default, optional per-agent override; resolved for the **market-local day of delivery** |
| Switch | market switch and per-agent switch, both **dated pauses** (`enabled=false` row), never deletions; market off wins over everything, agent off wins over market on |
| Reductions | none — no return penalties, no advances. A `reversal` is written once if an accrued order stops being `delivered` |
| Payout | manager-entered (date · amount · method · reference · note); refuses to push the balance negative unless explicitly allowed |
| Repair | `adjustment` (± with mandatory note). The ledger is append-only |
| Start | no backfill — nothing accrues before the first effective rate row |
| Money | NUMERIC(·,3), market currency; UI drops millimes on whole amounts (`fmtCommission`) |

## Storage (`supabase/migrations/20260918010001_agent_commissions_schema.sql`)

- `agent_commission_rates` — effective-dated rules, `agent_id NULL` = market default, half-open windows `[effective_from, effective_to)`, closed by a new row.
- `agent_commission_ledger` — APPEND-ONLY (trigger). `accrual +`, `reversal −`, `payout −`, `adjustment ±`. Balance = `SUM(amount)`. Partial unique index on `(order_id, entry_type)` makes the sweep idempotent.
- RLS: SELECT for super_admin / market_manager (own market). No agent policy — agents read only through `get_my_commissions()`.

## Functions (`…010002_agent_commissions_rpcs.sql`)

| RPC | Who | Purpose |
|---|---|---|
| `resolve_commission_rate(market, agent, day)` | internal | the rule for one agent on one local day |
| `set_agent_commission_rate(market, agent, amount, enabled, from, note)` | super_admin | rate change **and** on/off switch |
| `get_commission_settings(market)` | super_admin | Paramètres › Général › Commissions payload |
| `accrue_agent_commissions(market?)` | pg_cron every 15 min (`agent-commissions-accrue-15min`) + super_admin via `POST /api/team/commissions/accrue` | accruals + reversals |
| `get_team_commissions(market, from, to, tz)` | managers | per-agent period figures + all-time balances |
| `get_agent_commission_ledger(agent, from?, to?)` | managers | statement / CSV |
| `record_agent_payout(...)`, `post_agent_commission_adjustment(...)` | managers | the only money writes |
| `get_my_commissions(days)` | agent | own view; caller = `auth.uid()`, no agent parameter |

## Surfaces

- `/team` — verdict segments ("N agents à payer (Σ)", "N solde négatif"), roster **Solde** column with `Payer`, drawer **Commission** section.
- `/team/performance` — 6th strip cell, ranking commission line, **Commissions & paiements** card, payout modal, drawer section.
- `/settings/general?tab=commissions` — market switch, market rate + effective date, per-agent switches / own rates, history (super_admin).
- `/commissions` (agent shell tab **Mes commissions**) — À recevoir · ce mois · en cours · dernier paiement · history grouped by day.

Code: `src/lib/commissions/*` (types, view-models, api helpers), `src/hooks/useTeamCommissions.ts`, `src/hooks/useAgentCommissions.ts`, `src/components/team/control-room/{CommissionsCard,CommissionSection,PayoutModal}.tsx`, `src/components/settings/general/CommissionsSection.tsx`, `src/components/agent-commissions/*`, routes under `src/app/api/{team/commissions,settings/commissions,agent/commissions}`.

## Go-live

Nothing accrues until super_admin sets the market rate in Paramètres › Général › Commissions (that row's `effective_from` is the launch date). The prototype that was approved: `prototypes/agent-commissions-v1.html`.
