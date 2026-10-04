# Performance équipe — rebuilt around one question

**Status:** BUILT 2026-10-04 (owner: "follow the latest prototype and implement it exactly") on branch
`feat/team-performance-v3`, off main 866c897. Phases 1–3, 5 and 6 done; phase 4 was already done by
Salle de contrôle v6 (`stretchesOf`, now exported and shared). Migration
`20261005100000_team_performance_v2.sql` is NOT on prod — paste it before merging.
v1 was **rejected** on 2026-10-04 ("no colourful, no modern visuals, no elegant components").
**Prototype:** `prototypes/team-performance-v3.html` (the « Aurore » look, real Libya data read 2026-10-03/04).
`-v2` is the four-look style board he chose from; `-v1` is kept for history.
**Sibling:** Salle de contrôle v5 (`/team`, live 2026-10-03) stays as approved. This page reuses
its vocabulary, its colours (`--room-*`) and its score.

## 1. Why

The owner rejected the live `/team/performance` page: "structure, layout, design, no efficient data —
redesign from ground zero". Three rounds of questions (2026-10-03) produced ten answers:

| # | Question | Answer |
| --- | --- | --- |
| 1 | Which page? | Performance équipe (the screenshot). Salle de contrôle v5 stays. |
| 2 | The ONE question | **Why do agents lose orders?** |
| 3 | Pains | Too much at once · nothing to act on · "the Classement could be much better" |
| 4 | Reader | The owner, every day |
| 5 | Ranking | **Livrées pour 100 attribuées** (= v5) + a bar of where her orders went + her biggest leak with its number |
| 6 | Fake orders | Count them in the score, coloured apart |
| 7 | When a problem is found | **One line: what to tell her** |
| 8 | Keep | Présence, Par produit, Carte débit × taux ("enhance it visually") — commissions and goals go |
| 9 | Hours | **On shift**: first → last action, breaks over 1 h removed — Salle de contrôle's « Actif » too |
| 10 | Default window | 30 days |

### 1b. The look (two rounds, 2026-10-04, after v1 was rejected)

The ten answers above still hold; only the look restarted.

| # | Question | Answer |
| --- | --- | --- |
| 11 | Page structure | One page, the same five blocks |
| 12 | Classement | **One card per agent**: ring of her 100 orders, score /100 with its trend, biggest leak, the line to tell her |
| 13 | What colour means | **Each agent has her own colour everywhere**; outcomes keep fixed colours inside the charts |
| 14 | Overview | **Waffle**: 10 × 10 squares, one per order |
| 15 | Look | **« Aurore »**: soft gradient page, frosted-glass cards, a halo of her colour behind her avatar (picked from a rendered board of 4 looks) |
| 16 | Carte débit × taux | **Bubbles + zones**: her colour and initial, size = decisions, four tinted named zones, dotted trail from last period |
| 17 | Par produit | **Heatmap tiles**: green deepens with livrées pour 100; red ▼ badge at 5+ points under the team |
| 18 | Présence | **Shift timelines**, one day at a time: first → last action, breaks over 1 h as dotted gaps |

## 2. What the data said (Libya, 2026-10-03)

- Of 100 orders attributed: **19 delivered · 17 lost at Darb after upload · 42 rejected · 19 never real ·
  3 still open**. Flat for five weeks (18, 16, 20, 20, 19 delivered per 100).
- The old ranking divided by "active hours" = 10-minute windows containing a click. It ranked roqaya
  #1 while v5 ranks her #3; it rewarded batch-rejecting. Both pages now share one score.
- tasnim files **100 %** of her rejections under « Autre » (still on 2026-10-03) but types the real
  reason in the note ("she said cancel", "number not in use", "she didn't order").
- roqaya classes **45 %** of her orders as never real (rest of the team: 10 %). Orders are distributed
  evenly, so this is labelling, not bad luck — which is why "never real" stays in her score.
- hend's orders wait a **median 18.7 h** before her first call (team 2–9 h); 57 % of her "unreachable"
  came after a wait over 24 h. "Call back more" would be the wrong advice — she already tries most.
- Darb losses take 1–2 weeks to settle: a week-old cohort shows 7 % lost vs 17 % settled.
- Goals are dead: the four `goal_*` settings are the August seed values, 3 `agent_targets` rows, all 17 Aug.
- Tunisia: no orders since 2026-07-07.

