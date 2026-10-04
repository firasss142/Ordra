import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ from: (...a: unknown[]) => mockFrom(...a) }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { POST } from "./route";
import { NextRequest } from "next/server";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const MANAGER = { id: "mgr-1", role: "market_manager", market_id: "m-1" };

const req = (body: unknown) =>
  new NextRequest(new URL("http://localhost:3000/api/orders/duplicates/dismiss"), {
    method: "POST",
    body: JSON.stringify(body),
  });

let upsert: ReturnType<typeof vi.fn>;
function db(orders: { id: string; market_id: string }[]) {
  upsert = vi.fn().mockResolvedValue({ error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === "orders") return { select: () => ({ in: () => Promise.resolve({ data: orders, error: null }) }) };
    return { upsert };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({ actor: MANAGER });
});

describe("POST /api/orders/duplicates/dismiss", () => {
  test("records every order of the group, once each", async () => {
    db([{ id: A, market_id: "m-1" }, { id: B, market_id: "m-1" }]);
    const res = await POST(req({ order_ids: [A, B] }));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      [
        { order_id: A, market_id: "m-1", dismissed_by: "mgr-1" },
        { order_id: B, market_id: "m-1", dismissed_by: "mgr-1" },
      ],
      { onConflict: "order_id", ignoreDuplicates: true },
    );
  });

  test("a group is at least two orders", async () => {
    db([]);
    expect((await POST(req({ order_ids: [A] }))).status).toBe(400);
  });

  test("agents cannot dismiss (the screen is read-only for them)", async () => {
    mockGetActor.mockResolvedValue({ actor: { ...MANAGER, role: "agent" } });
    db([]);
    expect((await POST(req({ order_ids: [A, B] }))).status).toBe(403);
  });

  test("a manager cannot dismiss another market's orders", async () => {
    db([{ id: A, market_id: "m-1" }, { id: B, market_id: "m-2" }]);
    expect((await POST(req({ order_ids: [A, B] }))).status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  test("an unknown order is a 404", async () => {
    db([{ id: A, market_id: "m-1" }]);
    expect((await POST(req({ order_ids: [A, B] }))).status).toBe(404);
  });
});
