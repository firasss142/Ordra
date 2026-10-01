# Recherche agent sur tout le marché — plan

Drafted 2026-10-01. Status: **implemented on branch `feat/agent-market-search`
(2026-10-01), uncommitted; migration NOT yet applied to production.** D1 taken as
recommended (other agents' orders: view-only with the owner's first name). See §7 for
what changed against this plan, and docs/agent-market-search.md for the reference.

Prototype: `prototypes/agent-search-v1.html`.

## 1. The request

The search bar in the agent shell must find **every order in the agent's market**, not just the
agent's own. Orders the agent owns keep today's permissions. An order the agent does not own
opens **view-only**. Search should predict as you type, stay simple, and be accurate and fast.

## 2. What is true today (measured on prod, 2026-10-01)

**Why agents cannot find the order.** There are two walls, and a UI change alone clears neither:

1. The search bar (`components/queue/QueueSearchBar.tsx` → `lib/agent-search/suggestions.ts`)
   searches only three client caches the shell has already loaded: `/api/agent/queue`,
   `/api/delivery/worklist` and `/api/agent/leads/queue`. An order that is not in the agent's
   own lists cannot appear.
2. RLS blocks the read anyway. `orders_select` lets an agent see a row only when
   `assigned_to = auth.uid()`, and `order_items_agent` and `order_history_select` apply the same
   rule. `GET /api/orders/[id]` also returns 404 to an agent on any order they do not own.

**Where the missing orders actually are.** This matters more than the request's wording:

| | Libya (live) | Tunisia |
| --- | --- | --- |
| Orders | 5 039 | 4 203 |
| Unassigned | 349, **all `deleted`** | 3 275 (Feb–Jul 2026, mostly archived) |
| Unassigned and not terminal | **0** | 384 (276 real + 108 « Produit Test »; 117 `pending`, the rest carrier states) |
| Orders in the last 30 days | 1 607 | **0** |
| Repeat customers (last 60 days) whose orders sit with **different agents** | **79 of 128** | — |

In Libya an unassigned live order does not exist. The order an agent cannot find is either
**another agent's** (62% of repeat customers are split across agents) or **deleted** (usually as
a duplicate). "Unassigned only" would fix Tunisia's backlog and almost nothing in the market that
is actually trading. See decision D1.

**Arabic spelling variants silently lose results.** In Libyan names, 278 carry a hamza alef
(أ إ آ), 349 carry ة and 231 carry ى. 22 customers appear under both spellings. Searching
احمد finds 237 orders, while the variant-tolerant search finds **298**. For فاطمة it is 18
against **34**. The same miss exists on the manager Orders page, which uses the same
`lib/orders/search-query`. The agent's *local* matcher (`lib/queue/search.normalize`) already
folds the hamza alef by accident, because NFKD splits أ into ا plus a combining hamza, which it
then strips. It does not fold ة or ى. So today the local and server searches disagree with each
other as well.

**Speed is not a problem.** Every searched column already has a `gin_trgm_ops` index. Measured
over one market: a name search takes 7.4 ms, a phone 0.6 ms, and the variant-tolerant Arabic
regex 2.7 ms (it uses the same trigram indexes). **No new index is needed.**

## 3. Decisions

- **D1 — Scope of "all orders" (owner to confirm).** An agent's search covers the whole market:
  - own orders → **full access**, opening today's panel (unchanged);
  - unassigned orders → **view-only**;
  - orders owned by another agent → **view-only, with the owner's first name** (recommended;
    see §2: in Libya this is the case the team actually hits);
  - deleted orders → view-only, ranked last and labelled « Supprimée ». This answers the
    customer who says "I ordered and nobody called".
  Alternative: hide other agents' orders, as the request's wording suggests. The prototype
  toggles between the two.
- **D2 — Do not widen RLS.** A policy letting agents `SELECT` the market's orders would let any
  agent dump the whole customer base (every column, including `raw_payload`) with one REST call
  from the browser console. Instead, add a narrow server endpoint that takes the market from the
  session, requires a query of at least 3 characters, returns at most 8 rows from a fixed
  column list, and has no pagination.