## 3. The page (top to bottom) — as drawn in v3

1. **Header** — title, the agents' avatar stack (their colours, click = focus), market + window, one period
   control: 30 jours (default) · 7 jours · Ce mois · Personnalisé. Everything below follows it.
2. **Sur 100 commandes attribuées** — a **waffle** of 100 squares beside four glass tiles with a trend vs the
   previous window: Livrées · Retournées · Rejetées · Jamais réelles (+ « En cours » under them). Hovering a
   tile lights its squares. A short notice when the window is younger than 14 days (Darb not settled) — the
   Retournées trend is then hidden. « Retournées » is v5's word for the same definition.
3. **Classement** — **one card per agent** (≥ 30 attributed), ranked: avatar in her colour, medal, a ring
   of her 100 orders with the score in the middle and its trend, four small per-100 numbers (retournées,
   rejetées, jamais réelles, en cours), her biggest leak (icon + label + count + her % against the others'),
   and **« À lui dire »**: one line. Click a card: a panel opens under the cards with her top 3 leaks (count,
   comparison, orders above the others' rate, line to tell her) and the whole page focuses on her (her bubble,
   her product column, her timeline row); Escape or × closes. Under 30 orders: "Hors classement" chips.
4. **Carte débit × taux** — "Aller vite lui coûte-t-il des commandes ?" Bubbles in her colour with her
   initial, sized by decisions; four tinted, named zones split by the team cross; a dotted trail from where
   she stood the previous window; names and values written beside each bubble; « Chiffres » swaps the chart
   for a table. Placed from 30 decisions.
5. **Par produit** — "Qui ne vend pas quel produit ?" Heatmap tiles, products × (team + each ranked agent):
   green deepens with livrées pour 100 (0 → 40), the number inside; a red ▼ badge when ≥ 5 points under the
   product's team value with n ≥ 20; « — » under 10 orders.
6. **Présence** — "Qui a travaillé, quand, et combien ?" A day strip (one column per day, stacked in the
   agents' colours = hours on shift, Fridays shaded) picks the day; below, one **shift timeline** per agent
   for that day: pills from first to last action, dotted gaps for breaks over 1 h with their length, start
   and end times, the day's hours, and the window's total + days + daily average. A link opens that day in
   Salle de contrôle (`/team?day=…`) — no drawer on this page. Default day = the latest one when at least
   half the regular agents worked an hour.

Gone from the page: conf/h ranking, streaks (« série »), goals and « Objectif » buttons, KPI strip,
commissions card and payout modal (v5 has Solde + Payer), the agent drawer and the day drawer.

## 4. Definitions (one truth with Salle de contrôle)

| On screen | Definition |
| --- | --- |
| Attribuées | orders whose `assigned_at` falls in the window and that she still holds (v5) |
| Livrée | `status = delivered` |
| En cours | still in her queue (pending/attempts/callback/confirmed/dispatch_scheduled) or on the road |
| Retournée | uploaded, then cancelled / returning / to_be_returned / returned / received (= v5 « retournée ») |
| Jamais réelle | rejected as non_commande · doublon · simple_info · numero_invalide · numero_hors_service · mauvais_interlocuteur, or `deleted` |
| Rejetée | every other rejection, « Autre » included |
| Score | livrées ÷ attribuées × 100; ranked from 30 attribuées; trend = rounded score − rounded previous window (v5 rule) |
| Décisions | distinct orders she uploaded + rejected in the window (v5 vocabulary) |
| Taux | uploadées ÷ (uploadées + rejetées) — v5's only rate |
| Heures en poste | per local day, the sum of gaps between her consecutive actions when the gap ≤ 60 min |
| Débit | décisions ÷ heures en poste; placed on the map from 30 décisions |

## 5. Leaks and the line to tell her

A leak is something she does **more than the rest of the team** (everyone but her), measured in orders:
`excess = her count − (rest rate × her base)`. Shown when `excess ≥ max(8, 3 % of her attributed)` and her
rate is ≥ 1.5 × the rest's **or** ≥ 10 points above it (the second arm catches high-base rates such as
first-call rejections, 66 % vs 45 %). Ranked by excess; the row shows the first, the opened row up to three.

| Leak | Base | Line to tell her (FR) |
| --- | --- | --- |
| Motif « Autre » | attribuées | Choisir le vrai motif, pas « Autre » |
| A sub-reason (each one) | attribuées | per sub-reason, e.g. « Non sérieux » → Rappeler avant de classer « non sérieux » |
| Retournées après upload | her parcels that left | Confirmer adresse et intention avant d'uploader |
| Rejet dès le 1er appel | her rejections | Rappeler au moins une fois avant de rejeter |
| 1er appel après 24 h | attribuées | Appeler chaque nouvelle commande le jour même |

30-day result: tasnim « Autre » (281) · salima « Non sérieux » (107), 1er appel (56), « Changé d'avis » (37) ·
roqaya « Pas commandé » (72), « Simple info » (29), « Prix » (27) · hend 1er appel après 24 h (33),
« Ne répond pas » (20), « Hors service » (18). **The wording is the owner's to validate** — it is the one
part of the page that speaks for him.

## 6. Data

One new read RPC, `get_team_performance_v2(market, from, to, tz)`, replacing `get_team_performance`:
per agent the cohort segments, the rejection counts by sub-reason, first-call rejections, first calls
after 24 h, décisions, minutes on shift, **shift segments per local day** (start, end, actions — v5's action
set; a gap over 60 min or midnight starts a new segment), products × agent; the same for the previous window
(segments + décisions + minutes only). The prototype's segments were read with exactly this rule. SECURITY DEFINER with the
`get_team_commissions` guard; `REVOKE … FROM PUBLIC, anon` then `GRANT … TO authenticated`; tested
under a real JWT. Leaks, ranking and positions are computed in a pure `lib/team/performance/` view model.

Salle de contrôle: `activeMin` in `src/lib/team/room/day-view.ts` moves from 10-minute buckets to the
on-shift sum (owner's answer 9). One function, shared by both pages.

## 7. Phases

0. **Prototype** — v3 is the current spec. Owner reviews; revisions become `-v4`, never overwrites.
1. **SQL** — `get_team_performance_v2` + migration; owner pastes it (MCP apply is declined in this repo).
2. **View model (TDD)** — segments, score/trend, leaks + thresholds, scatter positions, presence, product cells.
3. **Components** — px units copied from the prototype (14 px root trap), fr + ar keys first.
4. **v5 « Actif »** — swap to the shared on-shift function, update its tests.
5. **Cleanup** — delete RankingCard, ThroughputRateChart, GoalSegments, TeamStrip, the drawers and
   `useTeamPerformance` once nothing imports them; drop `get_team_performance` after deploy.
6. **Docs** — `docs/crm-and-team.md` Performance section rewritten; CLAUDE.md index line.

## 8. Decisions I made as the expert (veto any of them)

- Five segments, not seven: "en route" and "still in her queue" are one grey (both unsettled), deleted
  orders join "never real".
- **Colours (v3):** outcomes #079455 · #F79009 · #E8385A · #7A5AF8 (+ grey #D5D9E0 en cours); agents
  #444CE7 · #DD2590 · #088AB2 · #CA8504 (pass every pair, so the map can mix them) · #4CA30D · #E04F16.
  All run through the dataviz validator; amber sits at 2.35:1 on white, so a number is always written
  beside it. An agent's colour follows her, never her rank. Production needs a stable colour per user.
- **Design system:** the owner chose gradients, frosted glass and per-person colour for this page, which
  `docs/design-system.md` forbids today ("zero gradients, zero shadows, colour only on status"). The build
  adds a section for analytics surfaces (like §4.21 for finance) instead of breaking the rule silently.
- Product tiles use one green ramp (magnitude) + a red badge (problem), never red↔green on the cells.
- Clicking a Présence day opens Salle de contrôle's day — no second day view on this page.
- The goals settings stay in the database (harmless), but nothing reads them; removing the keys is a
  later cleanup.
- Phone: the same five cards stacked; the ranking row becomes a card; the map keeps its four quadrants.

## 9. Open

- v3 verdict — then Arabic + phone in the prototype (v1 had both; v3 is French, desktop).
- Advice wording (above) — owner to validate or rewrite.
- tasnim's notes hold the real reasons: a later feature could suggest the reason from the note's words.
- Ce mois is nearly empty: Libya intake stopped 2026-09-29 (sheet source).
