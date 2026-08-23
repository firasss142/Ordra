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

/**
 * Resolving the barcode on a returned parcel.
 *
 * Nothing printed on a parcel looks like an OMS uuid — a Tunisian return
 * carries a twelve-digit Cosmos tracking number, a Libyan one carries Darb's
 * sticker. The console used to match the scan against `orders.id` and against
 * only the page it happened to hold, so a real parcel never resolved.
 */

function req(code: string) {
  return new NextRequest(
    new URL(`http://localhost/api/warehouse/returns/lookup?code=${encodeURIComponent(code)}`),
  );
}

function wire(actor: Record<string, unknown> | null = { role: "warehouse_agent", market_id: "m-1" }) {
  mockFrom.mockImplementation(() => {
    const c: Record<string, unknown> = {};
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockReturnValue(c);
    c.single = vi.fn().mockResolvedValue({ data: actor, error: null });
    c.maybeSingle = vi.fn().mockResolvedValue({ data: actor, error: null });
    return c;
  });
}

/** The order the RPC points at, fetched for display once resolved. */
function withOrder(order: Record<string, unknown> | null) {
  mockFrom.mockImplementation((table: string) => {
    const c: Record<string, unknown> = {};
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockReturnValue(c);
    c.single = vi.fn().mockResolvedValue({
      data: table === "users" ? { role: "warehouse_agent", market_id: "m-1" } : order,
      error: null,
    });
    c.maybeSingle = vi.fn().mockResolvedValue({
      data: table === "users" ? { role: "warehouse_agent", market_id: "m-1" } : order,
      error: null,
    });
    return c;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
});

describe("GET /api/warehouse/returns/lookup", () => {
  test("resolves a carrier tracking number to the order, with its details", async () => {
    withOrder({
      id: "o-1",
      customer_name: "Sami",
      product_name: "Sac",
      quantity: 1,
      total_price: 129,
      tracking_number: "000000227104",
    });
    mockRpc.mockResolvedValue({
      data: { outcome: "found", order_id: "o-1", code: "000000227104" },
      error: null,
    });

    const res = await GET(req("000000227104"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toBe("found");
    expect(json.order.customer_name).toBe("Sami");
    expect(mockRpc).toHaveBeenCalledWith("find_return_by_code", {
      p_market_id: "m-1",
      p_code: "000000227104",
    });
  });

  test("passes an ambiguous verdict through rather than picking one", async () => {
    wire();
    mockRpc.mockResolvedValue({ data: { outcome: "ambiguous", matches: 3 }, error: null });
    const json = await (await GET(req("af69d0"))).json();
    expect(json.outcome).toBe("ambiguous");
    expect(json.matches).toBe(3);
    expect(json.order).toBeUndefined();
  });

  test("reports what a parcel actually is when it is not a return", async () => {
    // Telling an operator holding the parcel "introuvable" would be false.
    withOrder({ id: "o-9", customer_name: "Ali", status: "delivered" });
    mockRpc.mockResolvedValue({
      data: { outcome: "wrong_status", order_id: "o-9", status: "delivered" },
      error: null,
    });
    const json = await (await GET(req("000000227999"))).json();
    expect(json.outcome).toBe("wrong_status");
    expect(json.status).toBe("delivered");
    expect(json.order.customer_name).toBe("Ali");
  });

  test("not_found comes back as not_found", async () => {
    wire();
    mockRpc.mockResolvedValue({ data: { outcome: "not_found" }, error: null });
    expect((await (await GET(req("999999999999"))).json()).outcome).toBe("not_found");
  });

  test("400 without a code — an empty scan is a client bug, not an outcome", async () => {
    wire();
    const res = await GET(new NextRequest(new URL("http://localhost/api/warehouse/returns/lookup")));
    expect(res.status).toBe(400);
  });

  test("403 for a role that cannot scan", async () => {
    wire({ role: "agent", market_id: "m-1" });
    expect((await GET(req("000000227104"))).status).toBe(403);
  });
});
