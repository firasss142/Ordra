/**
 * Shared pieces of the manifest routes (docs/xdelivery-manifests.md).
 *
 * Every refusal reaches the screen as `{ error_code, message }` with a status the
 * client can branch on. The codes come from the RPCs' `DETAIL` JSON
 * (supabase/migrations/20261008120000_carrier_manifests.sql) and from PickupError
 * (src/lib/carriers/xdelivery/pickup.ts); the full list is in the doc.
 */

import { NextResponse } from "next/server";
import { PickupError, type PickupErrorCode } from "@/lib/carriers/xdelivery/pickup";

/** The `code` inside a Postgres error's DETAIL JSON, or null. */
export function rpcDetailCode(error: { details?: unknown } | null | undefined): string | null {
  const details = error?.details;
  if (typeof details !== "string") return null;
  try {
    const code = (JSON.parse(details) as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

/** RPC refusal code → HTTP status. Anything unlisted is a 409 (a state conflict). */
export const MANIFEST_RPC_STATUS: Record<string, number> = {
  ACTOR_MISMATCH: 403,
  ACTOR_NOT_FOUND: 403,
  FORBIDDEN: 403,
  NO_SITE_ASSIGNED: 403,
  MARKET_MISMATCH: 403,
  WRONG_SITE: 403,
  MANIFEST_NOT_FOUND: 404,
  PARCEL_NOT_FOUND: 404,
  BAD_CODE: 400,
  REASON_REQUIRED: 400,
  NOTE_REQUIRED: 400,
  NOT_A_RETURN_MANIFEST: 409,
  DELIVERED_CONFLICT: 409,
  INVALID_STATUS: 409,
  MANIFEST_CLOSED: 409,
  ALREADY_DAMAGED: 409,
  NOT_RECEIVED: 409,
  STOCK_MOVED: 409,
};

export function manifestRpcErrorResponse(
  error: { message?: string; details?: unknown } | null,
  fallback = "MANIFEST_RPC_FAILED",
): NextResponse {
  const code = rpcDetailCode(error);
  return NextResponse.json(
    { error_code: code ?? fallback, message: error?.message ?? "" },
    { status: code ? (MANIFEST_RPC_STATUS[code] ?? 409) : 500 },
  );
}

const PICKUP_STATUS: Record<PickupErrorCode, number> = {
  NO_PORTAL_LOGIN: 409,
  NOTHING_TO_REQUEST: 409,
  MANIFEST_NOT_FOUND: 404,
  NOT_A_PICKUP_LIST: 409,
  LIST_DELETED: 409,
};

/**
 * A pickup refusal, or X-Delivery's portal failing. Their portal is undocumented
 * and answers 5xx at times: that is a 502 the screen can retry, never a 500 that
 * reads like an Ordra bug. Anything else is rethrown for withRouteErrors.
 */
export function pickupErrorResponse(err: unknown): NextResponse {
  if (err instanceof PickupError) {
    return NextResponse.json({ error_code: err.code, message: err.message }, { status: PICKUP_STATUS[err.code] });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/portail X-Delivery/i.test(message)) {
    const login = /connexion au portail/i.test(message);
    return NextResponse.json(
      { error_code: login ? "PORTAL_LOGIN_REFUSED" : "CARRIER_UNAVAILABLE", message },
      { status: 502 },
    );
  }
  throw err;
}

/** Their barcode or our QR, as scanned: every whitespace gone. */
export function normalizeScannedCode(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s/g, "") : "";
}

/** The `return_reason` enum — the « Endommagé » reasons. */
export const RETURN_REASONS = ["packaging", "product_defect", "customer_damage", "carrier_damage", "other"] as const;

/** UUID shape: our QR is the order id. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
