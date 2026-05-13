# Shopify Webhook — Production Readiness Plan

## Context

The OMS already has a working storefront webhook engine. The endpoint, adapter pattern, signature validation, idempotency log, replay support, and health tracking are all built. This plan is **not** a from-scratch build — it is the polish required to make Shopify intake production-safe.

**Existing pieces:**
- Generic webhook endpoint: [src/app/api/webhooks/[storefrontId]/route.ts](../src/app/api/webhooks/[storefrontId]/route.ts)
- Handler: [src/lib/orders/webhook-handler.ts](../src/lib/orders/webhook-handler.ts)
- Shopify adapter (HMAC + payload mapping): [src/lib/storefronts/shopify-adapter.ts](../src/lib/storefronts/shopify-adapter.ts)
- Delivery log + dedupe index: [supabase/migrations/025_webhook_delivery_log.sql](../supabase/migrations/025_webhook_delivery_log.sql), [026_webhook_delivery_log_idempotency.sql](../supabase/migrations/026_webhook_delivery_log_idempotency.sql)
- Other adapters: Easy Orders, WooCommerce, Lightfunnels

**Current dedupe scope:** `(storefront_id, external_id, event)` — already discriminates by event type, so `orders/create` vs `orders/updated` vs `orders/cancelled` for the same order are **not** falsely deduped against each other. This corrects a common misdiagnosis.

---

## The Real Issues (in priority order)

### 1. Dedupe key is wrong for Shopify retries — DATA LOSS RISK

**Problem:** Shopify retries the same delivery with the same `X-Shopify-Webhook-Id` on a 5xx/timeout. It can also send two legitimate `orders/updated` events for the same order within seconds. Our current key `(storefront_id, external_id, event)` collides:

- The first `orders/updated` is stored. The second legitimate `orders/updated` (e.g., merchant edits address twice) is silently dropped as a duplicate.
- A retried `orders/updated` (Shopify resending the same event because we returned 5xx) is processed correctly today, but only because we get lucky on timing.

**Fix:** Dedupe by Shopify's per-delivery identity (`X-Shopify-Webhook-Id`), not by event type.

