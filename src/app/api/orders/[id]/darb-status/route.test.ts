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

const mockFetchDarbTimeline = vi.fn();
vi.mock("@/lib/carriers/darb-assabil-tracking", () => ({
  fetchDarbTimeline: (...args: unknown[]) => mockFetchDarbTimeline(...args),
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
  return c;
}

const darbOrder = {
  id: "order-1",
  tracking_number: "SH1584689",
  carrier_id: "darb-uuid",
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

  test("400 when the order has no tracking number", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockReturnValue(singleChain({ ...darbOrder, tracking_number: null }));
    expect((await GET(req(), { params })).status).toBe(400);
  });

  test("200 with the parsed Arabic timeline events", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "orders") return singleChain(darbOrder);
      if (table === "carriers") return singleChain(carrierRow);
      return singleChain(null);
    });
    mockFetchDarbTimeline.mockResolvedValue([
      { type: "info", labelAr: "تم إنشاء الشحنة", timestamp: "2026-05-07T21:58:12.019Z" },
      { type: "success", labelAr: "تم التسليم", timestamp: "2026-05-09T10:00:00.000Z" },
    ]);

    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.kind).toBe("ok");
    expect(json.timeline).toHaveLength(2);
    expect(json.timeline[1].labelAr).toBe("تم التسليم");
    expect(mockFetchDarbTimeline).toHaveBeenCalledWith("SH1584689", expect.anything());
  });

  test("502 when the carrier fetch throws", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "orders") return singleChain(darbOrder);
      if (table === "carriers") return singleChain(carrierRow);
      return singleChain(null);
    });
    mockFetchDarbTimeline.mockRejectedValue(new Error("ECONNRESET"));

    const res = await GET(req(), { params });
    expect(res.status).toBe(502);
  });
});
