# Team Performance — Présence day-click redesign

## Context

On `/team/performance`, the "Présence" heatmap table (`src/components/team/control-room/PresenceHeatmap.tsx`) shows one colored cell per agent per day. Clicking a day is supposed to drill into that agent's performance on that specific day. It doesn't:

- The `onClick` lives on the `<tr>` (`PresenceHeatmap.tsx:44`), not on the individual day `<td>`. Every cell in a row — whichever day you actually click — bubbles up to the same row handler, which only ever knows the **agent id**, never which day was clicked.
- The sidebar that opens (`AgentDrawer.tsx`) fetches exactly two things, neither of which is day-specific: a hardcoded "right now" live snapshot (`get_team_live`, always `now()`, no date param) for the "Aujourd'hui" section, and the same period-wide aggregate (`get_team_performance` over whatever 7d/30d range is selected at the top of the page) for everything else. Click Monday or Friday for the same agent — identical panel.
- The raw material for a real per-day view already exists and is already sitting in the browser: `PerfAgent.daily` (`{day, active_minutes, treated, confirmed}` per agent) is exactly what colors the heatmap cells, but `AgentDrawer` never reads it.
- There's no real attendance/session table — "Présence" is inferred from `order_history` action timestamps (10-minute-bucket proxy), not logins. There's no call-duration data anywhere, only order status-change timestamps. Product breakdown and rejection reasons are currently computed at the **period** level only, not per day.

## Decisions (from two rounds of clarifying questions with Firas)

