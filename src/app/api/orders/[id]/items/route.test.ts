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

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost:3000/api/orders/order-1/items"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// A thenable chain. Each terminal method (.single, .order, .limit) resolves to
// `resolveWith`, AND the chain itself is awaitable so callers that stop at
// `.eq(...)` (e.g. SELECT with no .limit) get the same payload.
function queryChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  chain.order = vi.fn().mockResolvedValue(resolveWith);
  chain.limit = vi.fn().mockResolvedValue(resolveWith);
  chain.then = (onFulfilled: (v: typeof resolveWith) => unknown) =>
    Promise.resolve(resolveWith).then(onFulfilled);
  return chain;
}

const agentUser = { id: "agent-1", role: "agent", market_id: "m-1" };
const assignedOrder = {
  id: "order-1", status: "assigned", assigned_to: "agent-1", market_id: "m-1",
  delivery_fee: 0, unit_price: 100, quantity: 1,
};
const activeProduct = {
  id: "prod-2", market_id: "m-1", name: "Widget B",
  default_price: 50, current_stock: 10, is_active: true,
};

beforeEach(() => vi.clearAllMocks());

describe("POST /api/orders/[id]/items", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeRequest({ product_id: "prod-2", quantity: 1, unit_price: 50 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 404 when order not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      return queryChain({ data: null, error: { message: "not found" } });
    });
    const res = await POST(makeRequest({ product_id: "prod-2", quantity: 1, unit_price: 50 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 409 when product belongs to a different market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    const wrongMarketProduct = { ...activeProduct, market_id: "m-2" };
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      if (table === "orders") return queryChain({ data: assignedOrder, error: null });
      if (table === "products") return queryChain({ data: wrongMarketProduct, error: null });
      return queryChain({ data: null, error: null });
    });
    const res = await POST(makeRequest({ product_id: "prod-2", quantity: 1, unit_price: 50 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(409);
  });

  test("returns 409 when product is out of stock", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    const outOfStock = { ...activeProduct, current_stock: 0 };
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      if (table === "orders") return queryChain({ data: assignedOrder, error: null });
      if (table === "products") return queryChain({ data: outOfStock, error: null });
      return queryChain({ data: null, error: null });
    });
    const res = await POST(makeRequest({ product_id: "prod-2", quantity: 1, unit_price: 50 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(409);
  });

  test("returns 201 and new item on success, total_price updated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    const newItem = {
      id: "item-new", order_id: "order-1", product_id: "prod-2", product_name: "Widget B",
      variant_id: null, variant_label: null, quantity: 2, unit_price: 50, line_total: 100,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const orderWithItems = { ...assignedOrder, total_price: 200, delivery_fee: 5 };

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      if (table === "orders") return queryChain({ data: orderWithItems, error: null });
      if (table === "products") return queryChain({ data: activeProduct, error: null });
      if (table === "order_items") return itemsChain({ existing: [{ line_total: 100, quantity: 1 }], inserted: [newItem] });
      return queryChain({ data: null, error: null });
    });

    const res = await POST(makeRequest({ product_id: "prod-2", quantity: 2, unit_price: 50 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toEqual(newItem);
  });

  test("orders SELECT only references columns that exist on the orders table", async () => {
    // Regression: requesting orders.variant_id (which only lives on order_items)
    // makes Supabase fail the row fetch, and the route then returns a
    // misleading 404 "Order not found".
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    let capturedColumns: string | null = null;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      if (table === "orders") {
        const chain = queryChain({ data: assignedOrder, error: null });
        chain.select = vi.fn().mockImplementation((cols: string) => {
          capturedColumns = cols;
          return chain;
        });
        return chain;
      }
      if (table === "products") return queryChain({ data: activeProduct, error: null });
      if (table === "order_items")
        return itemsChain({ existing: [{ line_total: 50, quantity: 1 }], inserted: [{ id: "x" }] });
      return queryChain({ data: null, error: null });
    });

    await POST(makeRequest({ product_id: "prod-2", quantity: 1, unit_price: 50 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(capturedColumns).not.toBeNull();
    const cols = (capturedColumns as unknown as string).split(",").map((c) => c.trim());
    // orders.variant_id does not exist — the order table only has variant_label
    // as a snapshot; variant_id is an order_items column.
    expect(cols).not.toContain("variant_id");
  });

  test("backfills the legacy item before inserting the new one when order_items is empty", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    const legacyOrder = {
      ...assignedOrder,
      product_id: "prod-legacy",
      product_name: "Legacy Widget",
      variant_label: null,
      quantity: 1,
      unit_price: 100,
      total_price: 100,
      delivery_fee: 0,
    };
    const newItem = {
      id: "item-new", order_id: "order-1", product_id: "prod-2", product_name: "Widget B",
      variant_id: null, variant_label: null, quantity: 1, unit_price: 50, line_total: 50,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const items = itemsChain({ existing: [], inserted: [{ id: "item-legacy" }, newItem] });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      if (table === "orders") return queryChain({ data: legacyOrder, error: null });
      if (table === "products") return queryChain({ data: activeProduct, error: null });
      if (table === "order_items") return items;
      return queryChain({ data: null, error: null });
    });

    const res = await POST(makeRequest({ product_id: "prod-2", quantity: 1, unit_price: 50 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(201);
    // One batched insert containing two rows: legacy backfill first, then the
    // new item the user picked.
    expect(items.insertedBatches.length).toBe(1);
    const batch = items.insertedBatches[0];
    expect(batch.length).toBe(2);
    const [migration, addition] = batch;
    expect(migration.product_id).toBe("prod-legacy");
    expect(migration.product_name).toBe("Legacy Widget");
    expect(migration.quantity).toBe(1);
    expect(migration.unit_price).toBe(100);
    expect(addition.product_id).toBe("prod-2");
    // Response returns the new item (last in batch), not the legacy backfill.
    const body = await res.json();
    expect(body.data).toEqual(newItem);
  });

  test("does NOT backfill when order_items already has rows", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    const orderWithExisting = { ...assignedOrder, product_id: "prod-legacy", product_name: "Legacy", quantity: 1, unit_price: 100 };
    const newItem = {
      id: "item-new", order_id: "order-1", product_id: "prod-2", product_name: "Widget B",
      variant_id: null, variant_label: null, quantity: 1, unit_price: 50, line_total: 50,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const items = itemsChain({ existing: [{ line_total: 100, quantity: 1 }], inserted: [newItem] });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: agentUser, error: null });
      if (table === "orders") return queryChain({ data: orderWithExisting, error: null });
      if (table === "products") return queryChain({ data: activeProduct, error: null });
      if (table === "order_items") return items;
      return queryChain({ data: null, error: null });
    });

    const res = await POST(makeRequest({ product_id: "prod-2", quantity: 1, unit_price: 50 }), {
      params: Promise.resolve({ id: "order-1" }),
    });
    expect(res.status).toBe(201);
    expect(items.insertedBatches.length).toBe(1);
    const batch = items.insertedBatches[0];
    expect(batch.length).toBe(1);
    expect(batch[0].product_id).toBe("prod-2");
  });
});

