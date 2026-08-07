# Agent queue redesign (v2)

Branch: `feat/agent-queue-redesign` · Prototype: `prototypes/agent-queue-v2.html`

## Why

The confirmation queue is the one screen an agent stares at for a full shift, and its job is
narrow: call the next customer, log the outcome, move on. It wasn't serving that.

- **Eleven numbers, three overlapping count systems, before the first order.** Shift metrics, a
  status-dot strip, and the bucket tabs all restated each other — `معلق 39` *was* `جديد 14 +
  قيد التنفيذ 25`, and `مؤكد` appeared twice. ~200px of arithmetic.
- **Price won the hierarchy** (22px extra-bold green) over the customer name at 14px.
- **The product column was noise** — every row truncated the same storefront marketing sentence.
- **A ladder of identical green CTAs**, each on its own row, doubling card height.
- **Inverted density**: 6px internal padding inside a 12px gap, each card in a hard coloured border.
- **A redundant status column** — in `جديد`, 100% of rows read `قيد الانتظار`.
- **Absolute long dates** where elapsed time is what signals urgency.
- ~6 orders visible at 1080p.

## What shipped

### A. Palette — neutral ground, green earns its place

`--agent-*` moved from `.agent-theme` to `:root` in [globals.css](../src/app/globals.css) so the
`agent.*` utilities resolve everywhere, and `tailwind.config.ts` now references those vars instead
of duplicating literal hexes (the old setup meant a palette change had to be made twice).

Ground `#f4fbf4` → `#FAFAF9`; ink is the console's three-step ramp (`#1B1917` / `#5C5852` /
`#78726A`), every step ≥4.5:1. **Green is spent on exactly three things** — the primary CTA, the
confirmed state, the active tab.

Status hues are *aliased* to the `--oms-*` tokens rather than restated, so both consoles stay
covered by `src/lib/orders/status-contrast.test.ts`.

### B. Status — one map, three encodings

`src/lib/queue/agent-status.ts` wraps the canonical `lib/orders/status-presentation`; it does not
own a second map. It adds only what the queue needs: reference-deleted uploads, the carrier
lifecycle bucket, and a *datum* (attempt counter or scheduled time).

`QueueStatusPill` renders `[glyph][word][datum]` at fixed geometry — the glyph in an 8px slot so
every label in the column starts at the same x. Hue = phase + outcome, shape = open/closed,
weight = urgency.

Two corrections this surfaced:

- `confirmed` is **violet**, not green (still the agent's; the upload is a separate action) and
  `uploaded` is **teal** (first state actually with the carrier). The queue had these inverted.
- `presentStatus` rendered `Tentative 0/9`: every attempt-status order in the DB carries
  `attempts_count = 0`, and `??` only falls back on null. Zero is now treated as absent — an order
  cannot be in `attempt_2` having made no calls. **This fixed the admin orders table too.**

### C. Two clocks

| Column | Measures | Answers |
|---|---|---|
| `Âge` | now − `created_at` | how long the **customer** has waited |
| `Dernière action` | now − last **agent** action | how long since **anyone touched it** |

They coincide on a new order, so the second reads `—` (never actioned) rather than restating the
first. Age reuses `lib/orders/order-age`; `lib/queue/last-action.ts` is new.

> **`orders.updated_at` is NOT the source.** `trg_orders_updated_at`
> ([001_initial_schema.sql:241](../supabase/migrations/001_initial_schema.sql#L241)) fires on every
> write, and the Dexpress/Darb sync crons write these rows — an order nobody had called in three
> days would report "5 minutes ago". The source is `order_history`
> (`actor_type = 'agent'`, newest first), stamped in the queue route.

**One heat map, not two.** Age keeps the escalating scale; last-action stays neutral except for one
case — an `attempt_*` order untouched >24h *with retries left*. That is a forgotten follow-up, and
it is the only thing that column ever colours.

### D. Row, header, chrome

- Row is a ruled band, not a boxed card: a 3px leading rail in the row's own status hue, hairline
  separators, uniform 65px height. The old `.support` sub-row is gone — notes and address changes
  are one glyph with a hover/focus disclosure, so height never depends on whether a customer left a
  comment.
- Product line is the **catalogue** name (`product_display_name`) with the city, not the storefront
  sentence. Price demoted to 15px neutral.
- Header: three count systems collapse to one. The status-dot strip is deleted (nothing lost —
  `معلق` = the two active tabs summed; `مُرسَل`/`مرفوض` are `fermées` sub-chips). Shift metrics
  become a readout with no pill chrome.
- Sub-filters live in **one permanent recessed panel** below the tabs, whichever bucket is open —
  they used to render inline for `en_cours` and as a second row for `fermées`. Chips carry the hue
  and glyph of the status they filter for, both derived from the shared map.
- Nav folded into the header row on desktop (`Topbar navSlot`); the standalone band is mobile-only.
- `QueueList` gained a column header strip. Header and rows share `QUEUE_ROW_GRID`, so they cannot
  drift.

## Files

`globals.css` · `tailwind.config.ts` · `types/queue.ts` · `api/agent/queue/route.ts` ·
`lib/orders/status-presentation.ts` · `lib/queue/{agent-status,last-action}.ts` (new) ·
`components/shared/StatusGlyph.tsx` (added `tone="inherit"`) ·
`components/queue/{OrderCard,QueueHeader,QueueList,QueueStatusPill,row-grid}` ·
`components/layout/{Topbar,AgentNavTabs,AgentDashboardShell}` · `messages/{ar,fr}.json`

## Verified

- **4492 passing.** Zero regressions: the failing set is identical to `main`
  (`webhook-handler`, `TeamSection`, `CarriersSection`, dexpress/buybox adapters, and
  `DateRangePicker` — a date-boundary test that also fails on `main`).
- `npm run typecheck` and `npm run build` clean.
- Driven in Chromium against the real dev server + database: 40 rows in `nouveau`, 73 in
  `en_cours`; **every sub-filter chip's count equals the rows it yields**; hues `red/amber/violet`
  and weights `loud/medium` render; counters read `1/9 2/9 3/9`; `last_action_at` populated from
  `order_history`; no console errors.
- **10 rows visible at 1440×900**, up from ~6. 221px of chrome before the first row.
- No clipped pills, no wrapped CTAs, uniform row height (65–66px).
- RTL: no physical CSS properties in any changed file; forcing `dir=rtl` mirrors the layout (rail
  and thumbnail to the trailing edge, money to the leading edge).

## Not covered by the live walkthrough

The hover-note disclosure has unit coverage but no order in the current dataset carries a
`customer_note` or `last_known_address`, so it was not exercised in the browser.

`npm run lint` is not runnable — the repo has no ESLint config and `next lint` drops into an
interactive setup prompt. Pre-existing.
