import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchXDeliveryStatuses } from "./client";
import type { CarrierConfig } from "../types";

const config: CarrierConfig = {
  id: "c1",
  code: "xdelivery",
  apiEndpoint: "https://app.x-delivery.io/api/company",
  apiCredentials: { api_key: "KEY" },
  deliveryFee: 0,
  returnFee: 0,
};

afterEach(() => vi.unstubAllGlobals());

describe("fetchXDeliveryStatuses", () => {
  it("POSTs the barcode array with the API key and returns their rows, barcodes stringified", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ barcode: 611, status: "DELIVERED", motif: "" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const rows = await fetchXDeliveryStatuses(config, ["611", "612"]);
    expect(rows).toEqual([{ barcode: "611", status: "DELIVERED", motif: "" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.x-delivery.io/api/company/parcels/status");
    expect(init.headers["x-api-key"]).toBe("KEY");
    expect(JSON.parse(init.body)).toEqual(["611", "612"]);
  });

  it("throws on a non-2xx answer so the poll counts the batch as errored", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(fetchXDeliveryStatuses(config, ["1"])).rejects.toThrow("HTTP 401");
  });

  it("throws when the answer is not an array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html>", { status: 200 })));
    await expect(fetchXDeliveryStatuses(config, ["1"])).rejects.toThrow(/unexpected/i);
  });
});
