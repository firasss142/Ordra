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

function createRequest(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method: "GET" });
}

function queryChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockReturnValue(chain);
  chain.lt = vi.fn().mockReturnValue(chain);
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
  mockRpc.mockResolvedValue({ data: "e-1", error: null });
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

  /** Runs an export as a Tunisian manager and returns the orders query chain. */
  async function exportWith(qs: string) {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let orderChainRef: ReturnType<typeof queryChain> | null = null;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") {
        orderChainRef = queryChain({ data: [], error: null });
        return orderChainRef;
      }
      return queryChain({ data: null, error: null });
    });
    const res = await GET(createRequest(`/api/orders/export${qs}`));
    expect(res.status).toBe(200);
    return orderChainRef! as ReturnType<typeof queryChain>;
  }

  test("exports the rows the list shows: same filters, deleted and archived hidden", async () => {
    const c = await exportWith("?status=pending,confirmed&city=Tunis");
    expect(c.in).toHaveBeenCalledWith("status", ["pending", "confirmed"]);
    expect(c.in).toHaveBeenCalledWith("customer_city", ["Tunis"]);
    expect(c.neq).toHaveBeenCalledWith("status", "deleted");
    expect(c.is).toHaveBeenCalledWith("archived_at", null);
  });

  test("Archivées exports the tab it was launched from", async () => {
    const c = await exportWith("?scope=archive&state=archived&status=returned");
    expect(c.not).toHaveBeenCalledWith("archived_at", "is", null);
    expect(c.in).toHaveBeenCalledWith("status", ["returned"]);
  });

  test("Supprimées exports the deleted orders", async () => {
    const c = await exportWith("?scope=archive&state=deleted");
    expect(c.eq).toHaveBeenCalledWith("status", "deleted");
  });

  test("date_from/date_to bound created_at at the market's day edges, in UTC", async () => {
    // The CSV must be the rows the operator was looking at. The list cuts days
    // at the market's midnight (Libya = UTC+2), so the export must too — a
    // UTC-midnight bound would drop every order placed after 22:00 local from
    // the day it belongs to and add it to the next.
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    let orderChainRef: ReturnType<typeof queryChain>;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: LY_MARKET_ID }, error: null });
      if (table === "orders") {
        orderChainRef = queryChain({ data: [], error: null });
        return orderChainRef;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await GET(createRequest("/api/orders/export?date_from=2026-09-04&date_to=2026-09-05"));
    expect(res.status).toBe(200);

    expect(orderChainRef!.gte).toHaveBeenCalledWith("created_at", "2026-09-03T22:00:00.000Z");
    expect(orderChainRef!.lte).toHaveBeenCalledWith("created_at", "2026-09-05T21:59:59.999Z");
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

describe("GET /api/orders/export — the export is journaled (export.orders)", () => {
  const twoOrders = [
    { id: "o-1", created_at: "2026-04-10T10:00:00Z", customer_name: "A", customer_phone: "1", customer_city: "T", product_name: "P", variant_label: null, total_price: 10, status: "pending", assigned_to: null },
    { id: "o-2", created_at: "2026-04-10T11:00:00Z", customer_name: "B", customer_phone: "2", customer_city: "T", product_name: "P", variant_label: null, total_price: 20, status: "pending", assigned_to: null },
  ];

  function asManager(orders: unknown, error: unknown = null) {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "market_manager", market_id: "m-1" }, error: null });
      if (table === "orders") return queryChain({ data: orders, error });
      return queryChain({ data: null, error: null });
    });
  }

  test("records the number of rows, the format and the market, as the signed-in user", async () => {
    asManager(twoOrders);
    const res = await GET(createRequest("/api/orders/export"));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("journal_record", expect.objectContaining({
      p_action: "export.orders",
      p_entity_type: "orders",
      p_market_id: "m-1",
      p_context: { rows: 2, format: "csv" },
    }));
  });

  test("a super_admin export across all markets is recorded with no market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: { role: "super_admin", market_id: null }, error: null });
      return queryChain({ data: twoOrders, error: null });
    });
    await GET(createRequest("/api/orders/export"));
    expect(mockRpc).toHaveBeenCalledWith("journal_record", expect.objectContaining({ p_market_id: null }));
  });

  test("a journal that fails changes nothing: the CSV is still served", async () => {
    asManager(twoOrders);
    mockRpc.mockRejectedValue(new Error("journal down"));
    const res = await GET(createRequest("/api/orders/export"));
    expect(res.status).toBe(200);
    expect((await res.text()).split("\n")).toHaveLength(3);
  });

  test("a failed export records nothing", async () => {
    asManager(null, { message: "boom" });
    const res = await GET(createRequest("/api/orders/export"));
    expect(res.status).toBe(500);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
