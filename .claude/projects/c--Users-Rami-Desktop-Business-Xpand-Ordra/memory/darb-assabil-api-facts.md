---
name: darb-assabil-api-facts
description: Verified live facts about the Darb Assabil carrier API (service plans, area/branch data shape) discovered by probing the account
metadata:
  type: reference
---

Verified by probing the live Darb Assabil API (`https://v2.sabil.ly`) on 2026-06-02 using the configured `darb_assabil` carrier's decrypted credentials. Account `692637b42f63874515cebd63`.

**Service plans** (`GET /api/local/service/rates/public`) — 4 plans:
- `6783c612dcf305c9e775c987` — "توصيل رجالي" (male), amount 0, **isPrimary: true** ← used as `default_service_id`
- `67c84fea9ed6c0d5c5bb1d2c` — "توصيل فوري" (express+male), amount 15
- `67c84fbc9ed6c0d5c5bb1d2b` — "توصيل نسائي" (female), amount 10
- `67ed8ed1f406d9671db58d8b` — "استلام قيمة مالية" (deposit), amount 10

**Area/branch data** (`GET /api/local/branches/public?offset=0&limit=300`) — 37 branch rows, 26 distinct `city` values. CORRECTION (verified 2026-06-02): the flat top-level `(city, area)` on each branch row is NOT the dispatchable set. The real deliverable areas for a city live in the row's **`areas[]` array** (each `{ area, deliveryRate, geoPoint, geoFeature }`). A city's full area list = its top-level `area` PLUS every `areas[].area`. Most of the 280 such combos ARE deliverable; e.g. طرابلس has ~92 areas (عين زارة, قرقارش, تاجوراء, …), بنغازي ~63, الجفرة = [هون, الجفرة, سوكنة, ودان, زلة].

**Dispatch contract (empirically validated against `POST /api/local/shipments/calculate/shipping`):** `to.area` MUST be a member of that city's deliverable area list. The city name is only valid as an area if it appears in its own `areas[]` (بنغازي/بنغازي ✓). Two branch rows are NOT dispatchable as `city/area` even though they appear in the list: **`تاجوراء/تاجوراء` ✗ and `طرابلس/طرابلس` ✗** — these fail with `Unable to fetch branch 'LBY-<city>,<area>'!` (HTTP 200 status:false, or HTTP 500). `تاجوراء` is therefore NOT a serviceable standalone city (it's only an area under طرابلس); it must be dropped as a city key. So the data MUST be validated combo-by-combo, not trusted from the branches list.

The validated set is bundled at `src/lib/carriers/darb-assabil-areas-data.json` (25 cities, 278 combos). The dispatch sends `to: { countryCode:"lby", city, area, address }` where `area` is a sub-area the agent picks from that city's list. Note: the `calculate` endpoint also enforces `products[].title` min-length — a 1-char title returns a misleading 400 `@ products.0.title`, not a city error.

To re-probe: read the carrier row from Supabase (`code='darb_assabil'`), decrypt `api_credentials` with `ENCRYPTION_KEY` (aes-256-cbc, `iv_b64:cipher_b64`), call with headers `Authorization: apikey <key>`, `X-API-VERSION: 1.0.0`, `X-ACCOUNT-ID: <account_id>`. HTTP 200 always; check `body.status === true`. See [[darb-assabil-step2-plan]].
