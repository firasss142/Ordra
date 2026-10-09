/**
 * X-Delivery (Tunisia) — published company API: `add-parcel`, `delete-parcel`.
 * Plan: plans/xdelivery-integration.md.
 *
 * Facts that shape this file, all observed against the live API on 2026-10-05:
 *   - Auth is the `x-api-key` header; a bad key answers 401 "Invalid API Key".
 *   - Every body value is a string. The validator requires uniqueIdentifier,
 *     customerName, customerPhone1, address, governorateName, price,
 *     designation, exchange and quantity; delegationName and comment are
 *     optional despite the doc's asterisks.
 *   - Errors are NestJS-shaped: `{ message: string | string[], statusCode }`.
 *   - Barcodes are 15 digits in practice (the doc shows 12) and may come back
 *     as a number: always stringify, never check a length.
 *   - `delete-parcel` answers 404 "not found or already processed" once their
 *     depot has the parcel, so a void only works before pickup.
 *
 * A payload that cannot be sent (bad phone, unknown governorate, delegation
 * from another governorate) is not thrown: `formatPayload` marks it
 * `__invalid` and `dispatch` answers a local 422 without calling the carrier,
 * so the agent reads a precise refusal instead of a 500.
 */

import type {
  CarrierAdapter,
  CarrierOrderData,
  CarrierConfig,
  CarrierRawResponse,
  CarrierDispatchResult,
  CarrierVoidResult,
} from "../types";
import { CarrierDispatchError } from "../errors";
import { normalizeTunisianPhone, resolveXDeliveryDestination } from "./destinations";

export const XDELIVERY_DEFAULT_ENDPOINT = "https://app.x-delivery.io/api/company";

/** Dispatch-time picks the upload modal puts in `extra` (persisted on carrier_extra). */
export const XDELIVERY_GOVERNORATE_EXTRA = "xdelivery_governorate";
export const XDELIVERY_DELEGATION_EXTRA = "xdelivery_delegation";

const INVALID = "__invalid";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function designationOf(order: CarrierOrderData): { designation: string; quantity: number } {
  const items = order.order_items ?? [];
  if (items.length > 1) {
    return {
      designation: items
        .map((it) => `${it.quantity}× ${it.product_name}${it.variant_label ? ` - ${it.variant_label}` : ""}`)
        .join(" + "),
      quantity: items.reduce((n, it) => n + it.quantity, 0),
    };
  }
  return {
    designation: order.variant_label ? `${order.product_name} - ${order.variant_label}` : order.product_name,
    quantity: order.quantity,
  };
}

function messageOf(body: unknown): string {
  if (body && typeof body === "object") {
    const m = (body as Record<string, unknown>).message;
    if (Array.isArray(m)) return m.map(String).join(" · ");
    if (typeof m === "string") return m;
    try {
      return JSON.stringify(body).slice(0, 200);
    } catch {
      return "";
    }
  }
  return typeof body === "string" ? body.slice(0, 200) : "";
}

export class XDeliveryAdapter implements CarrierAdapter {
  formatPayload(
    order: CarrierOrderData,
    config: CarrierConfig,
    extra?: Record<string, unknown>,
  ): Record<string, string> {
    const destination = resolveXDeliveryDestination({
      customerCity: order.customer_city,
      governorate: str(extra?.[XDELIVERY_GOVERNORATE_EXTRA]),
      delegation: str(extra?.[XDELIVERY_DELEGATION_EXTRA]),
    });
    if (!destination.ok) {
      return {
        [INVALID]:
          destination.reason === "unknown_governorate"
            ? `Gouvernorat introuvable pour « ${order.customer_city ?? ""} » : choisissez-le avant l'envoi.`
            : "Cette délégation n'appartient pas au gouvernorat choisi.",
      };
    }

    const phone1 = normalizeTunisianPhone(order.customer_phone);
    if (!phone1) {
      return { [INVALID]: `Téléphone invalide (« ${order.customer_phone} ») : X-Delivery exige 8 chiffres.` };
    }
    const phone2 = normalizeTunisianPhone(order.customer_phone_2);
    const { designation, quantity } = designationOf(order);
    const note = str(order.customer_note);

    const payload: Record<string, string> = {
      uniqueIdentifier: config.apiCredentials.unique_identifier ?? "",
      address: str(order.customer_address) ?? `${destination.delegation}, ${destination.governorate}`,
      customerName: order.customer_name,
      customerPhone1: phone1,
      governorateName: destination.governorate,
      delegationName: destination.delegation,
      exchange: "false",
      price: String(order.total_price),
      designation,
      quantity: String(quantity),
      isOpened: config.apiCredentials.is_opened === "1" ? "true" : "false",
    };
    if (phone2 && phone2 !== phone1) payload.customerPhone2 = phone2;
    if (note) payload.comment = note;
    return payload;
  }

  async dispatch(payload: Record<string, string>, config: CarrierConfig): Promise<CarrierRawResponse> {
    if (payload[INVALID]) {
      return { status: 422, body: { message: payload[INVALID] } };
    }

    let response: Response;
    try {
      response = await fetch(`${config.apiEndpoint || XDELIVERY_DEFAULT_ENDPOINT}/add-parcel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": config.apiCredentials.api_key ?? "" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new CarrierDispatchError(
        `X-Delivery API request failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }

    let body: unknown;
    const text = await response.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: response.status, body };
  }

  parseResponse(raw: CarrierRawResponse): CarrierDispatchResult {
    if (raw.status === 200 || raw.status === 201) {
      const barcode = (raw.body as Record<string, unknown> | null)?.barcode;
      if (barcode !== undefined && barcode !== null && String(barcode).trim()) {
        return { success: true, trackingNumber: String(barcode).trim() };
      }
      return {
        success: false,
        errorCode: "XDELIVERY_VALIDATION",
        errorMessage: messageOf(raw.body) || "Réponse X-Delivery sans code-barres",
        retryable: false,
      };
    }
    if (raw.status === 400 || raw.status === 422) {
      return {
        success: false,
        errorCode: "XDELIVERY_VALIDATION",
        errorMessage: messageOf(raw.body) || "Validation error",
        retryable: false,
      };
    }
    if (raw.status === 401 || raw.status === 403) {
      return {
        success: false,
        errorCode: "XDELIVERY_CONFIG",
        errorMessage: `Clé API X-Delivery refusée (${messageOf(raw.body) || `HTTP ${raw.status}`})`,
        retryable: false,
      };
    }
    const excerpt = messageOf(raw.body);
    return {
      success: false,
      errorCode: "XDELIVERY_TRANSIENT",
      errorMessage: `X-Delivery temporairement indisponible (HTTP ${raw.status}${excerpt ? `: ${excerpt}` : ""})`,
      retryable: true,
    };
  }

  async voidDispatch(trackingNumber: string, config: CarrierConfig): Promise<CarrierVoidResult> {
    const url = `${config.apiEndpoint || XDELIVERY_DEFAULT_ENDPOINT}/delete-parcel?barcode=${encodeURIComponent(trackingNumber)}`;
    try {
      const response = await fetch(url, {
        method: "DELETE",
        headers: { "x-api-key": config.apiCredentials.api_key ?? "" },
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) return { success: true, supported: true };
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // body is informational only
      }
      return { success: false, supported: true, reason: messageOf(body) || `HTTP ${response.status}` };
    } catch (err) {
      return { success: false, supported: true, reason: err instanceof Error ? err.message : String(err) };
    }
  }
}
