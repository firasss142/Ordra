import type { CarrierOrderData, CarrierConfig } from "../types";
import { CarrierConfigError } from "../errors";
import { resolveDestination } from "./states";

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
    phone: order.customer_phone,
    phone_2: order.customer_phone_2 ?? "",
    name: order.customer_name ?? "",
    address: order.customer_address ?? "",
    info,
    notes: order.customer_note ?? "",
    sub_total: String(subTotal),
    cost: String(deliveryFee),
    total: String(total),
    cost_inclusive: "not_inclusive",
    qty: String(order.quantity),
    cost_type: "0",
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
