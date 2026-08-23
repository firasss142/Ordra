# Entrepôt — Darb sticker scanning, end to end · Préparation accuracy

## Context

Three asks: make the Darb Assabil pre-printed sticker scan actually work —
calling the right Darb API, per `docs/darb-warehouse-workflow.md` — behind a
dedicated scan surface, UI and backend; make every figure on **Préparation**
true; and **tell the agent which colour of roll to use before they pick up the
parcel**, with the API as the official source, verified against the poster.

**The core gap: the OMS never talks to Darb at scan time.** `scan_order_out`
writes `orders.carrier_sticker_ref` into our own table and stops. Migration
`20260822000001_warehouse_scan_prereqs.sql` says so in its own header ("It is
NOT pushed to Darb here"). That means **step 5 of the workflow never happens**:

> | 5 | **Scan the sticker** | Warehouse | Sticker number replaces the `SH…` reference. **Parcel is now routable.** |

Without the PATCH the parcel is not routable and the operator still re-does the
scan in Darb's own app — the entire thing this feature was meant to remove.

---

## The colour question — ANSWERED BY THE API

Probed live 2026-08-22 with `scripts/probe-darb-branches.ts` (read-only, GET).

**`GET /api/local/branches/public` returns a `color` hex on every branch
record.** It is absent from the vendor's Postman schema and from the
integration guide, which is why nothing found it before — the documented
schema is not the whole payload (`toZoneCode` behaves the same way).

Both accounts return an **identical** 38-branch directory, so the colour
scheme is company-wide. "Tripoli ≠ Benghazi" is about *prices*: the harvested
`darb_shipping_rates` show Benghazi quotes are a different list entirely
(بنغازي 0–15 vs 20–35 · البيضاء 20 vs 35 · الكفرة 40 vs 50). Colours are shared;
prices are not. **Nothing is typed by hand and nothing is guessed.**

### API colour ↔ poster card — 9 for 9

| API `color` | Branch groups | Poster card |
|---|---|---|
| `#d80a0a` rouge | TR · SA1 · SH2 · SH3 · SH4 · TDSW · HR · EXCU | طرابلس + ضواحي |
| `#5a3001` brun | HW | جنوب طرابلس |
| `#fc6401` orange | ZWR · ZWY · ZY | غرب طرابلس |
| `#f9fc01` jaune | KHM · MS | شرق طرابلس |
| `#ed00ff` magenta | WS · ZW | المنطقة الوسطى |
| `#339307` vert | BN · BNN · BYD · DRN · MRJ · QBA · TBR | المنطقة الشرقية |
| `#091d96` bleu marine | JB | الجبل الغربي |
| `#0cbceb` cyan | SB | المنطقة الجنوبية |
| `#8fff00` vert lime | JL · KF | الجنوب الشرقي |

The API supplies the colour and the branch grouping; the poster supplies only
the human card NAME, which the API does not carry. The card names are stored
alongside and asserted against this table by a fixture test.

Two signals were tested first and rejected — recorded so they are not retried:

| Rejected signal | Why |
|---|---|
| `toZoneCode` (8 values) | Merges what the colours keep apart: zone `TR` spans طرابلس (red) *and* ترهونة/بني وليد (brown); zone `WA` spans اجدابيا (magenta) *and* الكفرة (lime). |
| `breakdown.branchToBranch` | A radial distance band from the *origin* branch, so it differs per account and cuts across colours. |

**`toBranchGroup` is the join key**: 19 values live, each mapping to exactly one
colour, present on 823/823 mirrored shipments from creation — before booking,
before handover — and identical across both accounts.

### Resolution chain at the bench

The directory resolves **56 of our 66** destination strings outright, including
the 45 that are areas filed as cities (جنزور → TR rouge · شحات → BYD vert ·
اوباري → SB cyan). Normalisation (strip standalone hamza, tolerate the
اِمساعد/مساعد alef, match the compound `جالو اوجلة` by token) plus a short alias
table (`الجبل الغربي`→JB, `ضواحي طرابلس (15)`→TR, `مكتب طرابلس`→TR,
`المنطقة الوسطي \\ تخفيض`→WS) takes it to 64.

1. `carrier_extra.darb_branch_group`, cached from a previous resolve;
2. the live shipment GET **already made to resolve the `_id`** → `toBranchGroup`;
3. `darb_shipments` mirror by `order_id`;
4. `darb_branches` directory → `(city, area)` → branch group → colour;
5. branch has no colour of its own (only `EXP` زناتة and `RGG` الرياضية, both
   Tripoli) → the city's colour when every other branch there agrees, flagged
   as inferred;
6. nothing resolves (`القربوللي`, `الشقيقة` — genuinely absent from Darb's
   directory) → **« couleur à confirmer »**, never a guess.

### Other live facts — probed 2026-08-22 against production (`vshynigvgrlihngozuwb`)

| Fact | Consequence |
|---|---|
| `PATCH /api/local/shipments/reference/:id` with `{reference}` is the call Darb's own app makes; permission verified by `scripts/probe-darb-reference-permission.ts`, binding confirmed by `probe-darb-reference-validation.ts` | This is the endpoint, addressed by the internal `_id`. |
| Darb accepts **any** number — one 2.4 M outside our stock bound with no error | The OMS must be the guard. |
| The list endpoint accepts `?reference=` | An order with no stored `_id` is still resolvable. |
| 407 LY our-warehouse `uploaded` orders — only **84** carry `carrier_extra.darb_assabil_id` | 323 need the reference lookup first. |
| **324 of the 407 predate 2026-06-01**; 323 carry plain-digit references, none have a status slug; the mirror knows 0 of them | A historical import. Plain digits are assigned at booking → handed over months ago. Not bench work. |
| The other 83 all have a Darb id: 53 `pending`, 14 `released`, 16 unknown | The 14 `released` are out for delivery and must leave the bench. |
| Sticker numbers are 6–8 digits, no leading zeros (708×7, 91×8, 62×6) | Roll ranges are plain integers; the prototype's `000000542713` is mock. |
| `carriers.api_credentials` is an encrypted scalar; `buildConfig()` decrypts it | Server-side only; `src/app/api/darb-assabil/sync-batch/route.ts` is the route pattern. |
| Both Darb rows share code `darb_assabil`, both `supplies_own_labels = true` | Resolve by `carrier_id`, never by code. |
| `btree_gist` is installed | The no-overlapping-rolls exclusion constraint is available. |

### Decisions taken (stated, not assumed)

- **Darb first, then commit.** The PATCH runs *before* `scan_order_out`. The
  other order would leave stock deducted, status `scanned`, and a parcel Darb
  cannot route. Bound-then-local-failure is the harmless direction: re-scanning
  the same sticker rebinds identically (workflow rule 6).
- **No silent local-only fallback.** A sticker recorded on our side but not at
  Darb is worse than a refused scan, because it *looks* done.
- **The API owns the colour; we own only the roll's number range.** The branch
  directory is a mirror, refreshed by script — never hand-edited.
- **Roll enforcement activates once a roll exists.** With zero registered rolls
  the bench would dead-lock on day one, so the guard enforces only when the
  carrier has at least one open roll, and the panel carries a standing amber
  notice while none does. No quiet degradation.

---

## 0. Probe first — read-only, no writes

**DONE.** `scripts/probe-darb-branches.ts` ran read-only against both accounts
and found the `color` field, settling the whole question — see above. Its output
is in `report/darb-branches.json`. The script is kept and promoted to the
directory sync used by step 1.

## 1. Routing directory + sticker rolls

`supabase/migrations/2026…_darb_routing_and_sticker_rolls.sql`

```
darb_branches                        -- MIRROR of GET /api/local/branches/public
  branch_group, branch_code, city, area, color   -- color straight from the API
  PRIMARY KEY (branch_group, city, area)
  -- identical for both accounts, so not keyed on carrier_id

darb_zones                           -- the 9 cards: the API's colour + our name
  color_hex PRIMARY KEY              -- the API is the authority on membership
  name_ar, name_fr, sort_order       -- the poster supplies only the name

sticker_rolls                        -- rolls belong to an ACCOUNT
  id, carrier_id → carriers, color_hex → darb_zones
  band_code                          -- what is printed on the roll band
  label, range_start bigint, range_end bigint      -- CHECK end >= start
  status default 'open'              -- open | exhausted | void
  opened_by, opened_at, closed_at
  EXCLUDE USING gist (carrier_id WITH =,
                      int8range(range_start, range_end, '[]') WITH &&)
    WHERE (status <> 'void')         -- two rolls cannot claim the same number
```

- `get_sticker_rolls(p_market_id)` → each roll with **derived** `consumed`,
  `remaining`, `next_number`, counted from `orders.carrier_sticker_ref`.
  Derived, never stored: consumption is not a fourth stock-like mutation path.
- `scan_order_out` gains two checks, between the duplicate check and the stock
  read, so the RPC stays the single authority no route can bypass:
  - `Sticker % is not in any registered roll`;
  - `Sticker % is from the % roll, this parcel routes to %` — **the check that
    catches the real floor mistake**, the wrong-colour roll.
- `precheck_scan_out(p_order_id, p_actor_id, p_sticker_ref)` → JSON verdict,
  called **before** touching Darb so a doomed scan never causes a carrier write.

`src/lib/carriers/darb-routing.ts` — `resolveZoneFor(order)` implementing the
five-step chain above; returns branch group, zone, roll and colour, or an
explicit `unknown`.

`src/app/api/warehouse/sticker-rolls/route.ts` — GET list, POST open, PATCH
close, gated by `canScanWarehouse` (opening a roll is floor work).

`src/components/warehouse/console/StickerRollsDialog.tsx` — modelled on the
existing `StockCountDialog`. Pick the account and the zone (colours come from
the API, shown as swatches — never typed) and enter the number range. Shows
which zones have no open roll yet, per account.

## 2. The colour, where the agent needs it

- **Préparation row** — colour dot + zone name beside the destination, so the
  queue reads as roll batches. Rows whose zone will not resolve say so.
- **Scan station** — the loudest thing above the input:
  `● ROULEAU VERT · المنطقة الشرقية · reste 58 · prochain 889230`.
- **Refusal by name** — *« Ce sticker vient du rouleau ORANGE (غرب طرابلس).
  Ce colis part vers بنغازي — rouleau VERT. »*
- **Picking list** — grouped by roll colour, the order parcels get stickered in.

## 3. The Darb call

`src/lib/carriers/darb-assabil-http.ts` (new) — lift `baseUrl`, `buildHeaders`
and the JSON fetch out of `darb-assabil-tracking.ts`; tracking imports it. No
behaviour change, one place for the three headers.

`src/lib/carriers/darb-assabil-reference.ts` (new)

- `resolveDarbShipmentId(reference, config)` → `GET /api/local/shipments?reference=…&limit=1`
  → `results[0]._id` **and `toBranchGroup`**, in one response. Single-value
  params only — repeated params silently return wrong data (`docs/darb-assabil-sync.md` §1).
- `bindDarbReference(internalId, sticker, config)` → the PATCH. `HTTP 200 ≠
  success`: the envelope's `status === true` decides. Returns the vendor message
  on refusal so the bench reads Darb's own words.

## 4. `scan-out` route — order of operations

`src/app/api/warehouse/scan-out/route.ts`

1. Load the order with its carrier (`code`, `supplies_own_labels`,
   `tracking_number`, `carrier_extra`, `carrier_status_slug`).
2. Carrier-warehouse short-circuit — unchanged.
3. `precheck_scan_out` → refuse now on duplicate / not-in-roll / wrong-roll /
   status / market.
4. Darb only, sticker present:
   - resolve `_id` from `carrier_extra.darb_assabil_id`, else
     `resolveDarbShipmentId(tracking_number)`; write the id **and the branch
     group** back into `carrier_extra`, so each is resolved once;
   - still nothing → `DARB_SHIPMENT_UNKNOWN` (409);
   - `bindDarbReference` → on refusal `DARB_BIND_FAILED` (502) carrying Darb's
     message. **Nothing has been committed.**
5. `scan_order_out` — stock, status, sticker; one `inventory_log` row, one
   `order_history` row. Unchanged contract; the note now carries the sticker.
6. If 5 fails after 4 succeeded, say so plainly: *sticker lié chez Darb, la
   sortie n'a pas été enregistrée — rescannez le même sticker.*

New `ScanErrorCode`s in `src/lib/preparation/tray-state.ts`:
`STICKER_NOT_IN_ROLL`, `STICKER_WRONG_ROLL`, `DARB_SHIPMENT_UNKNOWN`,
`DARB_BIND_FAILED`.

`orders.carrier_sticker_bound_at` records when Darb accepted it — so a sticker
we merely recorded and one Darb actually knows stay distinguishable.

Tunisia is untouched: no sticker, our own label, `label_prints` guard stays.

## 5. The scan surface — panel **and** station

`src/components/warehouse/console/ScanStation.tsx` (new) — the whole experience
once, `variant: "panel" | "station"`: colis-en-main tile · **roll strip with the
required colour** · keyboard-wedge input with a camera toggle reusing the
existing but currently unmounted `src/components/warehouse/QrScanner.tsx`
(`html5-qrcode` is already a dependency) · one result tile with five distinct
outcomes (bound / wrong roll / refused by us / refused by Darb /
bound-but-not-committed), never a raw Postgres string · last-scans list · the
standing "ne jamais saisir un numéro à la main" warning.

`PreparationConsole` renders `variant="panel"`, deleting ~120 lines of inline
scan markup. New route `src/app/[locale]/(warehouse)/warehouse/scan/page.tsx`
renders `variant="station"`: full-bleed, large type, tablet-usable, Échap back
to Préparation. Reached from a header button on both shells, and added to the
agent tab band — that role has no sidebar, so the band is its only navigation.

## 6. Préparation — the accuracy pass

Each item is a defect I verified, not a preference.

| # | Defect | Fix |
|---|---|---|
| a | **"Scannées aujourd'hui" is session-local** — `scans.filter(ok).length` resets on reload and ignores every other operator | Read `scanned_today` / `scanned_yesterday` from `get_warehouse_day_stats`, already wired through `summary.ts` |
| b | **`DAILY_GOAL = 40` hardcoded** | Settings key `goal_daily_scanned` per market ("all cost variables from DB settings — never hardcode") |
| c | **One sentence mixes two scopes** — `kpiQueueSub` renders regions from the loaded page and orders from the server; filters, product list and grouping work on the loaded 100 while the KPI says 407 | Zone breakdown and product list come from `get_warehouse_queue_stats`; filters query the server; the table states how many of how many are loaded |
| d | Page prefetches 200 rows, the client immediately refetches 100 | One shared limit constant |
| e | **Age measured from `created_at`** — the intake clock, not the bench clock. An order created three weeks ago and uploaded this morning reads "21 j en retard" | Measure from the `uploaded` event; same clock in `get_warehouse_queue_stats` |
| f | **Two definitions of "late" on one screen** — the pill uses the server's `late_prepare + never_scanned`, the row filter uses `hours >= 48` on the loaded page | One definition, server-side |
| g | **Dead affordances** — "Liste de picking", "Imprimer étiquettes", "Créer un lot" have no handler | Wire the picking list (grouped by roll colour) and TN label printing to the existing `/api/warehouse/label-prints`; remove "Créer un lot" until lots exist |
| h | **Unscannable rows look identical to scannable ones** — the 14 `released` and the 323 with no resolvable Darb id refuse at the bench with no prior warning | `get_to_label_orders` returns `carrier_status_slug` and whether a Darb id exists; the row carries a chip |
| i | **Search ignores the sticker**, though the prototype's placeholder promises it | Include `carrier_sticker_ref` and `tracking_number`, and show them on the row |
| j | **Region grouping uses our own `libya-regions.ts` three-region guess** | Group by the nine Darb zones instead — the carrier's own geography, which is also the roll grouping |

## 7. The 324-order backlog — read-only reconciliation

`scripts/reconcile-bench-backlog.ts` — for every LY our-warehouse `uploaded`
order: resolve the `_id` (stored, else by reference), `GET` the shipment, write
a CSV to `report/` plus a breakdown by real Darb status. **Zero writes, GET
only.** I bring you the numbers and a proposed closing migration; nothing
changes without your sign-off. The eventual write path is the sanctioned one,
`promote_darb_status`.

## 8. Verification

- **TDD, tests first**: RPC level (roll membership, wrong roll, range overlap,
  duplicate, conditional label guard), route level (Darb called before commit,
  id + branch-group resolution and write-back, each error code, Tunisia
  unchanged), lib level (the five-step zone resolution incl. the `الزاوية`
  ambiguity and the six junk city strings), component level (the five scan
  outcomes, colour resolution, KPIs sourced from the server).
- A fixture test asserting `darb_zones` reproduces the poster exactly, so the
  table cannot drift from the photo without a test failing.
- `npm run typecheck`; `npm run test:run` — measured baseline is **24
  pre-existing failures**; nothing new. `npm run build`.
- One dev server only, headless login by injecting an `@supabase/ssr` cookie
  minted with the service key; capture `/fr/warehouse/preparation` and
  `/fr/warehouse/scan` at 1440×900 into a review artifact.
- **The live Darb write is the one thing I stop and ask about.** Everything is
  built and unit-tested against recorded fixtures first; then I ask before the
  first real PATCH — one bind against one `pending` shipment, verified by GET
  and reverted, exactly as `probe-darb-reference-validation.ts` does.

Plan copied to `Ordra/plans/entrepot-scan-and-preparation.md`.

## Out of scope

The closing migration for the 324 backlog orders (needs the reconciliation
result first) · re-harvesting shipping rates (fees are already calculated, per
your instruction) · Retours, Journal, Stock, Aujourd'hui beyond the shared
queue-stats RPC · pushing anything to Darb other than the reference.
