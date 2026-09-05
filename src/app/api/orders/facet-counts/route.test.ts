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

function createRequest(query = "") {
  return new NextRequest(new URL(`/api/orders/facet-counts${query}`, "http://localhost:3000"), {
    method: "GET",
  });
}

function actorChain(role: string, marketId: string | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id: marketId }, error: null });
  return chain;
}

function runAs(role: string, marketId: string | null) {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return actorChain(role, marketId);
    throw new Error(`unexpected table ${table}`);
  });
  mockRpc.mockResolvedValue({
    data: { statuses: {}, agents: {}, cities: {}, products: {}, carriers: {} },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The facet counts must bound the same set the list shows. The list now cuts
 * days at the market's midnight, so the RPC receives UTC instants for the
 * window — not calendar dates it would cast at UTC midnight — and the zone for
 * its own `today` preset.
 */
describe("GET /api/orders/facet-counts — market-local window", () => {
  test("passes the Libyan day edges as UTC instants and the market zone", async () => {
    runAs("market_manager", LY_MARKET_ID);

    const res = await GET(createRequest("?date_from=2026-09-04&date_to=2026-09-05"));
    expect(res.status).toBe(200);

    expect(mockRpc).toHaveBeenCalledWith(
      "get_order_facet_counts",
      expect.objectContaining({
        p_market_id: LY_MARKET_ID,
        p_date_from: "2026-09-03T22:00:00.000Z",
        p_date_to: "2026-09-05T21:59:59.999Z",
        p_tz: "Africa/Tripoli",
      }),
    );
  });

  test("leaves an absent window open and still names the zone", async () => {
    runAs("market_manager", LY_MARKET_ID);

    await GET(createRequest("?preset=today"));

    expect(mockRpc).toHaveBeenCalledWith(
      "get_order_facet_counts",
      expect.objectContaining({ p_date_from: null, p_date_to: null, p_tz: "Africa/Tripoli" }),
    );
  });
});
