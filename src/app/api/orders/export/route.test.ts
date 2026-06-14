import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function createRequest(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method: "GET" });
}

function queryChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.or = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(resolveWith);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/orders/export", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = createRequest("/api/orders/export");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  test("returns 403 when agent tries to export", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockReturnValue(queryChain({ data: { role: "agent", market_id: "m-1" }, error: null }));
    const req = createRequest("/api/orders/export");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  test("returns CSV with correct headers", async () => {
    const orders = [
      {
        id: "order-1",
        created_at: "2026-04-10T10:00:00Z",
        customer_name: "Ahmed",
        customer_phone: "+21699999999",
        customer_city: "Tunis",
        product_name: "Shampoo",
        variant_label: "Pack x2",
        total_price: 60,
        status: "pending",
        assigned_to: null,
      },
    ];
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: orders, error: null });
      return queryChain({ data: null, error: null });
    });

    const req = createRequest("/api/orders/export");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");

    const csv = await res.text();
    const lines = csv.split("\n");
    // First line = headers
    expect(lines[0]).toContain("ID");
    expect(lines[0]).toContain("Statut");
    // Second line = data
    expect(lines[1]).toContain("Ahmed");
    expect(lines[1]).toContain("Tunis");
  });

  test("applies filters to export query", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    let orderChainRef: ReturnType<typeof queryChain>;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") {
        orderChainRef = queryChain({ data: [], error: null });
        return orderChainRef;
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest("/api/orders/export?status=pending&city=Tunis");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const eqCalls = (orderChainRef!.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqCalls.find((c: unknown[]) => c[0] === "status" && c[1] === "pending")).toBeDefined();
    expect(eqCalls.find((c: unknown[]) => c[0] === "customer_city" && c[1] === "Tunis")).toBeDefined();
    expect(orderChainRef!.neq).toHaveBeenCalledWith("status", "deleted");
  });

  test("applies comma-separated status via .in()", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let orderChainRef: ReturnType<typeof queryChain>;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") {
        orderChainRef = queryChain({ data: [], error: null });
        return orderChainRef;
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest("/api/orders/export?status=delivered,returned,rejected,deleted");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const inCalls = (orderChainRef!.in as ReturnType<typeof vi.fn>).mock.calls;
    const statusIn = inCalls.find((c: unknown[]) => c[0] === "status");
    expect(statusIn).toBeDefined();
    expect(statusIn![1]).toEqual(["delivered", "returned", "rejected", "deleted"]);
    expect(orderChainRef!.neq).toHaveBeenCalledWith("status", "deleted");
  });

  test("include_deleted=1 exports ONLY deleted orders", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let orderChainRef: ReturnType<typeof queryChain>;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") {
        orderChainRef = queryChain({ data: [], error: null });
        return orderChainRef;
      }
      return queryChain({ data: null, error: null });
    });

    const req = createRequest("/api/orders/export?include_deleted=1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(orderChainRef!.eq).toHaveBeenCalledWith("status", "deleted");
    expect(orderChainRef!.neq).not.toHaveBeenCalledWith("status", "deleted");
  });

  test("super_admin can export with market_id filter", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "super_admin", market_id: null }, error: null });
      if (table === "orders") return queryChain({ data: [], error: null });
      return queryChain({ data: null, error: null });
    });

    const req = createRequest("/api/orders/export?market_id=m-1");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});
