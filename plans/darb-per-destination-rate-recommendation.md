# Darb Assabil per-destination rates → Tripoli vs Benghazi recommendation

## Why

Libyan carriers price delivery **by destination address**, not by a flat rate (unlike the
Tunisian carriers). The OMS did not model that at all:

- `carriers.delivery_fee` is a single flat number per carrier row.
- Both Darb Assabil accounts carried an **identical 10.000 LYD / 5.000 LYD**.
- Darb's own `POST /api/local/shipments/calculate/shipping` — which returns the real
  per-shipment price — was documented but **never called at runtime**.

So "recommend the cheaper Darb account for this customer's address" was always a tie, and
every Darb order was booked at a cost that had no relationship to what Darb actually charges.

## Probe verdicts — 2026-08-08

Run: `npx tsx --env-file=.env.local scripts/probe-darb-shipping-rates.ts`
96 calls, 12 destinations × 2 accounts. Read-only (`calculate/shipping` preview only).

Accounts (genuinely separate, distinct `account_id`s):

| key | `carriers.name` | id | Darb `account_id` |
|---|---|---|---|
| tripoli | Darb Assabil - Tripoli | `4f1271c8-b1f2-4836-9293-8ab3d0b18e69` | `6a2d5de9d4bdbae4fd9b63ee` |
| benghazi | Darb Assabil — Benghazi | `43077d36-3d61-40d6-ae35-59ed15cec8f7` | `6a37fb333cc4f684de2a5600` |

### (a) ACCOUNTS DIFFER — 11 of 12 destinations, max Δ 20.000 LYD ✅ gate passes

| destination | Tripoli | Benghazi | Δ | cheaper |
|---|---|---|---|---|
| طرابلس / الرياضية | 15.000 | 20.000 | −5 | **Tripoli** |
| طرابلس / تاجوراء | 15.000 | 20.000 | −5 | **Tripoli** |
| الزاوية / الزاوية | 20.000 | 25.000 | −5 | **Tripoli** |
| مصراتة / مصراتة | 20.000 | 25.000 | −5 | **Tripoli** |
| سرت / سرت | 30.000 | 25.000 | +5 | **Benghazi** |
| بنغازي / بنغازي | 30.000 | 10.000 | +20 | **Benghazi** |
| بنغازي / قمينس | 35.000 | 15.000 | +20 | **Benghazi** |
| درنة / درنة | 40.000 | 25.000 | +15 | **Benghazi** |
| طبرق / طبرق | 40.000 | 25.000 | +15 | **Benghazi** |
| البيضاء / شحات | 40.000 | 25.000 | +15 | **Benghazi** |
| سبها / سبها | 35.000 | 35.000 | 0 | tie |
| الكفرة / الكفرة | 50.000 | 40.000 | +10 | **Benghazi** |

The split is cleanly geographic and سرت is the hinge. Picking the right account saves
**5–20 LYD per order**.

### (b) AMOUNT-INVARIANT

Fee identical at COD 50 / 199 / 500 / 2000. A `(city, area)` scalar rate is valid — no
value bands needed.

`amount = 0` returns HTTP 500 *"Your sales cannot cover the charges!"* on both accounts:
with `paymentBy: "sales"` Darb deducts shipping from the settlement, and a zero-value
order can't cover it. A probe artifact, not a harvest failure mode — harvest at a
non-zero nominal amount.

### (c) NOT sensitive to service, quantity, line count, or paymentBy

