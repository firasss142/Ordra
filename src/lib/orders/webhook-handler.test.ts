import { describe, test, expect, vi } from "vitest";
import { createHmac } from "crypto";
import { handleWebhook } from "./webhook-handler";
import { LY_MARKET_ID } from "@/lib/markets";

vi.mock("./auto-assignment-orchestrator", () => ({
  tryAutoAssign: vi.fn().mockResolvedValue(undefined),
}));

const STOREFRONT_ID = "sf-123";
const MARKET_ID = "market-tn";
const SECRET = "test-secret";

// EasyOrders posts the bare order object (no envelope) and authenticates with
// a plain shared-secret `secret` header — see easy-orders-adapter.ts.
function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "EO-99",
    full_name: "Ahmed",
    phone: "+21699999999",
    address: "Tunis",
    government: "Tunis",
    note: "Ring twice",
    cost: 60,
    total_cost: 60,
    cart_items: [
      {
        product_id: "prod-1",
        variant_id: "var-1",
        price: 30,
        quantity: 2,
        product: { id: "prod-1", name: "Shampoo", sku: "SH-001" },
      },
    ],
    ...overrides,
  };
}

// Self-returning select chain for webhook_delivery_log dedupe lookups.
// Accepts any number of .eq() filters and resolves .maybeSingle() to the given row.
function makeWdlSelectChain(row: unknown): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  return chain;
}

// Creates a chainable mock that supports any Supabase query method
function createQueryChain(resolveWith: { data: unknown; error: unknown }): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.ilike = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolveWith);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  return chain;
}

function mockAdminClient(overrides: {
  storefrontData?: unknown;
  storefrontError?: unknown;
  productData?: unknown;
  insertData?: unknown;
  insertError?: unknown;
  historyInsertData?: unknown;
  logInsertError?: unknown;
  existingDeliveryLog?: unknown; // for idempotency check
}) {
  const {
    storefrontData = {
      id: STOREFRONT_ID,
      market_id: MARKET_ID,
      platform: "easy_orders",
      config: {},
      webhook_secret: SECRET,
      is_active: true,
    },
    storefrontError = null,
    productData = null,
    insertData = { id: "order-uuid-1" },
    insertError = null,
    historyInsertData = { id: "hist-1" },
    logInsertError = null,
    existingDeliveryLog = null,
  } = overrides;

  // webhook_delivery_log SELECT chain: returns self on .eq() so we accept any
  // number of equality predicates (legacy 2-eq path and new 3-eq delivery_id path).
  const wdlMaybeSingle = vi.fn().mockResolvedValue({ data: existingDeliveryLog, error: null });
  const wdlSelectChain: Record<string, unknown> = {};
  wdlSelectChain.eq = vi.fn().mockReturnValue(wdlSelectChain);
  wdlSelectChain.maybeSingle = wdlMaybeSingle;

  const wdlInsertChain = createQueryChain({ data: { id: "log-uuid-1" }, error: logInsertError });
  const webhookDeliveryLogChain = {
    select: vi.fn().mockReturnValue(wdlSelectChain),
    insert: vi.fn().mockReturnValue(wdlInsertChain),
  };

  const tableChains: Record<string, ReturnType<typeof createQueryChain> | typeof webhookDeliveryLogChain> = {
    storefronts: createQueryChain({ data: storefrontData, error: storefrontError }),
    products: createQueryChain({ data: productData, error: null }),
    orders: createQueryChain({ data: insertData, error: insertError }),
    order_history: createQueryChain({ data: historyInsertData, error: null }),
    webhook_delivery_log: webhookDeliveryLogChain as unknown as ReturnType<typeof createQueryChain>,
  };

  return {
    from: vi.fn().mockImplementation((table: string) =>
      tableChains[table] ?? createQueryChain({ data: null, error: null })
    ),
    rpc: vi.fn().mockResolvedValue({ data: { order_id: "order-uuid-1", status: "deleted", updated_at: "2026-04-11", history_id: "hist-1" }, error: null }),
  };
}

