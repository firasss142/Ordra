import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdapter } from "@/lib/storefronts/adapter-registry";
import type { WebhookEventType } from "@/lib/storefronts/types";
import { PayloadMappingError } from "@/lib/storefronts/errors";
import { validateUuidOnlyPayload } from "@/lib/storefronts/uuid-only-payload";
import { resolveProduct } from "@/lib/storefronts/product-resolver";
import { resolveCity } from "@/lib/storefronts/city-resolver";
import {
  productMatchStatus,
  cityMatchStatus,
  worstMappingStatus,
} from "@/lib/storefronts/resolver-types";
import { transitionOrderStatus } from "./transition";
import { isTerminalStatus } from "@/types/order-status";
import { tryAutoAssign } from "./auto-assignment-orchestrator";

interface WebhookInput {
  storefrontId: string;
  rawBody: string;
  headers: Headers;
  adminClient: SupabaseClient;
  decryptFn: (ciphertext: string) => string;
  /**
   * super_admin replay: skip signature validation (payload is trusted from our own
   * log) and skip the (storefront_id, external_id) pre-check. Downstream order
   * insert/update idempotency still applies — a replayed payload whose order
   * already exists is logged as `ignored` (duplicate), not re-processed.
   */
  allowReplay?: boolean;
}

interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Per-source delivery identity (used as the primary dedupe key when present).
// Currently only Shopify exposes a stable per-delivery ID. Other adapters
// fall back to the legacy (storefront_id, external_id, event) heuristic.
interface DeliveryHeaders {
  deliveryId: string | null;
  shopifyEventId: string | null;
  shopifyTopic: string | null;
  shopifyTriggeredAt: string | null;
}

function extractDeliveryHeaders(platform: string, headers: Headers): DeliveryHeaders {
  if (platform === "shopify") {
    return {
      deliveryId: headers.get("X-Shopify-Webhook-Id"),
      shopifyEventId: headers.get("X-Shopify-Event-Id"),
      shopifyTopic: headers.get("X-Shopify-Topic"),
      shopifyTriggeredAt: headers.get("X-Shopify-Triggered-At"),
    };
  }
  return { deliveryId: null, shopifyEventId: null, shopifyTopic: null, shopifyTriggeredAt: null };
}

interface LogWebhookDeliveryInput {
  adminClient: SupabaseClient;
  source: string;
  event: string;
  payload: unknown;
  status: "processed" | "ignored" | "error";
  orderId?: string | null;
  errorMessage?: string | null;
  storefrontId?: string | null;
  externalId?: string | null;
  deliveryHeaders?: DeliveryHeaders;
}

async function logWebhookDelivery(input: LogWebhookDeliveryInput): Promise<void> {
  try {
    await input.adminClient.from("webhook_delivery_log").insert({
      source: input.source,
      event: input.event,
      payload: input.payload,
      order_id: input.orderId ?? null,
      status: input.status,
      error_message: input.errorMessage ?? null,
      storefront_id: input.storefrontId ?? null,
      external_id: input.externalId ?? null,
      delivery_id: input.deliveryHeaders?.deliveryId ?? null,
      shopify_event_id: input.deliveryHeaders?.shopifyEventId ?? null,
      shopify_topic: input.deliveryHeaders?.shopifyTopic ?? null,
      shopify_triggered_at: input.deliveryHeaders?.shopifyTriggeredAt ?? null,
    });
  } catch {
    // Best-effort: log failures must never propagate
  }

  if (input.storefrontId) {
    await updateStorefrontHealth(
      input.adminClient,
      input.storefrontId,
      input.status,
      input.errorMessage ?? null,
    );
  }
}

async function updateStorefrontHealth(
  adminClient: SupabaseClient,
  storefrontId: string,
  status: "processed" | "ignored" | "error",
  errorMessage: string | null,
): Promise<void> {
  try {
    const patch: Record<string, unknown> = {
      last_webhook_received_at: new Date().toISOString(),
      last_webhook_status: status,
      last_webhook_error: status === "error" ? errorMessage : null,
    };
    if (status === "error") {
      const { data: current } = await adminClient
        .from("storefronts")
        .select("webhook_failure_count")
        .eq("id", storefrontId)
        .single();
      patch.webhook_failure_count = (current?.webhook_failure_count ?? 0) + 1;
    } else {
      patch.webhook_failure_count = 0;
    }
    await adminClient.from("storefronts").update(patch).eq("id", storefrontId);
  } catch {
    // Best-effort — health tracking must never block webhook delivery
  }
}

