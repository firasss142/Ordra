import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdapter } from "@/lib/storefronts/adapter-registry";
import type { WebhookEventType } from "@/lib/storefronts/types";
import { PayloadMappingError } from "@/lib/storefronts/errors";
import { transitionOrderStatus } from "./transition";
import { isTerminalStatus } from "@/types/order-status";
import { tryAutoAssign } from "./auto-assignment-orchestrator";

interface WebhookInput {
  storefrontId: string;
  rawBody: string;
  headers: Headers;
  adminClient: SupabaseClient;
  decryptFn: (ciphertext: string) => string;
}

interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
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
    });
  } catch {
    // Best-effort: log failures must never propagate
  }
}

// Pre-dispatch statuses where updates and cancellations are allowed
const PRE_DISPATCH_STATUSES = new Set([
  "new", "assigned", "attempt_1", "attempt_2", "attempt_3",
  "callback_scheduled", "confirmed",
]);

export async function handleWebhook(input: WebhookInput): Promise<WebhookResult> {
  const { storefrontId, rawBody, headers, adminClient, decryptFn } = input;

  // 1. Look up storefront
  const { data: storefront, error: sfError } = await adminClient
    .from("storefronts")
    .select("id, market_id, platform, config, webhook_secret, is_active")
    .eq("id", storefrontId)
    .single();

  if (sfError || !storefront || !storefront.is_active) {
    return { status: 200, body: { error: "Storefront not found or inactive" } };
  }

  // 2. Decrypt secret and validate webhook
  const secret = decryptFn(storefront.webhook_secret);
  const adapter = getAdapter(storefront.platform);

  if (!adapter.validateWebhook(headers, rawBody, secret)) {
    return { status: 200, body: { error: "Invalid webhook signature" } };
  }

  // 3. Parse JSON
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 200, body: { error: "Invalid JSON body" } };
  }

  // 4. Parse event type and map to internal order
  let eventType: WebhookEventType;
  try {
    eventType = adapter.parseEventType(payload);
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

  // 5. Idempotency pre-check: if this (storefront_id, external_id, event) was already processed, short-circuit
  if (externalId) {
    const { data: priorLog } = await adminClient
      .from("webhook_delivery_log")
      .select("id, status, order_id")
      .eq("storefront_id", storefrontId)
      .eq("external_id", externalId)
      .maybeSingle();

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
    });
    return result;
  }

  if (result.body.duplicate === true || result.body.skipped === true) {
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

  // Resolve product_id: try SKU first (exact match), then name (case-insensitive)
  let product: { id: string } | null = null;

  if (orderData.sku) {
    const { data: skuMatch } = await adminClient
      .from("products")
      .select("id")
      .eq("market_id", storefront.market_id)
      .eq("sku", orderData.sku)
      .limit(1)
      .maybeSingle();
    product = skuMatch;
  }

  if (!product) {
    const { data: nameMatch } = await adminClient
      .from("products")
      .select("id")
      .eq("market_id", storefront.market_id)
      .ilike("name", orderData.product_name)
      .limit(1)
      .maybeSingle();
    product = nameMatch;
  }

  const { data: order, error: insertError } = await adminClient
    .from("orders")
    .insert({
      market_id: storefront.market_id,
      storefront_id: storefront.id,
      external_id: orderData.external_id,
      external_platform: orderData.external_platform,
      status: "new",
      customer_name: orderData.customer_name,
      customer_phone: orderData.customer_phone,
      customer_address: orderData.customer_address,
      customer_city: orderData.customer_city,
      customer_note: orderData.customer_note,
      product_id: product?.id ?? null,
      product_name: orderData.product_name,
      variant_label: orderData.variant_label,
      quantity: orderData.quantity,
      unit_price: orderData.unit_price,
      total_price: orderData.total_price,
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

  // Insert initial order_history
  await adminClient.from("order_history").insert({
    order_id: order.id,
    status_from: null,
    status_to: "new",
    actor_id: null,
    actor_type: "system",
    note: "Order received via webhook",
  });

  // Auto-assignment (best-effort — never blocks webhook response)
  try {
    await tryAutoAssign(adminClient, {
      id: order.id,
      market_id: storefront.market_id,
      product_id: product?.id ?? null,
      customer_city: orderData.customer_city,
    });
  } catch {
    // Order stays 'new' for manual assignment
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
  await adminClient
    .from("orders")
    .update({
      customer_name: orderData.customer_name,
      customer_phone: orderData.customer_phone,
      customer_address: orderData.customer_address,
      customer_city: orderData.customer_city,
      customer_note: orderData.customer_note,
    })
    .eq("id", existing.id);

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
      newStatus: "cancelled",
      actorId: null,
      actorType: "system",
      note: "Cancelled via storefront webhook",
    });
  } catch {
    return { status: 200, body: { error: "Failed to cancel order" } };
  }

  return { status: 200, body: { success: true, order_id: existing.id } };
}
