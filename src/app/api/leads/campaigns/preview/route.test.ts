import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: vi.fn(),
}));

import { POST } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";

function req(body: unknown) {
  return new NextRequest(
    new URL("/api/leads/campaigns/preview", "http://localhost:3000"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { method: "POST", body: JSON.stringify(body) } as any
  );
}

function historyChain(rows: unknown[], error: { message: string } | null = null) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.gte = vi.fn().mockReturnValue(c);
  c.lte = vi.fn().mockReturnValue(c);
  c.range = vi.fn().mockResolvedValue({ data: rows, error });
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/leads/campaigns/preview", () => {
  test("403 for agents", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "a", role: "agent", market_id: TN },
    });

    const res = await POST(
      req({ market_id: TN, filter_json: { order_statuses: ["delivered"] } })
    );
    expect(res.status).toBe(403);
  });

  test("403 when manager targets other market", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });

    const res = await POST(
      req({ market_id: LY, filter_json: { order_statuses: ["delivered"] } })
    );
    expect(res.status).toBe(403);
  });

  test("400 when filter_json missing or not an object", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });

    const res = await POST(req({ market_id: TN }));
    expect(res.status).toBe(400);
  });

  test("200 returns matched count and applies date filter to outcome history", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    const chain = historyChain([
      {
        order_id: "o1",
        status_to: "delivered",
        orders: { status: "delivered" },
      },
      {
        order_id: "o2",
        status_to: "delivered",
        orders: { status: "returned" },
      },
      {
        order_id: "o3",
        status_to: "returned",
        orders: { status: "returned" },
      },
      {
        order_id: "o3",
        status_to: "returned",
        orders: { status: "returned" },
      },
    ]);
    mockFrom.mockReturnValue(chain);

    const res = await POST(
      req({
        market_id: TN,
        filter_json: {
          order_statuses: ["delivered", "returned"],
          date_from: "2026-01-01T00:00:00Z",
          date_to: "2026-03-31T23:59:59Z",
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.matched).toBe(2);
    expect(mockFrom).toHaveBeenCalledWith("order_history");
    expect(chain.eq).toHaveBeenCalledWith("orders.market_id", TN);
    expect(chain.in).toHaveBeenCalledWith(
      "status_to",
      ["delivered", "returned"]
    );
    expect(chain.in).toHaveBeenCalledWith(
      "orders.status",
      ["delivered", "returned"]
    );
    expect(chain.gte).toHaveBeenCalledWith("created_at", "2026-01-01T00:00:00Z");
  });

  test("defaults to order_statuses=['delivered'] when not provided", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    const chain = historyChain([]);
    mockFrom.mockReturnValue(chain);

    const res = await POST(req({ market_id: TN, filter_json: {} }));
    expect(res.status).toBe(200);
    expect(chain.in).toHaveBeenCalledWith("status_to", ["delivered"]);
    expect(chain.in).toHaveBeenCalledWith("orders.status", ["delivered"]);
  });

  test("500 when outcome history lookup fails", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    const chain = historyChain([], { message: "boom" });
    mockFrom.mockReturnValue(chain);

    const res = await POST(req({ market_id: TN, filter_json: {} }));
    expect(res.status).toBe(500);
  });
});
