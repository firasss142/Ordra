import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { GET } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const CAR = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69";
const req = (q = "") => new NextRequest(new URL(`http://localhost:3000/api/carriers/scorecard/parcels${q}`));
const as = (role: string, market_id: string | null = LY) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id: "u1", role, market_id } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [{ order_id: "o1", tracking_number: "1593038", days: 8.2 }], error: null });
});

describe("GET /api/carriers/scorecard/parcels", () => {
  test("agents and warehouse agents never list them", async () => {
    as("agent");
    expect((await GET(req(`?carrier_id=${CAR}&kind=late`))).status).toBe(403);
    as("warehouse_agent");
    expect((await GET(req(`?carrier_id=${CAR}&kind=late`))).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("lists the parcels behind a number, the manager pinned to their market", async () => {
    as("market_manager", LY);
    const res = await GET(req(`?market_id=${TN}&carrier_id=${CAR}&kind=returns`));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_carrier_scorecard_parcels", { p_market_id: LY, p_carrier_id: CAR, p_kind: "returns" });
    expect((await res.json()).data[0].tracking_number).toBe("1593038");
  });

  test("refuses an unknown kind or a missing carrier", async () => {
    as("super_admin", null);
    expect((await GET(req(`?market_id=${LY}&carrier_id=${CAR}&kind=everything`))).status).toBe(400);
    expect((await GET(req(`?market_id=${LY}&kind=late`))).status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("a database failure is a 500", async () => {
    as("market_manager", LY);
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect((await GET(req(`?carrier_id=${CAR}&kind=dormant`))).status).toBe(500);
  });
});
