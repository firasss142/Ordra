/**
 * Dexpress current-status fetch — reads from /merchant/ajax-order-case/{id}.
 *
 * Two exports:
 *  - parseAjaxOrderCase(trackingNumber, responseText)
 *      Pure. Takes the raw response body, returns a DexpressStatusSnapshot
 *      (discriminated union: `kind: "ok" | "not_found"`). Throws
 *      CarrierDispatchError only on truly unexpected shapes — never on
 *      Dexpress-side 404 (clean signal) or unknown status IDs (graceful
 *      degradation per the briefing).
 *
 *  - fetchDexpressStatus(trackingNumber, client) — added in Step 3 once
 *    DexpressClient.getJsonEndpoint exists.
 *
 * Response shape confirmed empirically by scripts/probe-dexpress-ajax-status.ts
 * on 2026-05-25 across 3 statuses + the bad-ID case. See
 * plans/dexpress-order-status-display.md → "Empirical findings".
 */

import { CarrierDispatchError } from "../errors";
import {
  findStatusById,
  findStatusByLabel,
  type DexpressSlug,
} from "./statuses";
import type { DexpressClient } from "./client";

export type DexpressStatusSnapshot =
  | {
      kind: "ok";
      trackingNumber: string;
      slug: DexpressSlug | null;
      statusId: number | null;
      rawLabel: string;
      isAccepted: boolean;
    }
  | {
      kind: "not_found";
      trackingNumber: string;
    };

interface RawAjaxOrderCase {
  response_case?: unknown;
  order_status?: unknown;
  order_accept?: unknown;
  status_name?: unknown;
}

export function parseAjaxOrderCase(
  trackingNumber: string,
  responseText: string
): DexpressStatusSnapshot {
  let parsed: RawAjaxOrderCase;
  try {
    parsed = JSON.parse(responseText) as RawAjaxOrderCase;
  } catch (e) {
    throw new CarrierDispatchError(
      `DEXPRESS_TRACKING_MALFORMED_JSON: ${(e as Error).message}`
    );
  }

  if (typeof parsed.response_case !== "number") {
    throw new CarrierDispatchError(
      "DEXPRESS_TRACKING_UNEXPECTED_RESPONSE_CASE: missing or non-numeric response_case"
    );
  }

  if (parsed.response_case === 404) {
    return { kind: "not_found", trackingNumber };
  }

  if (parsed.response_case !== 201) {
    throw new CarrierDispatchError(
      `DEXPRESS_TRACKING_UNEXPECTED_RESPONSE_CASE: ${parsed.response_case}`
    );
  }

  const rawLabel =
    typeof parsed.status_name === "string" ? parsed.status_name : "";
  const isAccepted = parsed.order_accept === "1";

  // Primary lookup: numeric status ID from the response.
  let statusId: number | null = null;
  let slug: DexpressSlug | null = null;

  if (typeof parsed.order_status === "string" && parsed.order_status !== "") {
    const idNum = Number(parsed.order_status);
    if (Number.isFinite(idNum)) {
      statusId = idNum;
      slug = findStatusById(idNum)?.slug ?? null;
    }
  }

  // Fallback lookup: Arabic label, in case Dexpress ever drops order_status.
  if (slug === null && rawLabel.length > 0) {
    const byLabel = findStatusByLabel(rawLabel);
    if (byLabel) {
      slug = byLabel.slug;
      if (statusId === null) statusId = byLabel.id;
    }
  }

  return {
    kind: "ok",
    trackingNumber,
    slug,
    statusId,
    rawLabel,
    isAccepted,
  };
}

/**
 * Fetches the current Dexpress status for an order. Thin wrapper around
 * DexpressClient.getJsonEndpoint + parseAjaxOrderCase — exists so callers
 * (route handler, scripts, future polling) don't need to wire those two
 * pieces together themselves.
 */
export async function fetchDexpressStatus(
  trackingNumber: string,
  client: DexpressClient
): Promise<DexpressStatusSnapshot> {
  const path = `/merchant/ajax-order-case/${encodeURIComponent(trackingNumber)}`;
  const { bodyText } = await client.getJsonEndpoint(path);
  return parseAjaxOrderCase(trackingNumber, bodyText);
}
