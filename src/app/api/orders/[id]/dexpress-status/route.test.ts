import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: vi.fn().mockReturnValue({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  }),
}));

const mockFetchDexpressStatus = vi.fn();
vi.mock("@/lib/carriers/dexpress/tracking", () => ({
  fetchDexpressStatus: (...args: unknown[]) => mockFetchDexpressStatus(...args),
}));

vi.mock("@/lib/carriers/dexpress/client", () => ({
  DexpressClient: vi.fn().mockImplementation(() => ({ ensureSession: vi.fn() })),
}));

const mockBuildConfig = vi.fn();
vi.mock("@/lib/carriers/dispatch", () => ({
  buildConfig: (...args: unknown[]) => mockBuildConfig(...args),
}));

import { GET } from "./route";

function req() {
  return new NextRequest(
    new URL("http://localhost/api/orders/order-1/dexpress-status")
  );
}

// Helper: builds a chainable .select().eq().single() mock that resolves to {data, error}.
function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

// Order row that the route's RLS-scoped query returns.
// carriers is joined inline as a nested object — matches the !inner select syntax.
const dexpressOrder = {
  id: "order-1",
  tracking_number: "1343188",
  carrier_id: "dx-carrier-uuid",
  carriers: { code: "dexpress" },
};

const navexOrder = {
  id: "order-2",
  tracking_number: "TUN-99",
  carrier_id: "nx-carrier-uuid",
  carriers: { code: "navex" },
};

const dexpressOrderNoTracking = {
  id: "order-3",
  tracking_number: null,
  carrier_id: "dx-carrier-uuid",
  carriers: { code: "dexpress" },
};

// Encrypted carrier row that would come from the carriers table.
const carrierRow = {
  id: "dx-carrier-uuid",
  code: "dexpress",
  api_endpoint: "https://portal.dexpress.ly",
  api_credentials: "encrypted-blob",
  delivery_fee: 35,
  return_fee: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default buildConfig: returns a plausible CarrierConfig.
  mockBuildConfig.mockReturnValue({
    id: "dx-carrier-uuid",
    code: "dexpress",
    apiEndpoint: "https://portal.dexpress.ly",
    apiCredentials: { email: "m@example.com", password: "x" },
    deliveryFee: 35,
    returnFee: 0,
  });
});

describe("GET /api/orders/[id]/dexpress-status — auth + eligibility", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(req(), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 404 when RLS hides the order (cross-market access attempt)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    // RLS returns no rows for orders the user isn't allowed to see.
    mockFrom.mockReturnValue(singleChain(null));

    const res = await GET(req(), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(404);
    expect(mockFetchDexpressStatus).not.toHaveBeenCalled();
  });

  test("returns 400 when carrier is not Dexpress", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockFrom.mockReturnValue(singleChain(navexOrder));

    const res = await GET(req(), {
      params: Promise.resolve({ id: "order-2" }),
    });
    expect(res.status).toBe(400);
    expect(mockFetchDexpressStatus).not.toHaveBeenCalled();
  });

  test("returns 400 when tracking_number is empty", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockFrom.mockReturnValue(singleChain(dexpressOrderNoTracking));

    const res = await GET(req(), {
      params: Promise.resolve({ id: "order-3" }),
    });
    expect(res.status).toBe(400);
    expect(mockFetchDexpressStatus).not.toHaveBeenCalled();
  });
});

