# Carrier rate recommendation ("meilleur choix")

Which of Libya's two Darb Assabil accounts should an order ship with?

## The two accounts are geographic, not interchangeable

Probed live 2026-08-08, they price the same destination 5–25 LYD apart, split
cleanly by geography:

| City | Tripoli account | Benghazi account |
|---|---|---|
| طرابلس (Tripoli) | **35** | 40 |
| بنغازي (Benghazi) | 35 | **15** |
| مصراتة (Misrata) | **25** | 30 |
| درنة (Derna) | 40 | **25** |

Neither account is "the cheap one". The answer depends entirely on destination.

## The ranking ladder

`src/lib/carriers/darb-rate-recommendation.ts` — pure, dependency-free, the one
place the question is answered. It tries, in order:

1. **`quote`** — every account has a FRESH quote (≤14 days) for this exact
   destination. Rank on price. This is the only fully trustworthy rung.
2. **`quote_stale`** — every account has a real quote for this destination but
   they are ALL past the cutoff. Still rank on price: the quotes came from the
   same harvest sweep, so their *difference* is intact even if the absolute
   figures have drifted. The UI still flags `quoteUsable: false`.
3. **`true_cost`** — quotes are missing or of MIXED freshness. Falls back to
   `get_carrier_true_cost`.
4. **`sticker`** — no history either; use the flat `carriers.delivery_fee`.

### Why mixed freshness does NOT rank on price

An August price against a September one can differ because the tariff moved,
not because one account is genuinely cheaper. Comparing them would hard-route
orders to whichever account happened to get a fresher harvest. Missing or
mismatched data means "we cannot compare on price" — never "expensive".

### Why `true_cost` must never decide a per-destination question

`get_carrier_true_cost` is a MARKET-WIDE average: total delivery + return cost
over delivered orders, with no notion of destination. Because the Benghazi
account ships mostly to the cheap east, its average is structurally lower than
Tripoli's regardless of where the order in hand is going. It is a legitimate
tie-break; it is **not** a price for this address.

## Regression: 2026-09-09 — "always recommends Benghazi"

**Symptom.** The picker recommended the Benghazi account for every order,
including Tripoli destinations where it is 5 LYD *more* expensive.

**Cause — two independent defects that only bite together:**

1. `/api/cron/darb-rates-harvest` existed but was **never registered in
   `cron.job`**. The catalogue was harvested once by hand on 2026-08-08
   (`trigger: 'script'`) and never refreshed. By September every quote for both
   accounts was 32 days old — past the 14-day cutoff.
2. With all quotes stale, ranking fell through to `true_cost`, whose
   market-wide average (Benghazi 24.64 vs Tripoli 30.40 LYD/delivered) picks
   Benghazi **everywhere**.

**Fix.** Added the `quote_stale` rung (2 above) so uniformly-stale quotes still
rank by destination, and scheduled the harvest nightly at 02:17 UTC
(`supabase/migrations/20260909000003_schedule_darb_rates_harvest.sql`).

**The lesson.** A silent freshness fallback that changes *which dimension* is
being compared is worse than no recommendation at all — it stays plausible
while being wrong in one consistent direction. Any new rung must rank on a
number that actually answers the question asked.

## Monitoring

`darb_rate_harvest_runs` records every run. Check for staleness with:

```sql
select trigger, status, started_at, succeeded, failed
from darb_rate_harvest_runs order by started_at desc limit 5;
```

If the newest row is more than ~2 days old, or no row has `trigger = 'cron'`,
the recommendation has silently degraded off the `quote` rung.
