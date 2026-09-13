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
const req = (q = "") => new NextRequest(new URL(`http://localhost:3000/api/delivery/scorecard${q}`));
const as = (id: string, role: string) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id, role, market_id: LY } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: { delivered: 7, returned: 2, delivery_rate: 78, saved: 1, window_days: 30 }, error: null });
});

describe("GET /api/delivery/scorecard", () => {
  test("only agents have a delivery scorecard", async () => {
    as("m", "market_manager");
    expect((await GET(req())).status).toBe(403);
    as("w", "warehouse_agent");
    expect((await GET(req())).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("an agent always gets their own card, whatever id they send", async () => {
    as("a1", "agent");
    const res = await GET(req("?agent_id=someone-else"));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("get_delivery_agent_scorecard", { p_agent_id: "a1", p_days: 30 });
    expect((await res.json()).data.delivery_rate).toBe(78);
  });

  test("a database failure is a 500", async () => {
    as("a1", "agent");
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect((await GET(req())).status).toBe(500);
  });
});
