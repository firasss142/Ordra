# Agent shell — « Aurore » (since 2026-10-05)

The agent's five tabs, rebuilt from `prototypes/agent-shell-v2.html` (plan `plans/agent-shell-aurore.md`).
The prototype is the spec: class names, words and reading order are its own.

## Where things are

| Piece | Files |
|---|---|
| Stylesheet | `components/agent/agent.css` — the prototype's whole `<style>`, every rule scoped `.agt …` by a script (its « Téléphone » rules are the `max-width:767px` media query). Never edit by hand: regenerate. `agent-app.css` = app additions (phone overlays become `position:fixed`, `.page > .ph` hidden on a phone). |
| Shell | `components/layout/AgentDashboardShell.tsx` → `.agt > .stage > header.ah` + `.mtop/.mtitle` (phone) + `main.agt-main > .page` + bottom `.mtabs`. Pieces in `components/agent/shell/`: `AgentNav` (five tabs, delivery badge = act_now + returning), `AgentSearch` (market search, four groups, recent searches), `AgentAvail` (« Disponible »), `AgentBell`, `AgentMe`. |
| Shared atoms | `components/agent/shared.tsx`: `useAgentPhone`, `APill`/`ATag` (any prototype hue), `useAgentToast` (5-s « Annuler »). Icons, thumbs, tooltip, time words come from `components/orders/commandes/ui`. |
| Commandes | `components/agent/queue/` — `AgentQueuePage` (tiles, search, sub-tabs, list + order column, phone rows, bulk run, « ? » keys), `QueueRows`, `model.ts` (buckets, activity, tile hints). The endings: `queue/outcome/` (trays inside the order on a desktop, `CallResultSheet` on a phone). |
| CRM (Prospects) | `components/agent/crm/` |
| Livraison | `components/agent/delivery/` + `lib/delivery/agent-view.ts` (the manager board is untouched) |
| Mes commissions | `components/agent-commissions/AgentCommissionsView.tsx` |
| Voix du client | `components/agent/voc/` + the capture `components/feedback/CaptureDialog.tsx` (portal into a `.agt` layer) |
| i18n | `agent`, `agentQueue`, `agentOutcome`, `agentCrm`, `agentDelivery`, `agentCommissions`, `agentVoc` — each with a parity test in `src/messages/__tests__/`. |

## Rules worth knowing

- A page returns the **children of `.page`**; the shell supplies the band, the phone top and the toast provider.
- One search on screen: on Commandes the page's own field (bound to the same `QueueSearchContext` query);
  the band's market search shows on the other four tabs.
- The three meters count since the **market's** midnight (`/api/agent/stats` now uses `marketDayStartUtc`;
  it used the server's, i.e. UTC, before) and say so: « confirmées · aujourd'hui », « traitées · aujourd'hui »,
  « dans votre file ».
- Row tags are **icons** with the words as tooltip (owner, 2026-10-05) — the same `RowTags` as the managers' Commandes.
- **One way to record a call, for every role** (owner, 2026-10-05): the old `PostCallActionSheet` is gone. Agents get
  `AgentEndings` (their footer + keys 1–4); managers keep their footer (`ActionFooter`, with pool / restore / cancel) through
  `ManagerEndings`, whose call-result and send/schedule buttons open the same steps — inside the order on a computer,
  the bottom sheet on a phone. Both sit in a `.agt.agt-inline` layer (display: contents) so agent.css draws the steps.
- Fermées' carrier chip is « Chez le transporteur » (it said « En cours »).
- Agents read « Tentative n/3 »; managers read « Appel n/3 ».
