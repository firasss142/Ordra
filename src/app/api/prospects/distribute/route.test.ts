import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (...a: unknown[]) => mockFrom(...a),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { POST } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const HEND = "11111111-1111-1111-1111-111111111111";
const MOUNA = "22222222-2222-2222-2222-222222222222";

const req = (body: unknown) =>
  new NextRequest(new URL("http://localhost:3000/api/prospects/distribute"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const as = (id: string, role: string, market_id: string | null) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id, role, market_id } } as never);

/** Unassigned prospects, as the pool query returns them. */
const POOL = [
  { id: "l1", customer_phone: "0911111111", status: "new" },
  { id: "l2", customer_phone: "0922222222", status: "new" },
  { id: "l3", customer_phone: "0933333333", status: "new" },
];

const AGENTS = [
  { id: HEND, full_name: "Hend", is_active: true },
  { id: MOUNA, full_name: "Mouna", is_active: true },
];

/**
 * The route reads four things: the pool, the roster, each agent's open queue
 * and their calls today, then the prior agent per phone. One chainable mock
 * stands in for all of them; `table` decides what comes back.
 */
function supabaseReturning(over: Partial<Record<string, unknown[]>> = {}) {
  mockFrom.mockImplementation((table: string) => {
    let rows =
      over[table] ??
      (table === "leads" ? POOL : table === "users" ? AGENTS : []);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "not", "order", "limit", "neq", "gte"]) {
      chain[m] = vi.fn(() => chain);
    }
    // `in` really filters, so a hand-picked selection narrows the pool the way
    // PostgREST would. Without this the test cannot tell the two apart.
    chain.in = vi.fn((column: string, values: unknown[]) => {
      if (column === "id") {
        rows = (rows as { id: string }[]).filter((r) => (values as string[]).includes(r.id));
      }
      return chain;
    });
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
    return chain;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseReturning();
  mockRpc.mockImplementation((fn: string) => {
    if (fn === "bulk_assign_leads") {
      return Promise.resolve({
        data: { assigned: 3, skipped: 0, by_agent: [{ agent_id: HEND, n: 2 }, { agent_id: MOUNA, n: 1 }] },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

const body = (over: Record<string, unknown> = {}) => ({
  agent_ids: [HEND, MOUNA],
  rule: "history_then_round_robin",
  cap: 20,
  ...over,
});

describe("POST /api/prospects/distribute", () => {
  test("an agent cannot distribute the pool", async () => {
    // Distribution is the manager's act. An agent deciding who calls whom
    // would be reassigning their colleagues' work.
    as("a1", "agent", LY);
    expect((await POST(req(body()))).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("warehouse agents and investors are refused too", async () => {
    as("w", "warehouse_agent", LY);
    expect((await POST(req(body()))).status).toBe(403);
    as("i", "investor", null);
    expect((await POST(req(body()))).status).toBe(403);
  });

  test("a manager distributes their own market, whatever the body asks for", async () => {
    as("m", "market_manager", LY);
    const res = await POST(req(body({ market_id: TN })));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "bulk_assign_leads",
      expect.objectContaining({ p_market_id: LY }),
    );
  });

  test("a super admin must name a market", async () => {
    as("sa", "super_admin", null);
    expect((await POST(req(body()))).status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("a super admin distributing a named market reaches the RPC", async () => {
    as("sa", "super_admin", null);
    const res = await POST(req(body({ market_id: LY })));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "bulk_assign_leads",
      expect.objectContaining({ p_market_id: LY }),
    );
  });

  test("the plan reaches the database as one call, not one per prospect", async () => {
    // assign_lead() is per-lead; 1 694 prospects would be 1 694 round trips.
    as("m", "market_manager", LY);
    await POST(req(body()));
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  test("the actor is recorded as the manager who pressed the button", async () => {
    as("mgr-7", "market_manager", LY);
    await POST(req(body()));
    expect(mockRpc).toHaveBeenCalledWith(
      "bulk_assign_leads",
      expect.objectContaining({ p_actor_id: "mgr-7", p_actor_type: "manager" }),
    );
  });

  test("a super admin is recorded as a super admin, not as a manager", async () => {
    as("sa-1", "super_admin", null);
    await POST(req(body({ market_id: LY })));
    expect(mockRpc).toHaveBeenCalledWith(
      "bulk_assign_leads",
      expect.objectContaining({ p_actor_type: "super_admin" }),
    );
  });

  test("every assignment names a lead and an agent", async () => {
    as("m", "market_manager", LY);
    await POST(req(body()));
    const args = mockRpc.mock.calls[0][1] as { p_assignments: { lead_id: string; agent_id: string }[] };
    expect(args.p_assignments.length).toBeGreaterThan(0);
    for (const a of args.p_assignments) {
      expect(a.lead_id).toBeTruthy();
      expect([HEND, MOUNA]).toContain(a.agent_id);
    }
  });

  test("no agents chosen is refused before touching the database", async () => {
    as("m", "market_manager", LY);
    const res = await POST(req(body({ agent_ids: [] })));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("an unknown rule is refused", async () => {
    as("m", "market_manager", LY);
    expect((await POST(req(body({ rule: "whatever" })))).status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("a cap outside its bounds is refused", async () => {
    as("m", "market_manager", LY);
    expect((await POST(req(body({ cap: 0 })))).status).toBe(400);
    expect((await POST(req(body({ cap: 5000 })))).status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("an empty pool is a plain answer, not an error", async () => {
    // A manager who distributes twice in a row must be told the pool is empty,
    // not shown a failure.
    as("m", "market_manager", LY);
    supabaseReturning({ leads: [] });
    const res = await POST(req(body()));
    expect(res.status).toBe(200);
    expect((await res.json()).assigned).toBe(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("a selection of specific prospects distributes only those", async () => {
    as("m", "market_manager", LY);
    await POST(req(body({ lead_ids: ["l1", "l2"] })));
    const args = mockRpc.mock.calls[0][1] as { p_assignments: { lead_id: string }[] };
    expect(args.p_assignments.map((a) => a.lead_id).sort()).toEqual(["l1", "l2"]);
  });

  test("a database failure is reported, not swallowed into a false success", async () => {
    as("m", "market_manager", LY);
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST(req(body()));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/prospects/distribute?preview=1", () => {
  const preview = (b: unknown) =>
    new NextRequest(new URL("http://localhost:3000/api/prospects/distribute?preview=1"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });

  test("a preview writes nothing", async () => {
    as("m", "market_manager", LY);
    const res = await POST(preview(body()));
    expect(res.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("the preview reports the split between history and round robin", async () => {
    // Libya: 288 of 288 have a prior agent. Tunisia: 93 of 1 685. A manager in
    // Tunis must see that most of the batch is round robin before confirming.
    as("m", "market_manager", LY);
    const res = await POST(preview(body()));
    const json = await res.json();
    expect(json.rows.length).toBe(2);
    for (const r of json.rows) {
      expect(r.byHistory + r.byRoundRobin).toBe(r.total);
      expect(r.name).toBeTruthy();
    }
    expect(json.assigned + json.left).toBe(POOL.length);
  });

  test("the preview and the write plan the same thing", async () => {
    // They are two calls; if they disagreed, the manager would confirm numbers
    // that never happened.
    as("m", "market_manager", LY);
    const shown = await (await POST(preview(body()))).json();
    await POST(req(body()));
    const written = mockRpc.mock.calls[0][1] as { p_assignments: unknown[] };
    expect(written.p_assignments.length).toBe(shown.assigned);
  });
});
