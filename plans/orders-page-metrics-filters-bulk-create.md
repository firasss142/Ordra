# Orders page — metrics, date filter, facet counts, bulk bar, create panel

Six changes to `/orders`, decided with the user on 2026-08-13. Every open question
below was answered explicitly; the "Decided" lines are not inferences.

## Decisions

| Question | Answer |
|---|---|
| Tile set | 5 tiles: **Aujourd'hui · Téléchargées · Rejetées · Livrées · À rappeler**. `waiting` ("En attente") is removed and replaced by `delivered`. `toRecall` stays. |
| Default period for outcome tiles | **Today.** |
| Which tiles follow an applied date range | **Only the outcome tiles** (Téléchargées, Rejetées, Livrées). `Non assignées`, `Taux de confirmation` and `À rappeler` remain live "maintenant" figures. |
| Date basis | **Intake date (`orders.created_at`)** — the same column the table already filters on. No table changes. |
| Facet option counts | **Respect other active filters** (standard faceted search: each option counted with every other filter applied, but not its own facet's selection). |
| Bulk bar | **Inside the table card**, docked between the last row and the pagination — the products-page pattern. |
| Create panel | **Restyle only** — same fields, validation and submit flow. |

### One consequence, accepted by the user

With intake dating, `Livrées` counts *orders created in the window that are now
delivered*, not *orders delivered in the window*. Today's real production figures:
9 orders were delivered today, but 0 orders created today are delivered, because
delivery takes days. So the Livrées tile will read 0 or near-0 on a default
(today) view and only becomes meaningful over a wider range. This was shown with
these exact figures before the choice was made and chosen deliberately, because
it keeps the tile and the table it opens in exact agreement — the invariant the
KPI strip was rebuilt around.

## Steps

### 1 — Tile set: replace `waiting` with `delivered`
- `StatusCounts`: drop `waiting`, add `delivered`; add `periodFrom`/`periodTo` echo.
- `status-counts/route.ts`: count `delivered`, apply the date window to the three
  outcome counts only.
- `OrdersKpiStrip`: `KpiTile` union loses `waiting`, gains `delivered`; `STAGES`
  reordered to today · uploaded · rejected · delivered · toRecall.
- `kpi-tiles.ts`: `TILE_FILTERS.delivered = { preset: "all", statuses: ["delivered"], agentId: null }`.
- i18n: `orders.kpi.delivered` (fr + ar), drop `waiting`.

### 2 — Outcome tiles follow the applied date range
- `OrdersPageClient` passes `date_from`/`date_to` into the status-counts SWR key.
- Route defaults the window to today when neither bound is given.
- Tiles render the active window as their period line instead of "aujourd'hui".
- Queue tiles keep saying "maintenant" and ignore the window entirely.

### 3 — Custom date range in the Date facet
- Date facet menu gains a "Personnalisé" section: two `<input type="date">`
  (Du / Au) + Appliquer, seeded from the current `dateFrom`/`dateTo`.
- Presets stay; picking one clears the custom inputs and vice-versa.
- Guard: `from > to` is rejected inline, never submitted.

### 4 — Counts on every facet option
- New RPC `get_order_facet_counts(...)` returning one JSON object with a count
  per option across status / agent / city / product / carrier.
- Each dimension is counted with all other filters applied but **not its own**,
  so the number reads "what you'd get if you picked this".
- New route `/api/orders/facet-counts`; `OrdersFacetBar` renders the number on
  the trailing edge of each option row.

### 5 — Bulk bar inside the table card
- `OrdersTable` gains a `bulkBar?: React.ReactNode` prop rendered directly above
  `<Pagination>`, mirroring `ProductsTable`.
- `OrdersBulkBar` restyled to the products bar: light `surface-card`, top border,
  ghost buttons, green selection dot, trailing `✕`. Assign menu opens downward
  now that the bar is no longer pinned to the viewport bottom.
- Destructive "Annuler" keeps its critical colour — it is the one action that
  must not read as a ghost button.

### 6 — Create-order panel restyle
- Swap `surface-card`/`line-subtle`/`ink-*` for the orders-page `oms-*` token set.
- Primary CTA becomes brand green (matches "Créer la commande" on the page header).
- Section headers, inputs, focus rings and error banner aligned to the facet bar
  and KPI strip treatment. No field, validation or submit change.

## What shipped

All six steps are in. Files touched:

- `lib/orders/kpi-tiles.ts` — `delivered` replaces `waiting`; new `KpiWindow`,
  `resolveKpiWindow`, `isOutcomeTile`. A tile patch now carries its date bounds.
- `api/orders/status-counts/route.ts` — `delivered` added, `waiting` removed,
  outcome counts windowed on `created_at`, window echoed back as `window`.
- `components/orders/OrdersKpiStrip.tsx` — five stages in the asked-for order,
  period label per tile, bar scales keyed on the rendered period.
- `components/orders/OrdersFacetBar.tsx` — `DateRangeFields` footer on the Date
  facet, per-option counts, one `dateLabel` shared by the chip and the button.
- `supabase/migrations/20260904000001_get_order_facet_counts.sql` + matching
  `api/orders/facet-counts/route.ts` — applied to prod, verified at ~16 ms.
- `lib/orders/search-query.ts` — `termToLegs` / `searchToLegs`, so the facet
  counts and the list agree on what a search means.
- `components/orders/OrdersBulkBar.tsx` + `OrdersTable.tsx` — bar docked in the
  card via a `bulkBar` slot; assign menu now opens downward.
- `components/orders/CreateOrderModal.tsx` — fully migrated off the
  `surface-*`/`ink-*` set onto `oms-*`; CTA is brand green.
- `messages/fr.json`, `messages/ar.json` — `kpi.delivered`, `kpi.period*`,
  `facets.custom` / `dateFrom` / `dateTo` / `apply` / `invalidRange`;
  `kpi.waiting` removed.

### The tile row today, on live data

| Market | Aujourd'hui | Téléchargées | Rejetées | Livrées | À rappeler |
|---|---|---|---|---|---|
| Libya | 52 | 9 | 17 | **0** | 38 |
| Tunisia | 0 | 0 | 0 | **0** | 338 |

Livrées reads 0 on the default (today) window exactly as predicted above — an
order created today is not delivered yet. Widening the range to 1 Jul → 12 Aug
puts Libya's Livrées at 74. The tile is only informative over a wider window,
which is the trade accepted in exchange for tile/table agreement.

## Round 2 — create-order panel rebuilt to the mockup

Step 6 above was a restyle. The user then supplied a full redesign mockup, so
the panel was rebuilt rather than repainted. Decisions taken with them:

| Question | Answer |
|---|---|
| Marché field | **Removed.** The sidebar scope switcher is the only source. |
| super_admin scoped to all markets | **Blocked**, with a pointer to the sidebar and a disabled submit. |
| Variant × quantity | **Quantity stays editable.** A variant sets unit price + label only. |
| Manual total | **Allowed and audited** — an `order_history` row records the override. |
| Existing-customer card | **Fills name, city, address** on request. |

### Server changes this forced

- `api/orders/route.ts` no longer does `quantity = variant.quantity`. That line
  meant the panel could show "3 × 25,50 = 76,50" and save one unit at 25,50 —
  the operator was shown one number and the business recorded another.
- The same route now accepts a `total_price` that differs from quantity × unit
  price, **from managers and admins only** (agents cannot rewrite revenue), and
  writes a `pending → pending` history row naming the old and new figures.
- New `api/customers/lookup` — aggregates orders by national phone digits.
  Distinct from `api/customers/search`, which only sees follow-up-eligible
  orders and is therefore blind to a customer whose orders all delivered.

### Bug found and fixed while testing

`update()` spread `{ ...s, [key]: value, error: null }`. Assignment order meant
every `update("error", …)` immediately nulled the message it had just set, so
**this panel had validation messages in the code and none ever on screen** —
submitting with a missing field simply did nothing. Pre-existing; the new tests
caught it. Fixed by ordering `error: null` before the computed key.

### Also changed

City is now required (the mockup marks it `*`) and both markets share one
searchable combobox — Libya's raw always-open list is gone.

## Testing

TDD per `CLAUDE.md`. Test-first for each step:
- `kpi-tiles.test.ts` — delivered mapping round-trips, waiting is gone.
- `OrdersKpiStrip.test.tsx` — 5 tiles in order; queue tiles ignore the window.
- `OrdersFacetBar.test.tsx` — custom range applies/validates; option counts render.
- `OrdersBulkBar.test.tsx` — actions still fire from the docked bar.
- Gate on `npm run typecheck` + the touched suites (repo has a known pre-existing
  failing baseline elsewhere; do not gate on the full run).
