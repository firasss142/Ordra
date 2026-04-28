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
- order.created → create order in OMS with status 'new'
- order.updated → update fields if order is still pre-dispatch
- order.cancelled → mark as 'cancelled' if not yet dispatched

## Current adapters
- EasyOrdersAdapter (v1) — Session 4
- ShopifyAdapter (future)
- WooCommerceAdapter (future)

## Intake flow
1. Webhook hits /api/webhooks/{platform}/route.ts
2. Validate webhook signature using storefront.webhook_secret
3. Adapter maps platform fields → OMS internal order model
4. Tag order with correct market_id based on storefront config
5. Store raw payload in orders.raw_payload for debugging
6. Place order in unassigned pool (status = 'new')
7. Trigger assignment engine if auto-assignment configured

## Critical
- Use Supabase SERVICE ROLE for webhook handlers (no user session)
- Prevent duplicate intake: UNIQUE(storefront_id, external_id)
- total_price from webhook = source of truth for revenue

## References
- OMS spec Section 4 (Storefront Integration Layer)
- Easy Orders webhook config: see screenshot in project docs
