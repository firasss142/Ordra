# Agent shell redesign — Commandes, navigation + recherche, Commissions

Prototype: `prototypes/agent-shell-v1.html`
(`?lang=fr|ar &view=desktop|mobile &screen=orders|search|commissions|delivery &tab=… &open=… &state=normal|loading|empty &check=contrast|touch|ruler`).
Built 2026-09-18. This file is the source of truth; the copy under `~/.claude/plans/` is scratch.

## Révision 2 (2026-09-18, same day, owner's review of v1)

The owner's verdict on the first cut, and what changed — all in the prototype, nothing in `src/`:

| verdict | change |
|---|---|
| the row shows too much | two lines only: name + ref + tags, then product ×qty · city. Phone, address, sub-sentence and clock line are gone from the row |
| situation-first feels wrong on orders | **product first**, then status, then the two clocks (order age, last action **with what it was**), then amount |
| tags should be gentle, colourful, meaningful | flat tint + ink + dot (`.tagg`), no gradient, no ring, the same 14 tones; customer tags carry the deciding number (« حساس · 1 مرفوض », « مكرر ×2 », « عميل سابق ×3 ») |
| no end-call button on desktop | removed; the row opens the panel, where the outcome lives. The phone keeps one soft bar |
| the panel stays the old one | the sticky aside is gone; a slide-over **placeholder** says the existing `OrderDetailPanel` opens here unchanged. Not designed |
| tabs and sub-tabs should feel modern and gentle | one soft track (`--sunk`, radius 14) with a white pill for the active item, counts as small pills, 180 ms ease; on the phone the same track |
| "meaningful data, not just visuals" (devil's advocate) | commissions summary gains **last month** with the delta and the **correction share** of the period; accrual rows show the cities the parcels went to |

The delivery yardstick screen keeps the shipped gradient chip and grid; §1–§3 below describe v1
and are kept for the record. Where they conflict with this table, the table wins.

**Phase A only.** Nothing under `src/` has been touched. The owner reviews the prototype
before any React is written, which is the route the delivery row took
(`plans/delivery-worklist-row-redesign.md`).

## Context

The confirmation agent works in four tabs: **الطلبات** (queue), **إدارة العملاء** (leads),
**التوصيل** (delivery), **عمولاتي** (commissions). `/delivery` shipped 2026-09-13/17 from its own
prototype and now reads in a different language from the rest: situation first, one hue per
situation on a gradient chip, a coloured inline-start edge, a bucket strip with counts and sums,
a sticky detail panel on desktop, cards with a tinted action bar on the phone. The queue and the
commissions page still wear the older `agent-*` look (recessed chip strip, MeterCells, a lone
640 px card), and the chrome itself changes shape between tabs.

The brief: bring the three remaining surfaces into the delivery page's language, mobile-first,
without changing behaviour, without inventing visual elements the delivery page does not have,
without renaming anything, with predictive search across every tab and order type, contrast
≥ 4.5:1 and touch targets ≥ 44 px.

**The reference is the live `/delivery` page**, not the parked v4 prototype: the shipped design
(gradient chips, green selected row, situation first) is what the owner's screenshots show. Its
vocabulary lives in `src/components/delivery/ui.tsx` (`TONE`, `Chip`, `EDGE`, `OUTLINE_BTN`,
`PRIMARY_BTN`, `Money`, `ProductThumb`) and in `DeliveryWorklistView.tsx` / `DeliveryRow.tsx`.

## 0. Everything the prototype uses is already on /delivery

| element | where it comes from | reused for |
|---|---|---|
| gradient situation chip, one hue each | `Chip` + `TONE[..].chip`, design-system §4.22 | queue situation, commission entry type, search suggestion |
| 4 px inline-start edge | `EDGE` + `TONE[..].edge` | queue rows, commission rows |
| title row: glyph + h1 + sub + scorecard pill + filter/sort at the end | `DeliveryWorklistView` L160-209 | all three screens |
| bucket strip: dot · label · count · money line | L213-245 | queue buckets, commission entry types |
| column-head row (`lg` only) | L247-249 | queue, commissions |
| one `article` = desktop row and phone card | `DeliveryRow` | queue row, commission row |
| outlined primary + square WhatsApp at fixed slots | `OUTLINE_BTN`, `TONE[..].border` | queue action cell |
| phone action bar, full width, soft tint | `DeliveryRow` L113-120 | queue card |
| sticky aside 400/440 px + "pick one" placeholder | L301-309 | queue detail, commission summary |
| mobile full-screen detail with back bar | `DeliveryDetailScreen` | queue detail, search sheet |
| filter popover, sort button | L181-207 | queue sub-filters, commission period |
| selected row = 1.5 px brand border on `#F0FDF4` | `DeliveryRow` L75 | queue, commissions |
| empty state, skeletons | L258-271 | all three |
| recent-searches listbox | `QueueSearchBar` L167-216 | the predictive dropdown grows out of it |

No new glyph family, no colour outside the 14 `TONE` hues, no shadow at rest beyond the two the
delivery page already has (filter popover, mobile toast).

## 1. Écran Commandes

### Layout
Desktop `max-w-[1560px]`, grid `minmax(0,1fr) 440px`. Left: title row → bucket strip → column
heads → list. Right: sticky aside. Phone: title row → pill strip → cards → full-screen detail,
bottom tab bar unchanged.

Title row: ShoppingBag glyph, **قائمة الطلبات المباشرة**, sub `{name} — يتم تحديثها لحظياً`
(existing `queue.agentShell.*`). The three MeterCells collapse into **one scorecard pill** in the
delivery style carrying the same three numbers (`queue.stats.*`). At the end: **طلب جديد**
(the one filled button), then the filter popover and the sort button; the Dexpress refresh button
appears only in **المغلقة**.

Bucket strip: **الكل · جديد · قيد التنفيذ · مؤكد · المغلقة** (`queue.buckets.*`) with count and
Σ amount. **Level-2 sub-filters move into the filter popover** (tentative 1/2/3, rappel,
livraison; closed: uploaded/deposit/…), so the recessed chip strip disappears and the list starts
a row higher.

### The row
Columns `situation · client · action · amount`, the delivery grid, the delivery phone card.

**Situation model** — `situationOfOrder(order, now, maxAttempts)`, one hue each, aligned with
`SIT_TONE` wherever the meaning matches (amber = ne répond pas, orange = rappel dépassé,
blue = rappel prévu, green = livrée, grey = rien à faire):

| key | when | tone | AR / FR |
|---|---|---|---|
| `new` | pending < 24 h | grey | جديد · 2 س / Nouvelle · 2 h |
| `new_late` | pending ≥ 24 h | yellow | بدون اتصال · 1 يوم / Sans appel · 1 j |
| `no_answer` | attempt_N | amber | لا يجيب · 2/3 / Ne répond pas · 2/3 |
| `callback_due` | callback_scheduled, passed | orange | فات موعد المتابعة · +3 س / Rappel dépassé |
| `callback_ahead` | callback_scheduled, ahead | blue | موعد متابعة · بعد 2 س / Rappel prévu |
| `confirmed` | confirmed, awaiting upload | teal | مؤكد / Confirmée |
| `dispatch` | dispatch_scheduled | indigo | إرسال مبرمج / Envoi programmé |
| `uploaded` | uploaded | slate | تم الرفع / Téléchargé |
| `delivered` | delivered | green | تم التسليم / Livré |
| `returned` | returned | red | راجع / Retourné |
| `rejected` | rejected | rose | مرفوض · <reason> / Rejeté · <motif> |
| `cancelled` | cancelled | stone | ملغاة / Annulé |

`new_late` takes **yellow, not orange** — the plan's first draft gave orange to both it and
`callback_due`, which would have broken the one-hue-per-situation rule the whole page rests on.
**Violet stays reserved** (delivery = colis à risque) and appears here as a *tag*, not a chip.

The chip replaces `QueueStatusPill` **and** the two age columns (العمر, آخر إجراء): the age goes
inside the chip label with one definition per situation, and the last action becomes the clock
line under it, exactly as `DeliveryRow` L82-84. `RepeatBuyerBadge` / `DuplicateOrderBadge` /
`ManagerPresenceMark` / the hover-notes keep their behaviour; only their rest look becomes the
small ringed tag the delivery client cell uses.

Client cell: thumbnail 44 px + name + `#ref` + phones + city · product ×qty, with the search
`<mark>` preserved. Action cell: outlined **انتهت المكالمة** (label unchanged; **إرسال إلى الناقل**
on a confirmed row, **متابعة مع الناقل** on an uploaded one) at a fixed slot, then a 44 px
WhatsApp square. Amount at the end, `Money`, 19 px.

### Detail panel
The existing `OrderDetailPanel` content inside the sticky aside; on the phone the
`DeliveryDetailScreen` pattern with a fixed action row. **No auto-selection**: `useOrderPresence`
acquires the lock the moment `orderId` is set and an agent's row hard-blocks manager writes, so
auto-opening the top row would have every idle agent locking their own queue. The aside shows the
placeholder until a row is clicked — the prototype ships that state.

## 2. Écran Navigation + recherche

### Stable chrome
Header 60 px, sticky on every breakpoint (today `max-sm` only). Fixed slot order, RTL-mirrored:
`[Ordra + marché] [onglets] [recherche] [présence] [cloche] [avatar]`. **The search slot is
rendered on every tab** (the `onQueueTab` gate goes), so nothing reflows. Phone: the search pill
opens a full-screen sheet. `/` focuses the search from any tab (the handler leaves `QueuePage`).
Queue tab gains a `buckets.nouveau` badge (already fetched); delivery keeps its own.

Two measured fixes the prototype forced:
- **The active tab no longer changes font-weight.** Bolding the active label changed its text
  metrics and shifted the whole trailing cluster by 13 px in Arabic on every tab switch. Colour,
  tint and the 2 px underline already carry the state.
- **The search slot gets `flex:1 1 340px; min-width:300px`.** With `min-width:0` the longer French
  labels squeezed the field to **24 px** at 1600 px wide. The tabs give way first now.

Verified: with those two changes the slot geometry is pixel-identical across Commandes,
Commissions and Livraison in both languages (`?check=ruler`, and the geometry probe).

### Predictive dropdown
The recent-searches listbox, grown into a grouped `role="listbox"`: **الطلبات** (all four buckets,
each row carrying its situation chip) → **التوصيل** (worklist rows with their delivery chip) →
**إدارة العملاء** → **أقدم** (orders older than the 7-day window, from the server). Max 5 per
group, matched text `<mark>`ed, ↑↓ to move, Enter to open, Esc to clear then close. Field prefixes
(`name:`, `phone:`, `city:`, `product:`, `note:`) keep working.

Data path (verified in code, not assumed):
- Client caches are already warm on every tab because `AgentNavTabs` preloads them:
  `/api/agent/queue` (search `allOrders`), `/api/agent/queue?include=closed`,
  `/api/delivery/worklist` (id is `order_id`), `/api/agent/leads/queue`. Read them with
  `useSWR(key, fetcher, {revalidateOnMount:false})`, not `cache.get`, which is not reactive.
- Older orders need `GET /api/agent/search?q=`: session client, `getActor` + 403 for non-agents,
  agent RLS is `assigned_to = auth.uid()`, and **reuse `applySearch()` from
  `src/lib/orders/search-query.ts`** — it already builds the per-term `.or(ilike)` across the eight
  searchable columns, and pg_trgm GIN indexes exist on all eight
  (`20260901000001_orders_search_trgm.sql`).
- Navigation: the queue already reads `?bucket=` + `?openOrderId=`; `/delivery` needs a new
  `?open=<order_id>`; leads push `/leads/[id]`.
- Reuse `parseQuery/normalize/digitsOnly/matchesOrder`, `highlightSegments`, `normalizePhone`, and
  the private `matches()` in `DeliveryWorklistView` L51-62 (extract to `lib/delivery/search.ts`).
  Normalise the phone needle once per source — three digit normalisers exist.

## 3. Écran Commissions

The lone 640 px card becomes the delivery charpente: title row (Coins glyph, **عمولاتي**, the rate
sentence, a scorecard pill carrying **المستحق لك**), a bucket strip by **entry type**
(الكل · مسلّمة · تصحيحات · دفعات · تسويات) with counts and signed sums, column heads
(النوع · التفاصيل · التاريخ · المبلغ), and rows with the situation chip and the coloured edge —
green accrual, red reversal, grey payout, stone adjustment. Day rows still expand to their orders
(`aria-expanded`, the existing `HistoryRow` behaviour). Payout rows keep method · reference.

The summary (**المستحق لك**, the since-last-payout sentence, ce mois · en cours · dernier
paiement, the accrual rule, "voir plus") moves into the sticky aside; on the phone it is the first
card above the pills. The period becomes a choice in the filter popover instead of the
"voir plus" step. Texts are the existing `agentCommissions.*` keys.

One thing to settle: the **الكل** segment sums the visible window (−288 د.ل over 60 days, because
a 540 payout sits in it) while the pill shows the all-time balance (684 د.ل). Both are true and
they look contradictory side by side. Options: drop the sum on **الكل**, or label it "solde de la
période".

## 4. Accessibility — measured, not asserted

The prototype carries its own checkers (`?check=contrast`, `?check=touch`) and both were run
headless over 4 screens × 2 languages × 2 views.

**Contrast.** Two of the delivery page's own chips fail 4.5:1 at the dark end of their gradient:
**green 4.14:1** (`#15803D` on `#BBF7D0`) and **red 4.47:1** (`#B91C1C` on `#FECACA`). The
prototype darkens exactly those two inks — green to `#166534` (5.88:1, already the primary
button's hover colour) and red to `#991B1B` (5.74:1). Placeholder and zero-count text move off
`--ink-4` (2.54:1) onto `--ink-3` (4.83:1). All 14 tones and the running text then pass.
**This is a live bug on `/delivery`, not only in the prototype** — the fix belongs in
`src/components/delivery/ui.tsx` and wants a case in `src/lib/orders/status-contrast.test.ts`,
which does not cover the `TONE` pairs today.

**Touch targets.** All 24 combinations report no interactive target under 44 px. Getting there
needed: suggestion rows to 48 px, the clear button to a 44 px hit area, the bell and identity
menu to 44 px, and the mobile search pill to 44 px. Note the live delivery phone action bar is
**40 px** and will need the same bump in Phase B.

**RTL.** The edge, the chip gradient, the aside side and the tab order all mirror; digits, refs
and phones stay LTR; values that begin with a digit inside an Arabic line are isolated with
`unicode-bidi:plaintext` (without it "41 مسلّمة · 492 د.ل" reorders and reads wrong).

## 5. Rationales (the brief asks for ≤150 words each)

**Commandes.** The delivery page answers "what is wrong, how urgent, what do I do" from fixed
positions: situation first, one hue per situation, the age inside the chip label, the move at a
fixed x. The queue answered none of them — a status pill in the fourth column, two age columns
with different definitions, and an action button that moved with the label. Porting the delivery
row keeps every function (call outcome, upload, bulk select, badges, presence) while making the
colour say what the row needs before any word is read. Moving the sub-filters into the existing
filter popover removes a whole band of chrome, and the sticky aside replaces a drawer that hid the
list. Nothing new was drawn: chip, edge, strip, column heads, aside and buttons all already ship
on `/delivery`. (134 words)

**Navigation + recherche.** The follow-up page keeps one chrome and lets the content change
underneath. The agent shell did the opposite: the search field existed only on the queue tab, so
the trailing cluster slid on every tab switch, and the active tab's bold label moved it again by
13 px. Rendering the field on all four tabs and holding the tab weight constant makes the header a
fixed frame. The dropdown is the recent-searches listbox already in the code, grown to group
results by tab and to carry each row's own situation chip — the same chip the list uses — so a
result is recognisable before it is read. Reaching every order type needed only one new route for
orders older than the cached seven days. (126 words)

**Commissions.** The page was a single centred card with a hero number and three tiles: a
different shape from every other agent surface, and unreadable as a list once the ledger grows.
Given the same charpente as the follow-up page it becomes scannable — entry types as buckets with
counts and signed sums, one row per event with the hue saying accrual, correction, payment or
adjustment, and the day rows still opening onto their orders. The summary loses nothing; it moves
into the sticky aside where the follow-up page keeps its detail, and on the phone it stays the
first card. The period, previously a "voir plus" that only ever grew the window, becomes a choice
in the same filter popover the other two screens use. (126 words)

## 6. Decisions for the owner (after révision 2)

1. The status hues, in particular teal for "confirmée, à envoyer" and violet reserved for the
   risk tag rather than a status.
2. Sub-filters moved from the always-visible chip strip into the filter popover.
3. ~~Sticky aside~~ — settled: the panel stays the existing slide-over, untouched.
4. Commission buckets = entry types; period as a filter choice. Plus the **الكل** sum question in §3.
5. ~~WhatsApp square on queue rows~~ — settled: no action buttons on the desktop row.
6. The two darkened chip inks, which change `/delivery` as well as the new screens.
7. The gentle flat tag (`.tagg`) vs the delivery page's gradient chip: keep both (gradient on
   `/delivery`, flat on the queue) or move `/delivery` to the flat one too.
8. "Last month" and "correction share" on commissions are derived from the 60-day history in
   the prototype; in React they are one small addition to `get_my_commissions`.

## 7. Phase B — React, TDD, only after the review

1. Lift `TONE`, `Chip`, `EDGE`, `OUTLINE_BTN`, `PRIMARY_BTN`, `Money`, `ProductThumb`, `Ltr` into
   `src/components/agent/ui.tsx`, re-exported from `delivery/ui.tsx` so `/delivery` does not move.
   Apply the two ink fixes there and extend `status-contrast.test.ts` to the `TONE` pairs.
2. Extract `src/components/ui/BucketStrip.tsx`
   (`segments:{key,label,count,tone?,sum?,tint?}[], value, onChange, columns:4|5|6, money?, trailing?`)
   keeping the delivery class strings verbatim; `/delivery` adopts it first and must render
   identically, then the queue and commissions.
3. `src/lib/agent-queue/situation.ts` — `situationOfOrder()` + tests (the table in §1).
4. Topbar: sticky, search always rendered, constant tab weight, `flex:1 1 340px` on the slot,
   `/` handler in the shell, queue badge.
5. `src/lib/agent-search/{types,sources,rank,recent,index}.ts` + `useAgentSearch` +
   `TopbarSearch` (replaces the `QueueSearchBar` navbar variant, keeps `RECENT_SEARCHES_KEY` and
   the `queue.search.*` keys) + `GET /api/agent/search` + `?open=` on `/delivery`.
6. Queue: `QueueHeader` → title row + soft `BucketStrip` + filter popover; `OrderCard` → the
   product-first row (client · status tag · age · last action · amount, no button on `lg`);
   `QueueList` heads. `OrderDetailPanel` and `QueuePage`'s open/close logic are **not touched**.
7. Commissions: `AgentCommissionsView` rebuilt on the same pieces.
8. i18n: the only new keys are the queue situation labels/subs and the commission bucket names.
   Run the `i18n-reviewer` agent after.
9. `npm run typecheck`, `npm run lint`, `npm run test:run`.
10. Docs: `docs/design-system.md` §4.23 "Agent shell — one language", the `agent-commissions.md`
    surfaces line, and a note in `docs/delivery-worklist.md` about the two corrected inks.

## 8. Verification done in Phase A

- 4 screens × 2 languages × 2 views rendered headless; every state (`normal`, `loading`, `empty`,
  a bucket, an open panel, the ruler) renders with no console-visible failure.
- Slot geometry identical across the three tabs in both languages.
- `?check=contrast`: 18 pairs, 0 failures. `?check=touch`: 24 combinations, 0 targets under 44 px.
- Screenshots at 1620 px and 430 px kept with the review note.

## 9. Shipped in React (2026-09-18)

Scope, as the owner set it: the orders page (desktop + phone), the search bar, the commissions
page, and the side-open panel. **`/delivery`, the leads tab and the order panel's own content were
not touched.**

| file | change |
|---|---|
| `src/components/queue/QueueStatusTag.tsx` *(new)* | the flat status tag: tint + ink + glyph, hue/label/datum still from `presentAgentStatus`, so it cannot drift from the pill it replaces |
| `src/components/queue/OrderCard.tsx` | product-first row; the status tag replaces the pill; the last-action column names *what* the action was; the end-call button is gone; the tag is one node repositioned by breakpoint so phones keep the signal |
| `src/components/queue/row-grid.ts` | trailing column 112px → 40px (carrier mark only), last-action 104 → 116 for its second line |
| `src/components/queue/OrderDetailPanel/shell.ts` *(new)* | the two shells: `overlay` (unchanged slide-over) and `side` (sticky column on `lg`, slide-over below) |
| `src/components/queue/OrderDetailPanel/index.tsx` | a `variant` prop picking the shell. **Nothing inside the panel changed** |
| `src/components/queue/QueuePage.tsx` | list + panel share a grid when an order is open |
| `src/lib/agent-search/suggestions.ts` *(new)* | `buildSuggestions` over the warm SWR caches; reuses `lib/queue/search` for prefixes and normalisation; ranks exact phone > name prefix > substring; caps 5 per group |
| `src/components/queue/QueueSearchBar.tsx` | grouped typeahead with ↑↓/Enter, reading the three caches with `revalidateOnMount:false` |
| `src/components/layout/AgentDashboardShell.tsx` | the search field renders on **every** tab (the `onQueueTab` gate is gone) |
| `src/components/agent-commissions/AgentCommissionsView.tsx` | entry-type buckets (livrées / corrections / paiements / ajustements) with counts, column heads, and a tagged row per entry |
| `src/messages/{fr,ar}.json` | `agentCommissions.buckets.*` and `agentCommissions.cols.*` |

**Tests** (written first): `QueueStatusTag.test.tsx` (6), `OrderDetailPanel.variant.test.tsx` (3),
`QueueList.layout.test.tsx` (2), `agent-search/__tests__/suggestions.test.ts` (8), plus new cases
in `OrderCard.test.tsx` and `AgentCommissionsView.test.tsx`. Six old `OrderCard` cases that
asserted the end-call button are skipped with a note pointing here — the affordance moved to the
panel footer, it was not deleted.

**Verification.** `npx tsc --noEmit` clean; `npm run build` compiles and validates types; the
queue, commissions, layout, agent-search and queue-lib suites pass (596 passed / 6 skipped).
Four failures in `DarbStatusSection` and `Sidebar` are **pre-existing** — verified by stashing
the change set and re-running, which reproduces them identically.

**Not done, deliberately:** the `?open=` deep link on `/delivery` that a delivery suggestion
wants (the suggestion href is in place; the reader is not, and `/delivery` was out of scope), and
the "last month" / "correction share" figures from the prototype, which need a change to
`get_my_commissions`.

## 10. Second React pass (2026-09-18) — copying the prototype properly

The owner's review of the first pass: the grid jumped when an order opened, the phone view had
not actually changed, and the search bar did not behave like the prototype. Corrected by reading
the prototype's markup and CSS and porting it, rather than approximating it.

**The phone view (the real gap).** The first pass changed only the `lg` layout, so phones still
got the desktop row with its columns hidden. The row is now one element that is a ruled table row
on `lg` and the prototype's `.mc` card below it: a bordered card with its own 4px rail, the
identity line (name · ref · tags) with the amount at its end, product ×qty · city beneath, then
the status tag paired with one combined clock line (`6h · 2h` — age then last action), which is
exactly what `mCard` draws. `QueueList` drops its banded shell and column header below `lg`, as
`.mlist` does. One caught in the browser, not in a test: with the amount column left as `auto`,
the identity cell sized itself first and pushed the amount off-screen; it needs a fixed 84px
track next to `minmax(0,1fr)`.

**The search bar.** The prototype shows a compact trigger on phones that opens a full-screen
sheet (`mSearch`): back button, focused field, the same grouped results. The first pass had only
the desktop dropdown, unusable under a 44px pill. The grouped list is now one renderer shared by
the dropdown and the sheet.

**The grid transition.** The list used to snap to its narrower width while the panel slid in from
the edge — two movements in different directions. The wrapper is now always a grid whose second
track animates from `0fr` to `460px` over 220ms, and the panel settles vertically
(`panelSettle`) instead of sliding horizontally, so one motion resizes the list and reveals the
panel. `motion-reduce:transition-none` opts out.

Verified by rendering the real `QueueList` and `QueueSearchBar` to HTML, compiling the app's own
Tailwind against that markup, and screenshotting at 390px and 1440px — the phone card, the
desktop table and the search sheet all match the prototype.

## 11. Révision 3 (2026-09-19) — le prototype copie les captures du propriétaire

The owner sent two captures — the desktop orders page and a phone mock-up — and asked for the
prototype to match them exactly, prototype only, nothing added. `prototypes/agent-shell-v1.html`
screen « Commandes » is now that reproduction; the search, commissions and delivery screens are
untouched.

**Desktop (1672 px).** Title row = h2 + « — tasnim — يتم تحديثها لحظياً » + the in-page search
field (526 px) + three meters (taux de confirmation `sur 7 j`, traitées `24 h`, assignées) + the
filled « طلب جديد ». Then the four bucket chips as bordered pills with count badges (the active
one brand-outlined), the red overdue bar (`8 / 21` … + « الأقدم أولاً »), and the two panes:
the table (case · vignette ×N · client + product · `n / 8` pill + last call · age in red/orange
with its gauge · `LYD 249`) at `minmax(0,1fr)`, the **existing panel** at 560 px, reproduced
section by section (header pills, customer block with « اتصال », the 2×3 facts grid with the
amber « غير محددة » box, the three tabs, the product row, the two wide buttons, the four-action
footer with its `N / C / B` keys and the navigation hint). Pagination footer below the table.

**Phone (390 px).** Status bar → four chips → red overdue bar (bell · text · sort) → search →
cards in two rows (client · `LYD 249` / product · age tag with gauge · « n / 8 محاولات ») → the
tab bar with the percent glyph and the inline « 12 » badge. A card **swipes toward its end
edge** to reveal the green « اتصال » (drag 30 px; the third card ships revealed, as in the
mock-up). Tapping a card opens the « نتيجة المكالمة » sheet with its four outcomes; the second
phone shows it open, as the capture does.

**Two things fixed while copying, worth knowing.** (1) The prototype had *always* rendered its
Arabic screens in LTR flow with RTL text — the studio bar sets `direction:ltr` and the stage
inherited it. `[dir=rtl] .app, [dir=rtl] .scr { direction: rtl }` corrects every screen, which is
why the commissions and delivery mock-ups now sit mirrored the way the live app does. (2) Links
had the browser's default underline; `.app a, .scr a { text-decoration: none }`.

**Departures from the pixels, deliberate.** Orange age text is `#C2410C` (5.2:1) rather than the
capture's brighter orange (3.6:1); the gauge keeps the bright fill. Not-yet-called text uses
`#6B7280` (4.8:1) rather than the capture's lighter grey. Phone chips are 34 px tall as drawn but
sit inside 44 px buttons; the desktop chips (38), pagination (32), panel tabs (42), wide buttons
(38) and « اتصال » (40) are the capture's own heights and fail the 44 px check on purpose —
`?check=touch` lists them. Product photos are drawn book stand-ins keyed by product.

Data on the captures (counts 21 / 39 / 0 / 614, 28 / 33 on the phone, the ten desktop rows, the
seven phone rows, `#39494`) is kept as printed; `DESK` and `MOB` hold each capture's row order.

## 12. Révision 4 (2026-09-19) — the owner's five corrections

Reviewed against the live panel he sent as the intent, plus four behaviour notes.

**The panel, copied properly.** Six things were mirrored or mis-stacked against the intent
screenshot, and each is now the way the live panel draws it: the copy glyph sits at the lead edge
of `#39494` and of the phone number, not the trail edge; the overdue pill runs left-to-right
(clock, age, « · الهدف 2 h »); « اتصال » carries its glyph on the left; the phone number and
« + إضافة هاتف ثاني » are two lines, not one; the city warning stacks the glyph and « غير محددة »
above the « تحديد المدينة » button instead of putting them side by side; and the two wide buttons
are full width. That last one was a real bug, not a judgement call — a `<button>` sizes `width:auto`
to fit-content even at `display:flex`, so « إضافة منتج » and « دمج مع طلب آخر » had been rendering
as small right-aligned pills. The total and the product count were left-aligned for the same family
of reason: `.num` sets `direction:ltr`, which flips what `text-align:start` means, so the numbers
now sit inside a `<span class="num">` and the cell keeps its own direction.

**The four outcomes are glyph + name.** No sub-line, no keyboard chip, one 46 px row. The grid uses
`repeat(4,auto)` so « طلب اتصال لاحق » and « Rappel plus tard » take the width the shorter labels
do not need; equal columns clipped both.

**The red overdue bar is gone**, on the desktop and on the phone. The « الأقدم أولاً » sort button
lived inside it and went with it.

**The phone separates the two intentions.** Tapping a row opens the order panel full screen, behind
a back bar, using the same markup as the desktop panel. A 44 px call button at the end of the row
opens the « نتيجة المكالمة » sheet. The swipe-to-reveal of révision 3 is removed — the button is
what the owner asked for and the two together were redundant. The stage now shows three phones:
the list, the panel, the sheet.

Two departures worth knowing: the attempts pill on the phone row is now the glyph plus « 1 / 8 »
without the word « محاولات », because the call button needs that width and the glyph already says
what it counts; and the longest customer name still truncates on a 390 px row.

## 13. Shipped in React (2026-09-19) — the prototype, in the code

The owner asked for the prototype to be copied into the app. What changed, and why each
departure is a departure.

### The row — `OrderCard.tsx`, `row-grid.ts`

Columns are now the capture's: **select · client · activity · age · amount**, at
`40px minmax(0,1fr) 250px 196px 140px`. The phone card is the same element at
`minmax(0,1fr) auto auto 44px` over two rows, with the identity spanning both.

**The status column is gone**, and with it the coloured rail and the second elapsed-time
column. This is the one substantive change to what the row *says*, so it is worth stating
plainly: the four bucket chips above the list already name the status, every row under a chip
shares it, and the column was therefore repeating the active filter twelve times. The status
itself is not lost — it is in the chips, in the panel header, and in `presentAgentStatus`,
whose label rules (rejection reasons, attempt ceilings) keep their own unit tests in
`src/lib/queue/agent-status.test.ts`. `QueueStatusTag` was introduced by revision 2 and deleted
here; `QueueStatusPill` is now unreferenced and left in place rather than deleted blind.

**The activity cell** carries the attempts counter `n / max` and, beside it, "Appelé il y a 3h"
or "Pas encore appelé". That sentence is what the old last-action column said in digits.

**The age cell** is the elapsed time over a bar. The bar is new: `src/lib/queue/age-gauge.ts`
fills it as the share of a day the order has waited, capped at 100%, and colours it from the
tier `classifyOrderAge` already returns — so the bar and the number above it cannot disagree
about whether an order is late. The capture's own percentages are not a function of its ages
(9h44 and 1d18h are both drawn at 82%), so a rule was written rather than mimicked.

**The call button is back on the row, phone only**, as a 44px glyph that opens the
call-outcome sheet. The desktop row still opens the panel — the owner asked for the labelled
end-call button to leave the table, not for the action to move. The per-status rules for when
a call can still be recorded were already written as a skipped suite in `OrderCard.test.tsx`;
they are un-skipped and passing.

### The header — `QueueHeader.tsx`, `SegmentedTabs.tsx`

The title row gains the capture's in-page search field, bound to the same `queue-search`
context the navbar field writes, so whichever is on screen at a given width the list agrees
with it. The three meters gain the qualifier under their label ("sur 7 j", "sur 24 h") without
which a rate is not actionable. The bucket chips take a new `variant="outline"` on
`SegmentedTabs` — a brand border round the chosen segment and a tinted count, rather than the
accent-filled badge the warehouse consoles use, which is unchanged.

The header is one wrapping row with explicit `order-*`, so the search sits beside the title on
a desktop and under the chips on a phone — where the capture puts it — without rendering a
second input that would answer to the same name.

### The panel — `ActionFooter.tsx`, `QueuePage.tsx`

The panel's content is untouched, as instructed, with one exception the owner asked for: the
outcome buttons are **glyph + name**, 44px tall, with no sub-line. The app's footer never had
the descriptions the prototype drew, but it had no glyphs either, and four same-width buttons
in the same place on every order differ only by their words. The side panel widens to
480/560px to match.

### Not implemented, deliberately

The prototype's pagination footer ("1 - 10 of 21", page arrows, rows-per-page) is
functionality, not appearance. The agent queue is a priority-sorted worklist that agents work
top-down; paginating it changes how the queue is used, which is the owner's call and not a
side effect of a visual pass.

### Verified

Typecheck and build clean. The real `QueueHeader` and `QueueList` were rendered to HTML, the
app's own Tailwind compiled against that markup, and the result screenshotted at 390px and
1500px — which is how the 390px title overflow was caught: `truncate` cannot shrink a flex
child that has no `min-w-0`, so the title kept its full width and pushed every row 20px off
the screen.

---

## §14 — Le panneau de commande, copié sur la capture (2026-09-19)

Rév. 3 et 4 ont refait la ligne, l'en-tête et les seaux ; **le panneau n'avait pas bougé**.
Seule sa coquille avait changé (superposition → colonne latérale, `OrderDetailPanel/shell.ts`).
Il gardait donc sa typographie d'origine — étiquettes 10,5 px capitales, pastille SLA sur deux
lignes, boutons d'appel et de copie de 30 px, carte d'articles encadrée, onglets 13 px — à côté
d'une liste redessinée d'après la capture. C'est ce que le propriétaire voyait : « je retrouve
l'ancien panneau ».

Deux découvertes en cours de route :

1. **Le CTA du panneau était violet.** `--oms-accent` vaut `#6E56CF` à `:root` et `.agent-theme`
   ne le remappe pas. Le bouton « Confirmer », le soulignement de l'onglet actif et les liens du
   bloc client portaient donc la couleur réservée au chrome, pas le vert de marque. Ils passent
   à `--brand` (#15803D), le jeton que la ligne de file utilise déjà pour son bouton d'appel.
2. **« Sans réponse » coûtait deux clics.** `resolvePanelActions` gardait `endCall` dans le menu
   `⋯` au motif qu'il ne devait pas peser autant qu'une confirmation — mais c'est la fin d'appel
   la plus fréquente, et ce classement se payait en clics pour l'agent qui venait d'écouter
   sonner dans le vide. Les quatre issues sont maintenant quatre boutons ; le ton les classe (un
   bouton vert plein, trois contours).

### Ce qui change

| pièce | avant | après (capture) |
|---|---|---|
| en-tête | 50 px, pastille SLA sur 2 lignes, réf. 11 px | 46 px, pastille pleine sur 1 ligne, réf. 14 px, `dir="ltr"` sur `#réf` |
| client | nom 21 px, appel + copie en 2 boutons de 30 px | nom 22 px, copie en glyphe, **appel = bouton vert plein 40 px** |
| faits | étiquettes 10,5 px capitales | étiquettes 12,5 px, total 17 px, transporteur en pastille |
| ville absente | bandeau ambre au-dessus des boutons | **encadré ambre dans la cellule**, avec « Définir la ville » |
| onglets | 13 px, soulignement violet | 42 px, 15 px, **vert de marque** |
| articles | carte encadrée, 2 petits boutons | lignes à fond perdu, vignette 56 px, **2 boutons pleine largeur** |
| pied | 3 boutons + `⋯`, 44 px | **4 boutons pairs 46 px**, 2×2 sous `lg`, + rappel clavier |
| téléphone | pas de retour | **barre de retour 52 px** avec le nom, la croix de l'en-tête masquée |
| feuille d'appel | modale centrée, pastilles 36 px | **feuille basse** sous `lg`, tuiles 44 px, cartes teintées, rappel de la commande |

Le contenu n'a pas été supprimé : la capture est une nature morte (ni édition en ligne, ni
contrôles par ligne, ni sections transporteur). Tout ce que l'application affiche en plus est
conditionnel et ne s'affiche pas dans l'état capturé — bandeau de fiabilité, encart produit,
suivi Darb/Dexpress, `⋯`.

### Décisions du propriétaire

- Le nouveau look s'applique **partout où le panneau sert**, y compris la page Commandes du
  manager et les archives : un panneau, une langue visuelle.
- Le panneau latéral passe de 480 à **560 px** (600 en `2xl`) — c'est ce qui laisse les quatre
  boutons tenir sur une ligne comme dans la capture.

### Un écart assumé

Les libellés restent ceux de l'application (« Appel terminé », « Confirmer », « Refuser »,
« Rappeler ») là où la capture écrit « لم يتم الرد / تأكيد الطلب / رفض الطلب / طلب اتصال لاحق ».
Renommer `endCall` en « Pas de réponse » serait faux : ce bouton **ouvre la feuille des quatre
issues**, il n'enregistre pas une absence de réponse. Les trois autres sont des clés partagées
avec la console manager. À l'arbitrage du propriétaire.

