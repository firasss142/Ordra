# Libya destination = Darb Assabil catalogue, one picker everywhere

## Findings (2026-09-07)

- Dexpress last shipped an order on 2026-05-30. Darb Assabil ships everything in Libya now
  (1,053 uploads in 120 days vs 324 for Dexpress, all before June).
- Yet every Libya city control still lists **Dexpress states** (128 rows): create-order form,
  order-detail city editor, mappings bind modal. All 2,881 Libya orders of the last 90 days carry
  `dexpress_state_id`; **zero** carry `darb_destination_id`. So the agent picks a city at creation
  and is asked again for the Darb area at upload.
- Live Darb directory (`GET /api/local/branches/public`, no auth) = 26 cities / 306 pairs.
  Our catalogue = 25 / 278. Diff: 26 new **مصراتة** areas (all accepted by
  `calculate/shipping`), plus `طرابلس/طرابلس` and `تاجوراء/تاجوراء` which Darb still rejects
  ("Unable to fetch branch"). All 278 existing pairs re-validated OK.
- "String didn't match the expected pattern!" is Darb's validator rejecting the **phone** on the
  contact-create call. The failing test order had `customer_phone = "00000000"`; the adapter turns
  that into `+218` and Darb rejects it. Nothing in the OMS validated the phone before sending,
  and the vendor message was surfaced without the field name.

## Decisions

1. **Darb (city, area) pairs are the Libya destination list everywhere.** Dexpress code paths stay
   for the fallback API contract but no UI offers Dexpress states any more.
2. One shared component, `DarbDestinationPicker`, in two variants: `popover` (a field that opens a
   searchable panel) and `inline` (search + list always visible, for the dispatch step). Two-level
   browse (cities → areas) when the query is empty, flat normalized search across cities and
   areas when typing, keyboard navigation, RTL-safe.
3. Orders created or edited in the OMS store `darb_destination_id` + canonical `customer_city`.
   The dispatch modal pre-resolves from that id — no second pick.
4. Phone validated at creation (Libya: 9 digits starting with 9 after stripping 218/0; Tunisia: 8
   digits) and again in the Darb adapter, which now refuses an invalid phone with a clear message
   and names the field Darb rejected when the vendor returns a validation error.
5. Catalogue refresh is a script (`scripts/refresh-darb-destinations.ts`): fetch live directory,
   validate new pairs against `calculate/shipping`, rewrite the JSON, upsert `darb_destinations`.

## Steps

1. Catalogue: +26 Misrata areas in JSON + DB; refresh script.
2. `lib/carriers/darb-destination-search.ts` (pure search/grouping) — tests first.
3. Adapter: phone guard + vendor field in message — tests first.
4. `POST /api/orders` accepts `darb_destination_id`; mappings route binds Libya to Darb.
5. `useDarbDestinations` hook + `DarbDestinationPicker` component — tests first.
6. Wire: CreateOrderModal, CustomerCard/OrderDetailPanel, DarbAssabilDispatchModal,
   PostCallActionSheet, MappingsPageClient. Delete DarbAssabilLocationPicker.
7. `coverageFor` treats a stored Darb id as covered.
8. i18n fr/ar, typecheck, test run, docs.

## Outcome (2026-09-07)

Done as planned. Catalogue: 304 pairs in JSON + `darb_destinations` (26 مصراتة zones added,
Darb still rejects `طرابلس/طرابلس` and `تاجوراء/تاجوراء`). New: `scripts/refresh-darb-destinations.ts`,
`lib/carriers/darb-destination-search.ts`, `hooks/useDarbDestinations.ts`,
`components/shared/DarbDestinationPicker.tsx`. Deleted `DarbAssabilLocationPicker`. Typecheck clean;
full suite 5,891 tests with the same 24 pre-existing failures as before this work.
