import { describe, test, expect, vi, beforeEach } from "vitest";
import type { CarrierConfig } from "../types";

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

import { DexpressClient } from "./client";

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

const CARRIER_ID = "carrier-uuid-1";

// Helper: mock fetch response
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

describe("DexpressClient.ensureSession", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStoreMock.loadSession.mockReset();
    sessionStoreMock.saveSession.mockReset();
    sessionStoreMock.invalidateSession.mockReset();
    sessionStoreMock.refreshExpiry.mockReset();
  });

  test("returns cached session when fresh (expires_at in the future)", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000); // 1h from now
    sessionStoreMock.loadSession.mockResolvedValue({
      laravelSession: "cached-cookie",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: future,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    const session = await client.ensureSession();

    expect(session.laravelSession).toBe("cached-cookie");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("logs in when no session exists", async () => {
    sessionStoreMock.loadSession.mockResolvedValue(null);
    sessionStoreMock.saveSession.mockResolvedValue(undefined);

    const fetchMock = vi
      .fn()
      // GET /login → 200 with HTML containing _token, sets initial cookie
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="_token" value="initial-token">`,
          headers: {
            "set-cookie":
              "laravel_session=initial-cookie; Path=/; HttpOnly",
          },
        })
      )
      // POST /login → 302 to /merchant, rotates cookie
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: {
            location: "/merchant",
            "set-cookie":
              "laravel_session=authed-cookie; Path=/; HttpOnly",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    const session = await client.ensureSession();

    expect(session.laravelSession).toBe("authed-cookie");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // First call: GET /login
    const [getUrl, getInit] = fetchMock.mock.calls[0];
    expect(String(getUrl)).toContain("/login");
    expect(getInit?.method ?? "GET").toBe("GET");

    // Second call: POST /login with urlencoded body containing _token + email + password
    const [postUrl, postInit] = fetchMock.mock.calls[1];
    expect(String(postUrl)).toContain("/login");
    expect(postInit.method).toBe("POST");
    expect(postInit.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(postInit.body).toContain("_token=initial-token");
    expect(postInit.body).toContain("email=merchant%40example.com");
    expect(postInit.body).toContain("password=secret");
    // Login POST must carry the initial cookie
    expect(postInit.headers["Cookie"]).toContain("laravel_session=initial-cookie");

    expect(sessionStoreMock.saveSession).toHaveBeenCalledWith(
      CARRIER_ID,
      expect.objectContaining({
        laravelSession: "authed-cookie",
      })
    );
  });

  test("re-logs in when stored session is expired", async () => {
    const past = new Date(Date.now() - 60 * 1000);
    sessionStoreMock.loadSession.mockResolvedValue({
      laravelSession: "stale-cookie",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: past,
    });
    sessionStoreMock.saveSession.mockResolvedValue(undefined);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="_token" value="t">`,
          headers: { "set-cookie": "laravel_session=initial; Path=/" },
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: {
            location: "/merchant",
            "set-cookie": "laravel_session=fresh; Path=/",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    const session = await client.ensureSession();

    expect(session.laravelSession).toBe("fresh");
  });

  test("throws when login POST does not return 302", async () => {
    sessionStoreMock.loadSession.mockResolvedValue(null);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="_token" value="t">`,
          headers: { "set-cookie": "laravel_session=c; Path=/" },
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="_token" value="t"><div class="invalid-feedback">Wrong password</div>`,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    await expect(client.ensureSession()).rejects.toThrow(/login failed/i);
  });
});

describe("DexpressClient.getMerchantPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStoreMock.loadSession.mockReset();
    sessionStoreMock.saveSession.mockReset();
    sessionStoreMock.invalidateSession.mockReset();
    sessionStoreMock.refreshExpiry.mockReset();
  });

  test("sends Cookie header with the cached laravel_session", async () => {
    sessionStoreMock.loadSession.mockResolvedValue({
      laravelSession: "cached",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    sessionStoreMock.refreshExpiry.mockResolvedValue(undefined);

    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockResponse({ status: 200, body: "<html>ok</html>" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    const page = await client.getMerchantPage("/merchant/add-orders");

    expect(page.status).toBe(200);
    expect(page.html).toBe("<html>ok</html>");
    expect(page.redirectedToLogin).toBe(false);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/merchant/add-orders");
    expect(init.headers["Cookie"]).toContain("laravel_session=cached");
    expect(init.redirect).toBe("manual");
  });

  test("re-authenticates and retries when GET responds with 302 to /login", async () => {
    sessionStoreMock.loadSession.mockResolvedValue({
      laravelSession: "stale",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    sessionStoreMock.invalidateSession.mockResolvedValue(undefined);
    sessionStoreMock.saveSession.mockResolvedValue(undefined);

    const fetchMock = vi
      .fn()
      // First merchant GET → 302 → /login (session expired server-side)
      .mockResolvedValueOnce(
        mockResponse({ status: 302, headers: { location: "/login" } })
      )
      // Re-login: GET /login
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="_token" value="t2">`,
          headers: { "set-cookie": "laravel_session=initial2; Path=/" },
        })
      )
      // Re-login: POST /login → 302 /merchant
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: {
            location: "/merchant",
            "set-cookie": "laravel_session=fresh; Path=/",
          },
        })
      )
      // Retry merchant GET → 200 with content
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: "<html>after retry</html>" })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    const page = await client.getMerchantPage("/merchant/add-orders");

    expect(page.status).toBe(200);
    expect(page.html).toBe("<html>after retry</html>");
    expect(sessionStoreMock.invalidateSession).toHaveBeenCalledWith(CARRIER_ID);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("throws when re-login also fails (two consecutive logout redirects)", async () => {
    sessionStoreMock.loadSession.mockResolvedValue({
      laravelSession: "stale",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    sessionStoreMock.invalidateSession.mockResolvedValue(undefined);
    sessionStoreMock.saveSession.mockResolvedValue(undefined);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({ status: 302, headers: { location: "/login" } })
      )
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="_token" value="t">`,
          headers: { "set-cookie": "laravel_session=c; Path=/" },
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: {
            location: "/merchant",
            "set-cookie": "laravel_session=fresh; Path=/",
          },
        })
      )
      // Second merchant GET → still bounced to /login
      .mockResolvedValueOnce(
        mockResponse({ status: 302, headers: { location: "/login" } })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    await expect(client.getMerchantPage("/merchant/add-orders")).rejects.toThrow(
      /session/i
    );
  });
});

describe("DexpressClient.submitMerchantForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStoreMock.loadSession.mockReset();
    sessionStoreMock.saveSession.mockReset();
    sessionStoreMock.invalidateSession.mockReset();
    sessionStoreMock.refreshExpiry.mockReset();
  });

  test("sends multipart form-data with all fields and the cookie", async () => {
    sessionStoreMock.loadSession.mockResolvedValue({
      laravelSession: "auth-cookie",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    sessionStoreMock.refreshExpiry.mockResolvedValue(undefined);

    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockResponse({
        status: 302,
        headers: { location: "/merchant/success-added-order/12345" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    const result = await client.submitMerchantForm("/merchant/add-orders", {
      _token: "t",
      phone: "9325099500",
      address: "tripoli",
    });

    expect(result.status).toBe(302);
    expect(result.redirectLocation).toBe("/merchant/success-added-order/12345");
    expect(result.html).toBe("");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/merchant/add-orders");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.headers["Cookie"]).toContain("laravel_session=auth-cookie");
    expect(init.body).toBeInstanceOf(FormData);
    const fd = init.body as FormData;
    expect(fd.get("_token")).toBe("t");
    expect(fd.get("phone")).toBe("9325099500");
    expect(fd.get("address")).toBe("tripoli");
  });

  test("returns 200 with html when validation fails", async () => {
    sessionStoreMock.loadSession.mockResolvedValue({
      laravelSession: "c",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    sessionStoreMock.refreshExpiry.mockResolvedValue(undefined);

    const errorHtml = `<input name="phone"><div class="invalid-feedback">required</div>`;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockResponse({ status: 200, body: errorHtml })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    const result = await client.submitMerchantForm("/merchant/add-orders", {
      _token: "t",
    });

    expect(result.status).toBe(200);
    expect(result.html).toBe(errorHtml);
    expect(result.redirectLocation).toBeNull();
  });

  test("retries once after re-login when POST is bounced to /login", async () => {
    sessionStoreMock.loadSession.mockResolvedValue({
      laravelSession: "stale",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    sessionStoreMock.invalidateSession.mockResolvedValue(undefined);
    sessionStoreMock.saveSession.mockResolvedValue(undefined);

    const fetchMock = vi
      .fn()
      // First POST → 302 /login
      .mockResolvedValueOnce(
        mockResponse({ status: 302, headers: { location: "/login" } })
      )
      // Re-login GET
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="_token" value="t">`,
          headers: { "set-cookie": "laravel_session=i; Path=/" },
        })
      )
      // Re-login POST
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: {
            location: "/merchant",
            "set-cookie": "laravel_session=fresh; Path=/",
          },
        })
      )
      // Retry POST → 302 success
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: { location: "/merchant/success-added-order/777" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    const result = await client.submitMerchantForm("/merchant/add-orders", {
      _token: "stale",
      phone: "9325099500",
    });

    expect(result.status).toBe(302);
    expect(result.redirectLocation).toBe("/merchant/success-added-order/777");
    expect(sessionStoreMock.invalidateSession).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("DexpressClient.getJsonEndpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStoreMock.loadSession.mockReset();
    sessionStoreMock.saveSession.mockReset();
    sessionStoreMock.invalidateSession.mockReset();
    sessionStoreMock.refreshExpiry.mockReset();
  });

  test("sends AJAX headers (X-Requested-With + Accept) and returns body verbatim", async () => {
    sessionStoreMock.loadSession.mockResolvedValue({
      laravelSession: "auth-cookie",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    sessionStoreMock.refreshExpiry.mockResolvedValue(undefined);

    // Real captured probe body for tracking #1343188 — keeps tests anchored to reality.
    const probeBody =
      '{"response_case":201,"order_status":"3","order_accept":"1","status_name":"فى الشركة"}';

    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockResponse({
        status: 200,
        body: probeBody,
        headers: { "content-type": "text/html; charset=UTF-8" }, // Dexpress quirk
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    const result = await client.getJsonEndpoint(
      "/merchant/ajax-order-case/1343188"
    );

    expect(result.status).toBe(200);
    expect(result.bodyText).toBe(probeBody);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/merchant/ajax-order-case/1343188");
    expect(init.headers["X-Requested-With"]).toBe("XMLHttpRequest");
    expect(init.headers["Accept"]).toBe("application/json, text/plain, */*");
    expect(init.headers["Cookie"]).toContain("laravel_session=auth-cookie");
    expect(init.redirect).toBe("manual");
  });

  test("re-authenticates and retries when GET responds with 302 to /login", async () => {
    sessionStoreMock.loadSession.mockResolvedValue({
      laravelSession: "stale",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    sessionStoreMock.invalidateSession.mockResolvedValue(undefined);
    sessionStoreMock.saveSession.mockResolvedValue(undefined);

    const fetchMock = vi
      .fn()
      // First AJAX GET → 302 /login
      .mockResolvedValueOnce(
        mockResponse({ status: 302, headers: { location: "/login" } })
      )
      // Re-login: GET /login
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="_token" value="t">`,
          headers: { "set-cookie": "laravel_session=i; Path=/" },
        })
      )
      // Re-login: POST /login
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: {
            location: "/merchant",
            "set-cookie": "laravel_session=fresh; Path=/",
          },
        })
      )
      // Retry AJAX GET → 200 with body
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: '{"response_case":201,"order_status":"3","order_accept":"1","status_name":"فى الشركة"}',
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    const result = await client.getJsonEndpoint(
      "/merchant/ajax-order-case/1343188"
    );

    expect(result.status).toBe(200);
    expect(result.bodyText).toContain("response_case");
    expect(sessionStoreMock.invalidateSession).toHaveBeenCalledWith(CARRIER_ID);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("throws when re-login also fails (two consecutive logout redirects)", async () => {
    sessionStoreMock.loadSession.mockResolvedValue({
      laravelSession: "stale",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    sessionStoreMock.invalidateSession.mockResolvedValue(undefined);
    sessionStoreMock.saveSession.mockResolvedValue(undefined);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({ status: 302, headers: { location: "/login" } })
      )
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: `<input name="_token" value="t">`,
          headers: { "set-cookie": "laravel_session=c; Path=/" },
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: {
            location: "/merchant",
            "set-cookie": "laravel_session=fresh; Path=/",
          },
        })
      )
      // Retry still 302 → /login
      .mockResolvedValueOnce(
        mockResponse({ status: 302, headers: { location: "/login" } })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    await expect(
      client.getJsonEndpoint("/merchant/ajax-order-case/1343188")
    ).rejects.toThrow(/session/i);
  });

  test("returns body verbatim — does NOT parse JSON inside the client", async () => {
    sessionStoreMock.loadSession.mockResolvedValue({
      laravelSession: "c",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    sessionStoreMock.refreshExpiry.mockResolvedValue(undefined);

    // Empirically-confirmed not-found body from probe against 99999999.
    // Body parsing belongs in tracking.ts (parseAjaxOrderCase), not the client.
    const notFoundBody = '{"response_case":404}';
    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockResponse({ status: 200, body: notFoundBody })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DexpressClient(CARRIER_ID, CONFIG);
    const result = await client.getJsonEndpoint(
      "/merchant/ajax-order-case/99999999"
    );

    // Verbatim — no preprocessing, no JSON.parse, no shape validation.
    expect(result.bodyText).toBe(notFoundBody);
    expect(result.status).toBe(200);
  });
});
