import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockLoad = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));
vi.mock("@/lib/finance/stock/load", () => ({ loadStockPage: (...a: unknown[]) => mockLoad(...a) }));

import { GET } from "./route";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const req = (q: Record<string, string> = {}) => {
  const url = new URL("http://localhost:3000/api/finance/stock");
  Object.entries(q).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
};
function actor(role: string, marketId: string | null) {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id: marketId }, error: null });
  mockFrom.mockReturnValue(chain);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockResolvedValue({ total: { value: 1 } });
});

describe("GET /api/finance/stock", () => {
  test("403 for a market manager", async () => {
    actor("market_manager", LY);
    expect((await GET(req({ market_id: LY }))).status).toBe(403);
  });
  test("400 without a market", async () => {
    actor("super_admin", null);
    expect((await GET(req())).status).toBe(400);
  });
  test("400 on a window the page cannot ask for", async () => {
    actor("super_admin", null);
    expect((await GET(req({ market_id: LY, window: "30" }))).status).toBe(400);
  });
  test("loads the market on the asked window, 28 days by default", async () => {
    actor("super_admin", null);
    const res = await GET(req({ market_id: LY }));
    expect(res.status).toBe(200);
    expect(mockLoad).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ marketId: LY, windowDays: 28 }));
    await GET(req({ market_id: LY, window: "7" }));
    expect(mockLoad).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ windowDays: 7 }));
  });
});
