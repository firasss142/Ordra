import { describe, it, expect, vi, afterEach } from "vitest";
import { XDeliveryAdapter } from "./adapter";
import type { CarrierConfig, CarrierOrderData } from "../types";

const config: CarrierConfig = {
  id: "c1",
  code: "xdelivery",
  apiEndpoint: "https://app.x-delivery.io/api/company",
  apiCredentials: { api_key: "KEY", unique_identifier: "UID" },
  deliveryFee: 6.5,
  returnFee: 1.5,
};

function order(over: Partial<CarrierOrderData> = {}): CarrierOrderData {
  return {
    customer_name: "Client Test",
    customer_phone: "+216 98 123 456",
    customer_phone_2: null,
    customer_whatsapp: null,
    customer_address: "12 rue X",
    customer_city: "Sousse",
    customer_note: null,
    product_name: "Pantalon",
    variant_label: null,
    quantity: 2,
    total_price: 89.9,
    ...over,
  };
}

const adapter = new XDeliveryAdapter();

afterEach(() => vi.unstubAllGlobals());

describe("formatPayload", () => {
  it("builds the documented body, every value a string", () => {
    const p = adapter.formatPayload(order(), config);
    expect(p).toEqual({
      uniqueIdentifier: "UID",
      address: "12 rue X",
      customerName: "Client Test",
      customerPhone1: "98123456",
      governorateName: "Sousse",
      delegationName: "Sousse Ville",
      exchange: "false",
      price: "89.9",
      designation: "Pantalon",
      quantity: "2",
      isOpened: "false",
    });
  });

  it("uses the agent's delegation pick from extra", () => {
    const p = adapter.formatPayload(order(), config, { xdelivery_delegation: "Hammam Sousse" });
    expect(p.delegationName).toBe("Hammam Sousse");
  });

  it("uses the agent's governorate pick when the order's city is missing", () => {
    const p = adapter.formatPayload(order({ customer_city: null }), config, {
      xdelivery_governorate: "Béja",
    });
    expect(p).toMatchObject({ governorateName: "Beja", delegationName: "Beja Nord" });
  });

  it("adds a valid, distinct second phone and the note as comment", () => {
    const p = adapter.formatPayload(
      order({ customer_phone_2: "22 333 444", customer_note: " Appeler avant " }),
      config,
    );
    expect(p.customerPhone2).toBe("22333444");
    expect(p.comment).toBe("Appeler avant");
  });

  it("drops a second phone that repeats the first or is invalid", () => {
    expect(adapter.formatPayload(order({ customer_phone_2: "98123456" }), config).customerPhone2).toBeUndefined();
    expect(adapter.formatPayload(order({ customer_phone_2: "123" }), config).customerPhone2).toBeUndefined();
  });

  it("names the variant and summarises several lines", () => {
    expect(adapter.formatPayload(order({ variant_label: "Taille M" }), config).designation).toBe(
      "Pantalon - Taille M",
    );
    const multi = adapter.formatPayload(
      order({
        order_items: [
          { product_name: "Pantalon", variant_label: "M", quantity: 1 },
          { product_name: "Chemise", variant_label: null, quantity: 2 },
        ] as CarrierOrderData["order_items"],
      }),
      config,
    );
    expect(multi.designation).toBe("1× Pantalon - M + 2× Chemise");
    expect(multi.quantity).toBe("3");
  });

  it("falls back to the destination when the address is empty (address is required)", () => {
    expect(adapter.formatPayload(order({ customer_address: "  " }), config).address).toBe(
      "Sousse Ville, Sousse",
    );
  });

  it("honours the open-parcel setting", () => {
    const open = { ...config, apiCredentials: { ...config.apiCredentials, is_opened: "1" } };
    expect(adapter.formatPayload(order(), open).isOpened).toBe("true");
  });

  it("marks the payload invalid instead of throwing on a bad phone or destination", () => {
    expect(adapter.formatPayload(order({ customer_phone: "123" }), config).__invalid).toMatch(/téléphone/i);
    expect(adapter.formatPayload(order({ customer_city: "Paris" }), config).__invalid).toMatch(/gouvernorat/i);
    expect(
      adapter.formatPayload(order(), config, { xdelivery_delegation: "La Marsa" }).__invalid,
    ).toMatch(/délégation/i);
  });
});

describe("dispatch", () => {
  it("POSTs JSON with the x-api-key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ barcode: "611791217729000" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const payload = adapter.formatPayload(order(), config);
    const raw = await adapter.dispatch(payload, config);
    expect(raw).toEqual({ status: 200, body: { barcode: "611791217729000" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.x-delivery.io/api/company/add-parcel");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("KEY");
    expect(JSON.parse(init.body).customerPhone1).toBe("98123456");
  });

  it("never calls the carrier for an invalid payload", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const raw = await adapter.dispatch(adapter.formatPayload(order({ customer_phone: "1" }), config), config);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(raw.status).toBe(422);
  });
});

describe("parseResponse", () => {
  it("success: the barcode, as a string (15 digits in practice)", () => {
    expect(adapter.parseResponse({ status: 200, body: { barcode: 611791217729000 } })).toEqual({
      success: true,
      trackingNumber: "611791217729000",
    });
  });

  it("their validation error: every message, not retryable", () => {
    const r = adapter.parseResponse({
      status: 400,
      body: { message: ["price should not be empty", "address must be a string"], statusCode: 400 },
    });
    expect(r).toEqual({
      success: false,
      errorCode: "XDELIVERY_VALIDATION",
      errorMessage: "price should not be empty · address must be a string",
      retryable: false,
    });
  });

  it("our own pre-check refusal reads the same way", () => {
    const r = adapter.parseResponse({ status: 422, body: { message: "Téléphone invalide" } });
    expect(r).toMatchObject({ success: false, errorCode: "XDELIVERY_VALIDATION", retryable: false });
  });

  it("a refused key is a configuration error", () => {
    expect(
      adapter.parseResponse({ status: 401, body: { message: "Invalid API Key" } }),
    ).toMatchObject({ success: false, errorCode: "XDELIVERY_CONFIG", retryable: false });
  });

  it("a 200 without a barcode is not a success", () => {
    expect(adapter.parseResponse({ status: 200, body: {} })).toMatchObject({ success: false });
  });

  it("anything else is transient and retryable", () => {
    expect(adapter.parseResponse({ status: 502, body: "Bad gateway" })).toMatchObject({
      success: false,
      errorCode: "XDELIVERY_TRANSIENT",
      retryable: true,
    });
  });
});

describe("voidDispatch", () => {
  it("DELETEs by barcode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await adapter.voidDispatch("611791217729000", config)).toEqual({ success: true, supported: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.x-delivery.io/api/company/delete-parcel?barcode=611791217729000");
    expect(init.method).toBe("DELETE");
  });

  it("404 = already processed by them: not voidable, says why", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Parcel with barcode "1" not found or already processed.' }), {
          status: 404,
        }),
      ),
    );
    const r = await adapter.voidDispatch("1", config);
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/already processed/);
  });
});
