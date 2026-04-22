import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: vi.fn().mockResolvedValue(Buffer.from("PDF")),
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,abc") },
}));

vi.mock("@/lib/labels/OrderLabelPdf", () => ({
  OrderLabelPdf: () => null,
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function req(body: unknown = { order_ids: ["order-1"] }) {
  return new NextRequest(new URL("http://localhost/api/warehouse/label-prints"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const confirmedOrder = {
  id: "order-1",
  order_number: "ORD-001",
  customer_name: "Ali Ben Salah",
  customer_phone: "+21612345678",
  customer_city: "Tunis",
  customer_address: "Rue 1",
  product_name: "Skincare Set",
  variant_label: null,
  quantity: 1,
  market_id: "m-1",
  markets: { code: "tn" },
};

// Chain for users table: select().eq().single()
function userChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

// Chain for orders table: select().in().eq() → resolves to { data, error }
function ordersSelectChain(data: unknown[], error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockResolvedValue({ data, error });
  return c;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/warehouse/label-prints — role guard", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  test("returns 403 for agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    mockFrom.mockReturnValue(userChain({ role: "agent", market_id: "m-1" }));
    const res = await POST(req());
    expect(res.status).toBe(403);
  });
});

describe("POST /api/warehouse/label-prints — validation", () => {
  test("returns 400 when order_ids is missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(userChain({ role: "warehouse_agent", market_id: "m-1" }));
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  test("returns 400 when order_ids is empty", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(userChain({ role: "warehouse_agent", market_id: "m-1" }));
    const res = await POST(req({ order_ids: [] }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/warehouse/label-prints — atomicity", () => {
  test("inserts label_prints rows before generating PDF", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });

    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userChain({ role: "warehouse_agent", market_id: "m-1" });
      if (table === "orders") return ordersSelectChain([confirmedOrder]);
      const c: Record<string, unknown> = {};
      c.insert = insertMock;
      return c;
    });

    await POST(req({ order_ids: ["order-1"] }));
    expect(insertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ order_id: "order-1", printed_by: "wh-1" }),
      ])
    );
  });

  test("returns 422 when label_prints insert fails (no orphan PDF generated)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    const { renderToBuffer } = await import("@react-pdf/renderer");

    const failInsert = vi.fn().mockResolvedValue({ data: null, error: { message: "duplicate key" } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userChain({ role: "warehouse_agent", market_id: "m-1" });
      if (table === "orders") return ordersSelectChain([confirmedOrder]);
      const c: Record<string, unknown> = {};
      c.insert = failInsert;
      return c;
    });

    const res = await POST(req({ order_ids: ["order-1"] }));
    expect(res.status).toBe(422);
    expect(renderToBuffer).not.toHaveBeenCalled();
  });
});
