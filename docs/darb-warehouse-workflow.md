# Darb Assabil — warehouse workflow (product → ready to ship)

Operational context for the warehouse agent. Written from live API evidence, not
assumptions — see `docs/darb-assabil-sync.md` for the technical detail.

---

## What the pre-printed QR sticker is

Darb Assabil supplies **rolls of pre-printed stickers**. Each carries a QR code and a
number printed beside it (e.g. `1213123`), plus a region band (e.g. `TR / المنطقة الشرقية`).

The key thing to understand: **a sticker means nothing until it is scanned.** Out of the
roll it is just a number. Scanning binds that number to one specific shipment, and from
that moment on Darb tracks the parcel by it — that is what makes the parcel routable.

Evidence it's a physical roll: the numbers we've used cluster in tight blocks
(`889188–889277`, `496946–496957`), not in creation order — a roll being worked through.

---

## The workflow

| # | Step | Who | Result |
|---|---|---|---|
| 1 | Confirm the order by phone | Agent | status `confirmed` |
| 2 | Upload to Darb | OMS | Darb creates the shipment with a temporary `SH…` reference → status `uploaded` |
| 3 | Pack the product into a parcel | Warehouse | — |
| 4 | Peel the next sticker off the roll, stick it on the parcel | Warehouse | — |
| 5 | **Scan the sticker** | Warehouse | Sticker number replaces the `SH…` reference. **Parcel is now routable.** |
| 6 | Hand over to Darb | Warehouse → Darb | Darb staff *book* / accept it |
| 7 | Darb moves it | Darb | `processing` → `on-branch` → `released` (out for delivery) → `completed` |

Step 5 is the one that matters here. It is currently done **in the Darb app**; the plan is
to do it from the OMS instead, so the warehouse uses one system.

Steps 1–2 are ours. Step 6 onward is Darb's — their reception staff book the parcel, not us.

---

## Rules that matter on the floor

1. **One sticker = one parcel = one order.** Never reuse a sticker.
2. **Always scan — never type the number.** This is the important one. Darb accepts *any*
   number without checking it belongs to us: a foreign number 2.4M away from our stock was
   accepted with no error. A mistyped digit will silently bind a valid-looking number that
   may belong to another merchant's parcel, and nothing will warn you.
3. **Stick first, then scan**, so the parcel in your hand and the number in the system can
   never disagree.
4. **Order of operations is flexible.** A sticker can be bound before Darb books the parcel
   (that is the normal case — 635 of 823) or shortly after. Either is fine.
5. **Delivered / cancelled parcels can't be re-stickered.** Darb rejects it. If you need to
   change one of those, escalate.
6. **A wrong scan is fixable** — re-scan the correct sticker and it rebinds. But report it,
   because the wrong number may belong to someone else's parcel.
7. **An accepted bind is not a bind.** See below. The OMS re-reads the shipment
   after every bind and records what Darb is really holding.

---

## The sticker roll is colour-coded — and Darb's API says which colour

Settled 2026-08-22 by `scripts/probe-darb-branches.ts` (read-only).

`GET /api/local/branches/public` returns a **`color` hex on every branch
record**. The field is absent from the vendor's Postman collection and from
INTEGRATION_GUIDE.md — the documented schema is not the whole payload — so it
had been missed. Nine distinct colours come back, and they reproduce Darb's own
printed price poster card for card:

| `color` | Branch groups | Poster card | Example destinations |
|---|---|---|---|
| `#d80a0a` rouge | TR · SA1 · SH2 · SH3 · SH4 · TDSW · HR · EXCU | طرابلس + ضواحي | طرابلس · جنزور · تاجوراء · ورشفانة |
| `#5a3001` brun | HW | جنوب طرابلس | ترهونة · بني وليد |
| `#fc6401` orange | ZWR · ZWY · ZY | غرب طرابلس | الزاوية · صبراتة · زوارة · العجيلات |
| `#f9fc01` jaune | KHM · MS | شرق طرابلس | الخمس · زليتن · مصراتة |
| `#ed00ff` magenta | WS · ZW | المنطقة الوسطى | سرت · اجدابيا · البريقة · الجفرة |
| `#339307` vert | BN · BNN · BYD · DRN · MRJ · QBA · TBR | المنطقة الشرقية | بنغازي · البيضاء · درنة · طبرق |
| `#091d96` bleu marine | JB | الجبل الغربي | غريان · الزنتان · نالوت · يفرن |
| `#0cbceb` cyan | SB | المنطقة الجنوبية | سبها · أوباري · مرزق · غات |
| `#8fff00` vert lime | JL · KF | الجنوب الشرقي | جالو أوجلة · الكفرة |

