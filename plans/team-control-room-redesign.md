# Replace /confirmation-flow + /team with one "Équipe" control room

## Context

Both pages have existed ~6 months and the user never opens them. Exploration proved most of what they show is unrenderable or wrong: TTFC is structurally dead (looks for `status_to='assigned'` history rows that stopped being written on 2026-05-05 when assignment became pure ownership), sparklines/target are broken for super_admin (`team/page.tsx` passes `user.market_id` = NULL instead of `getActiveMarketScope`), "TRAITÉES" double-counts confirmed→uploaded rows, "APPELS" counts only "Pas de réponse" clicks, `confirmation_rate_target` exists in 0 DB rows, "Escalader" is a permanently disabled stub, and presence (which works — `users.last_seen_at`, 60s heartbeat) is surfaced nowhere useful.

User interview results:
- At-a-glance needs: **who's working right now · are orders called fast enough · which orders are dying silently**. Explicitly NOT an at-a-glance need: weekly rankings.
- Presence needs: online now + last action · **hours actually worked per day** · attendance history.
- Audience: user + market managers, daily → market-scoped, 30-second scan.
- Agent judgment: **treated per active hour** + **confirmation rate on treated**. (Not speed, not callback discipline, not FCR.)
- User delegated fuse-vs-separate: recommendation is **fuse into one page**.

Standing prefs (memory): HTML prototype with real prod figures BEFORE code/schema changes; decisive execution; gate on typecheck (lint unconfigured, 31 pre-existing test failures).

## The design (APPROVED via prototype — artifact d0bde51c, label approved-design-goals)

Two separate pages under the "Équipe" nav group. Minimal density by default; agent drawer for detail. **No money on either page** — goals ("Objectifs") replace dinars.

### Page 1 — `/team` "Salle de contrôle" (live, realtime bus + SWR)
- Verdict bar: "N agent(s) en ligne · N commandes bloquées · N files orphelines".
- 4 tiles (icon holder left, tinted by severity): Tentatives épuisées (red, count + oldest + per-agent split) · Files orphelines (amber: orders on agents offline > 30 min, incl. confirmed-never-uploaded) · En ligne x/y (neutral) · Rappels dépassés + Sans appel (green, stacked; zero-alerts collapsed).
- Agents table: Agent (avatar+presence dot) · Dernière action (status + relative time, red "N j sans action" if > 3 j) · Aujourd'hui [Traitées · Confirmées] · Objectifs du jour (3-segment: volume ≥ 12 traitées / qualité ≥ 40 % once ≥ 10 traitées / hygiène = 0 rappel dépassé & 0 order > 24 h w/o attempt) · File (count + outlined red pill for aging) · Action (Réassigner ▾ / Retour au pool). Red edge stripe only on idle agent holding orders. Rows open drawer.
- Bottom: "À débloquer" (count pill; Commande [name + product · agent] · Situation pill [violet confirmed-never-uploaded / amber attempts exhausted] · Âge red w/ warn icon · Action [Uploader / Réassigner…]; footer "+N autres · Ouvrir dans Commandes →") and "Rappels à venir" (chip "Les N avec X"; name · product · agent · date time).

### Page 2 — `/team/performance` "Performance équipe" (period-scoped, market-local days)
- Controls: Hier / 7 jours / 30 jours / Personnalisé · product filter select · hint "taux masqué sous 10 traitées".
- Strip (5): Traitées · Taux (weighted) · Heures (activity-derived) · Débit (median traitées/h) · Objectif équipe N / target conf. w/ progress bar.
- Classement (replaces old agent table): ranked on **confirmées / heure active** vs target 3,0 (per-agent override); each row: rank · avatar · name · comps (taux colored, débit, heures, jours) · coaching CTA "→ Objectif taux 40 % | débit X/h" (writes per-agent target) · big score + progress bar · "série N j" (consecutive active days at 3/3). Footer "Hors classement". Product filter re-ranks comps against the product's team rate.
- Carte débit × taux: scatter, dashed team refs, top-right "CIBLE" tint, quadrant labels FIABLE·LENT / CIBLE / FAIBLE / RAPIDE·PERD DES LEADS.
- Par produit: thumbnail · Traitées · range strip min(pire) ○ — équipe ● — max(meilleur) ○ · Écart best↔worst agent in pts (agents < 10 treated marked *).
- Présence heatmap: agents × local days, single-hue ramp (0 / <1h / 1–2h / 2–3h / 3h+), Total column "Xh · N j"; mouna 0 in red.
- Drawer (both pages): Aujourd'hui stats + actions/hour bars · Objectifs 7 j (conf/h, série, meilleure série, jours actifs) · Par produit w/ ±pts vs team · File actuelle by product+age · Rejets motifs · À retenir.