/**
 * Mock for the order_items table that handles both the up-front existence/sum
 * SELECT (resolves with `existing`) and the batched INSERT (resolves with
 * `inserted`, and records the rows passed in `insertedBatches`).
 */
function itemsChain(opts: {
  existing: Array<{ line_total: number; quantity: number }>;
  inserted: Array<Record<string, unknown>>;
}) {
  const insertedBatches: Array<Array<Record<string, unknown>>> = [];
  const handle: Record<string, unknown> & {
    insertedBatches: typeof insertedBatches;
  } = { insertedBatches };

  handle.select = vi.fn().mockImplementation(() => {
    // After insert(): returns the inserted rows array.
    // Standalone select(): returns the existing rows on .eq() resolution.
    return {
      eq: vi.fn().mockResolvedValue({ data: opts.existing, error: null }),
      then: (
        onFulfilled: (v: { data: unknown; error: null }) => unknown,
      ) =>
        Promise.resolve({ data: opts.inserted, error: null }).then(onFulfilled),
    };
  });
  handle.eq = vi.fn().mockReturnValue(handle);
  handle.insert = vi
    .fn()
    .mockImplementation((rows: Record<string, unknown> | Record<string, unknown>[]) => {
      const batch = Array.isArray(rows) ? rows : [rows];
      insertedBatches.push(batch);
      return {
        select: vi.fn().mockResolvedValue({ data: opts.inserted, error: null }),
      };
    });
  handle.update = vi.fn().mockReturnValue(handle);
  return handle;
}
