# Suivi livraison (manager) — rebuild in « Aurore calme », on the /leads skeleton

Date: 2026-10-08 · Branch `feat/delivery-board-aurore` (worktree `.claude/worktrees/delivery-aurore`, off origin/main aa60bf8f)
Scope: `/delivery` for **market_manager and super_admin** only (`DeliveryBoardClient` → `DeliveryBoardView`).
The agent worklist (`DeliveryWorklistClient`) is untouched.

Owner's ask: « restyle and redesign the /delivery page on manager to adhere to the new design
principles of our current product. Inspire from the /leads and /feedback pages. »

## Phase 0 — prototype (gate: nothing under `src/` before the owner says yes)

`prototypes/suivi-livraison-manager-v2.html` — studio presets:

| Switch | Values | What it shows |
|---|---|---|
| `data` | `busy` · `calm` · `empty` | a September-sized Libyan day (simulated from real volumes) · everything handled · nothing in flight |
| `view` | `colis` · `livreurs` | the two views of the segmented control |
| `band` | `sauves` · `afaire` | which figure answers the page (decision for the owner) |
| `lang` | `fr` · `ar` | studio LTR, stage mirrored |

Keys: 1/2/3 data · C/V view · A/B band · L language. Click a row for the drawer, tick rows for the
bulk bar → « Réattribuer », filter one agent for « Réattribuer ses N colis ».

## The page (top to bottom)

1. **Header** (as /leads, /feedback): crumb « Livraison › Suivi livraison », H1, sub
   « Libye · 312 colis en route · 6 agents » + live chip « En direct · 14:32 ». End side: segmented
   `Colis | Livreurs` (the /feedback two-page switch) and a glass chip « Cible : 4 h » (read-only,
   tooltip says where it is set).
2. **The band** (/leads `TopBand`, fixed height): start = the page's answer; end = « À faire »,
   a count badge + chips, opening a floating panel of one-line problems, each with its button:
   - parcels past the target with no action, by agent → « Voir » (list filtered to « En retard »)
   - an agent with parcels to treat and no action today → « Réattribuer ses N colis »
   - parcels with no agent → « Attribuer »
   - a courier holding ≥ 4 unreachable customers → « Appeler »
   - parcels with no movement for 21 days+ → « Voir »
   Calm = one green line « Tout est à jour ».
3. **« Où en sont les colis »** — 4 bucket cards (/leads source cards): icon, name, one-line rule,
   count + amount, a pill bar split by **situation** (the §4.22 hues), up to 4 caption lines, a foot
   (late / oldest). Click = toggle the list filter (« Filtre » tag, the others dim).
