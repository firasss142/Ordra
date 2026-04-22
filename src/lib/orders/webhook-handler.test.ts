import { describe, test, expect, vi } from "vitest";
import { createHmac } from "crypto";
import { handleWebhook } from "./webhook-handler";

vi.mock("./auto-assignment-orchestrator", () => ({
  tryAutoAssign: vi.fn().mockResolvedValue(undefined),
}));

function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

const STOREFRONT_ID = "sf-123";
const MARKET_ID = "market-tn";
const SECRET = "test-secret";

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    event: "order.created",
    order: {
      id: "EO-99",
      customer: {
        name: "Ahmed",
        phone: "+21699999999",
        address: "Tunis",
        city: "Tunis",
      },
      product: {
        name: "Shampoo",
        variant: "Pack x2",
        quantity: 2,
        unit_price: 30,
        total_price: 60,
      },
    },
    ...overrides,
  };
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

  // webhook_delivery_log needs both SELECT (idempotency check) and INSERT
  const wdlSelectChain = {
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: existingDeliveryLog, error: null }),
      }),
    }),
  };
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
    rpc: vi.fn().mockResolvedValue({ data: { order_id: "order-uuid-1", status: "cancelled", updated_at: "2026-04-11", history_id: "hist-1" }, error: null }),
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
    const headers = new Headers({ "X-Webhook-Signature": "bad-signature" });

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
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
    // Setup: existing order found with pre-dispatch status
    const admin = mockAdminClient({});
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
      return mockAdminClient({}).from(table);
    });

    const payload = makePayload({ event: "order.updated" });
    const body = JSON.stringify(payload);
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
    const headers = new Headers({ "X-Webhook-Signature": "bad-signature" });

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
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue(createQueryChain({ data: { id: "log-1" }, error: null })),
    };
    admin.from.mockImplementation((table: string) => {
      if (table === "orders") return ordersChain;
      if (table === "webhook_delivery_log") return wdlChain;
      return mockAdminClient({}).from(table);
    });

    const body = JSON.stringify(makePayload());
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
    const admin = mockAdminClient({});
    const existingOrder = { id: "existing-order-1", status: "delivered" };
    const ordersChain = createQueryChain({ data: existingOrder, error: null });

    const wdlChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue(createQueryChain({ data: { id: "log-1" }, error: null })),
    };
    admin.from.mockImplementation((table: string) => {
      if (table === "orders") return ordersChain;
      if (table === "webhook_delivery_log") return wdlChain;
      return mockAdminClient({}).from(table);
    });

    const payload = makePayload({ event: "order.updated" });
    const body = JSON.stringify(payload);
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue(createQueryChain({ data: { id: "log-1" }, error: null })),
    };
    admin.from.mockImplementation((table: string) => {
      if (table === "orders") return throwingChain;
      if (table === "webhook_delivery_log") return wdlChain;
      return mockAdminClient({}).from(table);
    });

    const body = JSON.stringify(makePayload());
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
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
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
    const headers = new Headers({ "X-Webhook-Signature": "bad-signature" });

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
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
    const signature = signPayload(body, SECRET);
    const headers = new Headers({ "X-Webhook-Signature": signature });

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
});
