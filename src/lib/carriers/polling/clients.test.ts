import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchNavexStatus } from "./clients";

vi.mock("@/lib/crypto", () => ({
  decrypt: (ct: string) => ct.replace(/^enc:/, ""),
}));

const NAVEX_CREDS = JSON.stringify({
  token: "kassandrashop-WX9A1CXYCIUJCC4EDV98NJT4IF8XC256",
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
