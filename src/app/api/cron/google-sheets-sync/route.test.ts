import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      single: vi.fn().mockResolvedValue({ data: null }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  })),
}));

vi.mock("@/lib/google-sheets/sources-config", () => ({
  getSheetsSources: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/google-sheets/sync-state", () => ({
  getLastRowForStorefront: vi.fn().mockResolvedValue(0),
  setLastRowForStorefront: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/google-sheets/client", () => ({
  fetchSheetRows: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/orders/create-order-from-data", () => ({
  createOrderFromData: vi.fn().mockResolvedValue({ status: "created", orderId: "x" }),
}));

const CRON_SECRET = "test-cron-secret";

function makeRequest(headers: Record<string, string> = {}) {
  process.env.CRON_SECRET = CRON_SECRET;
  return new NextRequest("http://localhost/api/cron/google-sheets-sync", {
    method: "GET",
    headers,
  });
}

describe("GET /api/cron/google-sheets-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  it("returns 401 when secret header is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 when x-cron-secret is wrong", async () => {
    const res = await GET(makeRequest({ "x-cron-secret": "wrong-secret" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization Bearer is wrong", async () => {
    const res = await GET(makeRequest({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns 200 with correct x-cron-secret", async () => {
    const res = await GET(makeRequest({ "x-cron-secret": CRON_SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 200 with correct Authorization Bearer", async () => {
    const res = await GET(makeRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/cron/google-sheets-sync", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
  });

  it("returns 200 with correct secret", async () => {
    const req = new NextRequest("http://localhost/api/cron/google-sheets-sync", {
      method: "POST",
      headers: { "x-cron-secret": CRON_SECRET },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
