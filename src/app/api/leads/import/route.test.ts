import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function req(body: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(
    new URL("/api/leads/import", "http://localhost:3000"),
    { method: "POST", body: JSON.stringify(body) } as any
  );
}

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function existingLeadsChain(rows: Array<{ customer_phone: string }>) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockResolvedValue({ data: rows, error: null });
  return c;
}

function insertLeadsChain(insertedIds: Array<{ id: string }>) {
  const c: Record<string, unknown> = {};
  c.insert = vi.fn().mockReturnValue(c);
  c.select = vi.fn().mockResolvedValue({ data: insertedIds, error: null });
  return c;
}

function historyChain() {
  const c: Record<string, unknown> = {};
  c.insert = vi.fn().mockResolvedValue({ data: null, error: null });
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/leads/import", () => {
  test("403 for agents", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });
    mockFrom.mockImplementation((t: string) =>
      t === "users" ? singleChain({ role: "agent", market_id: "m1" }) : singleChain(null)
    );
    const res = await POST(req({ csv: "x" }));
    expect(res.status).toBe(403);
  });

  test("400 on missing csv field", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) =>
      t === "users"
        ? singleChain({ role: "market_manager", market_id: "m1" })
        : singleChain(null)
    );
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  test("dedups existing phones and returns counts", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });

    const csv =
      "customer_name,customer_phone,source\n" +
      "Alice,+216111,manual_call\n" +
      "Bob,+216222,manual_call\n"; // Bob exists already
    let callIdx = 0;
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return singleChain({ role: "market_manager", market_id: "m1" });
      if (t === "leads") {
        callIdx++;
        // First leads() call is the dedup lookup; second is the insert.
        if (callIdx === 1)
          return existingLeadsChain([{ customer_phone: "+216222" }]);
        return insertLeadsChain([{ id: "new-1" }]);
      }
      if (t === "lead_history") return historyChain();
      return singleChain(null);
    });

    const res = await POST(req({ csv }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.imported).toBe(1);
    expect(json.data.skipped).toBe(1);
  });

  test("rejects bad CSV header (400 headers)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) =>
      t === "users"
        ? singleChain({ role: "market_manager", market_id: "m1" })
        : singleChain(null)
    );
    const res = await POST(req({ csv: "name,phone\nX,+1" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("headers");
  });
});
