import { timingSafeEqual } from "crypto";
import { mapNavexEvent } from "./carrier-webhook-engine";
import { canTransition, type OrderStatus } from "@/types/order-status";

export interface NavexOrderLookup {
  id: string;
  status: OrderStatus;
}

export interface NavexLogEntry {
  carrier_code: "navex";
  source: "webhook";
  tracking_number: string | null;
  carrier_status_raw: string | null;
  order_id: string | null;
  outcome: "processed" | "ignored" | "error";
  outcome_reason: string | null;
  raw_body: unknown;
}

export interface NavexApplyInput {
  orderId: string;
  newStatus: OrderStatus;
  isDamaged: boolean;
  note: string;
}

export interface NavexWebhookDeps {
  expectedToken: string;
  findOrderByTracking: (tracking: string) => Promise<NavexOrderLookup | null>;
  findOrderByExternalId: (externalId: string) => Promise<NavexOrderLookup | null>;
  applyFulfillment: (input: NavexApplyInput) => Promise<void>;
  writeLog: (entry: NavexLogEntry) => Promise<void>;
}

export interface NavexWebhookRequest {
  token: string | null;
  rawBody: string;
  deps: NavexWebhookDeps;
}

export interface NavexWebhookResult {
  status: 200;
  body: { received: true };
}

const OK: NavexWebhookResult = { status: 200, body: { received: true } };

function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function safeLog(
  deps: NavexWebhookDeps,
  entry: NavexLogEntry
): Promise<void> {
  try {
    await deps.writeLog(entry);
  } catch {
    // Best-effort: log failures never propagate.
  }
}

export async function handleNavexWebhook(
  req: NavexWebhookRequest
): Promise<NavexWebhookResult> {
  const { token, rawBody, deps } = req;

  // 1. Auth
  if (!token || !tokensMatch(token, deps.expectedToken)) {
    await safeLog(deps, {
      carrier_code: "navex",
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
      carrier_code: "navex",
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
  if (!isNavexPayload(payload)) {
    await safeLog(deps, {
      carrier_code: "navex",
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

  const { tracking_number, event, order_reference } = payload;

  // 4. Map event
  const mapping = mapNavexEvent(event);
  if (!mapping) {
    await safeLog(deps, {
      carrier_code: "navex",
      source: "webhook",
      tracking_number,
      carrier_status_raw: event,
      order_id: null,
      outcome: "ignored",
      outcome_reason: `unknown_event:${event}`,
      raw_body: payload,
    });
    return OK;
  }

  // 5. Order lookup: tracking_number → external_id fallback
  let order: NavexOrderLookup | null = null;
  try {
    order = await deps.findOrderByTracking(tracking_number);
    if (!order && order_reference) {
      order = await deps.findOrderByExternalId(order_reference);
    }
  } catch (err) {
    console.error("navex webhook: order lookup failed", err);
    await safeLog(deps, {
      carrier_code: "navex",
      source: "webhook",
      tracking_number,
      carrier_status_raw: event,
      order_id: null,
      outcome: "error",
      outcome_reason: "lookup_error",
      raw_body: payload,
    });
    return OK;
  }

  if (!order) {
    await safeLog(deps, {
      carrier_code: "navex",
      source: "webhook",
      tracking_number,
      carrier_status_raw: event,
      order_id: null,
      outcome: "ignored",
      outcome_reason: "order_not_found",
      raw_body: payload,
    });
    return OK;
  }

  // 6. Transition guard (idempotency: duplicate webhooks caught here)
  if (!canTransition(order.status, mapping.status_to)) {
    await safeLog(deps, {
      carrier_code: "navex",
      source: "webhook",
      tracking_number,
      carrier_status_raw: event,
      order_id: order.id,
      outcome: "ignored",
      outcome_reason: `invalid_transition:${order.status}_to_${mapping.status_to}`,
      raw_body: payload,
    });
    return OK;
  }

  // 7. Apply transition
  try {
    await deps.applyFulfillment({
      orderId: order.id,
      newStatus: mapping.status_to,
      isDamaged: mapping.damaged ?? false,
      note: mapping.actor_note,
    });
  } catch (err) {
    console.error("navex webhook: applyFulfillment failed", err);
    await safeLog(deps, {
      carrier_code: "navex",
      source: "webhook",
      tracking_number,
      carrier_status_raw: event,
      order_id: order.id,
      outcome: "error",
      outcome_reason: "processing_error",
      raw_body: payload,
    });
    return OK;
  }

  // 8. Success
  await safeLog(deps, {
    carrier_code: "navex",
    source: "webhook",
    tracking_number,
    carrier_status_raw: event,
    order_id: order.id,
    outcome: "processed",
    outcome_reason: null,
    raw_body: payload,
  });
  return OK;
}

interface NavexPayload {
  tracking_number: string;
  event: string;
  timestamp?: string;
  order_reference?: string;
}

function isNavexPayload(p: unknown): p is NavexPayload {
  if (!p || typeof p !== "object") return false;
  const obj = p as Record<string, unknown>;
  return typeof obj.tracking_number === "string"
    && obj.tracking_number.length > 0
    && typeof obj.event === "string"
    && obj.event.length > 0;
}
