# Agent commission tracking — system concept, data model, UI additions

> Durable copy (source of truth). Working scratchpad: `~/.claude/plans/title-design-a-majestic-pebble.md`. Stage 1 (HTML prototype) is mandatory before any code or migration.

## Context

The business pays its confirmation agents a **commission per delivered order** and today tracks it outside the OMS. The manager wants the OMS to (1) accrue what each agent earns, (2) record every payout (date · amount · method), (3) show what each agent has already withdrawn (*retiré*), what is still owed to them, and any negative balance (what *they* owe), and (4) surface commission metrics on the two existing team pages — **Salle de contrôle** (`/team`) and **Performance équipe** (`/team/performance`).

This plan is the design deliverable: feature outline, data model, UI mock-up descriptions, decisions taken with the manager, and the few questions still open (each with the default that will be used if unanswered).

## Decisions taken (manager, 2026-08-17)

| # | Decision |
|---|---|
| D1 | **Rate rule**: flat amount per delivered order — one **market default** + optional **per-agent override**. |
| D2 | **Nothing reduces a commission**: pure accrual + payouts. No return penalties, no formal advances. A negative balance can only come from a payout recorded above what was earned → the UI warns and requires an explicit confirm; the repair path is a compensating adjustment (ledger is append-only). |
| D3 | **Visibility**: `super_admin` + `market_manager` (own market) see commission money and record payouts. **Agents see their own balance and statement** (read-only, new "Mes commissions" tab in the agent shell) — revised 2026-08-18. |
| D5 | **Rates are set in Admin › Paramètres › Général**, new "Commissions" group (super_admin): market rate per delivered order + effective date, per-agent exceptions, history. The Performance card only links there — added 2026-08-18. |
| D6 | **On/off switches**: one market switch ("Commissions activées") and one per agent, in the same settings group. Off = a dated *pause* (no accrual for deliveries from that date), never a deletion; can be turned back on; history untouched. A disabled agent loses the "Mes commissions" tab (unless a balance remains) and leaves the "à payer" totals; any remaining balance stays payable — added 2026-08-18. |
| D4 | **Start today, no backfill**: only orders delivered **after the first effective rate** count. No opening balances. |

## What already exists (verified in code)

| Fact | Where |
|---|---|
| Agents = `users.role='agent'` (phone confirmation). Carriers deliver. No in-house delivery agent entity. | `Ordra/CLAUDE.md`, `users` schema |
| Delivery event = `order_history.status_to='delivered'` (system/carrier actor). Already the P&L revenue trigger. | `docs/business-logic.md` |
| Confirmation attribution = `order_history.status_to='confirmed'` with `actor_id` = agent (used by `get_team_*`). Orders can be **reopened** and reconfirmed (`reopen_order`) → the *last* confirm before delivery is the attributable one. | `supabase/migrations/20260907000002_team_rpcs.sql`, `20260418_reopen_order_rpc.sql` |
| `delivered` and `returned` are distinct terminals; an order does not go delivered→returned. | `Ordra/CLAUDE.md` status model |
| Team pages were designed **without money**; `market_manager` has `canViewFinances=false` (that flag gates the FINANCES sidebar — whole-business P&L — not per-agent pay, so it stays false; a new `canManageCommissions` is added instead). | `plans/team-control-room-redesign.md`, `src/lib/user-permissions.ts` |
| Append-only money ledger precedent (trigger rejects UPDATE/DELETE, balance = SUM fold, `payout_method` = bank_transfer / cash / wallet, `assert_money_actor`). | `supabase/migrations/20260819000002_investor_role_and_positions.sql`, `20260819000006_investor_money_safety.sql`, `docs/investor-domain.md` |
| Per-agent override precedent: `agent_targets` (append-only, latest wins) + market defaults in `settings` (`goal_*`). | `supabase/migrations/20260907000001_team_goals_schema.sql` |
| Read RPC precedent: `get_team_live` / `get_team_performance` (SECURITY DEFINER, market guard, JSONB out); TS view-models `src/lib/team/view-models.ts`; wire types `src/lib/team/types.ts`; SWR hooks `useTeamLive` / `useTeamPerformance`. | `src/components/team/control-room/*` |
| Scheduling: pg_cron (`20260909000005_pg_cron_darb_sync.sql`), not Vercel crons. Investor rollup lesson (F5): every cron job must also be runnable from the UI. | memory `oms-crons-run-in-pg-cron-not-vercel` |
| Money precision NUMERIC(·,3) millimes; currency = market currency (`markets.currency`). | `docs/investor-domain.md §1.2` |
| UI building blocks to reuse: `TeamStrip` `Cell`, `AgentRoster` table + `Menu` actions, `RankingCard` row, `AgentDrawer` (`SecLabel` + `Stat` sections), `TeamCard`, `fmtNum`, `Toast`, `PeriodControls`. | `src/components/team/control-room/` |