describe("GET /api/orders/[id]/dexpress-status — happy path + Dexpress branches", () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    // mockFrom must return one chain for "orders" and one for "carriers".
    mockFrom.mockImplementation((table: string) => {
      if (table === "orders") return singleChain(dexpressOrder);
      if (table === "carriers") return singleChain(carrierRow);
      return singleChain(null);
    });
  });

  test("returns 200 with kind:ok snapshot on the happy path", async () => {
    mockFetchDexpressStatus.mockResolvedValue({
      kind: "ok",
      trackingNumber: "1343188",
      slug: "IN_COMPANY",
      statusId: 3,
      rawLabel: "فى الشركة",
      isAccepted: true,
    });

    const res = await GET(req(), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      kind: "ok",
      trackingNumber: "1343188",
      slug: "IN_COMPANY",
      statusId: 3,
      rawLabel: "فى الشركة",
      isAccepted: true,
    });

    expect(mockFetchDexpressStatus).toHaveBeenCalledWith(
      "1343188",
      expect.anything()
    );
  });

  test("returns 404 with kind:not_found when Dexpress doesn't recognize the tracking number", async () => {
    mockFetchDexpressStatus.mockResolvedValue({
      kind: "not_found",
      trackingNumber: "1343188",
    });

    const res = await GET(req(), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({
      kind: "not_found",
      trackingNumber: "1343188",
    });
  });

  test("returns 502 with {error,message} when fetchDexpressStatus throws", async () => {
    mockFetchDexpressStatus.mockRejectedValue(
      new Error("DEXPRESS_SESSION_UNRECOVERABLE: bounced to /login twice in a row")
    );

    const res = await GET(req(), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBeDefined();
    expect(json.message).toBeDefined();
    expect(typeof json.message).toBe("string");
  });
});

describe("GET /api/orders/[id]/dexpress-status — unknown-status-id observability log", () => {
  const logInsertSpy = vi.fn();

  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "orders") return singleChain(dexpressOrder);
      if (table === "carriers") return singleChain(carrierRow);
      return singleChain(null);
    });
    logInsertSpy.mockClear();
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "carrier_event_log") {
        return {
          insert: (payload: unknown) => {
            logInsertSpy(payload);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      return {};
    });
  });

  test("writes a carrier_event_log row when slug is null but rawLabel has content (unknown status ID)", async () => {
    mockFetchDexpressStatus.mockResolvedValue({
      kind: "ok",
      trackingNumber: "1343188",
      slug: null,
      statusId: 9999,
      rawLabel: "حالة جديدة",
      isAccepted: true,
    });

    const res = await GET(req(), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);

    expect(logInsertSpy).toHaveBeenCalledTimes(1);
    const payload = logInsertSpy.mock.calls[0][0];
    expect(payload).toMatchObject({
      carrier_code: "dexpress",
      source: "tracking_view",
      tracking_number: "1343188",
      order_id: "order-1",
      carrier_status_raw: "حالة جديدة",
      outcome: "ignored",
      outcome_reason: "unknown_dexpress_status_id",
    });
  });

  test("does NOT write a log row when slug resolved successfully", async () => {
    mockFetchDexpressStatus.mockResolvedValue({
      kind: "ok",
      trackingNumber: "1343188",
      slug: "IN_COMPANY",
      statusId: 3,
      rawLabel: "فى الشركة",
      isAccepted: true,
    });

    await GET(req(), { params: Promise.resolve({ id: "order-1" }) });
    expect(logInsertSpy).not.toHaveBeenCalled();
  });

  test("does NOT write a log row on kind:not_found (clean Dexpress signal, not a parsing miss)", async () => {
    mockFetchDexpressStatus.mockResolvedValue({
      kind: "not_found",
      trackingNumber: "1343188",
    });

    await GET(req(), { params: Promise.resolve({ id: "order-1" }) });
    expect(logInsertSpy).not.toHaveBeenCalled();
  });

  test("response is still 200 even if the log insert throws (fire-and-forget)", async () => {
    mockFetchDexpressStatus.mockResolvedValue({
      kind: "ok",
      trackingNumber: "1343188",
      slug: null,
      statusId: 9999,
      rawLabel: "حالة جديدة",
      isAccepted: true,
    });
    // Override the admin client to throw on insert.
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "carrier_event_log") {
        return {
          insert: () => Promise.reject(new Error("log table down")),
        };
      }
      return {};
    });

    const res = await GET(req(), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.kind).toBe("ok");
  });
});