interface PriorLogRow {
  id: string;
  status: string;
  order_id: string | null;
}

async function findPriorByDeliveryId(
  adminClient: SupabaseClient,
  storefrontId: string,
  deliveryId: string,
): Promise<PriorLogRow | null> {
  const { data } = await adminClient
    .from("webhook_delivery_log")
    .select("id, status, order_id")
    .eq("storefront_id", storefrontId)
    .eq("delivery_id", deliveryId)
    .maybeSingle();
  return (data as PriorLogRow | null) ?? null;
}

async function findPriorByLegacyKey(
  adminClient: SupabaseClient,
  storefrontId: string,
  externalId: string,
  event: string,
): Promise<PriorLogRow | null> {
  const { data } = await adminClient
    .from("webhook_delivery_log")
    .select("id, status, order_id")
    .eq("storefront_id", storefrontId)
    .eq("external_id", externalId)
    .eq("event", event)
    .maybeSingle();
  return (data as PriorLogRow | null) ?? null;
}

// Pre-dispatch statuses where updates and cancellations are allowed
const PRE_DISPATCH_STATUSES = new Set([
  "pending", "assigned", "attempt_1", "attempt_2", "attempt_3",
  "callback_scheduled", "confirmed",
]);

export async function handleWebhook(input: WebhookInput): Promise<WebhookResult> {
  const { storefrontId, rawBody, headers, adminClient, decryptFn, allowReplay } = input;

  // 1. Look up storefront
  const { data: storefront, error: sfError } = await adminClient
    .from("storefronts")
    .select("id, market_id, platform, config, webhook_secret, is_active, auth_mode")
    .eq("id", storefrontId)
    .single();

  if (sfError || !storefront) {
    return { status: 200, body: { error: "Storefront not found or inactive" } };
  }

  // Inactive storefront: log the rejected delivery so operators can see merchants
  // hammering a deactivated endpoint. Still 200 — Shopify must not retry.
  if (!storefront.is_active) {
    const inactiveDeliveryHeaders = extractDeliveryHeaders(storefront.platform, headers);
    await logWebhookDelivery({
      adminClient,
      source: storefront.platform,
      event: "unknown",
      payload: safeParseJson(rawBody),
      status: "ignored",
      orderId: null,
      storefrontId,
      externalId: null,
      errorMessage: "Storefront inactive",
      deliveryHeaders: inactiveDeliveryHeaders,
    });
    return { status: 200, body: { error: "Storefront not found or inactive" } };
  }

  const deliveryHeaders = extractDeliveryHeaders(storefront.platform, headers);

  // 2. Resolve adapter (unknown platform → log + 200, never crash the route)
  let adapter;
  try {
    adapter = getAdapter(storefront.platform);
  } catch (err) {
    await logWebhookDelivery({
      adminClient,
      source: storefront.platform,
      event: "unknown",
      payload: null,
      status: "error",
      orderId: null,
      storefrontId,
      externalId: null,
      errorMessage: err instanceof Error ? err.message : String(err),
      deliveryHeaders,
    });
    return { status: 200, body: { error: "Unknown platform" } };
  }

  // Auth mode:
  //  - 'hmac' (default): server-to-server senders. Decrypt the stored secret
  //    and let the adapter validate the signature header. Failure replies with
  //    200 (avoid retry storms) except Shopify, which gets 401 so wrong-secret
  //    mistakes surface in Shopify's admin "Webhook events" panel.
  //  - 'uuid_only': browser-originated submissions where the UUID in the URL
  //    is the only secret. Signature check is skipped; in exchange we enforce
  //    a normalized payload shape and reply 400 on mismatch so the browser
  //    caller learns about its mistake immediately.
  const authMode: string = (storefront as { auth_mode?: string }).auth_mode ?? "hmac";

  if (!allowReplay && authMode !== "uuid_only") {
    const secret = decryptFn(storefront.webhook_secret);
    if (!adapter.validateWebhook(headers, rawBody, secret)) {
      const sigFailStatus = storefront.platform === "shopify" ? 401 : 200;
      return { status: sigFailStatus, body: { error: "Invalid webhook signature" } };
    }
  }

  // 3. Parse JSON
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    if (authMode === "uuid_only") {
      return { status: 400, body: { error: "Invalid JSON body" } };
    }
    return { status: 200, body: { error: "Invalid JSON body" } };
  }

  // For uuid_only submissions, enforce the normalized payload shape before
  // anything downstream sees it. HMAC senders keep their adapter-specific
  // validation path so existing Shopify/EasyOrders/WooCommerce/Lightfunnels
  // server-to-server flows remain untouched.
  if (authMode === "uuid_only") {
    const validation = validateUuidOnlyPayload(payload);
    if (!validation.ok) {
      await logWebhookDelivery({
        adminClient,
        source: storefront.platform,
        event: "unknown",
        payload,
        status: "error",
        orderId: null,
        storefrontId,
        externalId: null,
        errorMessage: validation.error,
        deliveryHeaders,
      });
      return { status: 400, body: { error: validation.error } };
    }
  }

  // 4. Parse event type and map to internal order
  let eventType: WebhookEventType;
  try {
    eventType = adapter.parseEventType(payload, headers);
  } catch (err) {
    if (err instanceof PayloadMappingError) {
      return { status: 200, body: { error: err.message } };
    }
    throw err;
  }

  // Extract external_id for idempotency check (best-effort — null if unparseable)
  let externalId: string | null = null;
  try {
    const mapped = adapter.mapToInternalOrder(payload);
    externalId = mapped.external_id ?? null;
  } catch {
    // Unparseable payload — idempotency check skipped, handler will surface the error
  }

  // 5. Idempotency pre-check.
  //
  // Two layered dedupe keys:
  //   (a) delivery_id  — the source's per-delivery identifier. Stable across
  //       retries. Used when the source exposes one (Shopify: X-Shopify-Webhook-Id).
  //       Discriminates *deliveries*, so legitimate later events (orders/updated
  //       after orders/create) carry a different delivery_id and are NOT deduped.
  //   (b) (external_id, event) — legacy fallback for sources without a
  //       per-delivery ID. Coarser but still correct for the create/update/cancel
  //       trichotomy because `event` is part of the key.
  //
  // Replay explicitly bypasses this — downstream order-level idempotency
  // still protects against duplicate writes.
  if (!allowReplay) {
    const priorLog = deliveryHeaders.deliveryId
      ? await findPriorByDeliveryId(adminClient, storefrontId, deliveryHeaders.deliveryId)
      : externalId
        ? await findPriorByLegacyKey(adminClient, storefrontId, externalId, eventType)
        : null;

    if (priorLog) {
      await logWebhookDelivery({
        adminClient,
        source: storefront.platform,
        event: eventType,
        payload,
        status: "ignored",
        orderId: priorLog.order_id ?? null,
        storefrontId,
        externalId,
        deliveryHeaders,
      });
      return {
        status: 200,
        body: {
          success: true,
          duplicate: true,
          order_id: priorLog.order_id ?? undefined,
        },
      };
    }
  }

  // 6. Dispatch and log
  let result: WebhookResult;
  let logStatus: "processed" | "ignored" | "error";
  let logOrderId: string | null = null;

  try {
    if (eventType === "order.created") {
      result = await handleOrderCreated(adminClient, adapter, payload, storefront, rawBody);
    } else if (eventType === "order.updated") {
      result = await handleOrderUpdated(adminClient, adapter, payload, storefront, rawBody);
    } else if (eventType === "order.cancelled") {
      result = await handleOrderCancelled(adminClient, adapter, payload, storefront);
    } else {
      result = { status: 200, body: { error: `Unhandled event type: ${eventType}` } };
    }
  } catch (err) {
    result = { status: 200, body: { error: "Internal error" } };
    await logWebhookDelivery({
      adminClient,
      source: storefront.platform,
      event: eventType,
      payload,
      status: "error",
      orderId: null,
      storefrontId,
      externalId,
      errorMessage: err instanceof Error ? err.message : String(err),
      deliveryHeaders,
    });
    return result;
  }

  // Classify the log row. Sub-handlers signal outcome via the response body
  // shape: a `success` field plus optional `duplicate`/`skipped` flags, OR an
  // `error` string when mapping/validation rejected the payload. Without this
  // branch, any `{ error: "..." }` result was silently logged as `processed` —
  // which hid every "Missing customer phone" failure from operators.
  let logErrorMessage: string | null = null;
  if (typeof result.body.error === "string") {
    logStatus = "error";
    logErrorMessage = result.body.error;
  } else if (result.body.duplicate === true || result.body.skipped === true) {
    logStatus = "ignored";
  } else {
    logStatus = "processed";
  }

  if (typeof result.body.order_id === "string") {
    logOrderId = result.body.order_id;
  }

  await logWebhookDelivery({
    adminClient,
    source: storefront.platform,
    event: eventType,
    payload,
    status: logStatus,
    orderId: logOrderId,
    storefrontId,
    externalId,
    errorMessage: logErrorMessage,
    deliveryHeaders,
  });

  return result;
}

