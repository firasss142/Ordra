# /in-delivery redesign

Manager-facing strategic view of orders in Phase-2 fulfillment. Complements
(does not replace) `/warehouse/carrier-tracking`, which keeps its warehouse-ops
cost/returns focus.

## Audience & access
- `super_admin` and `market_manager` — same gate as `/warehouse/carrier-tracking`.
- Agents and warehouse agents are redirected away (match `/orders/page.tsx`).

## Route
- New: `src/app/[locale]/(dashboard)/in-delivery/page.tsx` (server)
- New: `src/app/[locale]/(dashboard)/in-delivery/InDeliveryClient.tsx` (client)
- New: `src/app/[locale]/(dashboard)/in-delivery/[id]/page.tsx` (drill-down)

Sidebar: keep the existing "En livraison" sub-tab under Commandes pointed at
the filtered `/orders?...` view for power users, add a new item under
Logistique: "Tableau de bord livraison" → `/in-delivery`.

## Data shape

### GET /api/in-delivery/summary?market_id=
Returns a focused view for the dashboard:
```
{
  carriers: [
    { id, name,
      in_flight_total,
      in_flight_by_status: { dispatched, deposit, in_transit, to_be_returned },
      median_transit_hours,          // in-flight age, proxy
      delivery_rate_30d,             // same computation as existing endpoint
      return_rate_30d,
      stuck_count,
    }
  ],
  stuck_orders: [                    // top 20 across all carriers
    { id, external_id, customer_name, customer_city, status,
      carrier_id, carrier_name, last_update, age_hours,
      needs_carrier_followup }
  ],
  in_flight: [                       // top 100 most recently updated
    { id, external_id, customer_name, customer_city, status, carrier_id,
      carrier_name, updated_at, needs_carrier_followup }
  ],
  unassigned_carrier_count: number,
}
```

Reuses the aggregation approach from
`/api/warehouse/carrier-tracking/route.ts` — we derive the same numbers from
`orders` + `order_history`, but shape the payload around the three UI
sections.

### GET /api/orders/[id]/timeline
Returns the stage journey for one order:
```
{
  order: { id, external_id, status, carrier_name, created_at, updated_at,
           needs_carrier_followup },
  stages: [
    { status: 'dispatched', at: ISO, duration_hours: number | null }, ...
  ],
  history: [
    { id, status_from, status_to, actor_type, note, created_at }, ...
  ]
}
```
Derived purely from `order_history` rows. Manager-accessible: must belong to
the caller's market unless `super_admin`.

### POST /api/orders/[id]/escalate-carrier
Body: `{ note: string }`
- Appends one `order_history` row (actor_type='manager', note prefixed with
  `[escalation] `, status unchanged — `status_from = status_to = current`).
- Sets `orders.needs_carrier_followup = true`.
- Returns `{ ok: true }`.

## Migration

`supabase/migrations/20260607000002_in_delivery_followup_flag.sql`
- Adds `orders.needs_carrier_followup BOOLEAN NOT NULL DEFAULT false`.
- Partial index on `(market_id, carrier_id) WHERE needs_carrier_followup`.

## Hooks (client)

- `useInDeliverySummary(marketId?)` — SWR, 60s refresh, mirrors
  `useCarrierTracking` conventions.
- `useOrderTimeline(orderId)` — SWR, on-demand, no polling.

## Components

- `CarrierSplitCards` — grid of carrier performance cards (top section).
- `StuckAlertsList` — grouped-by-carrier list with escalate button.
- `InFlightTable` — recent in-flight orders, row-expand → `OrderTimeline`.
- `OrderTimeline` — horizontal stage bar with time-per-stage (shared by
  dashboard expand and `/in-delivery/[id]` page).
- `EscalateCarrierModal` — note input + POST.

All inline styles per design-system.md — no Tailwind, no CSS modules.

## Out of scope for this pass
- Map / city-level geo.
- Bulk escalate.
- Carrier webhook replays (already at /admin/logs).

## Tests
- API: 3 route.test.ts (summary, timeline, escalate) — role checks, market
  scoping, happy path.
- No component tests in this pass (follow existing pattern — API-heavy TDD,
  components covered via typecheck + manual).
