/**
 * X-Delivery status webhook — the pure handler behind POST /api/webhooks/xdelivery.
 *
 * Contract (their doc + portal, 2026-10-05): one POST per status change,
 * body `{ barcode: number, status, motif }`, header
 * `Authorization: Bearer <the account's API key>`. The URL is set by their
 * support, not by us. There is no signature, timestamp or event id; the
 * Bearer IS the API key, so rotating the key silently breaks the webhook —
 * the 10-minute poll is the safety net either way.
 *
 * The matching key also says WHICH account sent it, and updates are applied
 * only to that account's parcels.
 *
 * Once authenticated, the answer is 200 even if applying fails: their retry
 * behaviour is undocumented, the failure is in carrier_event_log, and the
 * poll re-reads the parcel within ten minutes.
 */

import type { XDeliveryUpdate, XDeliverySyncResult } from "./sync";

export interface XDeliveryAccountKey {
  carrierId: string;
  apiKey: string;
}

export interface XDeliveryWebhookDeps {
  loadAccounts: () => Promise<XDeliveryAccountKey[]>;
  applyUpdates: (updates: XDeliveryUpdate[], carrierId: string) => Promise<XDeliverySyncResult>;
}

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isUpdate(v: unknown): v is XDeliveryUpdate {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const barcodeOk = (typeof o.barcode === "string" && o.barcode.trim() !== "") || typeof o.barcode === "number";
  return barcodeOk && typeof o.status === "string" && o.status.trim() !== "";
}

export async function handleXDeliveryWebhook(input: {
  authorization: string | null;
  rawBody: string;
  deps: XDeliveryWebhookDeps;
}): Promise<WebhookResponse> {
  const match = /^Bearer\s+(.+)$/i.exec(input.authorization?.trim() ?? "");
  const presented = match?.[1]?.trim() ?? "";
  if (!presented) return { status: 401, body: { error: "unauthorized" } };

  const accounts = await input.deps.loadAccounts();
  // Compare against every account so the timing does not reveal which matched.
  let carrierId: string | null = null;
  for (const a of accounts) {
    if (a.apiKey && timingSafeEqual(presented, a.apiKey) && !carrierId) carrierId = a.carrierId;
  }
  if (!carrierId) return { status: 401, body: { error: "unauthorized" } };

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.length === 0 || !list.every(isUpdate)) {
    return { status: 400, body: { error: "expected { barcode, status, motif }" } };
  }

  try {
    const r = await input.deps.applyUpdates(list, carrierId);
    return { status: 200, body: { received: true, processed: r.processed, ignored: r.ignored } };
  } catch (err) {
    console.error("[xdelivery webhook] apply failed", err instanceof Error ? err.message : err);
    return { status: 200, body: { received: true } };
  }
}
