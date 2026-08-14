import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { PATCH, DELETE } from "./route";
import { NextRequest } from "next/server";

const ENTRY = {
  id: "e1",
  market_id: "m-1",
  period_start: "2026-07-01",
  period_end: "2026-07-10",
};

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost:3000/api/ad-spend/e1"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function userChain(role: string, marketId: string | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id: marketId }, error: null });
  return chain;
}

// ad_spend chain: first .single() resolves the entry fetch; update path also
// terminates with .single(). The update payload is captured so tests can assert
// on what actually reaches the column list, not merely on the HTTP status.
const updateMock = vi.fn();
function adSpendChain(entry: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  for (const m of ["select", "eq"]) {
    chain[m] = vi.fn().mockImplementation(passthrough);
  }
  chain.update = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
    updateMock(payload);
    return chain;
  });
  chain.single = vi.fn().mockResolvedValue({ data: entry, error: null });
  return chain;
}

/**
 * The products lookup behind the market-isolation check. The FK only proves a
 * product exists; nothing in RLS ties it to the entry's market, so PATCH reads
 * the row and compares markets itself.
 */
function productChain(marketId: string | null) {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  for (const m of ["select", "eq"]) {
    chain[m] = vi.fn().mockImplementation(passthrough);
  }
  chain.maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: marketId ? { market_id: marketId } : null, error: null });
  return chain;
}

function lastUpdatePayload(): Record<string, unknown> {
  return updateMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
});

describe("PATCH /api/ad-spend/[id]", () => {
  test("rejects a single-sided update that would invert the stored period", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("super_admin", null)
        : table === "products"
          ? productChain("m-1")
          : adSpendChain(ENTRY),
    );
    // period_end before the STORED period_start — previously accepted
    const res = await PATCH(patchRequest({ period_end: "2026-06-15" }), {
      params: Promise.resolve({ id: "e1" }),
    });
    expect(res.status).toBe(400);
  });

  test("accepts a single-sided period_end after the stored period_start", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("super_admin", null)
        : table === "products"
          ? productChain("m-1")
          : adSpendChain(ENTRY),
    );
    const res = await PATCH(patchRequest({ period_end: "2026-07-20" }), {
      params: Promise.resolve({ id: "e1" }),
    });
    expect(res.status).toBe(200);
  });

  test("403 for market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("market_manager", "m-1")
        : table === "products"
          ? productChain("m-1")
          : adSpendChain(ENTRY),
    );
    const res = await PATCH(patchRequest({ amount: 10 }), {
      params: Promise.resolve({ id: "e1" }),
    });
    expect(res.status).toBe(403);
  });

  // The entry modal has always offered a product select and always sent
  // product_id in the PATCH body; the route used to ignore it, so a
  // re-assignment reported success and changed nothing.
  test("persists a re-assignment to a different product", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("super_admin", null)
        : table === "products"
          ? productChain("m-1")
          : adSpendChain(ENTRY),
    );
    const res = await PATCH(patchRequest({ product_id: "prod-2" }), {
      params: Promise.resolve({ id: "e1" }),
    });
    expect(res.status).toBe(200);
    expect(lastUpdatePayload()).toEqual({ product_id: "prod-2" });
  });

  test("refuses a product from another market", async () => {
    // RLS gates the ENTRY by market and the FK only proves the product exists —
    // neither stops a Tunisia manager loading their spend onto a Libyan
    // product, where it is then read by product profitability and by investor
    // settlement. The route has to check the market itself.
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("super_admin", null)
        : table === "products"
          ? productChain("m-2")
          : adSpendChain(ENTRY),
    );
    const res = await PATCH(patchRequest({ product_id: "ly-product" }), {
      params: Promise.resolve({ id: "e1" }),
    });
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("refuses a product_id that does not exist", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("super_admin", null)
        : table === "products"
          ? productChain(null)
          : adSpendChain(ENTRY),
    );
    const res = await PATCH(patchRequest({ product_id: "ghost" }), {
      params: Promise.resolve({ id: "e1" }),
    });
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("persists an explicit null product_id as a move back to market-level", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("super_admin", null)
        : table === "products"
          ? productChain("m-1")
          : adSpendChain(ENTRY),
    );
    const res = await PATCH(patchRequest({ product_id: null }), {
      params: Promise.resolve({ id: "e1" }),
    });
    expect(res.status).toBe(200);
    const payload = lastUpdatePayload();
    expect(payload).toHaveProperty("product_id");
    expect(payload.product_id).toBeNull();
  });

  test("leaves product_id untouched when the key is absent from the body", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("super_admin", null)
        : table === "products"
          ? productChain("m-1")
          : adSpendChain(ENTRY),
    );
    const res = await PATCH(patchRequest({ amount: 42 }), {
      params: Promise.resolve({ id: "e1" }),
    });
    expect(res.status).toBe(200);
    expect(lastUpdatePayload()).not.toHaveProperty("product_id");
  });

  test("a product_id-only body is not treated as an empty update", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("super_admin", null)
        : table === "products"
          ? productChain("m-1")
          : adSpendChain(ENTRY),
    );
    const res = await PATCH(patchRequest({ product_id: null }), {
      params: Promise.resolve({ id: "e1" }),
    });
    expect(res.status).not.toBe(400);
  });
});

describe("DELETE /api/ad-spend/[id]", () => {
  test("soft-deletes an open-period entry", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("super_admin", null)
        : table === "products"
          ? productChain("m-1")
          : adSpendChain(ENTRY),
    );
    const res = await DELETE(
      new NextRequest(new URL("http://localhost:3000/api/ad-spend/e1"), { method: "DELETE" }),
      { params: Promise.resolve({ id: "e1" }) },
    );
    expect(res.status).toBe(200);
  });

  test("403 when a locked-period entry is deleted by non-super_admin path (manager blocked earlier)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("market_manager", "m-1")
        : table === "products"
          ? productChain("m-1")
          : adSpendChain(ENTRY),
    );
    const res = await DELETE(
      new NextRequest(new URL("http://localhost:3000/api/ad-spend/e1"), { method: "DELETE" }),
      { params: Promise.resolve({ id: "e1" }) },
    );
    expect(res.status).toBe(403);
  });
});