describe("handleWebhook", () => {
  test("returns 404 when storefront not found", async () => {
    const admin = mockAdminClient({ storefrontData: null });
    const body = JSON.stringify(makePayload());

    const result = await handleWebhook({
      storefrontId: "nonexistent",
      rawBody: body,
      headers: new Headers(),
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.error).toBe("Storefront not found or inactive");
  });

  test("returns 200 when storefront is inactive", async () => {
    const admin = mockAdminClient({
      storefrontData: {
        id: STOREFRONT_ID, market_id: MARKET_ID, platform: "easy_orders",
        config: {}, webhook_secret: SECRET, is_active: false,
      },
    });
    const body = JSON.stringify(makePayload());

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers: new Headers(),
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
  });

  test("returns 200 with error when signature is invalid", async () => {
    const admin = mockAdminClient({});
    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: "bad-secret" });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.error).toBe("Invalid webhook signature");
  });

  test("returns 200 with order_id for valid order.created", async () => {
    const admin = mockAdminClient({});
    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.order_id).toBeDefined();
  });

  test("inserts order with correct fields from payload", async () => {
    const admin = mockAdminClient({});
    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    const ordersFrom = admin.from.mock.calls.find(
      (c: unknown[]) => c[0] === "orders"
    );
    expect(ordersFrom).toBeDefined();
  });

  test("buybox order.created persists dexpress_state_id from customer.city_id", async () => {
    const buyboxStorefront = {
      id: STOREFRONT_ID,
      market_id: MARKET_ID,
      platform: "buybox",
      config: {},
      webhook_secret: SECRET,
      is_active: true,
      auth_mode: "uuid_only",
    };
    const admin = mockAdminClient({ storefrontData: buyboxStorefront });

    const insertFn = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "order-uuid-1" }, error: null }),
      }),
    });
    const ordersChain = createQueryChain({ data: { id: "order-uuid-1" }, error: null });
    ordersChain.insert = insertFn;
    // Keep the buybox storefront and the order-insert spy; delegate every other
    // table (products, webhook_delivery_log, order_history) to a fresh default mock.
    const storefrontsChain = createQueryChain({ data: buyboxStorefront, error: null });
    admin.from.mockImplementation((table: string) => {
      if (table === "orders") return ordersChain;
      if (table === "storefronts") return storefrontsChain;
      return mockAdminClient({}).from(table);
    });

    const body = JSON.stringify({
      source: "quraan-buybox",
      idempotency_key: "qb-dexpress-1",
      order_id: "qb-dexpress-1",
      customer: {
        name: "firas",
        phone: "0913456789",
        city: "سرت",
        city_id: 80,
        city_name: "سرت",
        route_id: 10,
        address: "شارع جمال عبد الناصر",
      },
      product: {
        id: "8123456789",
        title: "Quran",
        variant_id: 47259433337054,
        quantity: 2,
        unit_price: 35000,
        total_price: 70000,
      },
      upsells: [],
    });

    // uuid_only storefronts skip signature verification — no header needed.
    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers: new Headers(),
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(insertFn).toHaveBeenCalled();
    const insertPayload = insertFn.mock.calls[0][0];
    expect(insertPayload).toMatchObject({
      external_id: "qb-dexpress-1",
      external_platform: "buybox",
      customer_city: "سرت",
      dexpress_state_id: 80,
    });
  });

  test("returns 200 idempotently when duplicate external_id", async () => {
    const admin = mockAdminClient({
      insertError: { code: "23505", message: "duplicate key" },
    });

    // Override orders chain: insert fails with duplicate, but select finds existing
    const ordersChain = createQueryChain({ data: { id: "existing-order-id" }, error: null });
    // Override insert to fail with unique constraint
    ordersChain.insert = vi.fn().mockReturnValue(
      createQueryChain({ data: null, error: { code: "23505", message: "duplicate key" } })
    );
    admin.from.mockImplementation((table: string) => {
      if (table === "orders") return ordersChain;
      return mockAdminClient({}).from(table);
    });

    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
  });

  test("returns 200 with error for malformed JSON", async () => {
    const admin = mockAdminClient({});
    const body = "not-json{";
    const headers = new Headers({ secret: SECRET });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.error).toBeDefined();
  });

  test("order.updated only updates customer fields, not product or financial fields", async () => {
    // Setup: existing order found with pre-dispatch status. EasyOrders has no
    // customer-bearing update event, so order.updated is exercised via Shopify.
    const admin = mockAdminClient({ storefrontData: SHOPIFY_STOREFRONT });
    const existingOrder = { id: "existing-order-1", status: "assigned" };

    // Override orders chain to:
    // 1. First call (select existing) returns the order
    // 2. Second call (update) we can inspect what was sent
    const updateFn = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const ordersChain = createQueryChain({ data: existingOrder, error: null });
    ordersChain.update = updateFn;

    admin.from.mockImplementation((table: string) => {
      if (table === "orders") return ordersChain;
      return mockAdminClient({ storefrontData: SHOPIFY_STOREFRONT }).from(table);
    });

    const body = JSON.stringify(shopifyPayload());
    const headers = shopifyHeaders(body, { topic: "orders/updated" });

    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    // Verify update was called
    expect(updateFn).toHaveBeenCalled();
    const updatePayload = updateFn.mock.calls[0][0];

    // Should include customer fields
    expect(updatePayload).toHaveProperty("customer_name");
    expect(updatePayload).toHaveProperty("customer_phone");
    expect(updatePayload).toHaveProperty("customer_address");
    expect(updatePayload).toHaveProperty("customer_city");
    expect(updatePayload).toHaveProperty("customer_note");

    // Should NOT include product or financial fields
    expect(updatePayload).not.toHaveProperty("product_name");
    expect(updatePayload).not.toHaveProperty("variant_label");
    expect(updatePayload).not.toHaveProperty("quantity");
    expect(updatePayload).not.toHaveProperty("unit_price");
    expect(updatePayload).not.toHaveProperty("total_price");
    expect(updatePayload).not.toHaveProperty("raw_payload");
  });

  test("returns 200 for all error conditions — never non-200", async () => {
    // 404 case: storefront not found — should still return 200
    const admin = mockAdminClient({ storefrontData: null });
    const body = JSON.stringify(makePayload());

    const result = await handleWebhook({
      storefrontId: "nonexistent",
      rawBody: body,
      headers: new Headers(),
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
  });

  test("returns 200 for invalid signature — never 401", async () => {
    const admin = mockAdminClient({});
    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: "bad-secret" });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.error).toBeDefined();
  });

  test("returns 200 for malformed JSON — never 400", async () => {
    const admin = mockAdminClient({});
    const body = "not-json{";
    const headers = new Headers({ secret: SECRET });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.error).toBeDefined();
  });

  test("triggers auto-assignment after successful order creation", async () => {
    const { tryAutoAssign } = await import("./auto-assignment-orchestrator");
    vi.mocked(tryAutoAssign).mockClear();

    const admin = mockAdminClient({});
    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(tryAutoAssign).toHaveBeenCalledTimes(1);
    expect(tryAutoAssign).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "order-uuid-1",
        market_id: MARKET_ID,
      })
    );
  });

  test("still returns success when auto-assignment fails", async () => {
    const { tryAutoAssign } = await import("./auto-assignment-orchestrator");
    vi.mocked(tryAutoAssign).mockRejectedValueOnce(new Error("Assignment failed"));

    const admin = mockAdminClient({});
    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
  });

  test("does not trigger auto-assignment for duplicate orders", async () => {
    const { tryAutoAssign } = await import("./auto-assignment-orchestrator");
    vi.mocked(tryAutoAssign).mockClear();

    const admin = mockAdminClient({});
    const ordersChain = createQueryChain({ data: { id: "existing-order-id" }, error: null });
    ordersChain.insert = vi.fn().mockReturnValue(
      createQueryChain({ data: null, error: { code: "23505", message: "duplicate key" } })
    );
    admin.from.mockImplementation((table: string) => {
      if (table === "orders") return ordersChain;
      return mockAdminClient({}).from(table);
    });

    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(tryAutoAssign).not.toHaveBeenCalled();
  });

  test("decrypts webhook_secret before validation", async () => {
    const encryptedSecret = "encrypted:" + SECRET;
    const admin = mockAdminClient({
      storefrontData: {
        id: STOREFRONT_ID, market_id: MARKET_ID, platform: "easy_orders",
        config: {}, webhook_secret: encryptedSecret, is_active: true,
      },
    });
    const decryptFn = vi.fn().mockImplementation((s: string) => s.replace("encrypted:", ""));

    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn,
    });

    expect(decryptFn).toHaveBeenCalledWith(encryptedSecret);
    expect(result.status).toBe(200);
  });

  // --- Webhook delivery logging tests ---

  test("logs 'processed' after successful order.created", async () => {
    const admin = mockAdminClient({});
    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    const logCall = admin.from.mock.calls.find((c: unknown[]) => c[0] === "webhook_delivery_log");
    expect(logCall).toBeDefined();
    const logChain = admin.from.mock.results[
      admin.from.mock.calls.findIndex((c: unknown[]) => c[0] === "webhook_delivery_log")
    ].value;
    expect(logChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "easy_orders",
        event: "order.created",
        status: "processed",
        order_id: "order-uuid-1",
      })
    );
  });

  test("logs 'ignored' for duplicate order.created", async () => {
    const admin = mockAdminClient({});
    const ordersChain = createQueryChain({ data: { id: "existing-order-id" }, error: null });
    ordersChain.insert = vi.fn().mockReturnValue(
      createQueryChain({ data: null, error: { code: "23505", message: "duplicate key" } })
    );
    admin.from.mockImplementation((table: string) => {
      if (table === "orders") return ordersChain;
      // Use the original mock's chains for other tables (preserves webhook_delivery_log mock)
      return mockAdminClient({}).from(table);
    });

    // Capture the webhook_delivery_log chain from admin directly
    const wdlChain = {
      select: vi.fn().mockReturnValue(makeWdlSelectChain(null)),
      insert: vi.fn().mockReturnValue(createQueryChain({ data: { id: "log-1" }, error: null })),
    };
    admin.from.mockImplementation((table: string) => {
      if (table === "orders") return ordersChain;
      if (table === "webhook_delivery_log") return wdlChain;
      return mockAdminClient({}).from(table);
    });

    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(wdlChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ignored", event: "order.created" })
    );
  });

  test("logs 'ignored' for order.updated with post-dispatch status", async () => {
    // Exercised via Shopify: EasyOrders has no customer-bearing update event.
    const admin = mockAdminClient({ storefrontData: SHOPIFY_STOREFRONT });
    const existingOrder = { id: "existing-order-1", status: "delivered" };
    const ordersChain = createQueryChain({ data: existingOrder, error: null });

    const wdlChain = {
      select: vi.fn().mockReturnValue(makeWdlSelectChain(null)),
      insert: vi.fn().mockReturnValue(createQueryChain({ data: { id: "log-1" }, error: null })),
    };
    admin.from.mockImplementation((table: string) => {
      if (table === "orders") return ordersChain;
      if (table === "webhook_delivery_log") return wdlChain;
      return mockAdminClient({ storefrontData: SHOPIFY_STOREFRONT }).from(table);
    });

    const body = JSON.stringify(shopifyPayload());
    const headers = shopifyHeaders(body, { topic: "orders/updated" });

    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(wdlChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ignored", event: "order.updated" })
    );
  });

  test("logs 'error' and still returns 200 when sub-handler throws", async () => {
    const admin = mockAdminClient({});
    // Make orders.insert().select().single() throw an unhandled error
    const selectChain = createQueryChain({ data: null, error: null });
    selectChain.single = vi.fn().mockRejectedValue(new Error("DB connection lost"));
    const insertChain = createQueryChain({ data: null, error: null });
    insertChain.select = vi.fn().mockReturnValue(selectChain);
    const throwingChain = createQueryChain({ data: null, error: null });
    throwingChain.insert = vi.fn().mockReturnValue(insertChain);

    const wdlChain = {
      select: vi.fn().mockReturnValue(makeWdlSelectChain(null)),
      insert: vi.fn().mockReturnValue(createQueryChain({ data: { id: "log-1" }, error: null })),
    };
    admin.from.mockImplementation((table: string) => {
      if (table === "orders") return throwingChain;
      if (table === "webhook_delivery_log") return wdlChain;
      return mockAdminClient({}).from(table);
    });

    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(wdlChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error_message: "DB connection lost" })
    );
  });

  test("logging failure does not affect handleWebhook return value", async () => {
    const admin = mockAdminClient({ logInsertError: new Error("log DB down") });
    const logChainFailing = {
      select: vi.fn().mockReturnValue(makeWdlSelectChain(null)),
      insert: vi.fn().mockReturnValue({
        ...createQueryChain({ data: null, error: null }),
        single: vi.fn().mockRejectedValue(new Error("log DB down")),
      }),
    };
    const baseAdmin = mockAdminClient({});
    admin.from.mockImplementation((table: string) => {
      if (table === "webhook_delivery_log") return logChainFailing;
      return baseAdmin.from(table);
    });

    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
  });

  test("does NOT log when storefront not found", async () => {
    const admin = mockAdminClient({ storefrontData: null });
    const body = JSON.stringify(makePayload());

    await handleWebhook({
      storefrontId: "nonexistent",
      rawBody: body,
      headers: new Headers(),
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    const logCall = admin.from.mock.calls.find((c: unknown[]) => c[0] === "webhook_delivery_log");
    expect(logCall).toBeUndefined();
  });

  test("does NOT log when signature invalid", async () => {
    const admin = mockAdminClient({});
    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: "bad-secret" });

    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    const logCall = admin.from.mock.calls.find((c: unknown[]) => c[0] === "webhook_delivery_log");
    expect(logCall).toBeUndefined();
  });

  // --- Idempotency via webhook_delivery_log pre-check ---

  test("returns cached 200 without re-processing when duplicate (storefront_id, external_id, event) found in log", async () => {
    const { tryAutoAssign } = await import("./auto-assignment-orchestrator");
    vi.mocked(tryAutoAssign).mockClear();

    const admin = mockAdminClient({
      existingDeliveryLog: {
        id: "prior-log-id",
        status: "processed",
        order_id: "order-uuid-prior",
      },
    });

    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.duplicate).toBe(true);
    // No auto-assignment triggered for duplicate
    expect(tryAutoAssign).not.toHaveBeenCalled();
    // A suppression log entry was still appended
    const wdlChain = admin.from.mock.results[
      admin.from.mock.calls.findIndex((c: unknown[]) => c[0] === "webhook_delivery_log")
    ].value;
    expect(wdlChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ignored" })
    );
  });

  test("stores storefront_id and external_id in log on successful order.created", async () => {
    const admin = mockAdminClient({});
    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    const wdlIdx = admin.from.mock.calls.findLastIndex((c: unknown[]) => c[0] === "webhook_delivery_log");
    const wdlChain = admin.from.mock.results[wdlIdx].value;
    expect(wdlChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        storefront_id: STOREFRONT_ID,
        external_id: "EO-99",
      })
    );
  });

  test("returns 200 + logs error when storefront platform is unknown", async () => {
    const admin = mockAdminClient({
      storefrontData: {
        id: STOREFRONT_ID,
        market_id: MARKET_ID,
        platform: "rogueplatform",
        config: {},
        webhook_secret: SECRET,
        is_active: true,
      },
    });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: "{}",
      headers: new Headers(),
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.error).toBe("Unknown platform");

    const wdlChain = admin.from("webhook_delivery_log") as unknown as {
      insert: ReturnType<typeof vi.fn>;
    };
    expect(wdlChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "rogueplatform",
        event: "unknown",
        status: "error",
        storefront_id: STOREFRONT_ID,
      })
    );
  });

  // --- Phase 1: per-delivery idempotency + Shopify-specific behavior ---

  const SHOPIFY_STOREFRONT = {
    id: STOREFRONT_ID,
    market_id: MARKET_ID,
    platform: "shopify",
    config: {},
    webhook_secret: SECRET,
    is_active: true,
  };

  function shopifyPayload(idOverride?: string): Record<string, unknown> {
    return {
      id: idOverride ?? 5001,
      total_price: "60.00",
      note: null,
      customer: { first_name: "Ahmed", last_name: "Ben", phone: "+21699999999" },
      shipping_address: { address1: "Rue X", city: "Tunis", phone: "+21699999999" },
      line_items: [
        { name: "Shampoo", sku: "SH-001", variant_title: "Pack x2", quantity: 2, price: "30.00" },
      ],
    };
  }

  function shopifyHeaders(body: string, opts: {
    topic?: string;
    webhookId?: string;
    eventId?: string;
    triggeredAt?: string;
    badSig?: boolean;
  } = {}): Headers {
    const sig = opts.badSig
      ? "invalid=="
      : createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
    const h = new Headers({
      "X-Shopify-Hmac-Sha256": sig,
      "X-Shopify-Topic": opts.topic ?? "orders/create",
    });
    if (opts.webhookId) h.set("X-Shopify-Webhook-Id", opts.webhookId);
    if (opts.eventId) h.set("X-Shopify-Event-Id", opts.eventId);
    if (opts.triggeredAt) h.set("X-Shopify-Triggered-At", opts.triggeredAt);
    return h;
  }

  test("Shopify: invalid signature returns 401 (not 200)", async () => {
    const admin = mockAdminClient({ storefrontData: SHOPIFY_STOREFRONT });
    const body = JSON.stringify(shopifyPayload());
    const headers = shopifyHeaders(body, { badSig: true });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(401);
  });

  test("non-Shopify: invalid signature still returns 200 (no retry storm)", async () => {
    const admin = mockAdminClient({});
    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: "bad-secret" });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
  });

  test("Shopify: stores delivery_id + topic + event_id + triggered_at on log row", async () => {
    const admin = mockAdminClient({ storefrontData: SHOPIFY_STOREFRONT });
    const body = JSON.stringify(shopifyPayload());
    const headers = shopifyHeaders(body, {
      webhookId: "wh-abc-123",
      eventId: "evt-xyz-456",
      triggeredAt: "2026-05-12T10:00:00Z",
    });

    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    const wdlIdx = admin.from.mock.calls.findLastIndex((c: unknown[]) => c[0] === "webhook_delivery_log");
    const wdlChain = admin.from.mock.results[wdlIdx].value;
    expect(wdlChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_id: "wh-abc-123",
        shopify_event_id: "evt-xyz-456",
        shopify_topic: "orders/create",
        shopify_triggered_at: "2026-05-12T10:00:00Z",
      })
    );
  });

  test("Shopify: duplicate X-Shopify-Webhook-Id short-circuits before processing", async () => {
    const { tryAutoAssign } = await import("./auto-assignment-orchestrator");
    vi.mocked(tryAutoAssign).mockClear();

    const admin = mockAdminClient({
      storefrontData: SHOPIFY_STOREFRONT,
      existingDeliveryLog: {
        id: "prior-log-id",
        status: "processed",
        order_id: "order-prior",
      },
    });
    const body = JSON.stringify(shopifyPayload());
    const headers = shopifyHeaders(body, { webhookId: "wh-dup" });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.duplicate).toBe(true);
    expect(tryAutoAssign).not.toHaveBeenCalled();
  });

  test("Shopify: two legitimate orders/updated with different webhook IDs are both processed", async () => {
    // Build a stateful admin: first call has no prior log row, second call also has none.
    // Both events must reach handleOrderUpdated rather than being deduped.
    const orderRow = { id: "order-1", status: "pending" };
    const ordersChain = createQueryChain({ data: orderRow, error: null });
    const updateFn = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    ordersChain.update = updateFn;

    const admin = mockAdminClient({ storefrontData: SHOPIFY_STOREFRONT });
    admin.from.mockImplementation((table: string) => {
      if (table === "orders") return ordersChain;
      if (table === "webhook_delivery_log") {
        return {
          select: vi.fn().mockReturnValue(makeWdlSelectChain(null)),
          insert: vi.fn().mockReturnValue(createQueryChain({ data: { id: "log-1" }, error: null })),
        };
      }
      return mockAdminClient({ storefrontData: SHOPIFY_STOREFRONT }).from(table);
    });

    const body = JSON.stringify(shopifyPayload());

    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers: shopifyHeaders(body, { topic: "orders/updated", webhookId: "wh-A" }),
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers: shopifyHeaders(body, { topic: "orders/updated", webhookId: "wh-B" }),
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(updateFn).toHaveBeenCalledTimes(2);
  });

  test("logs delivery for inactive storefront (no silent drop)", async () => {
    const admin = mockAdminClient({
      storefrontData: {
        id: STOREFRONT_ID, market_id: MARKET_ID, platform: "easy_orders",
        config: {}, webhook_secret: SECRET, is_active: false,
      },
    });
    const body = JSON.stringify(makePayload());

    await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers: new Headers(),
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    const wdlIdx = admin.from.mock.calls.findLastIndex((c: unknown[]) => c[0] === "webhook_delivery_log");
    expect(wdlIdx).toBeGreaterThanOrEqual(0);
    const wdlChain = admin.from.mock.results[wdlIdx].value;
    expect(wdlChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ignored",
        storefront_id: STOREFRONT_ID,
        error_message: expect.stringContaining("inactive"),
      })
    );
  });

  test("non-Shopify sources without delivery_id still dedupe by (storefront_id, external_id, event)", async () => {
    // Easy Orders path — no X-Shopify-Webhook-Id header. Legacy dedupe still applies.
    const { tryAutoAssign } = await import("./auto-assignment-orchestrator");
    vi.mocked(tryAutoAssign).mockClear();

    const admin = mockAdminClient({
      existingDeliveryLog: {
        id: "prior-log-id",
        status: "processed",
        order_id: "order-prior",
      },
    });

    const body = JSON.stringify(makePayload());
    const headers = new Headers({ secret: SECRET });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.duplicate).toBe(true);
    expect(tryAutoAssign).not.toHaveBeenCalled();
  });

  test("logs 'error' with message when adapter mapping rejects payload", async () => {
    // Regression: a Shopify order without a phone number used to log as 'processed'
    // with order_id=null, silently hiding the failure. The mapping error must
    // surface as status='error' with the message preserved so operators can see it.
    const admin = mockAdminClient({ storefrontData: SHOPIFY_STOREFRONT });
    const payload = shopifyPayload();
    // Strip both phone fields — adapter will throw "Missing customer phone"
    (payload.customer as Record<string, unknown>).phone = null;
    (payload.shipping_address as Record<string, unknown>).phone = null;

    const body = JSON.stringify(payload);
    const headers = shopifyHeaders(body, { webhookId: "wh-no-phone" });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers,
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.error).toBe("Missing customer phone");

    const wdlIdx = admin.from.mock.calls.findLastIndex((c: unknown[]) => c[0] === "webhook_delivery_log");
    const wdlChain = admin.from.mock.results[wdlIdx].value;
    expect(wdlChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        error_message: "Missing customer phone",
        order_id: null,
      })
    );
  });
});

