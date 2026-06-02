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

**Area/branch data** (`GET /api/local/branches/public?offset=0&limit=200`) — 37 branches, 26 distinct cities. Each branch row has flat `city` + `area` (both Arabic). Key quirk: **25 of 26 cities have a single area equal to the city name; only طرابلس (Tripoli) has 4 areas** (`الرياضية`, `طرابلس`, `زناتة`, `حي الأندلس`). So the destination picker is effectively a city picker, with Tripoli expanding into sub-areas. The per-branch `areas[]` array (delivery rates + geo polygons) is empty on these public entries — authoritative pairs are the flat `(city, area)`.

The Step 2 dispatch sends `to: { countryCode: "lby", city, area, address }`. Sending a city/area combo not in this list triggers an obscure `Cannot read properties of undefined (reading 'name')` rather than a clean error — so the picker must only emit known pairs.

To re-probe: read the carrier row from Supabase (`code='darb_assabil'`), decrypt `api_credentials` with `ENCRYPTION_KEY` (aes-256-cbc, `iv_b64:cipher_b64`), call with headers `Authorization: apikey <key>`, `X-API-VERSION: 1.0.0`, `X-ACCOUNT-ID: <account_id>`. HTTP 200 always; check `body.status === true`. See [[darb-assabil-step2-plan]].
