import { timingSafeEqual } from "crypto";
import { mapDexpressStatus } from "./carriers/polling/status-map";
import { canTransition, type OrderStatus } from "@/types/order-status";

export interface DexpressOrderLookup {
  id: string;
  status: OrderStatus;
}

export interface DexpressLogEntry {
  carrier_code: "dexpress";
  source: "webhook";
  tracking_number: string | null;
  carrier_status_raw: string | null;
  order_id: string | null;
  outcome: "processed" | "ignored" | "error";
  outcome_reason: string | null;
  raw_body: unknown;
}

export interface DexpressApplyInput {
  orderId: string;
  newStatus: OrderStatus;
  isDamaged: boolean;
  note: string;
}

export interface DexpressWebhookDeps {
  expectedToken: string;
  findOrderByTracking: (tracking: string) => Promise<DexpressOrderLookup | null>;
  findOrderByExternalId: (externalId: string) => Promise<DexpressOrderLookup | null>;
  applyFulfillment: (input: DexpressApplyInput) => Promise<void>;
  writeLog: (entry: DexpressLogEntry) => Promise<void>;
}

export interface DexpressWebhookRequest {
  token: string | null;
  rawBody: string;
  deps: DexpressWebhookDeps;
}

export interface DexpressWebhookResult {
  status: 200;
  body: { received: true };
}

const OK: DexpressWebhookResult = { status: 200, body: { received: true } };

function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function safeLog(
  deps: DexpressWebhookDeps,
  entry: DexpressLogEntry
): Promise<void> {
  try {
    await deps.writeLog(entry);
  } catch {
    // Best-effort: log failures never propagate.
  }
}

export async function handleDexpressWebhook(
  req: DexpressWebhookRequest
): Promise<DexpressWebhookResult> {
  const { token, rawBody, deps } = req;

  // 1. Auth
  if (!token || !tokensMatch(token, deps.expectedToken)) {
    await safeLog(deps, {
      carrier_code: "dexpress",
      source: "webhook",
      tracking_number: null,
      carrier_status_raw: null,
      order_id: null,
      outcome: "error",
      outcome_reason: "invalid_token",
      raw_body: null,
    });
    return OK;
  }

  // 2. Parse JSON
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await safeLog(deps, {
      carrier_code: "dexpress",
      source: "webhook",
      tracking_number: null,
      carrier_status_raw: null,
      order_id: null,
      outcome: "error",
      outcome_reason: "invalid_json",
      raw_body: rawBody,
    });
    return OK;
  }

  // 3. Validate shape
  if (!isDexpressPayload(payload)) {
    await safeLog(deps, {
      carrier_code: "dexpress",
      source: "webhook",
      tracking_number: null,
      carrier_status_raw: null,
      order_id: null,
      outcome: "error",
      outcome_reason: "malformed_payload",
      raw_body: payload,
    });
    return OK;
  }

  const { order_snum, status_key, name_status, order_reference } = payload;
  const trackingNumber = String(order_snum);

  // 4. Map status
  const mapping = mapDexpressStatus(status_key, name_status);
  if (!mapping) {
    await safeLog(deps, {
      carrier_code: "dexpress",
      source: "webhook",
      tracking_number: trackingNumber,
      carrier_status_raw: String(status_key),
      order_id: null,
      outcome: "ignored",
      outcome_reason: `unknown_status_key:${status_key}`,
      raw_body: payload,
    });
    return OK;
  }

  // 5. Order lookup: tracking_number → external_id fallback
  let order: DexpressOrderLookup | null = null;
  try {
    order = await deps.findOrderByTracking(trackingNumber);
    if (!order && order_reference) {
      order = await deps.findOrderByExternalId(order_reference);
    }
  } catch (err) {
    console.error("dexpress webhook: order lookup failed", err);
    await safeLog(deps, {
      carrier_code: "dexpress",
      source: "webhook",
      tracking_number: trackingNumber,
      carrier_status_raw: String(status_key),
      order_id: null,
      outcome: "error",
      outcome_reason: "lookup_error",
      raw_body: payload,
    });
    return OK;
  }

  if (!order) {
    await safeLog(deps, {
      carrier_code: "dexpress",
      source: "webhook",
      tracking_number: trackingNumber,
      carrier_status_raw: String(status_key),
      order_id: null,
      outcome: "ignored",
      outcome_reason: "order_not_found",
      raw_body: payload,
    });
    return OK;
  }

  // 6. Transition guard (idempotency: duplicate webhooks caught here)
  if (!canTransition(order.status, mapping.statusTo)) {
    await safeLog(deps, {
      carrier_code: "dexpress",
      source: "webhook",
      tracking_number: trackingNumber,
      carrier_status_raw: String(status_key),
      order_id: order.id,
      outcome: "ignored",
      outcome_reason: `invalid_transition:${order.status}_to_${mapping.statusTo}`,
      raw_body: payload,
    });
    return OK;
  }

  // 7. Apply transition
  try {
    await deps.applyFulfillment({
      orderId: order.id,
      newStatus: mapping.statusTo,
      isDamaged: mapping.isDamaged,
      note: mapping.note,
    });
  } catch (err) {
    console.error("dexpress webhook: applyFulfillment failed", err);
    await safeLog(deps, {
      carrier_code: "dexpress",
      source: "webhook",
      tracking_number: trackingNumber,
      carrier_status_raw: String(status_key),
      order_id: order.id,
      outcome: "error",
      outcome_reason: "processing_error",
      raw_body: payload,
    });
    return OK;
  }

  // 8. Success
  await safeLog(deps, {
    carrier_code: "dexpress",
    source: "webhook",
    tracking_number: trackingNumber,
    carrier_status_raw: String(status_key),
    order_id: order.id,
    outcome: "processed",
    outcome_reason: null,
    raw_body: payload,
  });
  return OK;
}

interface DexpressPayload {
  order_snum: number;
  status_key: number;
  name_status: string;
  order_reference?: string;
}

function isDexpressPayload(p: unknown): p is DexpressPayload {
  if (!p || typeof p !== "object") return false;
  const obj = p as Record<string, unknown>;
  return typeof obj.order_snum === "number"
    && typeof obj.status_key === "number"
    && typeof obj.name_status === "string"
    && obj.name_status.length > 0;
}
