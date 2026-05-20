import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOrderFromData } from "./create-order-from-data";
import type { InternalOrderData } from "@/lib/storefronts/types";

// Mock the resolvers and auto-assign so the unit test stays DB-free
vi.mock("@/lib/storefronts/product-resolver", () => ({
  resolveProduct: vi.fn().mockResolvedValue({
    product_id: "prod-uuid",
    product_variant_id: null,
    match_method: "name",
  }),
}));

vi.mock("@/lib/storefronts/city-resolver", () => ({
  resolveCity: vi.fn().mockResolvedValue({
    city_id: "city-uuid",
    dexpress_state_id: null,
    match_method: "name",
  }),
}));

vi.mock("./auto-assignment-orchestrator", () => ({
  tryAutoAssign: vi.fn().mockResolvedValue(undefined),
}));

import { resolveProduct } from "@/lib/storefronts/product-resolver";
import { resolveCity } from "@/lib/storefronts/city-resolver";
import { tryAutoAssign } from "./auto-assignment-orchestrator";

const ORDER_DATA: InternalOrderData = {
  external_id: "6a0c4e064992e02ef080ea3b",
  external_platform: "converty",
  customer_name: "شادي",
  customer_phone: "914009883",
  customer_city: "طرابلس",
  customer_address: "عين زاره خمس شورع",
  customer_note: null,
  dexpress_state_id: null,
  product_name: "مصحف القرآن",
  sku: null,
  variant_label: null,
  quantity: 1,
  unit_price: 199,
  total_price: 199,
  external_product_id: null,
  external_variant_id: null,
  external_city_id: null,
  external_route_id: null,
  currency: null,
};

const STOREFRONT = { id: "sf-uuid", market_id: "market-uuid" };

function makeAdminClient(overrides: Record<string, unknown> = {}) {
  const insertedOrders: unknown[] = [];
  const insertedHistory: unknown[] = [];

  const orderInsertChain = {
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: "order-uuid" }, error: null }),
  };
  const historyInsertChain = {
    insert: vi.fn().mockResolvedValue({ error: null }),
  };

  return {
    _insertedOrders: insertedOrders,
    _insertedHistory: insertedHistory,
    from: vi.fn((table: string) => {
      if (table === "orders") {
        return {
          insert: vi.fn((row: unknown) => {
            insertedOrders.push(row);
            return orderInsertChain;
          }),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: "order-uuid" },
            error: null,
          }),
        };
      }
      if (table === "order_history") {
        const histInsert = vi.fn((row: unknown) => {
          insertedHistory.push(row);
          return Promise.resolve({ error: null });
        });
        return { insert: histInsert };
      }
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    }),
    ...overrides,
  };
}

describe("createOrderFromData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns status 'created' with orderId on successful insert", async () => {
    const adminClient = makeAdminClient();
    const result = await createOrderFromData({
      adminClient: adminClient as never,
      storefront: STOREFRONT,
      orderData: ORDER_DATA,
      rawPayload: { sheet_row: 2 },
      sourceNote: "Order received via Google Sheets sync",
    });

    expect(result.status).toBe("created");
    expect(result.orderId).toBe("order-uuid");
    expect(result.error).toBeUndefined();
  });

  it("calls resolveProduct with correct params", async () => {
    const adminClient = makeAdminClient();
    await createOrderFromData({
      adminClient: adminClient as never,
      storefront: STOREFRONT,
      orderData: ORDER_DATA,
      rawPayload: {},
      sourceNote: "test",
    });

    expect(resolveProduct).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        storefront_id: STOREFRONT.id,
        market_id: STOREFRONT.market_id,
        product_name: ORDER_DATA.product_name,
      })
    );
  });

  it("calls resolveCity with correct params", async () => {
    const adminClient = makeAdminClient();
    await createOrderFromData({
      adminClient: adminClient as never,
      storefront: STOREFRONT,
      orderData: ORDER_DATA,
      rawPayload: {},
      sourceNote: "test",
    });

    expect(resolveCity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        market_id: STOREFRONT.market_id,
        customer_city: ORDER_DATA.customer_city,
      })
    );
  });

  it("appends order_history row with actor_type 'system' and the sourceNote", async () => {
    const adminClient = makeAdminClient();
    await createOrderFromData({
      adminClient: adminClient as never,
      storefront: STOREFRONT,
      orderData: ORDER_DATA,
      rawPayload: {},
      sourceNote: "Order received via Google Sheets sync",
    });

    const historyRow = (adminClient._insertedHistory as Array<Record<string, unknown>>)[0];
    expect(historyRow).toMatchObject({
      order_id: "order-uuid",
      status_from: null,
      status_to: "pending",
      actor_type: "system",
      note: "Order received via Google Sheets sync",
    });
  });

  it("calls tryAutoAssign after successful insert", async () => {
    const adminClient = makeAdminClient();
    await createOrderFromData({
      adminClient: adminClient as never,
      storefront: STOREFRONT,
      orderData: ORDER_DATA,
      rawPayload: {},
      sourceNote: "test",
    });

    expect(tryAutoAssign).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "order-uuid",
        market_id: STOREFRONT.market_id,
      })
    );
  });

  it("returns status 'duplicate' on Postgres unique constraint violation (code 23505)", async () => {
    const dupClient = {
      from: vi.fn((table: string) => {
        if (table === "orders") {
          return {
            insert: vi.fn(() => ({
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: "23505", message: "duplicate key" },
              }),
            })),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "existing-uuid" },
              error: null,
            }),
          };
        }
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }),
    };

    const result = await createOrderFromData({
      adminClient: dupClient as never,
      storefront: STOREFRONT,
      orderData: ORDER_DATA,
      rawPayload: {},
      sourceNote: "test",
    });

    expect(result.status).toBe("duplicate");
    expect(result.orderId).toBe("existing-uuid");
  });

  it("returns status 'error' on unexpected insert error", async () => {
    const errClient = {
      from: vi.fn((table: string) => {
        if (table === "orders") {
          return {
            insert: vi.fn(() => ({
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: "42501", message: "permission denied" },
              }),
            })),
          };
        }
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }),
    };

    const result = await createOrderFromData({
      adminClient: errClient as never,
      storefront: STOREFRONT,
      orderData: ORDER_DATA,
      rawPayload: {},
      sourceNote: "test",
    });

    expect(result.status).toBe("error");
    expect(result.error).toBeDefined();
  });

  it("does not call tryAutoAssign on duplicate", async () => {
    const dupClient = {
      from: vi.fn((table: string) => {
        if (table === "orders") {
          return {
            insert: vi.fn(() => ({
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: "23505" },
              }),
            })),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: "x" }, error: null }),
          };
        }
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }),
    };

    await createOrderFromData({
      adminClient: dupClient as never,
      storefront: STOREFRONT,
      orderData: ORDER_DATA,
      rawPayload: {},
      sourceNote: "test",
    });

    expect(tryAutoAssign).not.toHaveBeenCalled();
  });
});
