# Agent shell — the five tabs in « Aurore » (2026-10-04)

Status: **BUILT 2026-10-05** in React (branch `feat/agent-shell-aurore`, owner: « follow exactly the prototype and
the plan »). All five tabs + the shell at once. Where each piece lives: docs/agent-shell.md.

## The brief and the answers
"Following the design style of commandes-v4.html, redesign the agent orders page and the other pages." Answers (all Recommended):
- **Scope:** all 5 agent tabs + header — Commandes, CRM (Prospects), Livraison, Mes commissions, Voix du client.
  Commandes deepest (list, panel, call result).
- **Top of the queue:** one tile per live bucket — Nouveau · En cours · Confirmé · Fermées. « En cours » turns red when a callback is due.
- **Phone:** every tab at desktop and 390 px.
- **Other pages:** same content, calmer. Every field and action stays; look and reading order change; bugs fixed and listed.

Content source: an inventory of the live pages (worktree at ddc61bd). The panel is commandes-v4's (« one panel for everyone »)
with the agent's four endings.

## Decisions I made as the expert (veto any)
1. Outcome steps (rejection reason, callback time, carrier) open **inside the order** on desktop, as a bottom sheet on phone —
   not a centred dialog on top of the panel.
2. **Callback time is written on the row** (« Rappel 18:30 » / « Rappel dû · 16:33 »). Today the row never says it.
3. Phone: the green button **dials, then** opens « Résultat de l'appel » (today it only opens the sheet). A confirmed
   order shows a **truck** (send), not the phone + outcome sheet (live bug).
4. One search on screen: on Commandes the page field only (same query, market results listed under the queue);
   the header search shows on the other tabs with its four groups.
5. Callback quick picks: +2 h · Ce soir 19:00 · Demain 11:00 / 14:00 / 18:00 (the retry times) + any date.
6. Rejection = two levels as today, the group cards carry their hint; « Le client veut plus tard » jumps to the callback.
7. Tags in words (« Doublon ×2 », « Déjà rejeté 1 fois », « Client fidèle · 2 livrées ») instead of bare icon+count.
8. SLA chip after confirmation: green only if confirmed within the delay, grey otherwise.
9. Voix du client on phone becomes cards (the 900 px table scrolled sideways).
10. Livraison phone detail now shows the tracking number, the one-tap result tiles and Messages (missing today).
11. The queue does not auto-open an order (as today); Prospects and Livraison auto-select the first item (as today).

## Live bugs the design fixes (from the inventory)
- Meters mislabelled: « sur 7 j » / « sur 24 h » are counted since midnight, « Assignées » is the queue size → labels now
  « confirmées · aujourd'hui », « traitées · aujourd'hui », « dans votre file »; hard-coded ▼ removed.
- Keys 1–4 did nothing in the open sheet; ↑↓ focus was invisible → working keys, visible focus ring.
- Darb block in the panel showed 28 raw i18n keys → labelled (Livreur, Tentatives, Remarque du livreur).
- « Nouveau prospect » went nowhere → a small drawer. Prospect card eyebrow « Résultat de l'appel » → « Prochaine action ».
- « Rafraîchir Dexpress » also refreshed Darb → « Actualiser le suivi ». « En cours » chip inside Fermées → « Chez le transporteur ».
- Age units « mn / d » → « min / j ». Takeover screen and presence tooltips had no Arabic → both languages.
Not fixed by design (code-level): prefetch keys (`days=60` vs 90, old leads endpoint), parcel search deep-link, silent prospect failures.

## Open points — settled at build time (veto any)
- Attempts: agents read « Tentative n/3 » (the prototype's own override), managers keep « Appel n/3 ». The panel
  is one component; the word follows the role.
- Meters stay « since midnight » with honest labels — and midnight is now the MARKET's (the route cut the day at the
  server's UTC midnight, i.e. 02:00 in Tripoli).
- Row tags in words (decision 7) even though the managers' Commandes went icon-only in PR #78 — the owner's call
  for managers came after this prototype; ask whether agents should follow it.

## Build order after approval
Commandes (tiles + row + panel endings, agents' panel switch +1 week after managers per commandes plan) → Livraison → CRM →
Voix du client → Commissions → header. Unused-i18n-key audit at the end ([[prototype-is-the-spec]]).
