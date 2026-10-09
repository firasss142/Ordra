# Journaux v3 — « Aurore calme », the /orders skeleton dressed like /feedback

2026-10-08 · worktree `.claude/worktrees/journaux-calm` · branch `feat/journaux-calm` (off origin/main e4161265)

Owner's ask: restyle and redesign /system/logs to the current design principles, inspired by
/orders and /feedback.

## Phase 0 — prototype (GATE: owner's yes before any src/ change)

`prototypes/journaux-v3.html`. Studio presets: `view=overview|history`, `tile=…`,
`drawer=none|issue|row|trace`, `calm=0|1`. No language switch: Journaux is super_admin only,
and super_admin is always French.

## What was found

- **Prod still shows v2** (`JournalScreen.tsx`, a 940 px column of stacked cards). The Commandes
  restyle of PR #97 never reached main: it merged into its stacked base after that base merged.
- **Prod on 10-08:** 3 open problems, all warnings:
  - a deactivated carrier with 67 parcels still out;
  - poll-carriers hangs at 04:30 (3 times in 7 days);
  - 1 sheet row refused.

  There is also 1 muted problem.
- **Over 7 days:**
  - 113 team changes, 35 of them sign-ins;
  - 38 errors, 21 of them `GET /api/cities` 500. That route had been "fixed" in PR #94. Verify it is deployed before closing it;
  - 10 carrier calls, 2 of which failed;
  - 2 061 job passes.

## Design

The page takes Commandes' layout and the look of /feedback. The content and the sentences stay those of v2.

**Header**
- Crumb « Système › Journaux ».
- One H1.
- A live sub line: « En direct · mis à jour… · N choses à surveiller · 24 systèmes suivis ».
- On the right:
  - the Aperçu | Historique segmented control, where Aperçu carries the open count;
  - « Retrouver une commande » with the `/` key.

**Aperçu**
- Four tiles that filter the table:
  - À régler maintenant
  - À surveiller
  - Systèmes en ordre (21/24)
  - En sourdine
- Then the search line, and a filter line (Catégorie, Marché, count on the right).
- One table. Its columns are Problème · Système · Depuis · Impact · État. When the Systèmes tile is on, the columns become Système · Catégorie · Dernière activité · 48 h bars · État.
- When nothing is open, the table shows a single « Tout fonctionne » row.

**Historique**
- Four family tiles with 7-day counts:
  - Équipe
  - Systèmes externes
  - Tâches automatiques
  - Sécurité et erreurs
- Then the search line, and a filter line (Période, Personne, Marché, the « Problèmes seulement » switch, count).
- One table, grouped by day using /feedback's group rows. Its columns are Heure · Qui · Ce qui s'est passé · Catégorie · Résultat.
- Series show a ×N chip.
- Routine passes get one counted line per day.

**Panels**
- /feedback's floating glass drawer, used for the issue, event and order-trace panels.
- Each has an eyebrow line, a title, figures, « Ce qui se passe » / « Que faire », folded tech detail, and actions in the foot.

**Six areas, each with a Commandes hue:**

| Area | Hue |
|---|---|
| Livraison | blue |
| Commandes entrantes | green |
| Publicité | pink |
| Messages | teal |
| Tâches automatiques | violet |
| Application | neutral |

## Phase 1 — build (after the yes)

- `components/journal/journal.css` scoped under `.jx`, in px, cloned from commandes.css and voice.css tokens.
- Rebuild `JournalScreen` on the skeleton. `Panels.tsx` moves to the drawer shell. `describe.ts`, the routes and the RPCs are unchanged; no SQL.
- New pieces:
  - `lib/journal/areas.ts`: the tile family → area map, pure and tested;
  - tile counts derived from the overview;
  - Historique tile counts. These need the 7-day per-family totals. Check whether `journal_feed`/`journal_routine` already give them; otherwise one small read route, with no migration if it can be done in SQL already exposed.
- TDD: tests for the tile filters, the empty state, day grouping, and Escape/`/`.
- Proof: screenshot each prototype state next to the app at 1440 px.
