# Order panel v1 — implementing the prototype

Prototype: `prototypes/order-panel-v1.html` (role + status switcher, annotations overlay).
Branch: `feat/order-panel-v1`, cut from `feat/stock-console-redesign` — that branch has
three unmerged commits that already touch `messages/fr.json` and `types/settings.ts`,
so cutting from `main` would have meant conflicts in both on the way back.

## What changes

| # | Change | Files | Data |
| --- | --- | --- | --- |
| 1 | Ville + Adresse promoted into the facts grid | `OrderFacts.tsx` | existing |
| 2 | Reliability strip on the client line | `CustomerHero.tsx`, `index.tsx` | `/api/customer-history` (existing) |
| 3 | SLA chip in the header | `PanelHeader.tsx`, `types/settings.ts`, `hooks/useSlaMinutes.ts` | **new setting** `sla_minutes` |
| 4 | Three call outcomes in the footer | `usePrimaryAction.ts`, `ActionFooter.tsx`, `index.tsx` | existing |
| 5 | Blockers moved directly above the footer | `index.tsx` | existing |
| ~~6~~ | ~~Admin-only operational summary~~ — built, then removed on review | — | — |

The agent brief needs no change: `ProductBriefBanner` already lives inside the Articles
tab, which is where the prototype leaves it. The prototype only dropped the *second*,
duplicated copy that the design mock floated above the tabs.

## Decisions taken

**Reliability wording.** One word, not a sentence: `Fiable` / `Moyen` / `À risque`,
with the tone dot carrying the level and the full sentence on hover. Thresholds
(`lib/orders/customer-reliability.ts`):

- fewer than 3 orders → `unknown`, rendered as `—`. One delivery out of one is not
  a reliable customer, it is an unknown one.
- delivered / total ≥ 0.85 → `fiable`
- delivered / total < 0.60, or 2+ returns → `à risque`
- otherwise → `moyen`

**SLA target.** New optional `sla_minutes` on `MarketSettings`, default 120.
The chip only renders while the order is still in the confirmation phase — once
confirmed it freezes at the achieved time and turns green; after upload it disappears
entirely, because there is nothing left to be late for.

**Three outcomes.** `resolvePanelActions` returns `primary` plus a new `outcomes`
array for the in-confirmation group. `ActionFooter` renders the outcomes when present
and falls back to the single-CTA layout otherwise, so every other status is untouched.
`Refuser` still opens `PostCallActionSheet` (a rejection reason is mandatory) — the
sheet just opens on the rejection step instead of the outcome-picker step.

## Removed after review

**The operational summary card.** Shipped in 567528c, removed in the next
commit. Seen against real data it did not earn its space: the origin cell
printed a raw storefront UUID rather than an order number, the market cell
restated a currency the total already carries, and "Doublons: Aucun" spent a
line saying nothing happened. The provenance it showed belongs on a row in the
orders console, not on the surface an agent uses to work one order.

## Deliberately NOT in this pass

**Estimated margin** in the ops summary. There is no per-order margin function:
`lib/calculations/profitability.ts` is market-level and needs `unit_cogs`, carrier
fees, packing cost and ad spend. A per-order contribution margin is a new financial
definition, and financial definitions are not something to invent inside a UI pass.
The ops card ships with market, source, creation time, duplicates and attempts —
all of which are real fields today. Margin gets its own pass once the definition
is agreed.
