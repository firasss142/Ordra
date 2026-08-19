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

## Open question

The sticker carries a **region band** (`TR / المنطقة الشرقية`). It is not yet established
whether a roll must match the destination region, or whether any roll works for any
destination. Confirm with Darb before relying on it either way.