- **D3 — View-only is a separate lightweight preview, not `OrderDetailPanel` in a read-only
  mode.** The panel registers agent **presence**, and an agent's presence row blocks manager
  writes, so a curious agent would freeze the manager. The panel also subscribes to realtime,
  where the reassign-away handler would close it at once, and it has about ten write paths to
  gate. The preview has none of that. Writes are already refused server-side for non-owners
  (the PATCH route returns 404, and `orders_update` RLS requires `assigned_to = auth.uid()`),
  so view-only never depends on the UI hiding a button.
- **D4 — One definition of "matches".** The endpoint reuses `lib/orders/search-query`
  (`parseSearch` / `applySearch`), which is the same parser as the manager Orders page: the same
  prefixes (`tel:`, `ville:`, `produit:`, `ref:`, `suivi:`) and the same phone reduction that
  finds `+218 91…`, `091…` and `91…` alike. The Arabic variant folding is added **there**, so the
  manager search gains it too, and so is `get_order_facet_counts`, which consumes the same
  legs. If they disagreed, a facet count would not match its rows.
- **D5 — "Prediction" means type-ahead that is exact, not fuzzy.**
  - Results appear as the agent types. The agent's own orders appear instantly from the caches;
    the whole market arrives from the server after a 250 ms pause. The two lists are merged by
    order id, and the server's row wins.
  - The field says what it understood: « Téléphone », « Référence / suivi » or « Nom, ville,
    produit ».
  - Ranking: an exact phone match first, then an exact reference or tracking number, then the
    agent's own orders, then open orders before closed, then the most recent.
  - The matched fragment is highlighted, and « 8 sur 23 » is shown with a hint to narrow the
    search.
  - **Every row shows why it matched.** When the hit is in a field the row does not normally
    carry (address, tracking number), that field is appended to the row. Without that, a row
    that matched on « قصر أحمد » in the address looks like a false positive.
  - **No typo tolerance.** Trigram similarity would suggest a *different* customer, and
    confirming the wrong person's order is worse than finding nothing. The one "fuzziness"
    allowed is spelling variants that mean the same letter (alef, ta marbuta, alef maqsura), and
    the tashkeel the client already strips.

## 4. The agent's workflow

