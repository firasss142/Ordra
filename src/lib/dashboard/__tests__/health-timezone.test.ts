import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { getDashboardHealth } from "../health";
import { LY_MARKET_ID } from "@/lib/markets";

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: {}, error: null });
});

/**
 * get_dashboard_health cut every window and every trend-chart day at UTC
 * midnight. The market lives at UTC+2 (Libya) / UTC+1 (Tunisia), so "today"
 * on the dashboard began two hours before the team's day did and the daily
 * chart moved late-evening orders onto the next bar. The RPC now takes the
 * market's zone; this pins that the caller sends it.
 */
describe("getDashboardHealth — market timezone", () => {
  test("a market manager's dashboard is cut in their market's zone", async () => {
    await getDashboardHealth({
      fromDate: "2026-09-04",
      toDate: "2026-09-05",
      marketId: null,
      role: "market_manager",
      actorMarketId: LY_MARKET_ID,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "get_dashboard_health",
      expect.objectContaining({ p_market_id: LY_MARKET_ID, p_tz: "Africa/Tripoli" }),
    );
  });

  test("the cross-market view falls back to Tunis, like every other route", async () => {
    await getDashboardHealth({
      fromDate: "2026-09-04",
      toDate: "2026-09-05",
      marketId: "all",
      role: "super_admin",
      actorMarketId: null,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "get_dashboard_health",
      expect.objectContaining({ p_market_id: null, p_tz: "Africa/Tunis" }),
    );
  });
});