4. **« L'équipe aujourd'hui »** — one card per agent (/leads agent card, identity hue with presence):
   avatar, name, verdict word with its dot, a thin ring = **parcels treated today out of those
   that needed her today**, at most one warn tag (« 5 en retard · 9 h » / « Aucune action
   aujourd'hui »), foot « Cette semaine · 6 sauvés · 1 perdu ». Ordered late → idle → ok,
   alphabetical inside (grouped, never ranked — decision 40). Click = toggle the agent filter.
5. **The list** — one card: state segmented (« En cours · En retard · Sans mouvement · Terminées »),
   filter buttons that say their value (Bac, Agent, Situation, Transporteur — §4.7b), search at the
   end, eyebrow column heads, plain hairline rows (no glass per row), 25 a page. Columns:
   ☐ · Situation (the §4.22 chip + its sub) · Client (name, #ref · city) · Produit · Agent (avatar 24)
   · Dernière trace (the newer of the agent's last action and the courier's words) · Attente
   (warn when past target) · Montant. One agent filtered → a line above the heads with
   « Réattribuer ses N colis » (the old « absent » button).
6. **Drawer** (§4.9, floating 580): situation chip, client, ref; « À faire » card with the
   recommended move, the number inside the call button, the four one-tap outcomes; Client;
   Transporteur (courier + call, last remark); Historique; footer « Réattribuer » + « Noter une action ».
   Same content as today's `DeliveryDetailPanel`, new chrome.
7. **Livreurs view** — one card per carrier account (accent colour, §4.18): en route / à traiter /
   en retour; then a table card of couriers (held, unreachable, returns, « Appeler »).

Bulk bar (dark, bottom centre), reassign modal (/leads `ReassignDialog`: agents with their load),
toast with « Annuler ».

## Decisions I made as the expert

- **The right-hand cockpit is retired.** Its Équipe tab becomes the agent cards (verdict, today,
  week); « Ce qui bloque » becomes the list filtered on that agent, sorted by priority; Livreurs and
  Transporteurs become the second view. One surface per question instead of a panel with three tabs.
- **The 7-day action strip is dropped** from the agent: « today » (ring) and « this week »
  (saved / lost) answer the manager's question; the strip was a third frame nobody acted on.
- **Rows lose their action buttons** on the manager screen. Managers supervise; acting happens in
  the drawer. The list becomes readable at a glance like /leads.
- **The long-dead stalls move to a state** (« Sans mouvement 68 ») instead of the dashed
  collapsed line, and « Terminées » too — the bucket strip had a 6th « done » cell that a manager
  never needs at the top.
- **No money in the band** (decision 40: money at stake was offered and not chosen). Amounts stay
  on the bucket cards and rows, as today.
- **The reassign confirmation no longer says « the commission follows the new agent ».** The ledger
  still attributes on the last confirmed transition (CLAUDE.md open discrepancy 4); the screen must
  not promise what the data does not do. Flagged, not fixed.

## Questions for the owner (after looking at the prototype)

1. Which figure answers the page: **saved this week** (outcome, like /leads — Recommended) or
   **to treat now** (the work)? → `band=sauves|afaire`.
2. Livreurs as a second view (Recommended) or a section at the bottom of the page?

## Phase 1 — React (after yes)

- New `src/components/delivery/board/` (`BoardView`, `Band`, `Buckets`, `Team`, `ParcelList`,
  `ParcelDrawer`, `CouriersView`, `board.css` scoped `.dlb`, px units — root font 14px).
- Pure arithmetic stays in `src/lib/delivery/board.ts`; add `treatedToday()` (rows with
  `last_action_at` today, market tz) and `todoLines()` with tests first.
- Agent colour: `/api/delivery/board` adds `users.color` (check it is on prod first).
- Reuse `DeliveryTimeline`, `DeliveryMessages`, `ActionSheet`, `WhatsAppSheet`, the action queue.
- Delete `DeliveryCockpit.tsx`, `DeliveryAgentsStrip`, the old view and their dead i18n keys.
- TDD: view tests on every state of the prototype; i18n parity fr/ar; screenshot pair at 1440 px.

## Rounds after v2 (owner, 2026-10-08)

- **v3** — one step calmer colours (« a bit calmer on the eye, just a bit »).
- **v4** — the banner is gone (« taking too much space without useful information »); « À faire »
  is a header button with a dropdown, the week's saved / lost a chip in the sub line; bucket and
  agent cards became slim one-row strips with details in tooltips, so the list starts on the
  first screen. Question 1 (which figure answers the page) is moot.
- **v5** — the parcel panel rebuilt to read top-down: who and how long · the courier's words ·
  À faire (number + WhatsApp, 2×2 outcomes) · details grid · short timeline · split footer;
  full screen under 640 px. Owner: « the prototype is good » → build it.
- Question 2 not answered: Livreurs stays a second view (the recommendation).

## Phase 1 — built (2026-10-08)

- `src/components/delivery/board/` — `BoardView`, `Strips` (À faire, bucket tiles, agent cards),
  `ParcelList`, `ParcelDrawer`, `Overlays` (Livreurs view, reassign dialog), `parts`,
  `board.css` scoped `.dlb`, px.
- `src/lib/delivery/manager.ts` (tests first): list states, the agent ring (treated today on the
  market clock / + live act-now untouched today), `todoLines`, `bucketTiles`, `lastTrace`,
  `sortRows`.
- `/api/delivery/board` returns each agent's `users.color` (column on prod; no migration).
- Deleted: `DeliveryBoardView`, `DeliveryCockpit`, `DeliveryRow`, `DeliveryDetail`,
  `ReassignSheet` (manager-only) and 17 dead `delivery.*` keys; strings live in
  `delivery.manager`.
- Found while building: a market with dozens of agent accounts pushed the list off the first
  screen again (local: 38). Agents with nothing in flight and nothing done today get no card,
  and past one row of six the rest wait behind « +N ».
- Not changed, flagged: the existing chip label `delivery.sit.address` reads « À traiter
  maintenant » in French (the same words as the bucket); the prototype says « Adresse à
  confirmer ». It is shared with the agent screen.
