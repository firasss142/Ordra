# Storefront Adapters — Rules

## Architecture
Adapter pattern. Each storefront implements the StorefrontAdapter interface.
New storefronts = new adapter file. Zero changes to OMS core logic.

## Interface
Every adapter must implement:
- validateWebhook(request, secret) → boolean
- mapToOrder(payload) → OMS internal order model
- handleEvent(event_type, payload) → action

## Webhook events handled
- order.created → create order in OMS with status 'pending'
- order.updated → update customer fields if still pre-dispatch (city re-resolved)
- order.cancelled → moves the order to 'deleted' if not yet dispatched

## Current adapters
Webhook (`adapter-registry.ts`): easy_orders, shopify, woocommerce, lightfunnels, buybox.
Sheet rows (`sheets/adapter-registry.ts`): converty — read by the Google Sheets sync,
one storefront (platform `google_sheets`) per sheet. See docs/storefront-accounts.md.

## Intake flow
1. Webhook hits /api/webhooks/{storefrontId}/route.ts → lib/orders/webhook-handler.ts
2. Validate signature with storefront.webhook_secret (or uuid_only for browser senders)
3. Adapter maps platform fields → InternalOrderData (every line, see docs/storefront-multi-line-intake.md)
4. market_id comes from the storefront row
5. raw_payload stored on the order
6. status = 'pending', auto-assignment attempted

One account = one storefront row: several Shopify stores or Converty accounts are
several rows, each with its own URL, secret, mappings and dedupe namespace.

## Critical
- Use Supabase SERVICE ROLE for webhook handlers (no user session)
- Prevent duplicate intake: UNIQUE(storefront_id, external_id)
- total_price from webhook = source of truth for revenue

## References
- OMS spec Section 4 (Storefront Integration Layer)
- Easy Orders webhook config: see screenshot in project docs
