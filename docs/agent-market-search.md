# Agent search over the whole market

Since 2026-10-01 the search field in the agent shell finds every order in the agent's market,
not only their own. Plan and measurements: `plans/agent-market-search.md`. Prototype:
`prototypes/agent-search-v1.html`.

## Who sees what

| The order is… | Shown | Opens |
| --- | --- | --- |
| the agent's own | in « Mes commandes » / « Livraison », as before | the usual panel, full rights |
| a colleague's | « Autres commandes du marché · Lecture seule », tag « Chez {prénom} » | read-only preview |
| unassigned | same group, tag « Non attribuée » | read-only preview |
| deleted | same group, ranked last, status « Supprimé » | read-only preview |
| in another market | never | — |

Hiding colleagues' orders is one constant: `SHOW_OTHER_AGENTS_ORDERS` in
`src/lib/agent-search/market.ts`.

## How it is built

- **Two speeds.** The agent's own lists are matched instantly from the shell's SWR caches
  (`lib/agent-search/suggestions.ts`). The market arrives from `GET /api/agent/search?q=` about
  250 ms after typing stops (`hooks/useAgentMarketSearch.ts`). Results are merged by order id.
- **RLS was not widened.** Agents still read only their own orders through RLS. The two agent
  routes use the service-role client and take the market from `getActor`, never from the request.
  They return a fixed column list, at most 8 rows plus a total, from at least 3 characters. A
  widened policy would let any agent dump the market's customers from the browser.
- **The preview is not the order panel.** `GET /api/agent/orders/[id]/preview` plus
  `components/queue/OrderPreviewSheet.tsx`. There is no presence row (an agent's presence blocks
  manager writes), no realtime and nothing editable. Its only action is copying the reference for
  the manager. Writes stay refused server-side for non-owners: the PATCH route returns 404 and the
  `orders_update` RLS requires the owner. This was verified in the running app.
- **One definition of "matches".** The server uses `lib/orders/search-query`, the same parser as
  the manager Orders page and `get_order_facet_counts`:
  - field prefixes (`tel:`, `ville:`, `ref:`, `suivi:`…);
  - phones reduced to national digits, so `+218 91…`, `091…` and `91…` are one number, even when
    typed with spaces;
  - spelling variants folded into one regex group: ا/أ/إ/آ, ه/ة, ي/ى/ئ, و/ؤ, and the accented
    vowels and ç. The groups mirror what `lib/queue/search.normalize` folds locally, so the
    local and server halves agree.
- **Ranking** (`rankMarketRows`), in this order:
  1. exact phone;
  2. exact reference or tracking number;
  3. the agent's own;
  4. open before closed;
  5. newest.

  Deleted is always last.
- **Every row says why it matched.** A hit only in the address, the tracking number or the second
  phone brings that field onto the row.

## Gotchas

- The global SWR config sets `keepPreviousData: true`. The market hook turns it off, or one
  query's rows would show as the answer to the next.
- A term with a foldable letter becomes a PostgREST `imatch."…"` leg, and `get_order_facet_counts`
  reads `op: "imatch"` (migration `20261002000207`, applied to production 2026-10-02). On any
  other database, apply it before deploying code that sends such legs, or the facet counts read
  zero.
- On a 390 px phone the agent header overflows, and the availability switch covers the search
  trigger. This predates the feature and is still open.