Supabase MCP token is **expired** in this session — real prod figures for the prototype need `/mcp` re-auth first.

## Assumptions still open (defaults will be used unless corrected)

| # | Question | Default |
|---|---|---|
| Q5 | Payment cadence (weekly/monthly)? Only affects the "unpaid for N days" hint. | No hint in v1; period presets unchanged (Hier / 7 j / 30 j / Personnalisé). |
| Q6 | Payout attributes beyond date/amount: method, reference, note, receipt photo? | Method (espèces / virement / wallet) + reference + note; no photo. |
| Q7 | Show "en cours" (confirmed by the agent, shipped, not yet delivered) as an estimate? | Yes, labelled *estimation*, never in the ledger. |
| Q8 | Commission per order regardless of quantity/lines? | Per order. |
| Q9 | Who sets rates? | Decided → D5: `super_admin`, in Paramètres › Général › Commissions. |
| Q10 | Should a payout above the balance be blocked or only warned? | Warned + explicit confirm ("crée un solde négatif de X"). |

## System concept — scenarios covered

1. Order confirmed by A, later delivered → +rate to A (one accrual per order, idempotent).
2. Confirmed by A, reopened, reconfirmed by B, delivered → B earns; A nothing (last confirm before delivery).
3. Confirmed, then returned / rejected / cancelled → no accrual, no penalty (D2).
4. Delivered event arrives late from the carrier → accrual dated at the delivered event; appears in the period the delivery landed.
5. Delivered later corrected away (manual status fix) → automatic `reversal` (−amount), visible in the ledger.
6. Manager records a payout (date · amount · method · reference · note) → balance drops; row is permanent; mistakes are repaired by an `adjustment` with a mandatory note.
7. Payout > balance → warning + confirm → negative balance shown as "doit X" until covered by later accruals.
8. Rate change effective on date D → deliveries ≥ D use the new rate; earlier accruals keep their snapshot.
9. Per-agent override (e.g. senior agent) supersedes the market default while effective.
10. Orders delivered before the first effective rate → ignored (D4).
11. Agent deactivated/deleted → history and balance remain readable; balance must be settled (surfaced as a hint).
12. Manager reads: per period *livrées / acquis / versé*; all-time *solde*; last payout; full statement per agent; CSV export.

## Data model

### `agent_commission_rates` — effective-dated rules (append-only by policy, like `agent_targets`)
```
id uuid pk
market_id uuid → markets
agent_id uuid → users NULL          -- NULL = market default
enabled boolean NOT NULL DEFAULT true       -- false = paused (market row or agent row); amount ignored
amount numeric(10,3) CHECK (amount >= 0)   -- market currency, per delivered order
effective_from date NOT NULL
effective_to date NULL              -- closed by a new row, never edited
set_by uuid → users, note text, created_at timestamptz
CHECK (effective_to IS NULL OR effective_to >= effective_from)
INDEX (market_id, agent_id, effective_from DESC)
```
Resolution for an order delivered on local date D: agent-specific row containing D, else market-default row containing D, else **no rate → no accrual**. If the resolved row has `enabled=false` → no accrual (a per-agent "off" wins over an "on" market row; a market "off" wins over everything). Pure resolver `src/lib/commissions/resolve-rate.ts` (unit-tested), mirrored in SQL. `pct_of_total_price` / per-product columns are deliberately **not** added (D1); adding a `kind` column later is additive.