All three catalogue services quote identically; `qty=1` = `qty=3` = 2 lines; `sales` =
`receiver`. **The harvest key is just `(carrier_id, city, area)`** — 278 × 2 = **556 cells**,
one service, one paymentBy, one amount. The `service` surcharges (women's +10, express +15)
are applied by Darb *on top* and are already surfaced separately from `darb_services`.

### (d) `branchToBranch` is the differentiator

| account | branchToBranch | pickFromDoor | dropToDoor |
|---|---|---|---|
| tripoli | **varies 10 … 45** | constant 0 | varies 5 … 15 |
| benghazi | **varies 0 … 35** | constant 0 | varies 5 … 15 |

`dropToDoor` is a property of the destination area and is the same for both accounts;
`branchToBranch` is the origin-branch → destination-branch leg and is what makes Benghazi
free (0) into بنغازي and Tripoli expensive (20) into the same place.

### (e) PORTABLE — both accounts accept all three catalogue service ids

No `carrier_id` needed on `darb_services`.

### Latency

p50 99 ms, p95 171 ms, max 646 ms. No 429 / `Retry-After` at 300 ms spacing.
556 cells at concurrency 4 / 250 ms ≈ 40 s.

## Findings worth acting on beyond the recommendation feature

1. **The booked cost is wrong for nearly every Darb order.** Real shipping is 10–50 LYD;
   the OMS books a flat 10 LYD. Delivery cost is understated almost everywhere, so
   profitability is overstated. The rates table fixes the input; deciding whether to
   backfill `orders.delivery_fee` from it is a separate call.
2. **The Benghazi carrier row has no `default_service_id`** in its credentials — it carries
   stray `email` / `password` keys from the creation form instead. The adapter falls back to
   `creds.default_service_id` when no `service_id` extra is passed, so non-modal paths
   (cron dispatch) on Benghazi would throw *"aucun forfait de service défini"*. Worth fixing
   independently of this feature.
3. `GET /api/carriers/active` uses `.maybeSingle()` on `(code, market_id)` and will 500 for
   `code=darb_assabil` (two Libya rows match). Latent today — only Dexpress calls it.

## Decision

**Gate passed. Built the full design**: nightly harvest into `darb_shipping_rates`, pure
local lookup, recommendation surfaced in the upload sheet and stored at intake, tie-break on
historical true cost-per-delivered.

Simplified by the probe: no value bands, no service dimension, no paymentBy dimension.

## Shipped — 2026-08-08

### Full catalogue harvested: 556/556 cells, 0 failures

| metric | value |
|---|---|
| combos priced for both accounts | 278 |
| Tripoli cheaper | 127 |
| Benghazi cheaper | 110 |
| tie (resolved on true cost) | 41 |
| **average gap** | **9.06 LYD** (max 25) |
| avg cost picking the cheaper account | 21.62 LYD |
| avg cost picking the other one | 30.68 LYD |

Sample against real Libya orders: بنغازي → Benghazi (15 vs 35), البريقة → Benghazi (5 vs 30),
طرابلس → Tripoli (35 vs 40), طرابلس/جنزور → Tripoli (15 vs 20), سبها → tie → Benghazi on
true cost, درنة → Benghazi (25 vs 40).

### What was built

| Area | Files |
|---|---|
| Probe | `scripts/probe-darb-shipping-rates.ts` |
| Schema | `20260825000001_darb_shipping_rates`, `…0002_orders_recommended_carrier`, `…0003_get_carrier_true_cost` |
| Quoting | `src/lib/carriers/darb-rate-quote.ts` |
| Harvest | `darb-rate-harvest.ts`, `darb-rate-harvest-cycle.ts`, `scripts/harvest-darb-shipping-rates.ts`, `api/cron/darb-rates-harvest/` |
| Decision | `darb-rate-lookup.ts`, `darb-rate-recommendation.ts`, `recommend-carrier-for-order.ts`, `lib/calculations/carrier-true-cost.ts` |
| Intake | `webhook-handler.ts`, `create-order-from-data.ts` → `orders.recommended_carrier_id` |
| UI | `api/carriers/rates/`, `hooks/useCarrierRates.ts`, `components/queue/CarrierRateBadge.tsx`, `rate-badge.ts`, `initial-carrier-selection.ts`, both pickers, `dispatch.rates` in fr/ar |
| Bug fix | `api/carriers/active` no longer 500s on the duplicate `darb_assabil` code |

184 new tests, all passing. Typecheck and production build clean.

### Still to do (ops / follow-ups)

1. **Schedule the nightly cron.** `POST /api/cron/darb-rates-harvest` with the `x-cron-secret`
   header, same external caller as the other crons (there is no `crons` block in `vercel.json`).
   Requires `CRON_SECRET` to be set.
2. **Fix the Benghazi carrier credentials** — no `default_service_id`, and stray `email` /
   `password` keys from the creation form. Cron-driven dispatch on that account would throw
   "aucun forfait de service défini". The harvest works around it via the catalogue default.
3. **Decide what to do about `carriers.delivery_fee`.** Real Darb shipping averages 21-31 LYD;
   the OMS books a flat 10. Every Darb order's delivery cost is understated 2-3x, so
   profitability is correspondingly overstated. The rate table is now the accurate input —
   whether to drive `orders.delivery_fee` (and the P&L) from it is a business call.
4. **Optional:** backfill `orders.recommended_carrier_id` for existing pre-dispatch orders.
   Not required — the picker recomputes live, so badges already work on old orders.
5. **Optional:** a dashboard tile counting `recommended_carrier_reason = 'quote'` vs
   `'true_cost'`. Every fallback in this design is quiet by construction; that ratio is how a
   dead harvest becomes visible.