async function handleOrderCreated(
  adminClient: SupabaseClient,
  adapter: ReturnType<typeof getAdapter>,
  payload: unknown,
  storefront: { id: string; market_id: string; config: unknown },
  rawBody: string
): Promise<WebhookResult> {
  let orderData;
  try {
    orderData = adapter.mapToInternalOrder(payload);
  } catch (err) {
    if (err instanceof PayloadMappingError) {
      return { status: 200, body: { error: err.message } };
    }
    throw err;
  }

  // Resolve the webhook payload to OMS entities. Product still runs its
  // strongest-first fallback chain (explicit mapping -> sku -> name); city is
  // a single-stage name match (the storefront city is a constrained dropdown
  // value that mirrors our destination table). The order's mapping_status is
  // the worst of the two outcomes — it drives the /mappings review surface,
  // NOT the order lifecycle (status stays 'pending').
  const productResolution = await resolveProduct(adminClient, {
    storefront_id: storefront.id,
    market_id: storefront.market_id,
    external_variant_id: orderData.external_variant_id ?? null,
    sku: orderData.sku,
    product_name: orderData.product_name,
  });
  const cityResolution = await resolveCity(adminClient, {
    platform: orderData.external_platform,
    market_id: storefront.market_id,
    customer_city: orderData.customer_city,
  });
  const mappingStatus = worstMappingStatus(
    productMatchStatus(productResolution.match_method),
    cityMatchStatus(cityResolution.match_method),
  );

  const { data: order, error: insertError } = await adminClient
    .from("orders")
    .insert({
      market_id: storefront.market_id,
      storefront_id: storefront.id,
      external_id: orderData.external_id,
      external_platform: orderData.external_platform,
      status: "pending",
      customer_name: orderData.customer_name,
      customer_phone: orderData.customer_phone,
      customer_address: orderData.customer_address,
      customer_city: orderData.customer_city,
      customer_note: orderData.customer_note,
      product_id: productResolution.product_id,
      product_variant_id: productResolution.product_variant_id,
      product_name: orderData.product_name,
      variant_label: orderData.variant_label,
      quantity: orderData.quantity,
      unit_price: orderData.unit_price,
      total_price: orderData.total_price,
      city_id: cityResolution.city_id,
      dexpress_state_id: cityResolution.dexpress_state_id,
      mapping_status: mappingStatus,
      external_product_id: orderData.external_product_id ?? null,
      external_variant_id: orderData.external_variant_id ?? null,
      external_route_id: orderData.external_route_id ?? null,
      currency: orderData.currency ?? null,
      raw_payload: JSON.parse(rawBody),
    })
    .select("id")
    .single();

  // Duplicate: unique constraint violation on (storefront_id, external_id)
  if (insertError && (insertError as { code?: string }).code === "23505") {
    const { data: existing } = await adminClient
      .from("orders")
      .select("id")
      .eq("storefront_id", storefront.id)
      .eq("external_id", orderData.external_id)
      .single();

    return {
      status: 200,
      body: { success: true, order_id: existing?.id, duplicate: true },
    };
  }

  if (insertError || !order) {
    return { status: 200, body: { error: "Failed to create order" } };
  }

  // Insert initial order_history (append-only — standard intake row).
  await adminClient.from("order_history").insert({
    order_id: order.id,
    status_from: null,
    status_to: "pending",
    actor_id: null,
    actor_type: "system",
    note: "Order received via webhook",
  });

  // When the storefront payload did not fully resolve to OMS entities, append
  // a second system note so the unresolved mapping is visible in the order's
  // history (the /mappings review surface uses orders.mapping_status; this is
  // the human-readable trail). Append-only — never updates the intake row.
  if (mappingStatus !== "mapped") {
    const parts: string[] = [];
    if (productMatchStatus(productResolution.match_method) !== "mapped") {
      parts.push(
        productResolution.product_id
          ? `product matched by name only (variant ${orderData.external_variant_id ?? "n/a"})`
          : `product unmatched (variant ${orderData.external_variant_id ?? "n/a"})`,
      );
    }
    if (cityMatchStatus(cityResolution.match_method) !== "mapped") {
      // City is name-only resolution: an unmatched city means the storefront
      // dropdown value isn't in our destination table.
      parts.push(`city unmatched ("${orderData.customer_city ?? "n/a"}")`);
    }
    await adminClient.from("order_history").insert({
      order_id: order.id,
      status_from: "pending",
      status_to: "pending",
      actor_id: null,
      actor_type: "system",
      note: `Mapping needs review: ${parts.join("; ")}`,
    });
  }

  // Auto-assignment (best-effort — never blocks webhook response)
  try {
    await tryAutoAssign(adminClient, {
      id: order.id,
      market_id: storefront.market_id,
      product_id: productResolution.product_id,
      customer_city: orderData.customer_city,
      city_id: cityResolution.city_id,
    });
  } catch {
    // Order stays 'pending' for manual assignment
  }

  return {
    status: 200,
    body: { success: true, order_id: order.id },
  };
}

