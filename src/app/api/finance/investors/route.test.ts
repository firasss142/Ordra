import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockLoad = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: () => ({ admin: true }),
}));
vi.mock("@/lib/finance/investors/load", () => ({ loadInvestorsPage: (...a: unknown[]) => mockLoad(...a) }));

import { GET } from "./route";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const req = (q: Record<string, string> = {}) => {
  const url = new URL("http://localhost:3000/api/finance/investors");
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
  mockLoad.mockResolvedValue({ investors: [] });
});

describe("GET /api/finance/investors", () => {
  test("403 for an agent", async () => {
    actor("agent", LY);
    expect((await GET(req({ market_id: LY }))).status).toBe(403);
  });
  test("400 when the owner names no market", async () => {
    actor("super_admin", null);
    expect((await GET(req())).status).toBe(400);
  });
  test("the owner reads the market asked", async () => {
    actor("super_admin", null);
    expect((await GET(req({ market_id: LY }))).status).toBe(200);
    expect(mockLoad).toHaveBeenCalledWith(expect.anything(), LY);
  });
  test("a market manager reads their own market whatever they ask for", async () => {
    actor("market_manager", LY);
    expect((await GET(req({ market_id: TN }))).status).toBe(200);
    expect(mockLoad).toHaveBeenCalledWith(expect.anything(), LY);
  });
});