### `agent_commission_ledger` — APPEND-ONLY (trigger, as `investor_ledger`)
```
id uuid pk
market_id uuid → markets, agent_id uuid → users
order_id uuid → orders NULL         -- accrual / reversal only
entry_type text CHECK ('accrual' | 'reversal' | 'payout' | 'adjustment')
amount numeric(12,3) NOT NULL       -- signed: accrual +, reversal −, payout −, adjustment ±
rate_amount numeric(10,3) NULL      -- snapshot on accrual/reversal
effective_at timestamptz NOT NULL   -- delivered-event time for accruals; PAYMENT DATE for payouts
method text NULL CHECK ('cash'|'bank_transfer'|'wallet')  -- payouts
reference text NULL, note text NULL -- note mandatory for adjustment (enforced in RPC)
created_by uuid → users NULL        -- NULL = system (cron)
created_at timestamptz DEFAULT now()
UNIQUE (order_id, entry_type) WHERE order_id IS NOT NULL   -- idempotent accrual / single reversal
INDEX (agent_id, effective_at DESC); INDEX (market_id, effective_at)
```
Derived, never stored:
- `earned` = Σ(accrual + reversal + adjustment) · `paid` = Σ|payout| · `balance` = Σ amount (all rows) → > 0 company owes agent, < 0 agent owes company.
- `pending_est` = count(orders whose last confirm is by the agent, status in `uploaded…in_transit`) × current rate — read-time estimate only (Q7).

### RLS
- SELECT both tables: `super_admin` all; `market_manager` own market. Agents read **only through** `get_my_commissions()` (SECURITY DEFINER, `agent_id = auth.uid()`), no direct table policy — same containment as the investor portal (D3).
- Writes only through SECURITY DEFINER RPCs guarded by role (`assert_money_actor` pattern); rate RPCs `super_admin` only (Q9).

## Accrual engine

`accrue_agent_commissions(p_market_id uuid DEFAULT NULL) RETURNS jsonb` — SECURITY DEFINER:
1. For each `order_history` row `status_to='delivered'` in scope with no `accrual` ledger row: find the last `confirmed` transition before it whose `actor_id` is an agent; resolve the rate at the delivered local date; if a rate exists insert `accrual` (else skip → D4 falls out naturally).
2. For each accrued order whose `orders.status <> 'delivered'` now and has no `reversal`: insert `reversal`.
3. Return `{accrued, reversed}`.

Scheduled in pg_cron every 15 min (own minute offset), **and** callable via `POST /api/team/commissions/accrue` (super_admin) so a repair never dead-ends. Runs are cheap: only delivered rows newer than the oldest effective rate are candidates.

## RPCs and API

| RPC | Purpose |
|---|---|
| `get_team_commissions(p_market_id, p_from, p_to, p_tz)` → jsonb | Per agent: `delivered`, `earned`, `pending_count`, `pending_est`, `paid`, `balance_total`, `last_payout {at, amount, method}`, `rate {amount, is_override, enabled, effective_from}`; team totals ("à payer" excludes disabled agents with zero balance); `currency`. Period buckets on `effective_at` in market-local days. |
| `get_agent_commission_ledger(p_agent_id, p_from, p_to)` | Statement rows (drawer + CSV). |
| `record_agent_payout(p_agent_id, p_amount, p_paid_at, p_method, p_reference, p_note, p_allow_negative)` | Insert `payout`; refuses if it makes the balance negative unless `p_allow_negative` is true (Q10). |
| `post_agent_commission_adjustment(p_agent_id, p_amount, p_note)` | ± with mandatory note. |
| `set_agent_commission_rate(p_market_id, p_agent_id, p_amount, p_enabled, p_effective_from, p_note)` | Closes the current row (`effective_to = from − 1`), inserts the new one — same call for a rate change and for the on/off switch (`p_enabled=false` keeps the last amount for display). |
| `accrue_agent_commissions(p_market_id)` | Above. |
| `get_my_commissions(p_from, p_to)` → jsonb | Agent-facing: `enabled` (tab hidden when false and balance = 0), rate, balance (earned / paid), month-to-date delivered + earned, in-flight estimate, last payout, statement rows, weekly buckets. Caller = `auth.uid()`; never accepts an agent id. |

Next.js routes: `GET /api/agent/commissions` (agent, own data), `GET /api/team/commissions`, `GET /api/team/commissions/[agentId]/ledger` (+ `?format=csv`), `POST /api/team/commissions/payouts`, `POST /api/team/commissions/adjustments`, `GET|POST /api/settings/commissions` (rates, super_admin — replaces the earlier `/api/team/commissions/rates`), `POST /api/team/commissions/accrue`. Market scope via `getActiveMarketScope` (`src/lib/auth/market-scope.ts`); role via new `canManageCommissions(role)` (super_admin, market_manager) and `canSetCommissionRates(role)` (super_admin) in `src/lib/user-permissions.ts`. SWR hook `useTeamCommissions(marketId, from, to)` beside `useTeamPerformance`.

