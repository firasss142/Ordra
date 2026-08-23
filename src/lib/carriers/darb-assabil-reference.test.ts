import { describe, test, expect, afterEach, vi } from "vitest";
import {
  parseShipmentLookup,
  parseBindResponse,
  resolveDarbShipment,
  bindDarbReference,
} from "./darb-assabil-reference";
import type { CarrierConfig } from "./types";

/**
 * Binding a pre-printed sticker to a Darb shipment — step 5 of the warehouse
 * workflow, the moment the parcel becomes routable.
 *
 * `PATCH /api/local/shipments/reference/:id` is keyed on Darb's internal `_id`,
 * NOT the SH… reference we store, so a lookup usually has to happen first. The
 * same lookup response carries `toBranchGroup`, which is what tells the bench
 * which coloured roll the parcel needs — so one call answers both questions.
 */

const config: CarrierConfig = {
  id: "darb-carrier-id",
  code: "darb_assabil",
  apiEndpoint: "https://v2.sabil.ly",
  apiCredentials: { api_key: "key-123", account_id: "acct-456" },
  deliveryFee: 5,
  returnFee: 3,
};

function jsonResponse(body: unknown, status = 200) {
  return { status, text: async () => JSON.stringify(body) } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("parseShipmentLookup", () => {
  test("reads _id and toBranchGroup out of the list shape", () => {
    const hit = parseShipmentLookup({
      status: true,
      data: {
        results: [
          { _id: "69fd0af4889e7a3cd010f1a1", reference: "1511544", toBranchGroup: "BN", status: "processing" },
        ],
      },
    });
    expect(hit).toEqual({
      internalId: "69fd0af4889e7a3cd010f1a1",
      reference: "1511544",
      branchGroup: "BN",
      rawStatus: "processing",
    });
  });

  test("HTTP 200 with status:false is not a hit — the vendor's envelope decides", () => {
    expect(parseShipmentLookup({ status: false, messages: [{ message: "not found" }] })).toBeNull();
  });

  test("an empty result set is not a hit", () => {
    expect(parseShipmentLookup({ status: true, data: { results: [] } })).toBeNull();
  });

  test("a record with no _id is not a hit — we could not address it anyway", () => {
    expect(parseShipmentLookup({ status: true, data: { results: [{ reference: "1511544" }] } })).toBeNull();
  });

  test("tolerates a missing toBranchGroup rather than dropping the shipment", () => {
    const hit = parseShipmentLookup({ status: true, data: { results: [{ _id: "abc" }] } });
    expect(hit?.internalId).toBe("abc");
    expect(hit?.branchGroup).toBeNull();
  });
});

describe("parseBindResponse", () => {
  test("status:true is a success", () => {
    expect(parseBindResponse(200, { status: true })).toEqual({ ok: true, message: null });
  });

  test("HTTP 200 with status:false is a refusal, carrying Darb's own words", () => {
    expect(
      parseBindResponse(200, { status: false, messages: [{ message: "الطلب مكتمل" }] }),
    ).toEqual({ ok: false, message: "الطلب مكتمل" });
  });

  test("a non-200 is a refusal even when the body is unparseable", () => {
    expect(parseBindResponse(502, "<html>bad gateway</html>").ok).toBe(false);
  });
});

describe("resolveDarbShipment", () => {
  test("looks the shipment up by reference and returns its id and branch group", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({ status: true, data: { results: [{ _id: "id-1", reference: "SH1", toBranchGroup: "SB" }] } }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const hit = await resolveDarbShipment("SH2057999", config);
    expect(hit?.internalId).toBe("id-1");
    expect(hit?.branchGroup).toBe("SB");

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/api/local/shipments?");
    expect(String(url)).toContain("reference=SH2057999");
    expect(init.method).toBe("GET");
    // The literal "apikey " prefix, not Bearer — a documented Darb gotcha.
    expect(init.headers.Authorization).toBe("apikey key-123");
    expect(init.headers["X-API-VERSION"]).toBe("1.0.0");
    expect(init.headers["X-ACCOUNT-ID"]).toBe("acct-456");
  });

  test("sends `reference` exactly once — a repeated param silently wins last", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ status: true, data: { results: [] } }));
    vi.stubGlobal("fetch", mockFetch);

    await resolveDarbShipment("SH1", config);
    const url = new URL(String(mockFetch.mock.calls[0][0]));
    expect(url.searchParams.getAll("reference")).toEqual(["SH1"]);
  });

  test("does not call the carrier at all for a blank reference", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    expect(await resolveDarbShipment("  ", config)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("a transport failure is null, not a throw — the caller decides", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ETIMEDOUT")));
    expect(await resolveDarbShipment("SH1", config)).toBeNull();
  });
});

describe("bindDarbReference", () => {
  test("PATCHes the sticker onto the shipment id", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ status: true }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await bindDarbReference("id-1", "889201", config);
    expect(result.ok).toBe(true);

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toBe("https://v2.sabil.ly/api/local/shipments/reference/id-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ reference: "889201" });
  });

  test("surfaces Darb's refusal message so the bench reads their words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status: false, messages: [{ message: "shipment completed" }] })),
    );
    const result = await bindDarbReference("id-1", "889201", config);
    expect(result).toEqual({ ok: false, message: "shipment completed" });
  });

  test("a transport failure is a refusal, never a silent success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ETIMEDOUT")));
    const result = await bindDarbReference("id-1", "889201", config);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("ETIMEDOUT");
  });

  test("refuses to call the carrier with a blank id or sticker", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    expect((await bindDarbReference("", "889201", config)).ok).toBe(false);
    expect((await bindDarbReference("id-1", " ", config)).ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