async function handleOrderUpdated(
  adminClient: SupabaseClient,
  adapter: ReturnType<typeof getAdapter>,
  payload: unknown,
  storefront: { id: string; market_id: string; config: unknown },
  rawBody: string
): Promise<WebhookResult> {
  let orderData;
  try {
    orderData = adapter.mapToInternalOrder(payload);
  } catch (err) {
    if (err instanceof PayloadMappingError) {
      return { status: 200, body: { error: err.message } };
    }
    throw err;
  }

  const { data: existing } = await adminClient
    .from("orders")
    .select("id, status")
    .eq("storefront_id", storefront.id)
    .eq("external_id", orderData.external_id)
    .single();

  if (!existing) {
    // Order doesn't exist yet — treat as creation
    return handleOrderCreated(adminClient, adapter, payload, storefront, rawBody);
  }

  // Only update if pre-dispatch
  if (!PRE_DISPATCH_STATUSES.has(existing.status)) {
    return { status: 200, body: { success: true, order_id: existing.id, skipped: true } };
  }

  // Only update customer fields — NEVER update product, financial, or raw_payload fields
  const customerUpdate: Record<string, unknown> = {
    customer_name: orderData.customer_name,
    customer_phone: orderData.customer_phone,
    customer_address: orderData.customer_address,
    customer_city: orderData.customer_city,
    customer_note: orderData.customer_note,
  };
  // Only touch dexpress_state_id when the payload actually resolved one. A null
  // from the adapter means "no opinion" — overwriting would wipe a value an
  // agent set manually via the order detail panel.
  if (orderData.dexpress_state_id != null) {
    customerUpdate.dexpress_state_id = orderData.dexpress_state_id;
  }
  await adminClient.from("orders").update(customerUpdate).eq("id", existing.id);

  return { status: 200, body: { success: true, order_id: existing.id } };
}

