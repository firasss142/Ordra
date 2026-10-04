import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import { LY_MARKET_ID } from "@/lib/markets";
import { marketDayStartUtc, todayInMarket } from "@/lib/dates/market-day";

function actor(role: string, marketId: string | null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.single = vi.fn().mockResolvedValue({ data: { role, market_id: marketId }, error: null });
  return c;
}

function runAs(role: string, marketId: string | null) {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  mockFrom.mockImplementation(() => actor(role, marketId));
}

const req = (qs = "") => new NextRequest(new URL(`/api/orders/status-counts${qs}`, "http://localhost:3000"));

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({
    data: { today: 41, unassigned: 7, recall: 23, late_callbacks: 3, to_send: 5, uploaded_today: 12 },
    error: null,
  });
});

describe("GET /api/orders/status-counts — the four work shortcuts", () => {
  test("counts in one call, from the market's midnight", async () => {
    runAs("market_manager", LY_MARKET_ID);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_orders_work_counts", {
      p_market_id: LY_MARKET_ID,
      p_day_start: marketDayStartUtc(todayInMarket(LY_MARKET_ID), LY_MARKET_ID),
    });
    expect((await res.json()).data).toEqual({
      today: 41,
      unassigned: 7,
      recall: 23,
      lateCallbacks: 3,
      toSend: 5,
      uploadedToday: 12,
    });
  });

  test("a manager is pinned to their market whatever the query says", async () => {
    runAs("market_manager", LY_MARKET_ID);
    await GET(req("?market_id=00000000-0000-0000-0000-000000000001"));
    expect(mockRpc.mock.calls[0][1].p_market_id).toBe(LY_MARKET_ID);
  });

  test("a super admin may count every market", async () => {
    runAs("super_admin", null);
    await GET(req());
    expect(mockRpc.mock.calls[0][1].p_market_id).toBeNull();
  });

  test("agents are refused", async () => {
    runAs("agent", LY_MARKET_ID);
    expect((await GET(req())).status).toBe(403);
  });

  test("a failed count is a 500, never zeros", async () => {
    runAs("market_manager", LY_MARKET_ID);
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await GET(req())).status).toBe(500);
  });
});