### Goals system ("Objectifs") — data model for Stage 2
- Market defaults in `settings`: goal_daily_treated=12, goal_min_rate=40, goal_weekly_conf_per_hour=3.0, goal_team_weekly_conf=150.
- Per-agent overrides: new table `agent_targets(agent_id, metric, value, set_by, created_at)`; coaching CTA writes here.
- Streak = consecutive *active* days at 3/3 (inactive days skipped, not broken). All derivable from `order_history` + `orders`.

### What dies (unchanged)
Funnel · podium/emoji · FCR · TTFC columns + histogram · sparklines · rejets par région · Escalader/Notifier stubs · dead files · /confirmation-flow route + API + lib.

## Stage 1 — HTML prototype (the immediate deliverable)

1. Pull real prod figures with read-only `mcp__supabase__execute_sql` SELECTs (project `vshynigvgrlihngozuwb`): online agents now, never-called counts + ages, overdue callbacks, attempt_3 ages, queue-on-offline-agents count, per-agent today stats, 7d per-agent treated/rate/active-hours/attendance from `order_history`.
2. Load `dataviz` + `artifact-design` skills, then build a single self-contained HTML prototype as an Artifact: both tabs, real figures, full design-system compliance (light console `#F6F6F7`/white cards, dark sidebar mock for context, brand green `#15803D` chrome only, status hues on status only, tabular-nums, flat cards).
3. Present to user; iterate on the artifact until approved. **No code changes until approval.**

## Stage 2 — implementation (after prototype approval)

0. Copy this plan to `Ordra/plans/team-control-room-redesign.md` (user rule).
1. **Data layer**: two new RPCs following the `get_dashboard_health` precedent (its migration documents a 65× win from moving Node reduction into SQL): `get_team_live(p_market_id)` and `get_team_performance(p_market_id, p_from, p_to)`, SECURITY DEFINER, returning JSON. Migrations via `mcp__supabase__apply_migration`. No table/column changes needed for v1 — everything derives from `orders`, `order_history`, `users.last_seen_at`. (Optional v2, separate approval: heartbeat-fed `presence_daily` for true connected-time vs activity-derived hours; also seed `confirmation_rate_target` setting.)
2. **API**: `/api/team/live` + rework `/api/team` to call the RPCs; market scope via `getActiveMarketScope` (fixes super_admin); keep `/api/orders/[id]/reassign` as-is.
3. **Frontend**: rebuild `TeamWorkspace` as tabbed control room; new components (KpiTiles, AgentRoster, AttendanceGrid, PerformanceTable); SWR hooks + existing realtime bus; strings in `fr.json` + `ar.json` (no hardcoded text); logical CSS props (RTL).
4. **Guards/cleanup**: agent-role redirect on `/team` (copy confirmation-flow's), `/confirmation-flow` → redirect, delete dead code listed above, consolidate presence thresholds into one helper.
5. **TDD**: failing tests first for the pure aggregation logic (active-hours bucketing, distinct-treated counting, weighted rate, attendance derivation, presence rollup) in `src/lib/team/`; API shape tests. Gate: `npm run typecheck` + targeted `vitest` runs (31 pre-existing failures are baseline noise).

## Verification

- Prototype: user eyeballs real figures against known reality (e.g., ~98 attempt_3 orders, ~150 orders on inactive agents' queues, salima/roqaya volumes).
- Code: typecheck + new unit tests green; run dev server, log in as super_admin and tn_manager (test creds in CLAUDE.md), verify both tabs against direct SQL spot-checks; verify agent role gets redirected; verify RTL rendering on LY market.

## Key files

- Pages: `Ordra/src/app/[locale]/(dashboard)/team/page.tsx`, `.../confirmation-flow/page.tsx`
- Workspaces: `Ordra/src/components/team/TeamWorkspace.tsx` (rebuild), `Ordra/src/components/confirmation-flow/*` (delete)
- APIs: `Ordra/src/app/api/team/route.ts` (rework), `Ordra/src/app/api/confirmation-flow/*` (delete)
- Reuse: `TeamPeriodSelector`, `ReassignControls` (fix its absolute-positioning), realtime bus (`src/lib/realtime/bus.ts`), `getActiveMarketScope` (`src/lib/auth/market-scope.ts`), presence helper (`src/lib/assign/presence.ts` as the survivor), design tokens per `Ordra/docs/design-system.md`
