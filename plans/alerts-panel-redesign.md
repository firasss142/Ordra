# Alerts panel redesign — rules, severity ladder, and layout

## Why

The live panel showed 19 alerts, five of them older than 40 days (`bloquée 1176 h`,
`en retard de 744 h 5 min`). Three problems, none of them cosmetic:

1. **It is a graveyard, not an inbox.** Nothing ignored for seven weeks gets actioned
   today, but it occupied the same visual weight as a callback 1 h 35 late. That is the
   alert-fatigue spiral: the panel teaches you to close it.
2. **Severity was a fixed lookup per type**, so a dispatch blocked 3 h and one blocked
   49 days were both `critical`. The tiles could not tell you where to look.
3. **`formatMinutes` stopped at hours**, printing `1176 h` instead of `49 j`, and pairing
   31-day staleness with 5-minute precision.

Separately, `AlertsList.tsx` was 120 lines of inline styles with hardcoded hex
(`#E1E3E5`, `#6D7175`, `#1A1A1A`) and `SEVERITY_COLORS` ignored the `hue-*` scale that
the orders console and queue pills share — which is why the panel read as a different
product from the page behind it.

## Decisions (confirmed with the operator)

- **Stale handling:** severity escalates with age, then the alert auto-expires out of the
  live list past a per-type cutoff.
- **Retired:** `agent_inactive` (fires on lunch), `low_stock` (duplicates the Produits
  page), `return_bottleneck` (permanent once tripped). `stock_depleted` stays.
- **Layout:** grouped by severity in collapsible sections, mirroring the four tiles.

## Alert catalogue

Age is measured from each rule's own anchor timestamp — the same anchor already used for
the row's `meta` reading, so the badge and the escalation never disagree.

| Type | Anchor | Trigger | Base | Escalates | Expires |
|---|---|---|---|---|---|
| `dispatch_failure` | `updated_at` | `confirmed`/`scanned` > 72 h | high | critical @ 7 d | 30 d |
| `carrier_webhook_stale` | `updated_at` | `in_transit` > 7 d (super_admin) | high | critical @ 14 d | 45 d |
| `overdue_callback` | `callback_scheduled_at` | callback time passed | high | critical @ 4 h | 14 d |
| `unassigned_overflow` | `created_at` | `pending`, unassigned > 2 h | medium | high @ 8 h, critical @ 24 h | 7 d |
| `stock_depleted` | — | active product at 0 | high | — | never |
| `attempts_stalled` **(new)** | `created_at` | open order ≥ 24 h with < 2 attempts | medium | high @ 48 h | 14 d |
| `pending_idle` **(new)** | `updated_at` | assigned + `pending`, untouched 4 h | medium | high @ 12 h, critical @ 24 h | 7 d |
| `dispatch_schedule_missed` **(new)** | `scheduled_dispatch_at` | still `dispatch_scheduled` past its time | high | critical @ 2 h | 7 d |
| `upload_stalled` **(new)** | `updated_at` | `uploaded`, unchanged 24 h | medium | high @ 72 h | 30 d |
| `price_changed` **(new)** | history row | agent edited price | medium | — | 7 d |
| `order_reopened` **(new)** | history row | agent reopened an order | low | — | 7 d |

`dispatch_schedule_missed` is a cron-failure signal, which is why it outranks the other
new rules: nothing else in the system notices that the scheduled upload never fired.

## The price-change audit gap

`PATCH /api/orders/[id]` strips `unit_price` and `total_price` from the history note
(route.ts:412) because both are *recomputed* on any quantity/product/fee edit — logging
them would mark every edit as a price change. So the requested alert had no data behind it.

Fix: record a price change only when the client explicitly sent the field, not when it was
derived. Intent is the thing worth auditing; derivation is not.

## Two colour vocabularies

The band says *how urgent*, the row says *what kind*. Inside one ÉLEVÉE band a missed
callback and a blocked dispatch are equally urgent and completely different problems, so
painting both amber spends the row's only colour on something the header already said.

- **Severity** — band header disc, summary tile, distribution bar.
  critical `red` · high `amber` · medium `violet` · low `neutral`.
- **Type** — the row's mark and its age pill. A missed call is red wherever it appears, so
  a row stays recognisable when its severity climbs and it changes band.
- **Zero** — a tile whose count is 0 turns green with a check rather than going grey. "No
  critical alerts" is information; a dimmed control reads as broken.

`SEVERITY_TONE` / `TYPE_TONE` in `components/alerts/constants.ts` are the only place these
live. Note the Tailwind v3 trap documented in §4.17: an opacity modifier on a `var()`-backed
colour (`bg-oms-sunken/60`) compiles to nothing, so every tone is a whole token.

## Testable seam

The rule engine's queries live in the route, but the *decisions* do not. `lib/alerts/`
holds the catalogue, the age→severity ladder, and the expiry check as pure functions, so
they are tested against real data with no Supabase mock. The route keeps a thinner set of
integration tests over the existing table-queue harness.

## Out of scope

Two conditions were offered and not taken, worth revisiting: **storefront intake stopped**
(a dead webhook looks exactly like a quiet day) and **unmapped city on intake** (the
history log already writes the note, and the order cannot dispatch until someone maps it).