1. A customer calls, or a problem surfaces. The agent presses **/** and types the phone in any
   format, a name, a reference or a tracking number.
2. The dropdown shows **Mes commandes** first. Clicking one opens today's panel with full rights,
   exactly as now. Below it is **Autres commandes du marché · lecture seule**, where each row
   carries « Non attribuée », « Chez Amira » or « Supprimée ».
3. Clicking a view-only row opens the **Aperçu** sheet. It shows the status and owner, customer,
   phones, city and address, lines with quantity and price, the total, carrier and tracking,
   and the status timeline with dates and notes. It has no edit fields and no outcome buttons.
   A single line explains why: « Lecture seule — cette commande n'est pas dans votre file. Pour
   la traiter, demandez à votre manager de vous l'attribuer. » The only action is **Copier la
   référence**, so the agent can paste it to the manager.
4. The manager reassigns it from `/assign` (existing), and it drops into the agent's queue in
   real time with full rights.

Not built in v1: a « Demander l'attribution » button that notifies the manager. It is the
natural next step if step 4 turns out to be the friction.

## 5. Build phases (TDD, in a worktree)

**Phase 0 — prototype** `prototypes/agent-search-v1.html` → owner review. ← *we are here*

**Phase 1 — Arabic variant folding in the shared search** (`lib/orders/search-query.ts`)

- A term containing Arabic letters becomes a case-insensitive regex (`imatch`, i.e. `~*`) in
  which ا/أ/إ/آ, ه/ة and ي/ى each match their group. Latin and digit terms keep `ilike`, so
  their behaviour is unchanged.
- `SearchLeg` gains `op: "ilike" | "imatch"`. `get_order_facet_counts` honours it through a
  `CREATE OR REPLACE` with the same signature, which keeps its grants (see the
  drop-function-resets-grants note).
- Tests: احمد matches أحمد, إحمد and آحمد. فاطمه ↔ فاطمة and يحيى ↔ يحيي. Regex metacharacters
  typed by a user are escaped. The PostgREST `or=(…)` string stays well-formed, which means
  quoting the value. Latin output is byte-identical to today's.

**Phase 2 — `GET /api/agent/search?q=`**

- Role `agent` only (managers have the Orders page). The market comes from `getActor`, never
  from the request. A service-role client applies `applySearch`, `market_id = actor.market_id`
  and a fixed projection, fetches 30 rows plus an exact count, ranks them in TypeScript, and
  returns the top 8 and the `total`.
- Each row: `id, customer_name, customer_phone, customer_city, product_name, total_price,
  currency, status, created_at, archived, owner: "me" | "none" | "other", owner_first_name,
  access: "full" | "view"`.
- `lib/agent-search/rank.ts` is pure and unit-tested with the D5 order.
- Route tests: another market's order is never returned even when it matches. A query shorter
  than 3 characters returns 400. A non-agent gets 403. `raw_payload` never appears. Deleted rows
  sort last. With D1 "hide others", `owner: "other"` rows are absent.

**Phase 3 — `GET /api/agent/orders/[id]/preview`**

- Agent, same market, read-only projection: the order fields above, plus `order_items` (name,
  variant, quantity, price), history (`status_to`, `created_at`, actor first name, note), carrier
  name and tracking number, and owner first name.
- On the agent's **own** order it returns `access: "full"`, and the UI goes to the panel instead.
- Tests: another market returns 404. The route never writes presence. The response contains no
  cost or margin fields.

**Phase 4 — UI**

- `QueueSearchBar`: SWR key `/api/agent/search?q=…` with a 250 ms debounce, `keepPreviousData`
  and a 3-character minimum. It merges with the local groups by id. The new group is « Autres
  commandes · lecture seule ». It also shows the intent chip, highlighting, and « 8 sur 23 ».
  It serves the desktop dropdown and the phone full-screen sheet.
- New `OrderPreviewSheet`: a right slide-over on desktop and a full sheet on phone. Its layout
  is taken from the prototype.
- i18n: fr and ar keys under `queue.search` and `queue.preview`, checked by i18n-reviewer.

**Phase 5 — verify in the running app as an agent** (local TN agent1 plus the LY E2E fixture).
Checks: a phone typed in three formats, احمد vs أحمد, another agent's order opening view-only, a
write attempt from the console refused, and one order from the other market never appearing.

## 6. Risks and things left open

- A determined agent can still enumerate customers eight rows at a time. That is a real limit,
  but far smaller than a widened RLS. If it matters, add a per-agent rate limit and log preview
  opens. Neither is in v1.
- Tunisia's 384 non-terminal unassigned orders are a data question (four months old, never
  distributed). The search will surface them; archiving them is a separate decision.

## 7. Implementation notes (2026-10-01)

Built as planned, test-first, with these differences, each found during the build:

- **Accents fold too, not only Arabic letters.** The live-app check showed `hela` missing
  « Hèla » on the server while the agent's local search found her. The same pattern mechanism
  now covers a vowel or c with its accents (`h[eéèêë]l[aàâäá]`, 4.9 ms over Tunisia, index-backed).
  This changes Latin search on the manager Orders page too, for the better.
- **A phone typed with spaces was three words.** `091 345 67` used to search "091" AND "345" AND
  "67", and the last one was matched against text only, so nothing was found. Manager Orders had
  the same bug. A wholly numeric query is now one number (`parseSearch` → `wholeNumber`).
- **Bidi.** `+218…` between Arabic words rendered as `…218+`. Each subtitle piece is now in a
  `<bdi>`. The search inputs (and the queue's own filter) got `dir="auto"` so `091 345 67` stops
  displaying as `67 345 091`.
- **No stale rows.** The global SWR config keeps the previous key's data. The market hook turns that
  off, so "salima"'s rows are never shown as the answer to "salima sfax".
- **Pre-existing, NOT fixed:** at 390 px the agent header overflows (the page is 405 px wide), and
  the availability switch covers the search trigger (switch x 112–260, trigger x 244–274). On a
  phone the header search is practically unreachable. The header was not touched; this needs its
  own fix.
- **Migration order matters.** The list sends `imatch` legs as soon as the code ships. Until
  `20261001100000_search_legs_arabic_variants.sql` is applied, `get_order_facet_counts` would read
  them as ILIKE and count zero. It is backward compatible, so apply it **before** deploying.
