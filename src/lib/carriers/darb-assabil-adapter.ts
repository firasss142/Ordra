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
 *  - paymentBy is fixed to "receiver": Darb charges the shipping + any service
 *    fee (women's/express premium) ON TOP of the product COD, to the customer.
 *    ("sales" would instead deduct those fees from our settlement — verified via
 *    the calculate/shipping API — so a special-service fee silently came out of
 *    our money. The old `payment_by` settings toggle was removed.)
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

    // Fees are ALWAYS charged to the receiver (the customer), on top of the
    // product COD. Verified against Darb's calculate/shipping API: "sales" makes
    // Darb deduct the shipping + service fees from our settlement (so a women's
    // /express premium silently came out of our money), whereas "receiver" adds
    // them on top — the customer pays product + shipping + any service fee. The
    // legacy `payment_by` settings toggle no longer changes this direction.
    const paymentBy = "receiver";

    // Per-order option flags, chosen in the dispatch modal and threaded via extra.
    const isFragile = extraFlag(extra, "is_fragile");
    const allowInspection = extraFlag(extra, "allow_inspection");
    const allowTesting = extraFlag(extra, "allow_testing");
    const allowCardPayment = extraFlag(extra, "allow_card_payment");

    // Build the itemized products[]. Real line items map 1:1 to Darb products with
    // their own title/quantity/per-unit amount. When the order has no order_items
    // (legacy single-product orders), fall back to ONE aggregated line (qty 1,
    // amount = full goods price) — avoids float precision risk from
    // total_price / quantity. The per-order flags apply to every line.
    const items = order.order_items ?? [];
    const products: DarbProduct[] =
      items.length > 0
        ? items.map((it) => ({
            title: it.variant_label
              ? `${it.product_name} - ${it.variant_label}`
              : it.product_name,
            quantity: it.quantity,
            amount: it.unit_price,
            currency: "lyd",
            isChargeable: true,
            isFragile,
            allowInspection,
            allowTesting,
          }))
        : [
            {
              title: product,
              quantity: 1,
              amount: order.total_price,
              currency: "lyd",
              isChargeable: true,
              isFragile,
              allowInspection,
              allowTesting,
            },
          ];

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
      // Legacy preview fields (single-line view + dry-run); the real wire body
      // is built from products_json below.
      amount: String(order.total_price),
      quantity: "1",
      currency: "lyd",
      // Itemized products + the card-payment flag, serialized so the snapshot
      // stays a flat Record<string,string> (the dry-run contract).
      products_json: JSON.stringify(products),
      allow_card_payment: allowCardPayment ? "1" : "0",
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
    // Prefer the itemized products[] serialized into the snapshot; fall back to a
    // single aggregated line for snapshots built before products_json existed.
    const products = parseProducts(p);
    const shipmentBody: Record<string, unknown> = {
      service: p.service_id,
      contacts: [contactId],
      paymentBy: p.payment_by,
      to: {
        countryCode: p.country_code,
        city: p.city,
        area: p.area,
        address: p.address,
      },
      products,
      notes: p.notes,
    };
    // Online card payment is native to Darb (no 10% surcharge on our side). When
    // enabled, the card fee is borne by the receiver per the vendor default.
    if (p.allow_card_payment === "1") {
      shipmentBody.allowCardPayment = true;
      shipmentBody.cardFeePaymentBy = "receiver";
    }

    let shipmentRaw: { status: number; body: unknown };
    try {
      shipmentRaw = await postJson(
        `${base}/api/local/shipments`,
        headers,
        shipmentBody,
      );
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

  /**
   * Cancel a shipment via `DELETE /api/local/shipments/:id`. The `:id` is the
   * internal ObjectId (`_id`) captured at dispatch into the order's
   * `carrier_extra.darb_assabil_id` — NOT the human `SH…` tracking reference,
   * which the vendor's delete endpoint does not accept.
   *
   * This is a hard delete with no recovery (the order_history / carrier_event_log
   * the route writes is the only forensic trail). Every failure mode reports
   * `supported: true` so the route surfaces "coordination manuelle requise" and
   * still flips local state — identical to Dexpress. A missing `_id` (order
   * dispatched before id capture, or malformed extra) short-circuits without an
   * HTTP call, since we can't address the shipment.
   */
  async voidDispatch(
    _trackingNumber: string,
    config: CarrierConfig,
    extra?: Record<string, unknown>
  ): Promise<CarrierVoidResult> {
    const internalId =
      typeof extra?.darb_assabil_id === "string" ? extra.darb_assabil_id : "";
    if (!internalId) {
      return {
        success: false,
        supported: true,
        reason:
          "Darb Assabil: identifiant interne (darb_assabil_id) manquant — suppression impossible",
      };
    }

    const base = (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
    const headers = buildHeaders(config);

    let raw: { status: number; body: unknown };
    try {
      raw = await deleteJson(
        `${base}/api/local/shipments/${encodeURIComponent(internalId)}`,
        headers
      );
    } catch (err) {
      return {
        success: false,
        supported: true,
        reason: err instanceof Error ? err.message : "unknown",
      };
    }

    const body = asRecord(raw.body);

    // Structured rejection — e.g. already picked up by a courier. Surface the
    // vendor message before the transient fallback so it isn't masked.
    if (body.status === false) {
      const messages = body.messages as Array<{ message?: string }> | undefined;
      return {
        success: false,
        supported: true,
        reason: messages?.[0]?.message ?? "Carrier rejected the cancellation",
      };
    }

    // Transport-level failure (5xx, or a body we couldn't parse as an envelope).
    if (raw.status >= 500 || body.status !== true) {
      return {
        success: false,
        supported: true,
        reason: `Carrier temporarily unavailable (HTTP ${raw.status})`,
      };
    }

    return { success: true, supported: true };
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
  /** Itemized products[] serialized as JSON (see DarbProduct). */
  products_json?: string;
  /** Online card payment toggle, "1"/"0". */
  allow_card_payment?: string;
  notes: string;
}

/** A single line in the Darb shipment's products[] wire array. */
interface DarbProduct {
  title: string;
  quantity: number;
  amount: number;
  currency: string;
  isChargeable: boolean;
  isFragile: boolean;
  allowInspection: boolean;
  allowTesting: boolean;
}

/** Reads a boolean-ish flag from the dispatch `extra` (true only for true/"1"/1). */
function extraFlag(
  extra: Record<string, unknown> | undefined,
  key: string
): boolean {
  const v = extra?.[key];
  return v === true || v === "1" || v === 1;
}

/**
 * Reconstruct the wire products[] from the snapshot. Uses the serialized
 * products_json when present; otherwise falls back to a single aggregated line
 * (back-compat with snapshots built before products_json existed).
 */
function parseProducts(p: DarbPayloadSnapshot): DarbProduct[] {
  if (p.products_json) {
    try {
      const parsed = JSON.parse(p.products_json);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through to the single-line fallback
    }
  }
  return [
    {
      title: p.product,
      quantity: 1,
      amount: Number(p.amount),
      currency: p.currency,
      isChargeable: true,
      isFragile: false,
      allowInspection: false,
      allowTesting: false,
    },
  ];
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

/** DELETE with a 15s timeout; parse JSON body, falling back to raw text. */
async function deleteJson(
  url: string,
  headers: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "DELETE",
    headers,
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
