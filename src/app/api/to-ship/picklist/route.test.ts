import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockFrom = vi.fn();
const mockRenderToBuffer = vi.fn();

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));
vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: (...args: unknown[]) => mockRenderToBuffer(...args),
  Document: () => null,
  Page: () => null,
  Text: () => null,
  View: () => null,
  StyleSheet: { create: (s: unknown) => s },
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function req(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost/api/to-ship/picklist"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function ordersQuery(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockResolvedValue({ data: rows, error: null });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({
    actor: { id: "mgr-1", role: "market_manager", market_id: "m-1" },
  });
  mockRenderToBuffer.mockResolvedValue(Buffer.from("%PDF-FAKE"));
});

describe("POST /api/to-ship/picklist", () => {
  test("401 when unauthenticated", async () => {
    mockGetActor.mockResolvedValueOnce({
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(req({ order_ids: ["o-1"], grouping: "city" }));
    expect(res.status).toBe(401);
  });

  test("403 when actor is an agent", async () => {
    mockGetActor.mockResolvedValueOnce({
      actor: { id: "a", role: "agent", market_id: "m-1" },
    });
    const res = await POST(req({ order_ids: ["o-1"], grouping: "city" }));
    expect(res.status).toBe(403);
  });

  test("400 on missing order_ids", async () => {
    const res = await POST(req({ grouping: "city" }));
    expect(res.status).toBe(400);
  });

  test("400 on invalid grouping", async () => {
    const res = await POST(req({ order_ids: ["o-1"], grouping: "unknown" }));
    expect(res.status).toBe(400);
  });

  test("400 when over 200 order_ids", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `o-${i}`);
    const res = await POST(req({ order_ids: ids, grouping: "city" }));
    expect(res.status).toBe(400);
  });

  test("404 when no matching orders are found", async () => {
    mockFrom.mockReturnValue(ordersQuery([]));
    const res = await POST(req({ order_ids: ["o-1"], grouping: "city" }));
    expect(res.status).toBe(404);
  });

  test("200 with application/pdf when orders exist", async () => {
    mockFrom.mockReturnValue(
      ordersQuery([
        {
          id: "o-1",
          customer_name: "Ahmed",
          customer_city: "Tunis",
          product_name: "Tee",
          variant_label: null,
          quantity: 2,
          total_price: 50,
          status: "confirmed",
        },
      ]),
    );
    const res = await POST(req({ order_ids: ["o-1"], grouping: "city" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(mockRenderToBuffer).toHaveBeenCalledTimes(1);
  });
});
