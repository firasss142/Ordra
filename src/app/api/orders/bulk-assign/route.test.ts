import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockGetActor = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (...a: unknown[]) => mockFrom(...a),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { POST } from "./route";

const IDS = ["o-1", "o-2", "o-3"];

function req(body: unknown) {
  return new Request("http://x/api/orders/bulk-assign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

function ordersChain(rows: Array<{ id: string; market_id: string }>) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.in = vi.fn().mockResolvedValue({ data: rows, error: null });
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue({ data: { id: "agent-1", market_id: "m-1" }, error: null });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({ actor: { id: "mgr-1", role: "market_manager", market_id: "m-1" } });
  mockFrom.mockImplementation((table: string) =>
    table === "users"
      ? ordersChain([])
      : ordersChain(IDS.map((id) => ({ id, market_id: "m-1" }))),
  );
});

describe("POST /api/orders/bulk-assign — locked orders", () => {
  test("reports how many were assigned and which were skipped as locked", async () => {
    mockRpc.mockResolvedValue({
      data: {
        assigned: ["o-1", "o-2"],
        skipped: [{ order_id: "o-3", reason: "locked", holder_id: "agent-9" }],
      },
      error: null,
    });

    const res = await POST(req({ order_ids: IDS, agent_id: "agent-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.assigned).toBe(2);
    expect(body.data.skipped).toBe(1);
    expect(body.data.locked).toEqual([
      { order_id: "o-3", reason: "locked", holder_id: "agent-9" },
    ]);
  });

  test("a fully-locked selection assigns nothing and says so", async () => {
    mockRpc.mockResolvedValue({
      data: { assigned: [], skipped: IDS.map((id) => ({ order_id: id, reason: "locked" })) },
      error: null,
    });

    const body = await (await POST(req({ order_ids: IDS, agent_id: "agent-1" }))).json();

    expect(body.data.assigned).toBe(0);
    expect(body.data.skipped).toBe(3);
  });

  // The RPC signature did not change, only the JSON shape, and nothing checks
  // it at compile time — there is no generated Supabase types file. A route
  // deployed ahead of the migration must not report `undefined` assigned.
  test("tolerates the legacy { assigned: number } shape for one release", async () => {
    mockRpc.mockResolvedValue({ data: { assigned: 3 }, error: null });

    const body = await (await POST(req({ order_ids: IDS, agent_id: "agent-1" }))).json();

    expect(body.data.assigned).toBe(3);
    expect(body.data.skipped).toBe(0);
    expect(body.data.locked).toEqual([]);
  });
});
