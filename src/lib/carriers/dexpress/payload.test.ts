import { describe, test, expect } from "vitest";
import { buildOrderPayload } from "./payload";
import type { CarrierOrderData, CarrierConfig } from "../types";
import { CarrierConfigError } from "../errors";

const ORDER: CarrierOrderData = {
  customer_name: "Mohamed",
  customer_phone: "9325099500",
  customer_phone_2: null,
  customer_whatsapp: null,
  customer_address: "Tripoli centre",
  customer_city: null,
  customer_note: "fragile please",
  product_name: "Ceinture",
  variant_label: "Noire L",
  quantity: 2,
  total_price: 50,
};

const CONFIG: CarrierConfig = {
  id: "carrier-uuid-1",
  code: "dexpress",
  apiEndpoint: "https://portal.dexpress.ly",
  apiCredentials: {
    email: "merchant@example.com",
    password: "secret",
    merchant_id: "807",
    from_state: "62",
  },
  deliveryFee: 35,
  returnFee: 0,
};

describe("buildOrderPayload", () => {
  test("builds all 28 fields including empty ones", () => {
    const payload = buildOrderPayload(ORDER, CONFIG, { state_id: 62 });
    const expectedKeys = [
      "_token",
      "has_places",
      "merchant_id",
      "from_state",
      "from_place",
      "route_id",
      "to_state",
      "to_place",
      "phone",
      "phone_2",
      "name",
      "address",
      "info",
      "notes",
      "sub_total",
      "cost",
      "total",
      "cost_inclusive",
      "qty",
      "cost_type",
      "order_type",
      "breakable",
      "packing",
      "plus_weight_cost",
      "dimensions[weight]",
      "dimensions[length]",
      "dimensions[width]",
      "dimensions[height]",
    ];
    expect(Object.keys(payload).sort()).toEqual(expectedKeys.sort());
    expect(expectedKeys).toHaveLength(28);
  });

  test("pricing: sub_total = total_price (goods-only), cost = delivery_fee, total = sum", () => {
    const payload = buildOrderPayload(ORDER, CONFIG, { state_id: 62 });
    expect(payload.sub_total).toBe("50");
    expect(payload.cost).toBe("35");
    expect(payload.total).toBe("85");
    expect(payload.cost_inclusive).toBe("not_inclusive");
  });

  test("hardcoded constants are present", () => {
    const payload = buildOrderPayload(ORDER, CONFIG, { state_id: 62 });
    expect(payload.has_places).toBe("no");
    expect(payload.from_place).toBe("0");
    expect(payload.to_place).toBe("0");
    expect(payload.cost_type).toBe("1");
    expect(payload.order_type).toBe("2");
    expect(payload.breakable).toBe("0");
    expect(payload.packing).toBe("0");
  });

  test("_token is left empty (client injects it after scraping)", () => {
    const payload = buildOrderPayload(ORDER, CONFIG, { state_id: 62 });
    expect(payload._token).toBe("");
  });

  test("uses merchant_id and from_state from credentials", () => {
    const payload = buildOrderPayload(ORDER, CONFIG, { state_id: 62 });
    expect(payload.merchant_id).toBe("807");
    expect(payload.from_state).toBe("62");
  });

  test("route_id resolved from extra.state_id (Tripoli)", () => {
    const payload = buildOrderPayload(ORDER, CONFIG, { state_id: 62 });
    expect(payload.to_state).toBe("62");
    expect(payload.route_id).toBe("12");
  });

  test("route_id for Benghazi", () => {
    const payload = buildOrderPayload(ORDER, CONFIG, { state_id: 10 });
    expect(payload.to_state).toBe("10");
    expect(payload.route_id).toBe("15");
  });

  test("info concatenates product_name and variant_label", () => {
    const payload = buildOrderPayload(ORDER, CONFIG, { state_id: 62 });
    expect(payload.info).toBe("Ceinture - Noire L");
  });

  test("info uses product_name only when variant_label is null", () => {
    const order = { ...ORDER, variant_label: null };
    const payload = buildOrderPayload(order, CONFIG, { state_id: 62 });
    expect(payload.info).toBe("Ceinture");
  });

  test("notes carries customer_note, falls back to empty string", () => {
    const payload = buildOrderPayload(ORDER, CONFIG, { state_id: 62 });
    expect(payload.notes).toBe("fragile please");

    const noNote = { ...ORDER, customer_note: null };
    const payload2 = buildOrderPayload(noNote, CONFIG, { state_id: 62 });
    expect(payload2.notes).toBe("");
  });

  test("phone_2 falls back to empty string when null", () => {
    const payload = buildOrderPayload(ORDER, CONFIG, { state_id: 62 });
    expect(payload.phone_2).toBe("");
  });

  test("address falls back to empty string when null", () => {
    const order = { ...ORDER, customer_address: null };
    const payload = buildOrderPayload(order, CONFIG, { state_id: 62 });
    expect(payload.address).toBe("");
  });

  test("quantity is stringified", () => {
    const payload = buildOrderPayload(ORDER, CONFIG, { state_id: 62 });
    expect(payload.qty).toBe("2");
  });

  test("dimensions and plus_weight_cost are sent as empty strings", () => {
    const payload = buildOrderPayload(ORDER, CONFIG, { state_id: 62 });
    expect(payload.plus_weight_cost).toBe("");
    expect(payload["dimensions[weight]"]).toBe("");
    expect(payload["dimensions[length]"]).toBe("");
    expect(payload["dimensions[width]"]).toBe("");
    expect(payload["dimensions[height]"]).toBe("");
  });

  test("throws CarrierConfigError when merchant_id is missing", () => {
    const config = {
      ...CONFIG,
      apiCredentials: { ...CONFIG.apiCredentials, merchant_id: "" },
    };
    expect(() => buildOrderPayload(ORDER, config, { state_id: 62 })).toThrow(
      CarrierConfigError
    );
  });

  test("throws CarrierConfigError when from_state is missing", () => {
    const config = {
      ...CONFIG,
      apiCredentials: { ...CONFIG.apiCredentials, from_state: "" },
    };
    expect(() => buildOrderPayload(ORDER, config, { state_id: 62 })).toThrow(
      CarrierConfigError
    );
  });

  test("throws on unknown state_id", () => {
    expect(() => buildOrderPayload(ORDER, CONFIG, { state_id: 99999 })).toThrow(
      /Unknown Dexpress state_id/
    );
  });
});
