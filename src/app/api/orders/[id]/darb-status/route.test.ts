import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

const mockFetchDarbShipment = vi.fn();
vi.mock("@/lib/carriers/darb-assabil-tracking", () => ({
  fetchDarbShipment: (...args: unknown[]) => mockFetchDarbShipment(...args),
}));

const mockBuildConfig = vi.fn();
vi.mock("@/lib/carriers/dispatch", () => ({
  buildConfig: (...args: unknown[]) => mockBuildConfig(...args),
}));

import { GET } from "./route";

function req() {
  return new NextRequest(new URL("http://localhost/api/orders/order-1/darb-status"));
}
const params = Promise.resolve({ id: "order-1" });

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  // update().eq() is awaited (reference repair) — resolve to a no-op result.
  c.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  return c;
}

const darbOrder = {
  id: "order-1",
  tracking_number: "SH1584689",
  carrier_id: "darb-uuid",
  carrier_extra: { darb_assabil_id: "69fd0af4889e7a3cd010f1a1" },
  carriers: { code: "darb_assabil" },
};

const carrierRow = {
  id: "darb-uuid",
  code: "darb_assabil",
  api_endpoint: "https://v2.sabil.ly",
  api_credentials: "encrypted-blob",
  delivery_fee: 5,
  return_fee: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildConfig.mockReturnValue({
    id: "darb-uuid",
    code: "darb_assabil",
    apiEndpoint: "https://v2.sabil.ly",
    apiCredentials: { api_key: "k", account_id: "a" },
    deliveryFee: 5,
    returnFee: 3,
  });
});

describe("GET /api/orders/[id]/darb-status", () => {
  test("401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(req(), { params })).status).toBe(401);
  });

  test("404 when the order isn't visible (RLS) / doesn't exist", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockReturnValue(singleChain(null, { code: "PGRST116" }));
    expect((await GET(req(), { params })).status).toBe(404);
  });

  test("400 when carrier is not darb_assabil", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockReturnValue(
      singleChain({ ...darbOrder, carriers: { code: "dexpress" } }),
    );
    expect((await GET(req(), { params })).status).toBe(400);
  });

  test("400 when the order has no internal darb_assabil_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockReturnValue(
      singleChain({ ...darbOrder, carrier_extra: {} }),
    );
    expect((await GET(req(), { params })).status).toBe(400);
  });

  test("200 with the inline timeline read by _id (not the stored reference)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "orders") return singleChain(darbOrder);
      if (table === "carriers") return singleChain(carrierRow);
      return singleChain(null);
    });
    mockFetchDarbShipment.mockResolvedValue({
      kind: "ok",
      reference: "1143633",
      slug: "completed",
      rawStatus: "completed",
      timeline: [
        { type: "info", labelAr: "تم إنشاء الشحنة", timestamp: "2026-05-07T21:58:12.019Z" },
        { type: "completed", labelAr: "تم التسليم", timestamp: "2026-05-09T10:00:00.000Z" },
      ],
    });

    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.kind).toBe("ok");
    expect(json.timeline).toHaveLength(2);
    expect(json.timeline[1].labelAr).toBe("تم التسليم");
    // Fetched by the internal _id, NOT the stored tracking_number.
    expect(mockFetchDarbShipment).toHaveBeenCalledWith(
      "69fd0af4889e7a3cd010f1a1",
      expect.anything(),
    );
    // The real reference is surfaced to the client.
    expect(json.trackingNumber).toBe("1143633");
  });

  test("persists the repaired reference when it differs from the stored one", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const orderChain = singleChain(darbOrder);
    mockFrom.mockImplementation((table: string) => {
      if (table === "orders") return orderChain;
      if (table === "carriers") return singleChain(carrierRow);
      return singleChain(null);
    });
    mockFetchDarbShipment.mockResolvedValue({
      kind: "ok",
      reference: "1143633",
      slug: "completed",
      rawStatus: "completed",
      timeline: [],
    });

    await GET(req(), { params });
    // tracking_number repaired from SH1584689 -> 1143633
    expect(orderChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ tracking_number: "1143633" }),
    );
  });

  test("does NOT write when the reference is unchanged or empty", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const orderChain = singleChain(darbOrder);
    mockFrom.mockImplementation((table: string) => {
      if (table === "orders") return orderChain;
      if (table === "carriers") return singleChain(carrierRow);
      return singleChain(null);
    });
    mockFetchDarbShipment.mockResolvedValue({
      kind: "ok",
      reference: "SH1584689", // same as stored
      slug: "pending",
      rawStatus: "pending",
      timeline: [],
    });

    await GET(req(), { params });
    expect(orderChain.update).not.toHaveBeenCalled();
  });

  test("502 when the carrier fetch throws", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "orders") return singleChain(darbOrder);
      if (table === "carriers") return singleChain(carrierRow);
      return singleChain(null);
    });
    mockFetchDarbShipment.mockRejectedValue(new Error("ECONNRESET"));

    const res = await GET(req(), { params });
    expect(res.status).toBe(502);
  });
});
