# Performance › Commandes — build plan (2026-10-04)

Source of truth: `prototypes/performance-commandes-v4.html` (owner: "implement following exactly the
prototype"). Decisions behind it: memory `performance-section-restructure`, prototype header.

## What ships

- Route `/{locale}/performance/orders` (super_admin + market_manager; agents → /queue).
- Sidebar: new group « Performance » = Commandes (new) · Équipe (`team/performance`, moved from
  Équipe) · Livraison (`carriers`, moved from Livraison). The rest of the prototype's sidebar
  (Opérations regrouping) belongs to the sidebar redesign and is NOT part of this build.
- The page, block for block: header + one date button (presets, whole months, two-month calendar),
  filter bar (A products × agents, Comparer: Non · Autres produits · Autres agents · Autres dates),
  hero waffle, « L'argent » (super_admin only), « À regarder » (max 3), « Où partent les commandes »
  (flow), « Les plus grosses fuites » (top 4), « Par produit » / « Par taille », « Par agent »,
  « Jour après jour », « Comment lire cette page », drill drawer.

## Data — one definition, shared with Produits and Transporteurs

`get_orders_performance(market, from, to, tz)` (new migration, SECURITY DEFINER, same market guard
as `get_product_cohort`): orders RECEIVED in [from, to] in market days, each followed to today —
status, `carrier_parcel_outcome.outcome` + failure cause, assigned_to, rejection reason + sub-reason,
total_price, city; product lines from `product_order_lines` (share by line value) + attribute
variants; ad spend per day (market-wide); agent names/colours; first order date.

Buckets (prototype letters) from `lib/products/cohort.ts#bucketOf`:
d delivered · f failed · b withdrawn (cancelled before pickup) · r in flight · c calling ·
u to upload · x rejected (real) · j rejected « jamais réelle » (sub-reason non_commande,
simple_info, numero_hors_service, doublon, numero_invalide) · s deleted / cancelled before upload.
Confirmation = up ÷ (up + x + j) (= Produits: every rejected order, deleted/cancelled out).
Delivery = d ÷ (d + f). Final = 1 − (c + u + r) ÷ n. Arrows only when both periods ≥ 30 orders,
≥ 90 % final, and the previous period starts on/after the first order.

Agent = `orders.assigned_to` (Salle de contrôle and Produits' ownership). Ranked by delivered per
100 REAL orders (n − junk); < 30 orders = not ranked.

Money (`lib/calculations/orders-performance-money.ts`, server only, super_admin only — the API
omits it for anyone else): Σ `orders.total_price` × the selected products' line share (whole price
with no product filter). Livré = d, Perdu en retours = f + b (arrow in points of shipped value),
Encore en route = r.

## Pipe

RPC (1–3 calls: A, previous period, B dates) → `lib/performance/orders/*` (pure, unit-tested) →
`GET /api/performance/orders` (the whole view model) and `GET /api/performance/orders/drill`
(breakdowns + the order list, 40 at a time) → `components/performance/orders/*` (prototype markup,
`performance-orders.css` scoped under `.pco`) → i18n `performanceOrders` fr + ar (parity test).

## Departures (deliberate)

- The drawer's « Ouvrir dans Commandes » opens Commandes on the same received dates (+ the agent or
  product when exactly one): the orders list filters by status, not by cohort outcome, so it cannot
  reproduce the exact list. Each order row in the drawer opens that order.
- Sizes (« Par taille », size chips) work on attribute variants; none exist in production yet, so
  they stay dormant until someone creates sizes.
- Migration is paste-ready SQL for the owner (MCP apply_migration is declined).
