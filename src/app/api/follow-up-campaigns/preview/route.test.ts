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

function req(body: unknown, headers?: Record<string, string>) {
  return new NextRequest(new URL("/api/follow-up-campaigns/preview", "http://localhost:3000"), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  } as never);
}

function managerHeaders(marketId = "mkt-tn") {
  return {
    "x-oms-role": "market_manager",
    "x-oms-actor-id": "mgr-1",
    "x-oms-market-id": marketId,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/follow-up-campaigns/preview", () => {
  test("returns 401 without auth", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(req({ filter_json: {} }));
    expect(res.status).toBe(401);
  });

  test("agent receives 403", async () => {
    const res = await POST(
      req({ filter_json: {} }, { "x-oms-role": "agent", "x-oms-actor-id": "a1", "x-oms-market-id": "mkt-tn" })
    );
    expect(res.status).toBe(403);
  });

  test("returns matched_count, skipped_active_followup, and sample", async () => {
    const sampleOrders = [
      { id: "o1", customer_name: "Alice", customer_phone: "+21611111111", customer_city: "Tunis", product_id: "p1", created_at: "2026-04-10T00:00:00Z" },
    ];

    let ordersCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      // Thenable chain — resolves when awaited
      const makeChain = (resolveWith: unknown) => {
        const chain: Record<string, unknown> = {
          then: (resolve: (v: unknown) => void) => resolve(resolveWith),
          catch: vi.fn(),
        };
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.gte = vi.fn().mockReturnValue(chain);
        chain.lte = vi.fn().mockReturnValue(chain);
        chain.in = vi.fn().mockReturnValue(chain);
        chain.order = vi.fn().mockReturnValue(chain);
        chain.limit = vi.fn().mockReturnValue(chain);
        return chain;
      };

      if (table === "orders") {
        ordersCallCount++;
        if (ordersCallCount === 1) {
          // First call: count query (matched_count = 10)
          return makeChain({ data: null, error: null, count: 10 });
        }
        // Third call: sample query
        return makeChain({ data: sampleOrders, error: null, count: null });
      }
      if (table === "order_follow_ups") {
        // Second call (after first orders call): active follow-ups count = 2
        return makeChain({ data: null, error: null, count: 2 });
      }
      return makeChain({ data: null, error: null, count: 0 });
    });

    const res = await POST(
      req({ filter_json: { statuses: ["delivered"], date_from: "2026-04-07" } }, managerHeaders())
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.data.matched_count).toBe("number");
    expect(typeof body.data.skipped_active_followup).toBe("number");
    expect(Array.isArray(body.data.sample)).toBe(true);
  });
});
