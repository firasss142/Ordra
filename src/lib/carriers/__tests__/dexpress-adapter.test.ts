import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DexpressAdapter } from "../dexpress-adapter";
import type { CarrierOrderData, CarrierConfig, CarrierRawResponse } from "../types";

const orderData: CarrierOrderData = {
  customer_name: "Mohamed Ali",
  customer_phone: "+218 91 234 5678",
  customer_phone_2: null,
  customer_whatsapp: null,
  customer_address: "Rue de la Liberté, App 5",
  customer_city: "Tripoli",
  customer_note: null,
  product_name: "Sneakers",
  variant_label: "Size 42",
  quantity: 2,
  total_price: 220,
};

const config: CarrierConfig = {
  code: "dexpress",
  apiEndpoint: "https://app.shippingeyes.com/api",
  apiCredentials: {
    api_base_url: "https://app.shippingeyes.com/api",
    api_key: "TEST_API_KEY_123",
  },
  deliveryFee: 15,
  returnFee: 5,
};

describe("DexpressAdapter.formatPayload", () => {
  const adapter = new DexpressAdapter();

  it("uses Shipping Eyes spec field names (name, phone, address, info, qty, order_total)", () => {
    const payload = adapter.formatPayload(orderData, config, {
      state_id: 62,
      place_id: 2,
    });

    expect(payload.name).toBe("Mohamed Ali");
    expect(payload.address).toBe("Rue de la Liberté, App 5");
    expect(payload.phone).toBe("0912345678");
    expect(payload.qty).toBe("2");
    expect(payload.info).toContain("Sneakers");
    expect(payload.info).toContain("Size 42");
    expect(payload.state_id).toBe("62");
    expect(payload.place_id).toBe("2");
  });

  it("hardcodes amount_type=with_delivery_cost, cost_type=0, source_creation=oms", () => {
    const payload = adapter.formatPayload(orderData, config, { state_id: 62 });
    expect(payload.amount_type).toBe("with_delivery_cost");
    expect(payload.cost_type).toBe("0");
    expect(payload.source_creation).toBe("oms");
  });

  it("computes order_total = total_price + deliveryFee", () => {
    const payload = adapter.formatPayload(orderData, config, { state_id: 62 });
    expect(payload.order_total).toBe("235");
  });

  it("prefers extra.shipping_cost_override over config.deliveryFee for order_total", () => {
    const payload = adapter.formatPayload(orderData, config, {
      state_id: 62,
      shipping_cost_override: 30,
    });
    expect(payload.order_total).toBe("250");
  });

  it("forwards women_delivery=0 by default", () => {
    const payload = adapter.formatPayload(orderData, config, { state_id: 62 });
    expect(payload.women_delivery).toBe("0");
  });

  it("forwards women_delivery=1 when set in extra", () => {
    const payload = adapter.formatPayload(orderData, config, {
      state_id: 62,
      women_delivery: 1,
    });
    expect(payload.women_delivery).toBe("1");
  });

  it("includes whatsapp and phone_2 when present (normalized)", () => {
    const data: CarrierOrderData = {
      ...orderData,
      customer_whatsapp: "+218 92 555 0000",
      customer_phone_2: "0921111222",
    };
    const payload = adapter.formatPayload(data, config, { state_id: 62 });
    expect(payload.whatsapp).toBe("0925550000");
    expect(payload.phone_2).toBe("0921111222");
  });

  it("omits whatsapp/phone_2 when not provided", () => {
    const payload = adapter.formatPayload(orderData, config, { state_id: 62 });
    expect(payload.whatsapp).toBeUndefined();
    expect(payload.phone_2).toBeUndefined();
  });

  it("includes notes when customer_note is set, omits when null", () => {
    const withNote: CarrierOrderData = { ...orderData, customer_note: "Fragile" };
    const payload = adapter.formatPayload(withNote, config, { state_id: 62 });
    expect(payload.notes).toBe("Fragile");

    const withoutNote = adapter.formatPayload(orderData, config, { state_id: 62 });
    expect(withoutNote.notes).toBeUndefined();
  });

  it("clamps name to 55 chars, address/info/notes to 255 chars", () => {
    const long = "A".repeat(300);
    const data: CarrierOrderData = {
      ...orderData,
      customer_name: long,
      customer_address: long,
      product_name: long,
      customer_note: long,
    };
    const payload = adapter.formatPayload(data, config, { state_id: 62 });
    expect(payload.name.length).toBe(55);
    expect(payload.address.length).toBe(255);
    expect(payload.info.length).toBeLessThanOrEqual(255);
    expect(payload.notes!.length).toBe(255);
  });
});

