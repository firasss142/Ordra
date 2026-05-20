---
name: dexpress-dispatch-failure-modes
description: How Dexpress carrier dispatch fails silently and why error messages come back empty
metadata:
  type: project
---

The Dexpress carrier integration scrapes a server-rendered Laravel 5 merchant portal (no real API — confirmed with the carrier). Two failure modes that are easy to misdiagnose:

1. **Malformed phone → silent rejection.** Dexpress requires Libyan numbers in 10-digit local form `09XXXXXXXX`. Storefront webhooks often deliver `924751325` (no leading 0) or `+218...`. The portal rejects these with a 302 redirect back to `/merchant/add-orders` (no inline error), and `performDispatch` returns HTTP 422. Fixed by normalizing in `buildOrderPayload` via `normalizeLibyanPhone` ([[oms-status-and-stock-model]] phone lives in `src/lib/carriers/phone.ts`).

2. **Swallowed error message (still unfixed as of 2026-05-20).** On a Laravel "redirect-back with errors", `DexpressAdapter.dispatch` does a follow-up GET to read the flashed errors — but `submitMerchantForm` discards the rotated `laravel_session` Set-Cookie, so the GET reuses the stale cookie and lands on a clean form with no flash data. Result: empty `DEXPRESS_VALIDATION` 422 with message "Validation error" instead of the real reason. Symptom in logs: `[DexpressAdapter] redirect-back with no parseable errors`.

**Why:** these turn a fixable data problem into an opaque "can't send to carrier" for the agent.
**How to apply:** when dispatch returns an empty 422, suspect the phone format first. If the real carrier error is needed, fix the cookie capture in `client.ts` `submitMerchantForm`.
