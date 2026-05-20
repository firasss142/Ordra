import type { CarrierOrderData, CarrierConfig } from "../types";
import { CarrierConfigError } from "../errors";
import { resolveDestination } from "./states";
import { normalizeLibyanPhone } from "../phone";

/**
 * Dexpress expects Libyan numbers in 10-digit local form (09XXXXXXXX).
 * Storefront webhooks often deliver them without the leading 0 (e.g.
 * "924751325") or with a +218 prefix, which Dexpress rejects with a silent
 * redirect-back. Normalize to the form the portal accepts; if a number is too
 * malformed to normalize, pass it through unchanged so the carrier returns its
 * own validation error rather than us guessing.
 */
function toCarrierPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return normalizeLibyanPhone(raw);
  } catch {
    return raw;
  }
}

export interface DexpressExtra {
  state_id: number;
}

export function buildOrderPayload(
  order: CarrierOrderData,
  config: CarrierConfig,
  extra: DexpressExtra
): Record<string, string> {
  const merchantId = config.apiCredentials.merchant_id;
  const fromState = config.apiCredentials.from_state;
  if (!merchantId || !fromState) {
    throw new CarrierConfigError(
      "DEXPRESS_MISSING_ACCOUNT_FIELDS: merchant_id and from_state required in credentials"
    );
  }

  const { to_state, route_id } = resolveDestination(extra.state_id);

  // cost_type tells Dexpress who pays delivery. Per-carrier setting in
  // credentials, defaults to "1" (customer pays) to preserve existing behaviour.
  //   "1" → customer pays delivery
  //   "0" → seller covers delivery
  // total is ALWAYS sub_total + cost regardless of cost_type — Dexpress
  // applies cost_type internally to decide what the customer is charged.
  const costType = config.apiCredentials.cost_type ?? "1";

  // total_price is goods-only (confirmed with Firas).
  const subTotal = order.total_price;
  const deliveryFee = config.deliveryFee;
  const total = subTotal + deliveryFee;

  const info = order.variant_label
    ? `${order.product_name} - ${order.variant_label}`
    : order.product_name;

  return {
    _token: "",
    has_places: "no",
    merchant_id: merchantId,
    from_state: fromState,
    from_place: "0",
    route_id: String(route_id),
    to_state: String(to_state),
    to_place: "0",
    phone: toCarrierPhone(order.customer_phone),
    phone_2: toCarrierPhone(order.customer_phone_2),
    name: order.customer_name ?? "",
    address: order.customer_address ?? "",
    info,
    notes: order.customer_note ?? "",
    sub_total: String(subTotal),
    cost: String(deliveryFee),
    total: String(total),
    cost_inclusive: "not_inclusive",
    qty: String(order.quantity),
    cost_type: costType,
    order_type: "2",
    breakable: "0",
    packing: "0",
    plus_weight_cost: "",
    "dimensions[weight]": "",
    "dimensions[length]": "",
    "dimensions[width]": "",
    "dimensions[height]": "",
  };
}