**Implementation:**
- Add columns to `webhook_delivery_log`:
  - `delivery_id text` (the source's per-delivery ID — Shopify: `X-Shopify-Webhook-Id`)
  - `shopify_event_id text` (`X-Shopify-Event-Id` — useful for tracing)
  - `shopify_topic text` (`X-Shopify-Topic`)
  - `shopify_triggered_at timestamptz` (`X-Shopify-Triggered-At`)
- New partial unique index: `UNIQUE (storefront_id, delivery_id) WHERE delivery_id IS NOT NULL`
- Drop or relax `idx_wdl_dedup` (the current `(storefront_id, external_id, event)` partial index) — replace with the delivery-level index above.
- In `handleWebhook`, before any processing: extract Shopify headers, check if `(storefront_id, delivery_id)` already exists; if yes, short-circuit with `ignored / duplicate-delivery`.
- For non-Shopify adapters that don't expose a per-delivery ID, fall back to the existing `(storefront_id, external_id, event)` heuristic.

**Tests:**
- Duplicate Shopify delivery (same `X-Shopify-Webhook-Id`) → ignored, no second order.
- Two legitimate `orders/updated` with different webhook IDs → both processed.
- `orders/create` then `orders/updated` (different webhook IDs) → both processed.
- `orders/create` then `orders/cancelled` (different webhook IDs) → both processed.
- Invalid signature → no log row created with delivery_id (delivery dedupe row should only land for authenticated requests).

---

### 2. Signature failures return 200 — silent in Shopify admin

**Problem:** [webhook-handler.ts:135-140](../src/lib/orders/webhook-handler.ts#L135-L140) returns 200 on invalid HMAC. Shopify's webhook admin UI shows the webhook as "delivered" — there is no signal in Shopify's own dashboard that the secret is wrong. Diagnosing requires digging through `webhook_delivery_log`.

**Fix:** For Shopify only, return **401** on signature failure. Keep 200 for other adapters to avoid retry storms where unrelated.

**Why Shopify-specific:**
- Shopify's retry policy on 401 is bounded (19 attempts over 48h) — not a storm.
- The 401 surfaces in Shopify's webhook events panel as "Failed", giving operators an obvious signal.
- For trusted/internal platforms (Easy Orders, etc.) we keep 200 to swallow noise.

**Tests:**
- Invalid HMAC on Shopify path → 401, no order created, log row written with `status='error'`, `error_message='Invalid signature'`.
- Valid HMAC → 200.

---

### 3. Phone normalization missing — fragments customer identity

**Problem:** Shopify ships phones in arbitrary formats: `+216 12 345 678`, `0021612345678`, `12345678`, `+216-12-345-678`. We use phone as the de-facto customer identity for:
- Carrier dispatch (the number passed to Aramex/DExpress/etc.)
- Agent dialing
- Duplicate customer detection
- Possibly future CRM lookups

Storing raw means `+216 12 345 678` and `+21612345678` look like two different customers.

**Fix:** Normalize at intake in `shopify-adapter.ts` (and ideally apply to other adapters later). Strategy:
1. Strip whitespace, dashes, parentheses.
2. Use `libphonenumber-js` if already a dep, otherwise a simple per-market normalizer:
   - Tunisia: ensure leading `+216`, strip leading 0.
   - Libya: ensure leading `+218`, strip leading 0.
3. Store normalized form in `customer_phone`. If preservation of the original is wanted, add `customer_phone_raw` — but only if there's a real use case.

**Decision required:** market-aware normalization needs `storefront.market_id` in the adapter, which currently isn't passed to `mapToInternalOrder`. Options:
- Pass `market: 'tunisia' | 'libya'` into the adapter call.
- Do normalization in the handler after mapping (cleaner, but couples market logic to the handler).

**Recommendation:** Normalize in the handler post-mapping. Adapters stay pure mappers.

**Tests:**
- `+216 12 345 678` → `+21612345678` (Tunisia market).
- `0021612345678` → `+21612345678`.
- `12345678` (Tunisia) → `+21612345678`.
- Libya equivalents.
- Already-normalized stays unchanged.

---

### 4. Cancellation goes to `deleted`, not `cancelled` — semantic mismatch

**Problem:** [handleOrderCancelled](../src/lib/orders/webhook-handler.ts#L419-L463) transitions to `deleted`. Per CLAUDE.md status model, both `cancelled` and `deleted` are terminal pre-dispatch statuses, but they connote different things:
- `cancelled` — legitimate customer/merchant cancel.
- `deleted` — manager soft-delete (bad data, duplicate, etc.).

A Shopify-side cancellation is conceptually the former.

**Fix:** Change the target status to `cancelled` and update the note to `"Cancelled via storefront webhook"` (already done).

**Tests:**
- `orders/cancelled` while order is `pending` → transitions to `cancelled`.
- `orders/cancelled` while order is `attempt_1` → transitions to `cancelled`.
- `orders/cancelled` after `uploaded` → ignored with `skipped: true` (already correct).
- Order history row written with `status_from`, `status_to='cancelled'`, `actor_type='system'`.

---

### 5. `raw_payload` not preserved on update events

**Problem:** [handleOrderUpdated](../src/lib/orders/webhook-handler.ts#L370-L417) updates customer fields but never touches `raw_payload`. After a Shopify edit, the stored `raw_payload` is stale relative to actual `customer_*` columns. Audit and replay become misleading.

**Fix options:**
- **A. Document it (cheapest):** the `raw_payload` is the *creation* payload. Updates and cancellations are in `webhook_delivery_log.payload`. Add a comment to the orders table migration and call it a day.
- **B. Append to a history column (cleanest):** add `orders.raw_payload_history jsonb[]` and push on each update.
- **C. Overwrite (lossy, wrong):** don't do this — it destroys the create payload that drove the initial order shape.

**Recommendation: Option A.** `webhook_delivery_log.payload` already preserves every event verbatim. We just need to document that the source-of-truth audit trail is the delivery log, not the order row.

**Action:**
- Add a comment to `webhook-handler.ts` near `handleOrderUpdated` documenting the rule.
- No schema change.

---

### 6. Inactive storefront swallows webhooks silently

**Problem:** [webhook-handler.ts:111-113](../src/lib/orders/webhook-handler.ts#L111-L113) returns 200 with `error: "Storefront not found or inactive"` but writes no log row. A merchant whose storefront was deactivated has no record of attempted deliveries — they just disappear.

**Fix:** Write a `status='ignored'` log row with the headers and payload before returning. Keep the 200 (we don't want Shopify to retry against a deactivated storefront).

**Edge case:** if the storefront ID doesn't exist at all (UUID typo or stale Shopify config), we have no `storefront_id` FK to write against. Either:
- Allow `storefront_id` to be null in `webhook_delivery_log` (already nullable per migration 026).
- Add a separate `webhook_delivery_orphans` table.

Use the nullable column. Already supported.

**Tests:**
- Delivery to inactive storefront → 200, log row with `status='ignored'`, `error_message='Storefront inactive'`.
- Delivery to non-existent storefront ID → 200, log row with `storefront_id=null`, `status='error'`.

---

### 7. Storefront wizard: Shopify needs the right secret semantics

**Problem:** The wizard currently generates a random `webhook_secret`. For Shopify, the secret has to be the value Shopify signs with. There are two valid sources depending on how the merchant connects:

- **Custom App / Admin webhooks:** the secret is the app's "client secret" (or webhook subscription's signing secret) shown in Shopify Partners/Admin.
- **App-managed:** when we later add GraphQL Admin API auto-subscribe, the secret is generated by Shopify and returned in the subscription mutation response.

**Fix:** Make the wizard platform-aware.

**Shopify branch:**
- Replace "Generate secret" with a paste field labeled "Shopify webhook signing secret".
- Add a required field "Shopify shop domain" (e.g. `your-store.myshopify.com`) — stored in `storefronts.config.shop_domain`.
- Optional field: "Admin API access token" (encrypted, for future auto-subscribe). Hide behind a "Advanced" toggle.
- Show the OMS webhook URL prominently: `https://<oms-domain>/api/webhooks/<storefront_id>` with a copy button, so the merchant can paste it into all three Shopify subscriptions.

**Other adapters:** keep "Generate" since they use OMS-issued secrets.

**Tests:**
- Wizard with platform=shopify renders paste field, not generate button.
- Wizard with platform=easy_orders still generates.
- Required validation: empty Shopify secret blocks save.
- Shop domain stored under `config.shop_domain`.

---

### 8. Manual Shopify subscription path

**Action items (no code changes):**
- Document the three required Shopify subscriptions:
  - `orders/create` → `POST https://<oms-domain>/api/webhooks/<storefront_id>`
  - `orders/updated` → same URL
  - `orders/cancelled` → same URL
- Format: JSON.
- API version: pin to a recent stable Shopify API version (e.g., `2024-10`) and document the version in the storefront record (`config.shopify_api_version`) so we can detect drift later.

---

### 9. Improve error visibility

Once the above is done, add operator-facing surfaces:

- Storefront detail page already shows `last_webhook_received_at` / `last_webhook_status`. Add:
  - Count of `status='error'` deliveries in last 24h.
  - Latest 5 error messages.
  - Filterable webhook delivery log (already replayable).
- Operational alerts for:
  - 3+ consecutive signature failures (likely wrong secret).
  - 5+ "product not matched" warnings (likely SKU drift).

---

## Implementation Order

The order minimizes risk of going live with data loss while keeping each PR reviewable.

### Phase 1 — Correctness fixes (PR 1)
1. Migration: add `delivery_id`, `shopify_event_id`, `shopify_topic`, `shopify_triggered_at` to `webhook_delivery_log`. Add new partial unique index. Keep old index until cutover.
2. Update `webhook-handler.ts`:
   - Extract Shopify headers up front.
   - Compute `delivery_id` (Shopify: `X-Shopify-Webhook-Id`; others: null).
   - Pre-check `(storefront_id, delivery_id)` for dedupe when present.
   - Fall back to existing `(storefront_id, external_id, event)` check when `delivery_id` is null.
   - Write all four header values to every log row.
3. Add log writes for inactive/missing storefronts.
4. Return 401 on Shopify signature failure (Shopify-only branch).
5. Change cancellation target from `deleted` to `cancelled`.
6. Tests for all of the above.

### Phase 2 — Data quality (PR 2)
1. Phone normalization helper in `lib/phone/normalize.ts` (TDD first).
2. Apply in webhook handler post-mapping.
3. Backfill migration for existing orders (optional, can be deferred).
4. Tests.

### Phase 3 — Storefront wizard polish (PR 3)
1. Platform-aware secret input.
2. Shop domain field.
3. Copy-to-clipboard for webhook URL.
4. Pin Shopify API version in config.
5. Tests for the wizard.

### Phase 4 — Real-world validation (no code)
1. Create a Shopify dev store.
2. Create a custom app in Shopify Admin, configure the three subscriptions pointing to the OMS endpoint.
3. Place a test order. Verify intake.
4. Edit shipping address in Shopify. Verify update lands.
5. Cancel the order. Verify transition to `cancelled`.
6. Disable the OMS storefront. Verify Shopify shows failed deliveries (after Phase 1's 401 change).
7. Verify replay still works post-idempotency change.

### Phase 5 — Operator UX (PR 4, only after Phase 4 validates)
1. Storefront detail page error visibility.
2. Health alerts.

### Phase 6 — Auto-subscribe (future, optional)
1. GraphQL Admin API integration for automatic subscription creation.
2. Token storage + rotation.
3. Only after Phase 4 confirms manual setup is solid.

---

## End-to-End Test Checklist

| Scenario | Expected |
|----------|----------|
| Shopify `orders/create` → new order | OMS order in `pending`, log row `processed` |
| Duplicate Shopify delivery (same `X-Shopify-Webhook-Id`) | No second order, log row `ignored / duplicate-delivery` |
| `orders/updated` after `orders/create` | Customer fields updated, log row `processed` |
| Two legitimate `orders/updated` events | Both applied in order |
| `orders/cancelled` pre-dispatch | Order → `cancelled`, history row written |
| `orders/cancelled` post-dispatch | Ignored, log row `ignored / skipped` |
| Invalid HMAC (Shopify) | 401, no order, log row `error` |
| Invalid HMAC (other adapter) | 200, no order, log row `error` |
| Missing phone | 200, log row `error / Missing customer phone` |
| Missing line items | 200, log row `error / Missing line_items` |
| Unknown Shopify topic (e.g. `orders/fulfilled`) | 200, log row `error / Unknown topic` |
| Product SKU matches existing product | `product_id` set on order |
| Product SKU does not match | `product_id=null`, no failure, surfaced as health warning |
| Inactive storefront | 200, log row `ignored / Storefront inactive` |
| Unknown storefront UUID | 200, log row with `storefront_id=null` |
| Phone `+216 12 345 678` (Tunisia) | Stored as `+21612345678` |
| Replay of a logged delivery | Same order outcome, no duplicate order |

---

## Open Questions

1. **`webhook_delivery_log.payload`**: do we want to keep storing the full payload for every event, or only on errors? Right now it's stored on every row, which means a year of Shopify activity = a lot of JSONB. Consider TTL or compression policy before going live with high volume.
2. **Phone normalization library**: add `libphonenumber-js` (~110kb) or hand-roll Tunisia/Libya rules? Hand-roll is fine for two countries — but check if we already have it transitively.
3. **`orders/edited` topic**: Shopify also emits `orders/edited` when line items change. Out of scope for v1 (would require re-pricing logic) — confirm we don't want to subscribe to it yet.
4. **GDPR / data subject requests**: Shopify emits `customers/data_request`, `customers/redact`, `shop/redact`. Required if the store is in the EU or accessible to EU customers. Out of scope unless Tunisia/Libya are doing EU business — likely no, but confirm.

---

## What we are NOT doing (yet)

- GraphQL Admin API auto-subscribe — Phase 6, after manual validation.
- Multi-variant product matching — current adapter takes the first line item only. Multi-product orders need a separate plan.
- Inventory sync back to Shopify — outside the OMS scope per current design.
- Shopify fulfillment status sync (telling Shopify we shipped) — separate plan; touches carrier lifecycle.

---

## References

- Existing handler: [src/lib/orders/webhook-handler.ts](../src/lib/orders/webhook-handler.ts)
- Existing adapter: [src/lib/storefronts/shopify-adapter.ts](../src/lib/storefronts/shopify-adapter.ts)
- Adapter rules: [src/lib/storefronts/CLAUDE.md](../src/lib/storefronts/CLAUDE.md)
- Delivery log schema: [supabase/migrations/025_webhook_delivery_log.sql](../supabase/migrations/025_webhook_delivery_log.sql), [026_webhook_delivery_log_idempotency.sql](../supabase/migrations/026_webhook_delivery_log_idempotency.sql)
- Shopify webhook docs: https://shopify.dev/docs/apps/build/webhooks
- Shopify webhook headers: https://shopify.dev/docs/apps/build/webhooks/subscribe#receive-webhook-events
