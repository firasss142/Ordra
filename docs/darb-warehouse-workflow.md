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

Whether a roll *must* match its destination is now moot in practice: the OMS
refuses a scan whose sticker comes from a roll registered to a different
colour, and names both in the refusal.

## Related

- Colour + branch directory probe: `scripts/probe-darb-branches.ts`
  (output committed at `report/darb-branches.json`)
- Reference binding (step 5): `PATCH /api/local/shipments/reference/:id`, probed
  by `scripts/probe-darb-reference-permission.ts` and
  `scripts/probe-darb-reference-validation.ts`
- Status sync and API gotchas: `docs/darb-assabil-sync.md`