**The colour follows the DESTINATION, and the join key is `toBranchGroup`.**
That field is on every shipment from creation — before booking, before handover
— so the roll can be named on the picking list, not discovered at the bench.

Two near-misses, recorded so nobody retries them:

* **`toZoneCode` is not the colour.** It has 8 values and merges what the
  colours keep apart: zone `TR` covers both طرابلس (rouge) and ترهونة (brun);
  zone `WA` covers both اجدابيا (magenta) and الكفرة (lime).
* **`breakdown.branchToBranch` is not the colour** either. It is a radial
  distance band measured from the *origin* branch, so it differs between our
  Tripoli and Benghazi accounts and cuts straight across the cards.

**Both accounts return an identical directory**, so the colour scheme is
company-wide. What does differ between the two accounts is the *price*: the
harvested quotes in `darb_shipping_rates` are a different list per account
(بنغازي costs 0–15 from Benghazi and 20–35 from Tripoli).

Two Tripoli branches — `EXP` (زناتة) and `RGG` (الرياضية) — carry no colour.
Every other branch in طرابلس is rouge, so they resolve from the city and are
flagged as inferred rather than guessed silently.

Whether a roll *must* match its destination is **not** enforced by the OMS. The
`sticker_rolls` registry that would have done it was built and dropped the same
day (`20260823000004`): it needed someone to record every roll's number range by
hand, and a guard that lapses is worse than no guard. The colour on screen is the
only control. *(This paragraph previously claimed the refusal existed. It never
shipped.)*

## Related

- Colour + branch directory probe: `scripts/probe-darb-branches.ts`
  (output committed at `report/darb-branches.json`)
- Reference binding (step 5): `PATCH /api/local/shipments/reference/:id`, probed
  by `scripts/probe-darb-reference-permission.ts` and
  `scripts/probe-darb-reference-validation.ts`
- Status sync and API gotchas: `docs/darb-assabil-sync.md`


---

## What Darb does to the sticker after you bind it

Measured on 19 parcels bound through the OMS on 2026-09-08, the day the bench
first ran on it. Two behaviours, neither documented by the vendor, neither
visible from the `PATCH` response:

| What happened | n | What the OMS records |
|---|---|---|
| Darb kept our number | 11 | `sticker_bind_state = confirmed` |
| **Darb's reception replaced it at booking** | **7** | `restickered`, plus their number in `carrier_reference_actual` |
| **Darb answered `status: true` and kept its own `SH…`** | **1** | `not_registered` |

The seven re-stickered parcels (Sebha and Koufra, Benghazi account) were bound
as `11870086`, `1272026`…; at booking, ~17 h later, Darb's reception assigned
`1279049`, `11865431`… Their number is what routes the parcel and what a
returned parcel will carry, so it is what `find_return_by_code` must match —
which it does, because `promote_darb_status` writes it to `tracking_number`.

The one never registered (sticker `1633019`, order `4622d937`) is the reason the
`PATCH` answer is not trusted: it returned success, produced **no `referenced`
timeline event**, and Darb still held `SH2171145` nineteen hours later. It then
healed itself — their reception scanned the physical sticker at booking and set
the reference to `1633019`. That is why an unverified bind does **not** block
the scan: the parcel is already stickered, already correct in the real world,
and refusing it would strand it *and* leave the order with no sticker at all,
so a return could never be found.

**What the OMS does now.** After every bind it re-reads the shipment
(`GET /api/local/shipments/:_id`), retries the bind once if the number did not
stick, then records `confirmed` / `restickered` / `not_registered` on the order.
Every sync sweep re-checks the same thing and writes only when the answer
changes. The bench sees it on Entrepôt › Banc › Scannés, with a one-tap re-bind.

Reproduce both in the sandbox: `POST /__sandbox/mode {"mode":"silent"}` (says
yes, binds nothing) and `{"mode":"reref"}` (binds, then overwrites with a Darb
number).
