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
 * STEP 1 SCOPE — settings/configuration only.
 * `formatPayload` is fully implemented so the carrier-settings "Test dispatch"
 * dry-run validates input and previews the resolved fields. The network methods
 * (`dispatch`, `parseResponse`) are intentional stubs that throw — the real
 * two-call flow (contact upsert → shipment create) lands in a later step.
 *
 * Per the interface contract, `formatPayload` returns a flat Record<string,string>.
 * That is a *preview projection* of the validated order — NOT the eventual wire
 * body (which is a nested JSON object built inside `dispatch()` in Step 2).
 *
 * Vendor contract notes (see delivery_company_docs/Darb Assabil/INTEGRATION_GUIDE.md):
 *  - countryCode/currency are lowercase ("lby"/"lyd"); uppercase silently fails.
 *  - phone is E.164 with a leading "+218".
 *  - destination needs BOTH city and area, in Arabic UTF-8.
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
    const city = (order.customer_city ?? "").trim();
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

    return {
      service_id: serviceId,
      payment_by: "receiver",
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

  async dispatch(
    _payload: Record<string, string>,
    _config: CarrierConfig
  ): Promise<CarrierRawResponse> {
    throw new CarrierDispatchError(
      "Darb Assabil dispatch not implemented yet (Step 1: settings only)"
    );
  }

  parseResponse(_raw: CarrierRawResponse): CarrierDispatchResult {
    throw new CarrierDispatchError(
      "Darb Assabil parseResponse not implemented yet (Step 1: settings only)"
    );
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
