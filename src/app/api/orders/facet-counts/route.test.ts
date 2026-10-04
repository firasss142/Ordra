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
 * The facet counts must bound the same set the list shows: the same scope, the
 * same shortcut, the market's day edges as UTC instants, multi-value facets.
 */
describe("GET /api/orders/facet-counts — v2", () => {
  test("passes the Libyan day edges as UTC instants", async () => {
    runAs("market_manager", LY_MARKET_ID);
    const res = await GET(createRequest("?date_from=2026-09-04&date_to=2026-09-05"));
    expect(res.status).toBe(200);
    const [fn, args] = mockRpc.mock.calls[0];
    expect(fn).toBe("get_order_facet_counts_v2");
    expect(args.p_date_from).toBe("2026-09-03T22:00:00.000Z");
    expect(args.p_date_to).toBe("2026-09-05T21:59:59.999Z");
    expect(args.p_market_id).toBe(LY_MARKET_ID);
  });

  test("sends every facet as a list, and the shortcut with the market's midnight", async () => {
    runAs("market_manager", LY_MARKET_ID);
    await GET(createRequest("?preset=recall&agent_id=a,unassigned&storefront_id=00000000-0000-0000-0000-00000000000a&city=none&carrier_id=none&status=attempt_1"));
    const args = mockRpc.mock.calls[0][1];
    expect(args.p_preset).toBe("recall");
    expect(args.p_day_start).toEqual(expect.any(String));
    expect(args.p_agents).toEqual(["a", "unassigned"]);
    expect(args.p_storefronts).toEqual(["00000000-0000-0000-0000-00000000000a"]);
    expect(args.p_cities).toEqual(["none"]);
    expect(args.p_carriers).toEqual(["none"]);
    expect(args.p_statuses).toEqual(["attempt_1"]);
    expect(args.p_products).toBeNull();
  });

  test("in Archivées it sends the tab and the cut-off of the market's archive delay", async () => {
    runAs("market_manager", LY_MARKET_ID);
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return actorChain("market_manager", LY_MARKET_ID);
      const c: Record<string, unknown> = {};
      c.select = vi.fn(() => c);
      c.eq = vi.fn(() => c);
      c.single = vi.fn().mockResolvedValue({ data: { value: 15 }, error: null });
      return c;
    });
    await GET(createRequest("?scope=archive&state=recent"));
    const args = mockRpc.mock.calls[0][1];
    expect(args.p_scope).toBe("archive");
    expect(args.p_state).toBe("recent");
    const days = (Date.now() - Date.parse(args.p_archive_cutoff)) / 86_400_000;
    expect(Math.round(days)).toBe(15);
  });
});
