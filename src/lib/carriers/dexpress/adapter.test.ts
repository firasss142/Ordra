import { describe, test, expect, vi, beforeEach } from "vitest";
import type { CarrierOrderData, CarrierConfig } from "../types";

const sessionStoreMock = {
  loadSession: vi.fn(),
  saveSession: vi.fn(),
  invalidateSession: vi.fn(),
  refreshExpiry: vi.fn(),
};

vi.mock("./session-store", () => ({
  loadSession: (...a: unknown[]) => sessionStoreMock.loadSession(...a),
  saveSession: (...a: unknown[]) => sessionStoreMock.saveSession(...a),
  invalidateSession: (...a: unknown[]) => sessionStoreMock.invalidateSession(...a),
  refreshExpiry: (...a: unknown[]) => sessionStoreMock.refreshExpiry(...a),
}));

import { DexpressAdapter } from "./adapter";

const ORDER: CarrierOrderData = {
  customer_name: "Mohamed",
  customer_phone: "9325099500",
  customer_phone_2: null,
  customer_whatsapp: null,
  customer_address: "Tripoli",
  customer_city: null,
  customer_note: null,
  product_name: "Ceinture",
  variant_label: null,
  quantity: 1,
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

function mockResponse(opts: {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}): Response {
  const headers = new Headers(opts.headers ?? {});
  return new Response(opts.body ?? "", {
    status: opts.status,
    headers,
  });
}

const FRESH_SESSION = {
  laravelSession: "auth-cookie",
  xsrfToken: null,
  csrfToken: "stale-csrf",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

describe("DexpressAdapter.formatPayload", () => {
  test("produces the full multipart fieldset including empty _token", () => {
    const adapter = new DexpressAdapter();
    const payload = adapter.formatPayload(ORDER, CONFIG, { state_id: 62 });
    expect(payload._token).toBe("");
    expect(payload.to_state).toBe("62");
    expect(payload.route_id).toBe("12");
    expect(payload.merchant_id).toBe("807");
    expect(payload.sub_total).toBe("50");
    expect(payload.cost).toBe("35");
    expect(payload.total).toBe("85");
  });

  test("throws when extra.state_id is missing or not a number", () => {
    const adapter = new DexpressAdapter();
    expect(() => adapter.formatPayload(ORDER, CONFIG, undefined)).toThrow(
      /DEXPRESS_MISSING_STATE/
    );
    expect(() =>
      adapter.formatPayload(ORDER, CONFIG, { state_id: "abc" } as unknown as Record<string, unknown>)
    ).toThrow(/DEXPRESS_MISSING_STATE/);
  });
});

describe("DexpressAdapter.dispatch — happy path", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStoreMock.loadSession.mockReset();
    sessionStoreMock.saveSession.mockReset();
    sessionStoreMock.invalidateSession.mockReset();
    sessionStoreMock.refreshExpiry.mockReset();
  });

  test("logs in, scrapes _token, submits, parses orderId from 302", async () => {
    sessionStoreMock.loadSession.mockResolvedValue(FRESH_SESSION);
    sessionStoreMock.refreshExpiry.mockResolvedValue(undefined);

    const fetchMock = vi
      .fn()
      // GET /merchant/add-orders → form HTML with _token
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<form><input name="_token" value="form-csrf-token"></form>`,
        })
      )
      // POST /merchant/add-orders → 302 to success
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: { location: "/merchant/success-added-order/777" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new DexpressAdapter();
    const payload = adapter.formatPayload(ORDER, CONFIG, { state_id: 62 });
    const raw = await adapter.dispatch(payload, CONFIG);

    expect(raw.status).toBe(302);
    expect((raw.body as { orderId: string }).orderId).toBe("777");

    const result = adapter.parseResponse(raw);
    expect(result).toEqual({ success: true, trackingNumber: "777" });

    // Verify _token was injected into the POST body
    const [, postInit] = fetchMock.mock.calls[1];
    expect(postInit.body).toBeInstanceOf(FormData);
    const fd = postInit.body as FormData;
    expect(fd.get("_token")).toBe("form-csrf-token");
    expect(fd.get("to_state")).toBe("62");
    expect(fd.get("route_id")).toBe("12");
    expect(fd.get("phone")).toBe("9325099500");
  });
});

describe("DexpressAdapter.dispatch — validation failures", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStoreMock.loadSession.mockReset();
    sessionStoreMock.saveSession.mockReset();
    sessionStoreMock.invalidateSession.mockReset();
    sessionStoreMock.refreshExpiry.mockReset();
  });

  test("single field error: returns DEXPRESS_VALIDATION with 'phone: required'", async () => {
    sessionStoreMock.loadSession.mockResolvedValue(FRESH_SESSION);
    sessionStoreMock.refreshExpiry.mockResolvedValue(undefined);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="_token" value="t">`,
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="phone"><div class="invalid-feedback">required</div>`,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new DexpressAdapter();
    const payload = adapter.formatPayload(ORDER, CONFIG, { state_id: 62 });
    const raw = await adapter.dispatch(payload, CONFIG);
    const result = adapter.parseResponse(raw);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorCode).toBe("DEXPRESS_VALIDATION");
    expect(result.errorMessage).toBe("phone: required");
    expect(result.retryable).toBe(false);
  });

  test("multiple field errors: joined with semicolons", async () => {
    sessionStoreMock.loadSession.mockResolvedValue(FRESH_SESSION);
    sessionStoreMock.refreshExpiry.mockResolvedValue(undefined);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="_token" value="t">`,
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body:
            `<input name="phone"><div class="invalid-feedback">required</div>` +
            `<input name="address"><div class="invalid-feedback">too short</div>`,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new DexpressAdapter();
    const payload = adapter.formatPayload(ORDER, CONFIG, { state_id: 62 });
    const raw = await adapter.dispatch(payload, CONFIG);
    const result = adapter.parseResponse(raw);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorMessage).toBe("phone: required; address: too short");
  });

  test("validation 200 with no parseable fields falls back to 'Validation error'", async () => {
    sessionStoreMock.loadSession.mockResolvedValue(FRESH_SESSION);
    sessionStoreMock.refreshExpiry.mockResolvedValue(undefined);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="_token" value="t">`,
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<html><body>Form re-rendered without invalid-feedback divs</body></html>`,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new DexpressAdapter();
    const payload = adapter.formatPayload(ORDER, CONFIG, { state_id: 62 });
    const raw = await adapter.dispatch(payload, CONFIG);
    const result = adapter.parseResponse(raw);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorMessage).toBe("Validation error");
  });
});