async function handleOrderCancelled(
  adminClient: SupabaseClient,
  adapter: ReturnType<typeof getAdapter>,
  payload: unknown,
  storefront: { id: string; market_id: string; config: unknown }
): Promise<WebhookResult> {
  let orderData;
  try {
    orderData = adapter.mapToInternalOrder(payload);
  } catch (err) {
    if (err instanceof PayloadMappingError) {
      return { status: 200, body: { error: err.message } };
    }
    throw err;
  }

  const { data: existing } = await adminClient
    .from("orders")
    .select("id, status")
    .eq("storefront_id", storefront.id)
    .eq("external_id", orderData.external_id)
    .single();

  if (!existing) {
    return { status: 200, body: { success: true, skipped: true } };
  }

  if (isTerminalStatus(existing.status) || !PRE_DISPATCH_STATUSES.has(existing.status)) {
    return { status: 200, body: { success: true, order_id: existing.id, skipped: true } };
  }

  try {
    await transitionOrderStatus(adminClient, {
      orderId: existing.id,
      newStatus: "deleted",
      actorId: null,
      actorType: "system",
      note: "Cancelled via storefront webhook",
    });
  } catch {
    return { status: 200, body: { error: "Failed to cancel order" } };
  }

  return { status: 200, body: { success: true, order_id: existing.id } };
}