- Clicking a day cell **replaces** the panel with a real single-day detail view. Clicking the agent's name/avatar (not a day) keeps opening the existing period-overview drawer as-is.
- For orders touched that day, show current status too — bridges "how the day went" to "did the work actually get closed out."
- Per-day product breakdown and per-day rejection reasons are in scope (needs new backend/RPC work — approved).
- The day panel includes a 24h (00:00–23:59) hourly activity table, colored like the Présence heatmap.
- Purpose is both coaching (comparisons, a takeaway) and operational audit (raw facts, what's still open).

## Step 1 — Real-data prototype — **done**

Per the established workflow of prototyping visually before schema/system changes, built and published the visual prototype *before* writing any RPC/component code (skipped a text-plan-approval gate at Firas's explicit direction — "the expected output is a UI HTML page before you touch any code").

- **File**: `Ordra/prototypes/team-performance-day-drawer-v1.html`
- **Published**: https://claude.ai/code/artifact/f332f8e0-09d7-40e6-a099-8e728fe0a751 ("Journée de tasnim")
- **Real data used** (read-only queries against Supabase project `vshynigvgrlihngozuwb`, market Libya `00000000-0000-0000-0000-000000000002`, tz `Africa/Tripoli`): agent **tasnim** (`0fe04d68-7159-475a-bee4-5e27ade3e5c4`) — she's literally the agent in Firas's original screenshot. 14-day Présence window (3–16 Aug), and two fully-worked days:
  - **11 Aug** (busy day): 86 calls, 37 touched, 28 treated, 13 confirmed, 220 min active, 4 products (incl. a book product), rejections 13× "autre" + 2× "refus_client", touched→now-status reconciliation (3 still stuck at attempt_3, 8 progressed to uploaded/delivered, 20 now rejected, 6 cancelled/deleted).
  - **14 Aug** (typical day): 95 calls, 34 touched, 13 treated, 6 confirmed, 160 min active, 3 products, rejections 7× "autre" (100% — vague-reason flag), reconciliation (5 still open: 4× attempt_3 + 1× callback_scheduled).
  - "Avant" side proves the bug live: today's (16 Aug) live numbers (46/17/8/170min) and the 7-day period aggregate (79 treated/36 confirmed) are identical regardless of which day cell is clicked.

**Real-data findings that changed the design vs. the original plan:**
- **Dropped "vs team, same day."** On several real days, tasnim was the *only* active agent in the Libya market — a same-day team comparison is frequently undefined for small teams. Replaced with **vs her own personal target** (12 treated / 40% rate — the actual thresholds from `src/lib/team/goals.ts`) and **vs her own trailing average** over the visible window. Both are always computable and match the app's existing goal-judging logic instead of inventing a new mechanic.
- **Per-product rate must respect `MIN_TREATED_FOR_RATE` (10) per product, not just per agent-day.** `AgentDrawer.tsx`'s existing per-product logic (`p.treated >= MIN_TREATED_FOR_RATE ? rateOf(...) : null`) already does this — on 14 Aug, none of the 3 individual products cross 10 treated even though the day total (13) does, so every product row shows a raw `confirmed/treated` fraction, not a %. The new per-day RPC and view-model must reuse this exact threshold per product, not just at the day-total level.
- **"Touched" (distinct orders) is a genuinely different number from "calls"/"touches" (action count)** — real data confirms both are worth showing side by side (e.g. 14 Aug: 95 calls across only 34 distinct orders touched).
- **The reconciliation bucketing** that held up against real statuses: `ok` (uploaded/scanned/dispatched/deposit/in_transit/delivered), `open` (confirmed/attempt_*/callback_scheduled/pending/dispatch_scheduled — still needs the agent), `rejected`, `other` (cancelled/deleted/returned).

**Firas's reaction to the prototype is the next input** — expect small layout/wording/scope adjustments before Steps 2–3 below are finalized; that's the point of having built it first.

---

## Step 1b — Added after brainstorming: call-attempt cadence (2h SLA)

Firas asked to also measure, per order, how many attempts an agent made and whether the follow-up after the first action came within 2h — plus asked for a better-designed Résumé and touched-orders section (didn't like the original prose paragraph / recon bar). Investigated with real data before changing the prototype (same prototype-first approach):

**Critical finding — `order_history` rows are NOT 1:1 with real call attempts.** Most repeated same-status rows (e.g. several `attempt_2→attempt_2` rows seconds apart) are the agent editing a field (phone/city/address — logged as a JSON-shaped `note`) or a manager reassignment (`note = "Reassigned to agent"`), not phone calls. **The reliable signal is a dedicated RPC** (`supabase/migrations/20260827000002_stamp_next_retry_slot.sql` and its successors, e.g. `20260829000004_no_answer_ladder_never_walks_back.sql`) that is the sole writer of genuine dial outcomes — it always writes a `note` matching `Tentative N - pas de reponse` / `Tentative N - rappel programme` / `Auto-rejete - tentative N`, where N is the true `orders.attempts_count` (a denormalised counter that can exceed 3 — the `attempt_1/2/3` status enum is a capped display tier, not the real count). **Real attempts = `order_history.note ~* '^(Tentative \d+|Auto-rejete)'`** — filter on this, not on `status_to IN ('attempt_1','attempt_2','attempt_3')`.

For a given order, sort these rows by `created_at`; the gap between consecutive ones is the real time-between-attempts. Verified on tasnim's real data:
- **14 Aug**: 13 of 17 judged follow-ups (76%) exceeded 2h — but almost all those gaps are **2–3 days**, not minutes-late. Reads as orders sitting untouched for days, not slow dialing.
- **11 Aug**: 12 of 20 (60%) exceeded 2h, but gaps are mostly **3–3.5h** — a same-day cadence issue, structurally different from the 14 Aug pattern.
- This same-day-slow vs. multi-day-abandoned distinction is itself the actionable insight, more than a single "% late" number — worth keeping as a qualitative note alongside the compliance rate, not collapsing into one figure.

**Redesign applied to the prototype** (same URL, republished):
- **Résumé** → 4 scannable insight cards (rate vs. target, cadence compliance %, still-open count, rejection-reason quality), reusing the KPI tinted-icon-holder pattern from `docs/design-system.md` §4.19, instead of one prose paragraph.
- **Touched-orders / "Devenir des commandes"** → replaced with a single **cadence table**: every order with a flagged (or notable) attempt gap, worst-first, showing product, per-attempt gap chips (`#N · 2j 22h ⚠`), and current status — merges what used to be two separate, vaguer sections (a reconciliation bar + prose) into one dense, actionable table. A footer line accounts for orders with no cadence signal (first contact that day, or resolved/edited without a dial).

**Open defaults, not yet confirmed — stated as assumptions, flag if wrong:**
- The 2h rule generalizes to every consecutive attempt pair (1→2, 2→3, ...), not just attempt 1→2.
- "Rappel programme" and "Auto-rejete" dials count as real attempts for cadence purposes, same as "pas de reponse".
- 2h stays a hardcoded constant for now rather than a new `settings` key (like `goal_daily_treated` etc.) — easy to promote later if it proves useful.

---

## Step 1c — Summary block redesign (metric brainstorm)

Firas asked what metrics the summary should actually carry. Audit of the existing
block found it was **two grids showing five numbers, two of them twice**: the
`stat-grid` (Appels · Touchées · Traitées · Confirmées · Taux) sat directly above a
`kpi-grid` where *Volume* re-stated Traitées and *Qualité* re-stated Taux — the same
figures in two visual grammars, one judged and one not. Meanwhile Appels, Touchées and
Activité carried no target, no comparison and no verdict, so a manager could read all
nine cells and still not know whether the day was good.

**Replaced with one hero + four non-overlapping cards:**

| Slot | Metric | Why this one |
|---|---|---|
| **Hero** | **Confirmées / heure** vs `goal_conf_per_hour` (3) | The metric `RankingCard` already sorts the entire team by, and it was absent from the day view entirely. Normalises for a short day — 6 confirmations in 2h40 and in 8h are not the same performance, which every raw count on the old block hid. Carries a 14-day trend sparkline with the target as a dashed rule and the opened day marked. |
| Card 1 | **Volume** — traitées vs 12 | Kept (real target from `goals.ts`), now the *only* place that number appears. |
| Card 2 | **Qualité** — taux vs 40 % | Kept, same de-duplication. |
| Card 3 | **Cadence rappel** — median gap + tier badge | Promoted from prose in "Points clés". A bounded slider is wrong for a value ranging 200 → 2827 min, so it gets an `à temps / tardif / abandonné` badge instead. |
| Card 4 | **Série en cours** | Streak was visible on the team ranking but not on the day the streak was won or lost. Recomputed here with the exact `computeGoalStreak` rule (volume + quality, inactive days skipped). |

Raw counts (**Appels · Touchées · appels par confirmation**) demoted to one
de-emphasised context line under the hero — still auditable, no longer competing with
the judged figures. *Appels par confirmation* is new and derived: **6,6** on 11 Aug vs
**15,8** on 14 Aug is the single sharpest contrast between those two days.

Dropped: *Écart vs moy. 14 j* (the hero's vs-target chip plus the sparkline cover
"is this day normal?" better than a lone delta) and the standalone *Activité* tile
(now the hero's denominator, stated in its subtitle). The "Points clés" cadence row is
now conditional — it renders only when there is a fix to offer, since the median it
used to quote lives on card 3.

Verified on both demo days (no JS errors across all five drawer paths): 11 Aug reads
3,5/h ▲ vs 3/h, cadence *tardif* 3h20, streak Jour 1 (record 3 j); 14 Aug reads
2,3/h ▼, cadence *abandonné* 1j 23h, streak Jour 3 · record égalé.

Republished: https://claude.ai/code/artifact/7edfa57e-82f6-4b68-8103-947bc2aa6dae
(the earlier artifact URL no longer resolves).

---

## Step 1d — Success metric switched to *téléchargée*, and the queue replaces "Points clés"

Two corrections from Firas, both of which changed real numbers rather than labels.

### The success metric is `uploaded`, not `confirmed`

`confirmed` only means the phone call went well — per `CLAUDE.md` the order is still in
the agent's queue with an "Upload" affordance until it is actually pushed to the
carrier. Counting confirmations credits work that never shipped. Re-queried the whole
window against production on the `uploaded` basis (distinct orders, end-of-day):

| Day | traitées | confirmées | **téléchargées** | taux conf. | **taux téléch.** |
|---|---|---|---|---|---|
| 5 Aug | 29 | 13 | 13 | 44,8 % | 44,8 % |
| 6 Aug | 22 | 13 | **11** | 59,1 % | **50,0 %** |
| 8 Aug | 28 | 13 | 13 | 46,4 % | 46,4 % |
| 11 Aug | 28 | 13 | **11** | 46,4 % | **39,3 %** |
| 14 Aug | 13 | 6 | 6 | 46,2 % | 46,2 % |

**This is not cosmetic.** On 11 Aug the two never-uploaded orders drop her from 46,4 %
to **39,3 % — under the 40 % target — which breaks a 3-day goal streak** that the
confirmation-based series showed as intact. The streak, the sparkline, `OWN_AVG_RATE`
(47,5 → 45,6) and the hourly series (18h/19h on 11 Aug) were all recomputed. Per-product
rates moved too (متوسط 11 Aug: 9 confirmées → 7 téléchargées, the 2 stuck ones).

The **"avant" panels deliberately still say *Confirmées*** — they depict today's
production behaviour faithfully, and relabelling them would misrepresent the bug.

### Stuck confirmations are now surfaced explicitly

An amber block names them, attributes the damage, and offers the fix:
*"2 confirmées jamais téléchargées — le client a dit oui, mais la commande n'est jamais
partie chez le transporteur… c'est ce qui fait passer son taux de 46,4 % à 39,3 %"* +
`[Télécharger]`. Products carrying stuck orders get a badge on their own table row, so
the blockage is attributable, not just a day total. When there are none, a green line
says so.

### "Points clés à retenir" → "File d'attente à la fin du jour"

The old section answered *how did she do?*, which the Résumé already answers with judged
numbers. The new one answers what a manager acts on the next morning: **what did she
leave behind, and how much runway is left on each one.** Two structurally different
leftovers: orders needing another **call** (bucketed by attempts remaining) and orders
needing an **upload**.

**`max_call_attempts` for the Libya market is 8, not 3** (`settings`) — so `attempt_3`
is only a capped display tier and "attempts left" must come from the setting, never the
status name. Rendered as an 8-column ladder (0→7 remaining) with urgency colour, plus
tiers: *épuisée — rejet auto* (0) · *dernière chance* (1–2) · *avec de la marge* (3+).

Real end-of-day queues reconcile exactly to *touched*:
- **11 Aug** — 37 touchées = 11 téléchargées + 2 bloquées + 9 à rappeler + 15 rejetées.
  Of the 9: **1 épuisée**, 8 with margin.
- **14 Aug** — 34 touchées = 6 + 0 + 21 + 7. Of the 21: **1 épuisée, 3 dernières
  chances**, 17 with margin — a backlog more than twice 11 Aug's.

The rejection-quality insight was dropped (the *Motifs de refus* section already flags
`autre` with "⚠ motif imprécis"); the per-order cadence table survives behind
*"Détail des relances"*, and the cadence note became the section footer.

**Consequences for Step 2:** the RPC must return, per day, (a) end-of-day status per
touched order, (b) attempts made per still-open order so `max_call_attempts − made`
is computable, and (c) `uploaded` counts per day / per hour / per product. It must read
`max_call_attempts` from `settings` per market, not assume 3. `MIN_TREATED_FOR_RATE`
still gates per-product rates.

**Consequence for Step 2:** the per-day RPC must also return `active_minutes` and
`confirmed` in a form that yields confirmations/hour, and the view-model needs the
trailing daily series (already in `PerfAgent.daily`) to draw the sparkline and compute
the streak — no new query, but the day endpoint alone is not sufficient.

---

## Step 2 — Backend: per-day RPC

Add a new migration under `supabase/migrations/` (follow the existing `20260907000002_team_rpcs.sql` timestamp-prefixed convention) with a new `SECURITY DEFINER` function, e.g. `get_agent_day_detail(p_market_id uuid, p_agent_id uuid, p_day date, p_tz text)`, scoped to one agent + one market-local calendar day. Mirror the CTE patterns already in `get_team_performance` (`hist`, `daily`, `agent_products`, `motifs`) rather than inventing new ones, narrowed to a single agent/day and extended with:

- **Hourly buckets**: same distinct-10-minute-bucket `active_minutes` proxy, grouped by `extract(hour from created_at at time zone p_tz)` instead of by day → `{hour, active_minutes, treated, confirmed}` × 24.
- **Touched-orders reconciliation**: distinct `order_id` with any `order_history` row by that agent on that day (mirrors the `touches`/"touched" definition validated in the prototype), left-joined to `orders.status` **as of now** (not as of that day), bucketed per the 4-way scheme validated above (`ok`/`open`/`rejected`/`other`).
- Per-product breakdown (with `treated >= 10` gating the rate exactly like `AgentDrawer.tsx` does today) and rejection reasons: same joins `get_team_performance` already does for `agent_products`/`motifs`, re-scoped to the single day.
- "Calls" (action count) vs. "touched" (distinct order count) as two separate numbers, both validated as meaningfully different in the real data.
- **Call-attempt cadence** (see Step 1b): filter `order_history.note ~* '^(Tentative \d+|Auto-rejete)'` — not `status_to IN ('attempt_1','attempt_2','attempt_3')`, which also catches field edits and reassignments. Window over consecutive matching rows per `order_id` (`LAG(created_at) OVER (PARTITION BY order_id ORDER BY created_at)`), flag `gap > interval '2 hours'`, scoped to attempts whose `created_at` falls on the requested day.

Add the API route (`src/app/api/team/agent-day/route.ts`, same shape as `src/app/api/team/performance/route.ts`) and a paired SWR hook (`src/hooks/useAgentDayDetail.ts`, same pattern as `useTeamPerformance.ts`). Extend `src/lib/team/types.ts` with the new `AgentDayDetail` shape. Per project convention (`CLAUDE.md` — TDD non-negotiable), write the RPC's expected-shape test and the view-model/formatting tests before the implementation.

---

## Step 3 — Frontend: wire real per-day clicks

- **`PresenceHeatmap.tsx`**: move the click target from the `<tr>` down to each day `<td>` — `onSelectDay(agentId, day)` — and keep a separate click target on the name/avatar cell for `onSelectAgent(agentId)` (existing period-overview behavior, unchanged, validated in the prototype). Give the two targets distinct hover affordance since they now do different things.
- **`TeamPerformanceWorkspace.tsx`**: add `selectedDay` state (`{ agentId, day } | null`) alongside the existing `selected` (agent) state.
- New component `AgentDayDrawer.tsx` in `src/components/team/control-room/`, reusing `Sheet`, `SecLabel`/`Stat`, `AgentAvatar`, and the `RAMP`/`level` color-ramp logic from `PresenceHeatmap.tsx` — worth lifting `RAMP` + a threshold-aware `level()` into a small shared helper (`src/lib/team/heat.ts`) so the day heatmap and the new hour heatmap (which needs its own thresholds — an hour caps at 60 active minutes, not 180+) draw from one source instead of a copy-pasted palette. Sections match the validated prototype: totals, vs-target/vs-own-average chips, 4-card insight summary (rate/cadence/still-open/rejection-quality, KPI tinted-icon pattern per §4.19), the cadence table (worst-gap-first, replaces the old reconciliation bar), per-product table, 24h hour strip, rejection peek.
- Wire both drawers side by side in `TeamPerformanceWorkspace.tsx`: a day-cell click opens `AgentDayDrawer`, a name/avatar click keeps opening the existing `AgentDrawer`.
- Add the new i18n keys to `src/messages/fr.json` and `ar.json` (new `team.dayDrawer` namespace) — no hardcoded strings, per project convention.

---

## Verification

- `npm run typecheck` and `npm test` (existing suite has pre-existing failures unrelated to this area — don't chase those, just confirm this change doesn't add new ones).
- New tests first (TDD, per `CLAUDE.md`): RPC output shape, the new view-model helpers (including the per-product `MIN_TREATED_FOR_RATE` gate), and `PresenceHeatmap`'s per-cell click behavior (asserts the right `(agentId, day)` pair fires, not just the agent id).
- `npm run dev`, open `/team/performance`, click several different day cells for tasnim (or any agent) and confirm the numbers actually change per day — spot-check against the real figures already validated in the prototype (11 Aug: 28 treated/13 confirmed; 14 Aug: 13 treated/6 confirmed). Click the agent name and confirm the existing period drawer still opens unchanged. Check both `fr` and `ar` locales (RTL layout, hour/day heatmap mirroring).
