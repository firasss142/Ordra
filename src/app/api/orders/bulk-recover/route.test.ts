import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: (...a: unknown[]) => mockRpc(...a), from: (...a: unknown[]) => mockFrom(...a) }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { POST } from "./route";
import { NextRequest } from "next/server";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const req = (body: unknown) =>
  new NextRequest(new URL("http://localhost:3000/api/orders/bulk-recover"), { method: "POST", body: JSON.stringify(body) });

function orders(rows: { id: string; status: string; market_id: string }[]) {
  mockFrom.mockImplementation(() => ({ select: () => ({ in: () => Promise.resolve({ data: rows, error: null }) }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({ actor: { id: "mgr", role: "market_manager", market_id: "m-1" } });
  mockRpc.mockResolvedValue({ data: {}, error: null });
});

describe("POST /api/orders/bulk-recover", () => {
  test("restores every deleted order through the recover RPC", async () => {
    orders([{ id: A, status: "deleted", market_id: "m-1" }, { id: B, status: "deleted", market_id: "m-1" }]);
    const res = await POST(req({ order_ids: [A, B] }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith("recover_deleted_order", { p_order_id: A, p_actor_id: "mgr", p_note: "Commande restaurée" });
    expect((await res.json()).data).toEqual({ restored: [A, B], failed: [] });
  });

  test("skips what is not deleted or not in the manager's market, and says so", async () => {
    orders([{ id: A, status: "pending", market_id: "m-1" }, { id: B, status: "deleted", market_id: "m-2" }]);
    const body = await (await POST(req({ order_ids: [A, B] }))).json();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(body.data.failed).toEqual([
      { order_id: A, reason: "not_deleted" },
      { order_id: B, reason: "forbidden" },
    ]);
  });

  test("a failed restore does not stop the others", async () => {
    orders([{ id: A, status: "deleted", market_id: "m-1" }, { id: B, status: "deleted", market_id: "m-1" }]);
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "x" } });
    const body = await (await POST(req({ order_ids: [A, B] }))).json();
    expect(body.data).toEqual({ restored: [B], failed: [{ order_id: A, reason: "not_recoverable" }] });
  });

  test("agents cannot restore", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a", role: "agent", market_id: "m-1" } });
    expect((await POST(req({ order_ids: [A] }))).status).toBe(403);
  });
});