Types: `TeamCommissions`, `CommissionAgent`, `CommissionLedgerEntry` in `src/lib/team/types.ts`; `buildCommissionView` in `src/lib/team/view-models.ts` (pure, tested); `fmtMoney(locale, amount, currency)` in `src/lib/team/format.ts`.

## UI — mock-up descriptions (HTML prototype with real figures before code)

Design-system rules hold: flat white cards, black/gray text, tabular-nums; functional color **only** for state — red = negative balance ("doit"), nothing else colored. Money as `1 234,500 DT` / `د.ل 1 234,500` (RTL). No new nav item in v1: recording and reading live in the two pages + the shared drawer.

### Page 1 — Salle de contrôle (`/team`, live) — stays a 30-second scan
```
┌ 4 agents en ligne · 12 commandes bloquées · 1 file orpheline · 3 agents à payer (412,500 DT) ┐
│ [Tentatives épuisées] [Files orphelines] [En ligne x/y] [Rappels dépassés / Sans appel]      │  ← unchanged
│ Agents                                                                                        │
│ Agent   Dernière action   Aujourd'hui      Objectifs du jour   Solde        File    Action    │
│ salima  confirmée · 4 min  9 tr · 5 conf    ●●●                +186,000 DT  12      Réassigner▾│
│ roqaya  rejetée · 1 h      6 tr · 2 conf    ●●○                doit 45,000  8       Réassigner▾│  ← red pill
│ mouna   —                  0 · 0            ○○○                —            0       Réassigner▾│
```
1. **Verdict bar** — new trailing segment `· N agents à payer (Σ DT)`; `· N en solde négatif` only when > 0. Hidden at zero.
2. **Roster** — new **Solde** column between *Objectifs du jour* and *File*: `+186,000 DT` (ink-primary), red pill `doit 45,000 DT` when < 0, `—` at zero. Header tooltip: "commissions acquises − versées, depuis toujours".
3. **Roster › Action ▾** — new item `Enregistrer un paiement…` (opens the payout modal).
4. **Drawer › new section "Commission"** (shared with page 2):
```
COMMISSION
Aujourd'hui  4 livrées · +6,000 DT      Ce mois  +186,000 DT
En cours     23 cmd ≈ 34,500 DT (estimation)
Solde        +141,000 DT                Dernier paiement  12 août · 200,000 DT · espèces
[ Enregistrer un paiement ]  [ Voir le relevé ]
  relevé (10 dernières lignes): date · type · montant · note · auteur … Tout le relevé →  Exporter CSV
```
Deliberately **no new tile**: money is per-agent; the four tiles are about blocked work.

### Page 2 — Performance équipe (`/team/performance`, period)
```
┌ Traitées │ Taux │ Heures │ Débit │ Objectif équipe │ Commissions 1 245,000 DT  830 livrées · 900,000 DT versées ┐  ← 6th cell
│ Classement                                          │ Carte débit × taux                                       │
│ 1 salima  taux 46 % · débit 4,1/h · 12 h · 6 j · livrées 61 · +91,500 DT     3,4 conf/h ▂▃▅                  │
│ Par produit                                         │ Présence                                                  │
│ Commissions & paiements  (période)                                             [Taux…] [Exporter CSV]         │
│ Agent   Livrées  Acquis (période)  Versé (période)  Solde total   Dernier paiement          [Payer]           │
│ salima  61       91,500 DT         100,000 DT       +141,000 DT   12 août · 200,000 · esp.  [Payer]           │
│ roqaya  38       57,000 DT         120,000 DT       doit 45,000   9 août · 120,000 · vir.   [Payer]           │
│ Total   99       148,500 DT        220,000 DT       +96,000 DT                                                 │
```
1. **Strip** — 6th `Cell` **Commissions**: value Σ *acquis* in period; caption `N livrées · X versées` (grid → `xl:grid-cols-6`).
2. **Classement** — comps line gains `· livrées N · +X DT`. Optional (flagged, not default): **taux de livraison** = delivered ÷ confirmed for the cohort confirmed in period, with a maturity hint — pay follows deliveries so agents care about it.
3. **New card "Commissions & paiements"** below Présence, full width: columns above; footer totals; follows the page period; product filter ignored (rate is per order); row click → drawer; **Solde** uses the roster tone rules; header link `Taux · Paramètres →` (opens Paramètres › Général › Commissions) and `Exporter CSV`.
4. **Payout modal** — "Enregistrer un paiement — {agent}": Montant · Date du paiement (default today, market tz) · Mode (espèces / virement / wallet) · Référence · Note · live line `Solde après paiement : +41,000 DT`; if it turns negative → amber notice "Cela crée un solde négatif de X — confirmer ?" + explicit checkbox. Toast + SWR mutate on success.
5. **Drawer** — same "Commission" section; *Acquis/Versé* scoped to the page period, *Solde* all-time.

