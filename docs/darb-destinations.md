# Libya destinations — the Darb Assabil catalogue and the one picker

Since June 2026 every Libyan parcel ships with Darb Assabil (Dexpress last shipped on
2026-05-30). The Libya "city" of an order is therefore a Darb **(city, area) pair**, chosen
once, from one control, everywhere an order is created or edited.

## Where the list comes from

| Layer | What | Refresh |
|---|---|---|
| `src/lib/carriers/darb-assabil-areas-data.json` | 25 cities / 304 validated pairs, bundled in the app | `scripts/refresh-darb-destinations.ts` |
| `darb_destinations` table | the same pairs with ids; `orders.darb_destination_id` points here | same script with `--db` |
| `GET /api/darb/destinations` | active rows for the UI (`useDarbDestinations`) | — |

The vendor's public branch directory (`GET /api/local/branches/public`, no auth) lists every
branch and its zones, but it also lists pairs the shipment API rejects — a city filed as its own
zone (`طرابلس/طرابلس`, `تاجوراء/تاجوراء` → "Unable to fetch branch"). The refresh script keeps a
pair only after `POST /api/local/shipments/calculate/shipping` (read-only) accepts it.

```
npx tsx --env-file=.env.local scripts/refresh-darb-destinations.ts               # diff only
npx tsx --env-file=.env.local scripts/refresh-darb-destinations.ts --write --db  # apply
npx tsx --env-file=.env.local scripts/refresh-darb-destinations.ts --revalidate --write --db
```

Pairs that disappear from the directory are **deactivated**, never deleted: orders reference the
row id. Last refresh: 2026-09-07 (26 مصراتة zones added; all 278 previous pairs re-accepted).

## The picker

`src/components/shared/DarbDestinationPicker.tsx`, pure logic in
`src/lib/carriers/darb-destination-search.ts`.

- **Browse**: cities first (طرابلس and بنغازي pinned, then catalogue order). A single-zone city is
  one click; a multi-zone city opens its zones, centre first, with a back button.
- **Search**: one flat search over cities and zones with the intake's Arabic folding
  (`normalizeCityName`): سوكنه finds سوكنة, الابرق finds الأبرق.
- **Keyboard**: arrows, Enter, Backspace-on-empty steps back, Escape closes and is stopped
  there so the dialog behind does not close with it. Typing on the closed field opens it with
  that text. A footer shows the keys (desktop only).
- **Feedback**: the matched letters are highlighted in every result; a result count sits in the
  footer; the last five picks come back as chips (per browser, `localStorage`); the field shows
  the city and the zone as two parts with a clear button.
- Two variants: `field` (a control that opens a dropdown — create form, order detail, lead form,
  mappings bind) and `inline` (always visible — the dispatch step; with no city known, cities
  and zones sit side by side so the zone list appears as soon as a city is chosen).

Consumers: `CreateOrderModal` (Libya), `OrderDetailPanel/CustomerCard` (Libya),
`DarbAssabilDispatchModal`, `MappingsPageClient` (Libya bind), and the CRM `NewLeadModal`
(Libya — a lead stores the zone name, which the conversion's intake resolver maps to the
pair; it used to store a French governorate label like "Tripoli" that nothing could resolve).

## Data flow on an order

1. Create / edit / bind writes `darb_destination_id` and snapshots the catalogue's spelling into
   `customer_city` (`POST /api/orders`, `PATCH /api/orders/[id]`, `POST /api/mappings/cities`).
   The other two destination pointers (`city_id`, `dexpress_state_id`) are cleared.
2. Dispatch (`DarbAssabilDispatchModal`) ships the bound pair as is — no second pick. Only an
   order without a bound pair falls back to resolving `customer_city` (exact city → zone name →
   alias) and, for a multi-zone city, asks for the zone.
3. `coverageFor(city, dexpressStateId, darbDestinationId)` treats a bound pair as covered.

## Phone

Darb validates the receiver phone against an E.164 pattern and answers only
"String didn't match the expected pattern!". The OMS now refuses a bad number twice before
that can happen: `CreateOrderModal` (Libya: 9 digits starting with 9 after stripping
218/0; Tunisia: 8 digits) and `DarbAssabilAdapter.formatPayload` (`toLibyanE164` in
`lib/carriers/phone.ts`). A vendor validation error that does get through now names the
rejected field: `… (champ : phone)`.
