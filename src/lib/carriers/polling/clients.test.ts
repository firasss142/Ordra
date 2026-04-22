import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchNavexStatus, fetchDexpressBatch } from "./clients";

vi.mock("@/lib/crypto", () => ({
  decrypt: (ct: string) => ct.replace(/^enc:/, ""),
}));

const NAVEX_CREDS = JSON.stringify({
  token: "kassandrashop-WX9A1CXYCIUJCC4EDV98NJT4IF8XC256",
});

const DEXPRESS_CREDS = JSON.stringify({
  api_key: "dex-key-123",
  api_base_url: "https://api.shippingeyes.com",
});

describe("fetchNavexStatus", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("POSTs to -etat- URL with form-encoded code", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ status: 1, etat: "En cours", status_message: "TRACK-1" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const raw = await fetchNavexStatus("TRACK-1", {
      api_credentials: "enc:" + NAVEX_CREDS,
      api_endpoint: "https://app.navex.tn/api",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://app.navex.tn/api/kassandrashop-etat-WX9A1CXYCIUJCC4EDV98NJT4IF8XC256/v1/post.php"
    );
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(options.body).toBe("code=TRACK-1");

    expect(raw).toEqual({ status: 1, etat: "En cours", status_message: "TRACK-1" });
  });

  test("returns text when response is not JSON", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve("ok{\"etat\":\"En cours\"}"),
    });
    vi.stubGlobal("fetch", mockFetch);

    const raw = await fetchNavexStatus("TRACK-2", {
      api_credentials: "enc:" + NAVEX_CREDS,
      api_endpoint: "https://app.navex.tn/api",
    });
    expect(typeof raw).toBe("string");
  });

  test("throws when credentials cannot be parsed", async () => {
    await expect(
      fetchNavexStatus("TRACK-3", {
        api_credentials: "enc:not-json",
        api_endpoint: "https://app.navex.tn/api",
      })
    ).rejects.toThrow();
  });

  test("throws when token is missing from credentials", async () => {
    await expect(
      fetchNavexStatus("TRACK-4", {
        api_credentials: "enc:" + JSON.stringify({ not_token: "x" }),
        api_endpoint: "https://app.navex.tn/api",
      })
    ).rejects.toThrow(/token/i);
  });

  test("throws when token has no dash separator", async () => {
    await expect(
      fetchNavexStatus("TRACK-5", {
        api_credentials: "enc:" + JSON.stringify({ token: "no-dash-separator" }),
        api_endpoint: "https://app.navex.tn/api",
      })
    ).resolves.toBeDefined();
  });
});

describe("fetchDexpressBatch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("POSTs to /mutable-order-tracking with comma-joined codes and Authorization header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () =>
        Promise.resolve({
          code: 4000,
          message: "success",
          data: [
            { order_snum: 1032, status_key: 10, name_status: "تم التسليم" },
          ],
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const raw = await fetchDexpressBatch(["1032", "1232"], {
      api_credentials: "enc:" + DEXPRESS_CREDS,
      api_endpoint: "https://api.shippingeyes.com",
    });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.shippingeyes.com/mutable-order-tracking");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("dex-key-123");
    expect(options.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(options.body).toContain("orders_codes=1032%2C1232");

    expect((raw as { code: number }).code).toBe(4000);
  });

  test("prefers api_base_url from credentials over api_endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ code: 4000, data: [] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchDexpressBatch(["1"], {
      api_credentials: "enc:" + DEXPRESS_CREDS,
      api_endpoint: "https://wrong.example.com",
    });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.shippingeyes.com/mutable-order-tracking");
  });

  test("returns empty list short-circuit when no tracking numbers", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    const raw = await fetchDexpressBatch([], {
      api_credentials: "enc:" + DEXPRESS_CREDS,
      api_endpoint: "https://api.shippingeyes.com",
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(raw).toEqual({ code: 4000, data: [] });
  });

  test("throws on missing api_key", async () => {
    await expect(
      fetchDexpressBatch(["1"], {
        api_credentials: "enc:" + JSON.stringify({ not_key: "x" }),
        api_endpoint: "https://api.shippingeyes.com",
      })
    ).rejects.toThrow(/api_key/i);
  });
});