### Page 3 — Paramètres › Général › **Commissions** (super_admin, new tab beside Opérations / Finance / Équipe / Libellés)
`SectionShell` card "Commissions — ce qu'un agent gagne par commande livrée": **Commissions activées** switch (market, with history chip) · *Commission par commande livrée (د.ل.)* with the standard change-history popover · *À partir du* (date, market tz; earlier deliveries keep their rate) · **Par agent** table listing every agent: switch · taux ("3,000 · marché" or "3,500 · taux propre") · depuis · note · action (Modifier / Taux propre…) — a disabled row is greyed with a "désactivée" tag · *Historique* list (rate changes and on/off events) · Save footer. Writes `agent_commission_rates` via `set_agent_commission_rate`. Group hidden for market managers (like Finance).

### Page 4 — Agent shell › **Mes commissions** (new tab after Commandes · Prospects · Relances; RTL/Arabic on LY) — deliberately minimal
Single column, max ~640px, read-only. Exactly these metrics, in this order:
1. **À recevoir** — the one big number = balance (Σ ledger). Caption: "depuis ton paiement du {date} · N livrées, M corrections" (rows since the last payout). If negative: "tu as reçu X de plus que ton dû — se résorbe avec les prochaines livraisons".
2. Three compact facts in one row: **Ce mois** (delivered count · +earned) · **En cours** (in-flight count · "≈ X si livrées", estimate) · **Dernier paiement** (date · amount · method).
3. **Historique par jour** — one row per local day: `date · "N livrées" · +amount`; corrections as "1 correction — commande #… n'était pas livrée · −amount"; payouts as a shaded row "Paiement reçu · mode · réf. · −amount". A day expands (`<details>`) to its order refs (#ext_id · product · city · +rate). Last 30 days loaded, "Voir {mois précédent}" for more. Footer rule: "Une commande compte le jour où le transporteur la marque livrée."
Header right: "{rate} د.ل. par commande livrée". No weekly card, no acquis/versé-since-launch figures, no actions.
Data: one call to `get_my_commissions(p_from, p_to)` returning `{rate, balance, since_last_payout:{delivered, corrections}, month:{delivered, earned}, inflight:{count, est}, last_payout, days:[{day, delivered, amount, orders:[…]}], payouts:[…]}` — day grouping done in SQL so the payload is small.

### Out of scope v1 (listed as decisions, not omissions)
Receipt photos · bank export · WhatsApp notification on payout · dedicated `/team/commissions` page (revisit if the card outgrows the performance page).

## Stage 1 status — prototype delivered (2026-08-17)

- Artifact: https://claude.ai/code/artifact/48ec67a6-1882-4766-856b-0bd9f1455bef (label `v1-real-figures`)
- Source: `Ordra/prototypes/agent-commissions-v1.html` (self-contained; deep links `#perf`, `#drawer:tasnim,ledger`, `#pay:roqaya,over`, `#rates`; append `,plain` to hide the "Nouveau" highlights)
- Figures: real Libya market — 30 d delivered attributed by last confirm (tasnim 37 · roqaya 21 · hend 12 · salima 11), 7 d = 58; live page frozen at 16 Aug 20:34 (last active evening). **Rate is illustrative** (3,000 LYD, tasnim 3,500) and payouts are sample rows to show each state incl. a negative balance.
- v2 (2026-08-18, label `v2-settings-and-agent-view`): added Paramètres › Général › Commissions and the agent's Mes commissions tab (real August figures: tasnim 37 delivered, weeks 0 · 18 · 19); rates sheet removed from the Performance card. 9 "Points à valider" now.
- v3 (2026-08-18, label `v3-minimal-agent-view`): agent view reduced to À recevoir · 3 facts · history grouped by day (expandable to orders).
- v4 (2026-08-18, label `v4-commission-switches`): market + per-agent switches in Paramètres › Commissions; "Par agent" table replaces the exceptions table; mouna shown disabled across surfaces. 10 "Points à valider".
- Awaiting: manager approval / iteration on the 10 points, and the real rate. **No code or migration until approved.**

## Implementation stages

**Stage 1 — HTML prototype** (user rule: prototype with real prod figures before schema): re-auth Supabase MCP (`/mcp`), pull read-only figures (delivered per agent last 30 d attributed by last confirm; confirmed-in-flight per agent; a candidate rate from the manager), load `artifact-design` + `dataviz`, build one self-contained artifact: both pages with the additions, drawer section, payout modal, rates sheet; iterate to approval.

**Stage 2 — data layer** (TDD first on pure TS): migrations `agent_commission_rates`, `agent_commission_ledger` (+ append-only trigger, RLS), the six RPCs, pg_cron schedule; tests for `resolve-rate`, balance fold sign rules, negative-balance detection, market-tz bucketing.

**Stage 3 — API + hooks**: routes above, permission helpers, `useTeamCommissions`; API shape tests (mirror `src/app/api/team/targets/route.ts` style).

**Stage 4 — UI**: `CommissionsCard`, `PayoutModal`, settings `CommissionsSection` (in `GeneralSettingsGroups`, new group key `commissions`), agent page `(agent)/commissions` + `AgentNavTabs` entry, drawer `CommissionSection`, roster **Solde** column + menu item, strip cell, ranking comps, verdict segment; strings in `fr.json` + `ar.json` under `team.commissions.*`; logical CSS props (RTL).

**Stage 5 — docs**: `docs/database-schema.md` rows for both tables; short `docs/agent-commissions.md` (rules D1–D4, ledger semantics) linked from `CLAUDE.md`; copy this plan to `Ordra/plans/agent-commission-tracking.md`; go-live = `set_agent_commission_rate` market default with `effective_from` = launch date.

## Implementation status — done 2026-08-18

Stages 2–5 implemented and verified (see docs/agent-commissions.md):
- Migrations applied to `vshynigvgrlihngozuwb`: `20260918010001_agent_commissions_schema`, `…010002_agent_commissions_rpcs` (+ `earned_total/paid_total`), `…010003_pg_cron_agent_commissions` (job `agent-commissions-accrue-15min`, `8-59/15 * * * *`).
- Verified in SQL (rolled back): sweep idempotent (86 → 0), override + pause honored, `NEGATIVE_BALANCE` refusal, manager can't set rates, agent RPC contained (`{}` for manager RPCs, RLS 0 rows).
- Verified in the running app (Playwright, super_admin session): `/team` Solde column + verdict, `/team/performance` strip cell + Commissions & paiements card, `/settings/general?tab=commissions`.
- Tests: 30 new tests green (view-models, permissions, 3 routes, PayoutModal, CommissionsCard, CommissionsSection, AgentCommissionsView); full suite 30 failures = pre-existing baseline (verified identical on HEAD for the settings/sidebar files); `npm run typecheck` and `npm run build` clean.
- Deviations from the plan: the agent tab is always shown (the page itself explains a disabled account) instead of hiding it — hiding needs a fetch in the nav; revisit if wanted. Roster payout affordance is a small `Payer` button in the Solde cell rather than a menu item.
- Go-live = set the market rate in Paramètres › Général › Commissions (no rows exist yet; nothing accrues until then).

## Verification
- Unit: rate resolution (override > default, effective windows, no-rate → null); fold: accrual+, reversal−, payout−, adjustment±; negative-balance flag; period bucketing in `Africa/Tunis` / `Africa/Tripoli`.
- SQL: `accrue_agent_commissions` twice → second run `{accrued:0}`; reopen+reconfirm scenario attributes to the last confirmer; a delivered→corrected order yields exactly one `reversal`; deliveries dated before the first rate produce nothing; a paused agent (or market) produces nothing from the pause date and resumes after re-enable.
- E2E (dev server, creds in `CLAUDE.md`): as super_admin and `tn_manager` record a payout → roster **Solde**, strip and card update; payout above balance shows the warning and needs the confirm; `tn_agent_1` gets 403 on every `/api/team/commissions/*` and `/api/settings/commissions` route, and `/api/agent/commissions` returns only their own rows (try another agent id → ignored); LY market renders RTL with `د.ل`; `npm run typecheck` green (lint unconfigured; 31 pre-existing test failures are baseline).