### Vérifié

`tsc` et `npm run build` propres. Les composants réels du panneau ont été rendus en HTML,
compilés avec le Tailwind de l'application et photographiés : bureau à 1200 px et téléphone à
390 px réels, en `ar` et `fr`, plus la feuille d'appel. Piège retrouvé : Chrome sans tête
plafonne la fenêtre vers 500 px, donc une page `dir="rtl"` gare un cadre de 390 px hors du
cliché — la page reste LTR et seul le cadre est miroir.


### Correctif du 2026-09-20 — le quatrième bouton et le blanc sous le total

Deux retours du propriétaire, capture à l'appui.

**1. Le bouton ne voulait pas dire ce qu'il faisait.** « Appel terminé / إنهاء المكالمة »
ouvrait la feuille des quatre issues — dont trois étaient déjà, en toutes lettres, sur la
barre juste à côté. La capture l'appelle « لم يتم الرد » : c'est la quatrième issue, pas une
porte vers les trois autres. Le motif existait déjà — `confirm_now` n'est pas un écran, il
déclenche la confirmation à l'ouverture — il manquait seulement son pendant. Nouveau
`no_answer_now`, même garde par `ref` (un double POST serait une tentative de trop, et au
plafond c'est elle qui bascule la commande en rejet automatique). Les quatre boutons mènent
maintenant chacun directement à sa propre fin.

Libellés : l'arabe reprend mot pour mot la capture (تأكيد الطلب · رفض الطلب · طلب اتصال لاحق ·
لم يتم الرد). Le français garde ses formes courtes (Confirmer · Refuser · Rappeler · **Pas de
réponse**) : « Confirmer la commande » coupait à « Confirmer la… » sur un quart de barre de
560 px, et une action principale tronquée est pire qu'une action brève. Seul `endCall`
change de sens en français aussi, puisque c'est le sens qui était faux.

**2. Le blanc entre le total et les boutons.** La coquille latérale portait
`lg:h-[calc(100vh-88px)]` : hauteur figée, donc toute commande à une ligne d'article
finissait par une bande de panneau vide entre le reçu et les boutons qui agissent dessus.
Passée en `lg:max-h-[…]`, la colonne s'arrête où son contenu s'arrête, comme la capture.
Le téléphone garde son plein écran — une feuille qui couvre l'écran doit le couvrir.