describe("DexpressAdapter.dispatch", () => {
  const adapter = new DexpressAdapter();
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends Authorization header WITHOUT 'Bearer ' prefix (per Shipping Eyes spec)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 4000, tracking_code: 999 }), { status: 200 })
    );

    await adapter.dispatch({ state_id: "62", phone: "0912345678" }, config);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("TEST_API_KEY_123");
    expect(headers.Authorization).not.toContain("Bearer");
  });

  it("POSTs URL-encoded body to <api_base_url>/create-order", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 4000, tracking_code: 999 }), { status: 200 })
    );

    await adapter.dispatch({ state_id: "62", phone: "0912345678" }, config);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe("https://app.shippingeyes.com/api/create-order");
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(init.body).toContain("state_id=62");
    expect(init.body).toContain("phone=0912345678");
  });
});

describe("DexpressAdapter.parseResponse", () => {
  const adapter = new DexpressAdapter();

  it("parses 4000 success with tracking_code at the response root", () => {
    const raw: CarrierRawResponse = {
      status: 200,
      body: { code: 4000, message: "success", tracking_code: 2451 },
    };
    expect(adapter.parseResponse(raw)).toEqual({
      success: true,
      trackingNumber: "2451",
    });
  });

  it("parses 4000 success with tracking_code nested in data (legacy shape)", () => {
    const raw: CarrierRawResponse = {
      status: 200,
      body: { code: 4000, data: { tracking_code: 2451 } },
    };
    expect(adapter.parseResponse(raw)).toEqual({
      success: true,
      trackingNumber: "2451",
    });
  });

  it("maps 4011 → DEXPRESS_INVALID_STATE (not retryable)", () => {
    const raw: CarrierRawResponse = {
      status: 200,
      body: { code: 4011, message: "Invalid Delivery State" },
    };
    const result = adapter.parseResponse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("DEXPRESS_INVALID_STATE");
      expect(result.retryable).toBe(false);
    }
  });

  it("maps 4012 → DEXPRESS_INVALID_PLACE", () => {
    const raw: CarrierRawResponse = { status: 200, body: { code: 4012 } };
    const result = adapter.parseResponse(raw);
    if (!result.success) expect(result.errorCode).toBe("DEXPRESS_INVALID_PLACE");
  });

  it("maps 4010 → DEXPRESS_VALIDATION and surfaces field errors", () => {
    const raw: CarrierRawResponse = {
      status: 200,
      body: {
        code: 4010,
        errors: { state_id: ["You must enter the state id"], phone: ["Required"] },
      },
    };
    const result = adapter.parseResponse(raw);
    if (!result.success) {
      expect(result.errorCode).toBe("DEXPRESS_VALIDATION");
      expect(result.errorMessage).toContain("state_id");
      expect(result.errorMessage).toContain("phone");
    }
  });

  it("maps HTTP 401/403 → DEXPRESS_CONFIG (not retryable)", () => {
    expect(
      adapter.parseResponse({ status: 401, body: {} }).success
    ).toBe(false);
    const r = adapter.parseResponse({ status: 403, body: {} });
    if (!r.success) {
      expect(r.errorCode).toBe("DEXPRESS_CONFIG");
      expect(r.retryable).toBe(false);
    }
  });

  it("maps HTTP 5xx → DEXPRESS_TRANSIENT (retryable)", () => {
    const r = adapter.parseResponse({ status: 503, body: {} });
    if (!r.success) {
      expect(r.errorCode).toBe("DEXPRESS_TRANSIENT");
      expect(r.retryable).toBe(true);
    }
  });

  it("maps unknown application code → DEXPRESS_UNKNOWN", () => {
    const r = adapter.parseResponse({
      status: 200,
      body: { code: 9999, message: "Mystery error" },
    });
    if (!r.success) {
      expect(r.errorCode).toBe("DEXPRESS_UNKNOWN");
      expect(r.errorMessage).toContain("Mystery error");
    }
  });
});