describe("handleWebhook — uuid_only auth", () => {
  const UUID_ONLY_STOREFRONT = {
    id: STOREFRONT_ID,
    market_id: MARKET_ID,
    platform: "easy_orders",
    config: {},
    webhook_secret: SECRET,
    is_active: true,
    auth_mode: "uuid_only",
  };

  function uuidOnlyPayload(overrides: Record<string, unknown> = {}) {
    // Combined shape: top-level customer/product for the uuid_only validator,
    // plus order.customer/order.product so the adapter (easy_orders) can still
    // map the payload into the internal order model.
    return {
      customer: {
        name: "Ahmed",
        phone: "+21699999999",
        city: "Tunis",
        address: "12 Rue X",
      },
      product: { variant_id: 42, quantity: 2 },
      ...makePayload(),
      ...overrides,
    };
  }

  test("accepts request without HMAC signature when auth_mode = 'uuid_only'", async () => {
    const admin = mockAdminClient({ storefrontData: UUID_ONLY_STOREFRONT });
    const body = JSON.stringify(uuidOnlyPayload());

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers: new Headers(), // no signature header
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.order_id).toBeDefined();
  });

  test("returns 400 + CORS-readable error on invalid payload", async () => {
    const admin = mockAdminClient({ storefrontData: UUID_ONLY_STOREFRONT });
    const body = JSON.stringify({ ...uuidOnlyPayload(), customer: { name: "", phone: "x", city: "y", address: "z" } });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers: new Headers(),
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe("customer.name must be a non-empty string");
  });

  test("returns 400 on malformed JSON", async () => {
    const admin = mockAdminClient({ storefrontData: UUID_ONLY_STOREFRONT });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: "not-json{",
      headers: new Headers(),
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBeDefined();
  });

  test("returns 400 when product.variant_id is not a number", async () => {
    const admin = mockAdminClient({ storefrontData: UUID_ONLY_STOREFRONT });
    const body = JSON.stringify({
      ...uuidOnlyPayload(),
      product: { variant_id: "42", quantity: 1 },
    });

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers: new Headers(),
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe("product.variant_id must be a number");
  });

  test("hmac storefront still rejects missing signature (regression guard)", async () => {
    // Same storefront fixture but explicit auth_mode = 'hmac' (the default).
    const admin = mockAdminClient({
      storefrontData: { ...UUID_ONLY_STOREFRONT, auth_mode: "hmac" },
    });
    const body = JSON.stringify(uuidOnlyPayload());

    const result = await handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: body,
      headers: new Headers(), // no signature
      adminClient: admin as unknown as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });

    expect(result.status).toBe(200);
    expect(result.body.error).toBe("Invalid webhook signature");
  });
});

