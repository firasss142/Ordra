# Transporteurs — the carrier scorecard

`/carriers` answers one question, read daily on desktop: **is each carrier doing its job?**
Spec: `prototypes/transporteurs-v2.html` (approved 2026-10-03, « follow it exactly »).
Look: « Aurore calme » since 2026-10-06 (`carriers.css`, scoped `.tsc`, as Performance ›
Commandes / Équipe) — the prototype's layout and numbers are unchanged; only the surfaces moved.
Plan and decisions: `plans/transporteurs.md`.

## Screens

| Route | Screen |
|---|---|
| `/carriers` | Vue d'ensemble (4 market numbers) → En bref (one card per carrier account) → dormant carriers |
| `/carriers/[carrierId]` | Band + five cards: Livraison, Pourquoi ça échoue, En retard, Retours, Villes |
| `/carriers/compare` | Vue globale (face to face) → Taux par semaine → Ville par ville |

The period (`?period=7|30|90`, default 30) lives in the URL and follows every link.
Audience: super_admin (scoped market) and market_manager (own market). Agents and
warehouse agents are redirected by the middleware and by `resolveScorecardPage`.
Sidebar: Livraison › Suivi livraison · Transporteurs.

## One outcome per parcel — `carrier_parcel_outcome`

A view (`security_invoker`), shared byte for byte with Produits v6. Never edit its
migration; change it with a new one. Outcomes, evaluated in order (latest Darb shipment
= `carrier_updated_at desc`):

- **delivered** — `delivered`, or Darb `completed` (Darb wins over an Ordra `cancelled`).
- **failed** — `returning` / `to_be_returned` / `returned` / `received`; Darb
  `returning` / `returned`; Darb `released` **after a Darb cancellation**; Ordra
  `cancelled` + Darb `cancelled` + picked up.
- **in_flight** — in-flight statuses; `cancelled` + an active Darb slug; re-queued after upload.
- **cancelled_before_pickup** — the rest.
- **picked up** — the earliest of Darb's `assigned` event and the first "with the
  carrier" status in `order_history` (Darb parcels older than 2026-08-17 have no timeline).

Why: every older screen counted delivered ÷ (delivered + returned). In Libya a failed
Darb parcel ends `cancelled`, not `returned`, so failures vanished and Darb read
92–100 % where the truth was 50–55 % (2026-10-03). `promote_darb_status` also maps every
`released` to `out_for_delivery`: 19 Tripoli parcels read « en livraison » for up to
105 days although Darb cancelled them and handed them back.

## What the page reads — `get_carrier_scorecard(market, days)`

`SECURITY DEFINER`, market guard (super_admin any, market_manager own, else `{}`).
Per active carrier that has ever carried a parcel: `period` (parcels **sent** in the
window: sent, delivered, failed, in flight, the previous window, pickup speed, first
attempt, median days pickup → delivered, delivered in < 3 days), `weeks` (13 upload
cohorts), `open` (at the carrier now, by days since pickup, late, stuck), `returns`
(failures of 90 days: handed back, scanned, still out, age of the unscanned),
`reasons` and `cities` (90 days). Plus `dormant`: inactive carriers holding open parcels.
`get_carrier_scorecard_parcels(market, carrier, kind)` lists the parcels behind a
number (`late` | `returns` | `dormant`), oldest first.

Judgements live in `src/lib/carriers/scorecard/view-model.ts` (tested), never in SQL:

| Pillar | Number | State |
|---|---|---|
| Livrés | delivered ÷ (delivered + failed) of parcels sent | vs `carrier_delivery_target_pct` (60); near = within 5 pts; « Provisoire » when > 10 % still on the road |
| En retard | on the road ≥ `carrier_late_days` (3) after pickup, or not picked up after 2 days | red as soon as one is stuck (no movement for `carrier_stall_days`, 5) |
| Retours à scanner | handed back by the carrier, never scanned in | red above 20 older than 7 days |

Reasons are grouped by who caused them: client / transporteur (incl. no reason given) /
nous. Compare uses shares only (higher = better), a gap under 3 points is a tie, and
« Ville par ville » keeps cities where each carrier finished ≥ 10 parcels.

## The account colour

`carriers.accent_color` (`#RRGGBB`): Tripoli and Navex `#1F5FBF`, Benghazi and Cosmos
`#C24E17` — the validated pair (CVD ΔE 25.2, white text ≥ 4.7:1). It paints the band on
Transporteurs and a solid city pill in the agent queue (`OrderCard`), which replaced the
thin hashed ring around the shared Darb logo (unreadable, owner 2026-10-03). The city
comes from the carrier's warehouse and is shown only for multi-account carriers.

## Retired

« Suivi transporteur » (`/warehouse/carrier-tracking`) and « Tableau livraison »
(`/in-delivery`) were deleted with their routes, hooks and the escalate/control-room
APIs. Both URLs redirect (302) to `/carriers`. `OrderTimeline` moved to
`components/orders/` (strings under `orderTimeline`); `orders.needs_carrier_followup`
stays in the schema, unwritten.

## Facts the page surfaced (2026-10-03)

- No return has been scanned in since 2026-08-18; Darb handed back 444 (Tripoli) and 98
  (Benghazi) failures in 90 days, median 6–7 days after the failure. The gap is the
  returns bench, not Darb.
- ~70 Libyan orders sit `uploaded`/`scanned` with no Darb booking; they are not counted
  as late (not at the carrier) — a separate clean-up.
- Darb cities are Arabic only (`to_city`); `city-names.ts` gives the French names.

## Follow-up (PR 2)

Point `get_dashboard_health`, the Connexions health badge, `/api/carriers/performance`
(« meilleur choix »), `refresh_delivery_zone_stats` and `get_carrier_true_cost` at
`carrier_parcel_outcome`, so every delivery rate in Ordra is the same number.
