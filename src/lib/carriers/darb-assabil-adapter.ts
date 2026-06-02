import type {
  CarrierAdapter,
  CarrierOrderData,
  CarrierConfig,
  CarrierRawResponse,
  CarrierDispatchResult,
  CarrierVoidResult,
} from "./types";
import { CarrierDispatchError, CarrierConfigError } from "./errors";

/**
 * Darb Assabil (v2.sabil.ly) — Libyan COD logistics platform.
 *
 * `formatPayload` validates the order + config and returns a flat
 * Record<string,string> *preview projection* (also drives the carrier-settings
 * dry-run). `dispatch` consumes that snapshot and performs the real two-call
 * flow (contact upsert → shipment create), assembling the nested wire body.
 *
 * Vendor contract notes (see delivery_company_docs/Darb Assabil/INTEGRATION_GUIDE.md):
 *  - HTTP 200 does NOT mean success — always check body.status === true.
 *  - Authorization uses the literal "apikey " prefix (not "Bearer").
 *  - countryCode/currency are lowercase ("lby"/"lyd"); uppercase silently fails.
 *  - phone is E.164 with a leading "+218".
 *  - destination needs BOTH city and area, in Arabic UTF-8.
 *  - tracking_number = the human reference ("SH<digits>"); the internal _id is
 *    returned in result.extra.darb_assabil_id for later status polling.
 *  - Cancellation is a hard delete; we do not support it (voidDispatch).
 *  - paymentBy controls who bears the delivery fee: "sales" deducts it from the
 *    COD settlement (fee included in the customer's price), "receiver" charges
 *    it on top. Driven by the `payment_by` settings toggle (default: included).
 */
export class DarbAssabilAdapter implements CarrierAdapter {
  formatPayload(
    order: CarrierOrderData,
    config: CarrierConfig,
    extra?: Record<string, unknown>
  ): Record<string, string> {
    const creds = config.apiCredentials;

    // Credentials — configuration problems, not order problems.
    if (!creds.api_key) {
      throw new CarrierConfigError("Darb Assabil: clé API (api_key) manquante");
    }
    if (!creds.account_id) {
      throw new CarrierConfigError(
        "Darb Assabil: ID de compte (account_id) manquant"
      );
    }

    // Service plan: per-shipment extra wins, else the configured default
    // (the male-courier plan id). Required either way.
    const serviceId =
      (typeof extra?.service_id === "string" && extra.service_id) ||
      creds.default_service_id ||
      "";
    if (!serviceId) {
      throw new CarrierDispatchError(
        "Darb Assabil: aucun forfait de service (service_id) défini"
      );
    }

    // Destination + recipient — order data problems.
    // City and area MUST come from the same picked (city, area) pair, so prefer
    // the picker's extra.city. Falling back to order.customer_city would risk a
    // mismatched pair (e.g. order city تاجوراء + picked area طرابلس), which the
    // carrier rejects with "Unable to fetch branch 'LBY-<city>,<area>'".
    const city = (
      typeof extra?.city === "string" && extra.city.trim()
        ? extra.city
        : order.customer_city ?? ""
    ).trim();
    const area = (typeof extra?.customer_area === "string"
      ? extra.customer_area
      : ""
    ).trim();
    const address = (order.customer_address ?? "").trim();
    const phoneRaw = (order.customer_phone ?? "").trim();

    if (!phoneRaw) {
      throw new CarrierDispatchError("Darb Assabil: téléphone client manquant");
    }
    if (!city) {
      throw new CarrierDispatchError("Darb Assabil: ville (city) manquante");
    }
    if (!area) {
      throw new CarrierDispatchError("Darb Assabil: zone (area) manquante");
    }
    if (!address) {
      throw new CarrierDispatchError("Darb Assabil: adresse manquante");
    }

    const product = order.variant_label
      ? `${order.product_name} - ${order.variant_label}`
      : order.product_name;

    // Shipping-fee-included toggle (settings switch, stored "1"/"0"; empty = on).
    // On  → "sales": customer pays the product amount, the fee is deducted from
    //        the COD settlement (fee effectively included in the price).
    // Off  → "receiver": the fee is charged to the customer on top.
    const paymentBy = creds.payment_by === "0" ? "receiver" : "sales";

    return {
      service_id: serviceId,
      payment_by: paymentBy,
      country_code: "lby",
      city,
      area,
      address,
      phone: normalizeLibyanPhone(phoneRaw),
      name: order.customer_name,
      product,
      // Single line item, qty 1, amount = full goods price — avoids float
      // precision risk from total_price / quantity (decided for this carrier).
      amount: String(order.total_price),
      quantity: "1",
      currency: "lyd",
      notes: order.customer_note ?? "",
    };
  }