// ---------------------------------------------------------------------------
// Storefront -> OMS mapping resolution (product / city / mapping_status)
// ---------------------------------------------------------------------------
describe("handleWebhook — storefront -> OMS mapping resolution", () => {
  // Buybox is a Libya storefront — the city resolver routes Libya orders
  // through dexpress_states, not the cities table.
  const BUYBOX_STOREFRONT = {
    id: STOREFRONT_ID,
    market_id: LY_MARKET_ID,
    platform: "buybox",
    config: {},
    webhook_secret: SECRET,
    is_active: true,
    auth_mode: "uuid_only",
  };

  // Real-shaped buybox payload (matches the live raw_payload).
  function buyboxPayload(overrides: {
    customer?: Record<string, unknown>;
    product?: Record<string, unknown>;
  } = {}) {
    return {
      source: "quraan-buybox",
      idempotency_key: "bc8b4a5f-mapping-test",
      order_id: "bc8b4a5f-mapping-test",
      customer: {
        name: "ayaaaa",
        phone: "0913456789",
        city: "مصراتة",
        city_id: 3,
        city_name: "مصراتة",
        route_id: 2,
        address: "شارع الاختبار",
        ...overrides.customer,
      },
      product: {
        id: "9262459551959",
        title: "Quran",
        variant_id: 48611571007703,
        bundle_label: "نسخة واحدة",
        quantity: 1,
        unit_price: 7,
        total_price: 7,
        currency: "TND",
        ...overrides.product,
      },
      upsells: [],
    };
  }

  // Mock admin client with independently controllable resolver tables.
  // Captures the orders.insert payload for assertions.
  //
  // City resolution is name-only: the city resolver matches customer_city
  // against the market's destination table (dexpress_states for Libya, cities
  // for Tunisia). There is no external_city_mappings lookup.
  function mappingMockClient(opts: {
    productMappingRow?: unknown; // storefront_product_mappings
    skuProductRow?: unknown; // products via sku
    nameProductRow?: unknown; // products via name ILIKE
    cityRows?: unknown[]; // cities name match (Tunisia)
    dexpressStateRows?: unknown[]; // dexpress_states name match (Libya)
  }) {
    const captured: { orderInsert?: Record<string, unknown>; historyInserts: unknown[] } = {
      historyInserts: [],
    };

    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.ilike = vi.fn(() => {
        (chain as { __usedIlike?: boolean }).__usedIlike = true;
        return chain;
      });
      chain.limit = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);

      if (table === "storefronts") {
        chain.maybeSingle = vi.fn(async () => ({ data: BUYBOX_STOREFRONT, error: null }));
        chain.single = chain.maybeSingle;
        return chain;
      }
      if (table === "webhook_delivery_log") {
        chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
        chain.insert = vi.fn(() => ({
          select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: "log-1" }, error: null })) })),
        }));
        return chain;
      }
      if (table === "storefront_product_mappings") {
        chain.maybeSingle = vi.fn(async () => ({ data: opts.productMappingRow ?? null, error: null }));
        return chain;
      }
      if (table === "products") {
        chain.maybeSingle = vi.fn(async () => {
          const usedIlike = (chain as { __usedIlike?: boolean }).__usedIlike === true;
          return { data: usedIlike ? opts.nameProductRow ?? null : opts.skuProductRow ?? null, error: null };
        });
        return chain;
      }
      if (table === "cities") {
        // resolver awaits .select().eq() directly (returns a list) — Tunisia path
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: opts.cityRows ?? [], error: null })),
          })),
        };
      }
      if (table === "dexpress_states") {
        // resolver awaits .select().eq("status", 1) directly — Libya path
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: opts.dexpressStateRows ?? [], error: null })),
          })),
        };
      }
      if (table === "orders") {
        chain.insert = vi.fn((payload: Record<string, unknown>) => {
          captured.orderInsert = payload;
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: "order-mapping-1" }, error: null })),
            })),
          };
        });
        chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
        chain.single = vi.fn(async () => ({ data: { id: "order-mapping-1" }, error: null }));
        return chain;
      }
      if (table === "order_history") {
        chain.insert = vi.fn(async (payload: unknown) => {
          captured.historyInserts.push(payload);
          return { data: { id: "hist-x" }, error: null };
        });
        return chain;
      }
      // unknown table
      chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      return chain;
    });

    return {
      client: { from, rpc: vi.fn(async () => ({ data: null, error: null })) },
      captured,
    };
  }

  async function run(client: unknown, payload: unknown) {
    return handleWebhook({
      storefrontId: STOREFRONT_ID,
      rawBody: JSON.stringify(payload),
      headers: new Headers(),
      adminClient: client as Parameters<typeof handleWebhook>[0]["adminClient"],
      decryptFn: (s: string) => s,
    });
  }

  test("persists external_* identifiers and currency on the order", async () => {
    const { client, captured } = mappingMockClient({});
    const result = await run(client, buyboxPayload());

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(captured.orderInsert).toMatchObject({
      external_product_id: "9262459551959",
      external_variant_id: "48611571007703",
      external_route_id: "2",
      currency: "TND",
    });
    // external_city_id is no longer persisted — city is name-only resolution.
    expect(captured.orderInsert).not.toHaveProperty("external_city_id");
  });

  test("mapping_status = 'mapped' when the product mapping resolves and the city name matches", async () => {
    // Libya storefront: the city resolves by name against dexpress_states
    // (the customer picked it from a constrained dropdown, so a name match is
    // authoritative -> 'mapped'). city_id stays null.
    const { client, captured } = mappingMockClient({
      productMappingRow: { product_id: "prod-quran", product_variant_id: "var-1" },
      dexpressStateRows: [
        { id: 12, name: "مصراتة" },
        { id: 62, name: "طرابلس" },
      ],
    });
    await run(client, buyboxPayload());

    expect(captured.orderInsert).toMatchObject({
      product_id: "prod-quran",
      product_variant_id: "var-1",
      city_id: null,
      dexpress_state_id: 12,
      mapping_status: "mapped",
    });
  });

  test("mapping_status = 'unmatched' when neither product nor city resolves", async () => {
    const { client, captured } = mappingMockClient({}); // all tables empty
    await run(client, buyboxPayload());

    expect(captured.orderInsert).toMatchObject({
      product_id: null,
      city_id: null,
      dexpress_state_id: null,
      mapping_status: "unmatched",
    });
  });

  test("mapping_status = 'unmatched' when the product resolves but the city name is not in the destination table", async () => {
    // The city dropdown value didn't match any dexpress_states row — it must
    // be flagged. product is 'mapped', city is 'none' (unmatched) -> worst wins.
    const { client, captured } = mappingMockClient({
      productMappingRow: { product_id: "prod-quran", product_variant_id: null },
      dexpressStateRows: [{ id: 62, name: "طرابلس" }], // no "مصراتة"
    });
    await run(client, buyboxPayload());

    expect(captured.orderInsert).toMatchObject({
      product_id: "prod-quran",
      dexpress_state_id: null,
      city_id: null,
      mapping_status: "unmatched",
    });
  });

  test("appends an order_history note when mapping_status is not 'mapped'", async () => {
    const { client, captured } = mappingMockClient({}); // unmatched
    await run(client, buyboxPayload());

    // first history row is the standard 'pending' intake row; there should
    // additionally be a system note flagging the unresolved mapping.
    const notes = captured.historyInserts
      .map((h) => (h as { note?: string }).note ?? "")
      .join(" | ");
    expect(notes.toLowerCase()).toContain("mapping");
  });

  test("the mapping note names the unmatched city by its dropdown value", async () => {
    const { client, captured } = mappingMockClient({
      productMappingRow: { product_id: "prod-quran", product_variant_id: "var-1" },
      dexpressStateRows: [{ id: 62, name: "طرابلس" }], // city "مصراتة" misses
    });
    await run(client, buyboxPayload());

    const notes = captured.historyInserts
      .map((h) => (h as { note?: string }).note ?? "")
      .join(" | ");
    expect(notes).toContain("مصراتة");
    expect(notes.toLowerCase()).toContain("city unmatched");
  });

  test("does NOT append a mapping note when fully mapped", async () => {
    const { client, captured } = mappingMockClient({
      productMappingRow: { product_id: "prod-quran", product_variant_id: "var-1" },
      dexpressStateRows: [{ id: 12, name: "مصراتة" }],
    });
    await run(client, buyboxPayload());

    const mappingNotes = captured.historyInserts.filter((h) =>
      ((h as { note?: string }).note ?? "").toLowerCase().includes("mapping"),
    );
    expect(mappingNotes).toHaveLength(0);
  });
});