describe("DexpressAdapter.dispatch — abnormal responses", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStoreMock.loadSession.mockReset();
    sessionStoreMock.saveSession.mockReset();
    sessionStoreMock.invalidateSession.mockReset();
    sessionStoreMock.refreshExpiry.mockReset();
  });

  test("5xx response → DEXPRESS_UNKNOWN with retryable: true", async () => {
    sessionStoreMock.loadSession.mockResolvedValue(FRESH_SESSION);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="_token" value="t">`,
        })
      )
      .mockResolvedValueOnce(mockResponse({ status: 503, body: "down" }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new DexpressAdapter();
    const payload = adapter.formatPayload(ORDER, CONFIG, { state_id: 62 });
    const raw = await adapter.dispatch(payload, CONFIG);
    const result = adapter.parseResponse(raw);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorCode).toBe("DEXPRESS_UNKNOWN");
    expect(result.retryable).toBe(true);
  });

  test("missing _token on form page → throws CarrierDispatchError", async () => {
    sessionStoreMock.loadSession.mockResolvedValue(FRESH_SESSION);

    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockResponse({ status: 200, body: `<form>no token here</form>` })
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new DexpressAdapter();
    const payload = adapter.formatPayload(ORDER, CONFIG, { state_id: 62 });
    await expect(adapter.dispatch(payload, CONFIG)).rejects.toThrow(/DEXPRESS_NO_TOKEN/);
  });
});

describe("DexpressAdapter.voidDispatch", () => {
  test("returns supported: false (Dexpress portal doesn't expose cancel)", async () => {
    const adapter = new DexpressAdapter();
    const result = await adapter.voidDispatch("777", CONFIG);
    expect(result).toEqual({ success: false, supported: false });
  });
});