  /**
   * Two sequential calls (vendor has no single "create with new contact" call):
   *   1. Upsert the receiver contact by phone (idempotent — safe every dispatch).
   *   2. Create the shipment referencing that contact id.
   * If the contact step fails we do NOT attempt the shipment. Each returned body
   * is tagged with `_step` so `parseResponse` knows which call it is reading.
   * Transport failures (network throw) surface as `status: 0`.
   */
  async dispatch(
    payload: unknown,
    config: CarrierConfig
  ): Promise<CarrierRawResponse> {
    const p = payload as DarbPayloadSnapshot;
    const base = (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
    const headers = buildHeaders(config);

    // ── 1. Contact upsert ────────────────────────────────────────────
    let contactRaw: { status: number; body: unknown };
    try {
      contactRaw = await postJson(
        `${base}/api/contacts/create/public/contact`,
        headers,
        {
          account: config.apiCredentials.account_id,
          name: p.name,
          phone: p.phone,
        }
      );
    } catch {
      return { status: 0, body: { _step: "contact" } };
    }

    const contactBody = asRecord(contactRaw.body);
    if (contactRaw.status >= 500 || contactBody.status !== true) {
      return { status: contactRaw.status, body: { _step: "contact", ...contactBody } };
    }
    const contactId = (asRecord(contactBody.data)._id as string) ?? null;
    if (!contactId) {
      return { status: contactRaw.status, body: { _step: "contact", ...contactBody } };
    }

    // ── 2. Shipment create ───────────────────────────────────────────
    let shipmentRaw: { status: number; body: unknown };
    try {
      shipmentRaw = await postJson(`${base}/api/local/shipments`, headers, {
        service: p.service_id,
        contacts: [contactId],
        paymentBy: p.payment_by,
        to: {
          countryCode: p.country_code,
          city: p.city,
          area: p.area,
          address: p.address,
        },
        products: [
          {
            title: p.product,
            quantity: 1,
            amount: Number(p.amount),
            currency: p.currency,
            isChargeable: true,
          },
        ],
        notes: p.notes,
      });
    } catch {
      return { status: 0, body: { _step: "shipment" } };
    }

    return {
      status: shipmentRaw.status,
      body: { _step: "shipment", ...asRecord(shipmentRaw.body) },
    };
  }

  parseResponse(raw: CarrierRawResponse): CarrierDispatchResult {
    const body = asRecord(raw.body);
    const step = body._step as "contact" | "shipment" | undefined;

    // A structured rejection is a validation error whose message must reach the
    // agent — even when it arrives with HTTP 500. The carrier returns
    // { status:false, messages } for un-serviceable destinations (e.g. an
    // unknown branch: "Unable to fetch branch 'LBY-x,y'!"). Check this BEFORE
    // the transient fallback so the real reason isn't masked as "unavailable".
    if (body.status === false) {
      const messages = body.messages as Array<{ message?: string }> | undefined;
      const firstMessage = messages?.[0]?.message ?? "Carrier rejected the request";
      return {
        success: false,
        errorCode: step === "contact" ? "DARB_CONTACT_FAILED" : "DARB_VALIDATION",
        errorMessage: firstMessage,
        retryable: false,
      };
    }

    // Transport-level failure with no structured body (network throw → 0, or a
    // 5xx whose body we couldn't parse as a vendor envelope) — retryable.
    if (raw.status === 0 || raw.status >= 500) {
      return {
        success: false,
        errorCode: "DARB_TRANSIENT",
        errorMessage: `Carrier temporarily unavailable (HTTP ${raw.status})`,
        retryable: true,
      };
    }

    // Success must come from the shipment step with a reference + internal id.
    if (body.status === true && step === "shipment") {
      const data = asRecord(body.data);
      const reference = typeof data.reference === "string" ? data.reference : null;
      const internalId = typeof data._id === "string" ? data._id : null;
      if (!reference || !internalId) {
        return {
          success: false,
          errorCode: "DARB_MALFORMED",
          errorMessage: "Carrier returned success but no reference/_id",
          retryable: false,
        };
      }
      return {
        success: true,
        trackingNumber: reference,
        extra: { darb_assabil_id: internalId },
      };
    }

    return {
      success: false,
      errorCode: "DARB_UNKNOWN",
      errorMessage: "Unexpected response shape from carrier",
      retryable: false,
    };
  }

  async voidDispatch(
    _trackingNumber: string,
    _config: CarrierConfig
  ): Promise<CarrierVoidResult> {
    // Vendor cancellation is a hard delete; the integration does not support it.
    return {
      success: false,
      supported: false,
      reason: "Cancellation is not supported by the Darb Assabil integration.",
    };
  }
}

/**
 * The flat snapshot `formatPayload` returns and `dispatch` consumes. Kept as a
 * string map (not the nested wire body) so the carrier-settings dry-run can
 * preview it; `dispatch` assembles the real nested JSON from these fields.
 */
interface DarbPayloadSnapshot {
  service_id: string;
  payment_by: string;
  country_code: string;
  city: string;
  area: string;
  address: string;
  phone: string;
  name: string;
  product: string;
  amount: string;
  quantity: string;
  currency: string;
  notes: string;
}

/** The three headers every Darb Assabil request needs (apikey literal prefix). */
function buildHeaders(config: CarrierConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `apikey ${config.apiCredentials.api_key}`,
    "X-API-VERSION": "1.0.0",
    "X-ACCOUNT-ID": config.apiCredentials.account_id,
  };
}

/** POST JSON with a 15s timeout; parse JSON body, falling back to raw text. */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = await response.text();
  }
  return { status: response.status, body: parsed };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Normalise a Libyan phone number to E.164 (`+218XXXXXXXXX`).
 * Already-prefixed `+` numbers pass through; local `09…` style numbers have
 * leading zeros stripped before the `+218` prefix is applied.
 */
function normalizeLibyanPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "").replace(/^0+/, "");
  return `+218${digits}`;
}
