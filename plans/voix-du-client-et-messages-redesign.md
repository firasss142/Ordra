# Voix du client + Messages — redesign (2026-10-06)

Owner's ask: redesign `/feedback` (manager) and `/messages` (+ Modèles) from scratch in « Aurore
calme »; reshape what the pages are for; fix the bugs met on the way; delete the old design.

## Phase 0 — prototype (gate)

`prototypes/voix-du-client-et-messages-v1.html` — one board, studio switches:

| Switch | Values | Why |
|---|---|---|
| `structure` | `deux` · `hub` | owner: "generate both and let me compare" |
| `premier` | `raisons` · `feuille` | owner: generate both « Pourquoi on perd des ventes » and « la feuille » |
| `page` | `voix` · `messages` | |
| `wa` | `off` · `on` | WhatsApp is not connected on prod; both states are designed |
| `lang` | `fr` · `ar` | studio LTR, only the stage mirrors |

No React until the owner picks.

## What the live data says (prod, 2026-10-06)

- WhatsApp: 0 configs, 0 conversations, 0 messages, 0 templates. `/messages` is empty for everyone.
- Feedback: 196 rows, **184 `needs_review`, 0 ever reviewed**. The overview counts only the 12
  reviewed rows (11 rejection notes that are mostly agent shorthand + the test row « Produit
  magic »), so the page shows noise and hides the signal (52 pas de cash, 31 carte, 27 trop cher…).
- Last 30 days: 97 rows, of which 79 are the one-off « Autre » import (stopped 10-01). Live inflow
  since 10-02 ≈ 16 rows; the F key was used once.
- The 14 courier « non conforme » complaints never opened (status only exists once reviewed), so
  the 48 h rule cannot fire on them.

## Owner decisions (2026-10-06)

1. **Show everything, discard the noise.** No validation gate: every entry counts on arrival; the
   manager « Écarte » (one or many). Entries with no reason carry « à vérifier ».
2. First screen: build **both** « Pourquoi ils n'achètent pas » and « la feuille » (compare).
3. Structure: build **both** two pages and one hub (compare).
4. Messages: **full inbox + honest dormant state** (still visible when not connected — 09-25 rule).

## Decisions I made as the expert

- The page's question is « pourquoi perd-on des ventes, et que corrige-t-on ? », not statistics.
  Reasons are ranked cards with real quotes and the products concerned.
- « Notre réponse » — one line the manager writes per reason (e.g. « rappeler après le 1er du
  mois »), so the page records decisions, not only complaints. Needs `feedback_topics.response`
  (text, per market) — the only schema addition.
- « Sans raison claire » is not a reason; it is the « à vérifier » pile.
- Imported rows are marked as such in the sheet (source column), so the owner can see that capture
  is thin once the import ages out of the window.
- Backlog: courier complaints older than 14 days are closed on migration as « résolue — ancienne »
  (an event row says why); newer ones open. Otherwise the page opens on 13 complaints from June.
- Inbox: oldest-waiting first; « attend depuis » on every row; the 24 h window in plain words;
  « Qui est-ce ? » panel proposes the match (orders on that number) before anything is typed;
  « Garder dans Voix du client » turns a message into feedback (the bridge between the pages).
- Category colours move to the calm validated steps: réclamation `#E46A7B`, objection `#E9A23B`,
  suggestion `#4DAE7E`, in the agent capture too.

## Bugs to fix on the way

- `needs_review` gate hides 94 % of the data (decision 1 retires it; RPC + overview + rows).
- Courier complaints with `status NULL` (CHECK ties status to `NOT needs_review`).
- Test row « Produit magic » on prod — discard through the new UI, do not delete by SQL.

## After approval

React in this worktree (`feat/voice-messages-redesign`), TDD, then delete `FeedbackWorkspace`,
`OverviewBlocks`, `FeedbackTable`, `DateRangeControl`, `MessagesHeader`, the old inbox components
that the new ones replace, their tests and dead i18n keys. Migration as paste-ready SQL.

## Owner picks (2026-10-06, round 2)

- **Structure: deux pages** (Voix du client · Messages).
- **Premier écran: la feuille.** Raisons is the second tab.
- Raisons found "dense, overwhelming" → `prototypes/voix-du-client-et-messages-v2.html`
  (`?raisons=v2`): one sentence + a to-do line; one ranked list per section (rank · reason ·
  bar · count · trend); a reason opens on click to show 3 quotes, its products and « Notre
  réponse ». Removed from the tab: complaints and product cards (they live in the sheet), the
  Arabic subtitle, shares in %, the zero row (now one footer line).

## Built (2026-10-06) — owner: « follow the prototype exactly and implement »

Taken as the yes on v2; the two open questions went with the recommendation (owner defers):
« Notre réponse » column added, courier complaints older than 14 days closed at migration.

- Migration `supabase/migrations/20261006120000_voix_du_client_v2.sql` (paste on prod before
  merging): `feedback_topics.response`; needs_review retired (rows flipped, réclamations opened or
  closed if > 14 days, an event says why); new CHECK « a réclamation always has a status »;
  courier trigger writes rows live; RPCs `discard_/restore_customer_feedback`,
  `set_customer_feedback_topic`, `set_feedback_topic_response`; source `whatsapp`;
  keep/ignore and the import function dropped. SQL tests: `customer_feedback_test.sql` (139 ok).
- API: `/api/feedback/overview` (computeVoice + quotes), `/rows` (whole period, `id=`),
  `/bulk` (discard · restore · topic), `PATCH /topics/[id]`; `/review` and `/days` deleted.
- UI: `components/feedback/voice/*` (`.vdc`); Messages `components/whatsapp/inbox/*` (`.wam`).
- Deleted: `components/feedback/manager/*`, `lib/feedback/overview.ts`, the sparkline helpers,
  `MessagesHeader`, `ConversationsList`, `ConversationDrawer`, `ClaimSearch`, i18n
  `feedback.manager`, old `whatsappAdmin` keys.
- Later: drop `customer_feedback.needs_review`; claim-search to return the assigned agent (the
  « Qui est-ce ? » card has no agent name yet).
