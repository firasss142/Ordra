import { describe, it, expect, vi } from "vitest";
import { handleDexpressWebhook, type DexpressWebhookDeps } from "../dexpress-webhook-handler";

const VALID_TOKEN = "dexpress-test-token";

type LoggedEntry = {
  carrier_code: "dexpress";
  source: "webhook";
  tracking_number: string | null;
  carrier_status_raw: string | null;
  order_id: string | null;
  outcome: "processed" | "ignored" | "error";
  outcome_reason: string | null;
  raw_body: unknown;
};

function makeDeps(overrides: Partial<DexpressWebhookDeps> = {}): {
  deps: DexpressWebhookDeps;
  logs: LoggedEntry[];
  applyFulfillment: ReturnType<typeof vi.fn>;
} {
  const logs: LoggedEntry[] = [];
  const applyFulfillment = vi.fn().mockResolvedValue(undefined);
  const deps: DexpressWebhookDeps = {
    expectedToken: VALID_TOKEN,
    findOrderByTracking: vi.fn().mockResolvedValue(null),
    findOrderByExternalId: vi.fn().mockResolvedValue(null),
    applyFulfillment,
    writeLog: vi.fn().mockImplementation(async (entry: LoggedEntry) => {
      logs.push(entry);
    }),
    ...overrides,
  };
  return { deps, logs, applyFulfillment };
}

describe("handleDexpressWebhook", () => {
  it("returns 200 and logs invalid_token when token missing", async () => {
    const { deps, logs, applyFulfillment } = makeDeps();
    const result = await handleDexpressWebhook({
      token: null,
      rawBody: JSON.stringify({ order_snum: 1032, status_key: 10, name_status: "تم التسليم" }),
      deps,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ outcome: "error", outcome_reason: "invalid_token" });
    expect(applyFulfillment).not.toHaveBeenCalled();
  });

  it("returns 200 and logs invalid_token when token mismatches", async () => {
    const { deps, logs, applyFulfillment } = makeDeps();
    await handleDexpressWebhook({
      token: "wrong",
      rawBody: JSON.stringify({ order_snum: 1032, status_key: 10, name_status: "تم التسليم" }),
      deps,
    });
    expect(logs[0].outcome_reason).toBe("invalid_token");
    expect(applyFulfillment).not.toHaveBeenCalled();
  });

  it("returns 200 and logs invalid_json when body is not JSON", async () => {
    const { deps, logs } = makeDeps();
    await handleDexpressWebhook({
      token: VALID_TOKEN,
      rawBody: "{not-json",
      deps,
    });
    expect(logs[0]).toMatchObject({ outcome: "error", outcome_reason: "invalid_json" });
  });

  it("returns 200 and logs malformed_payload when order_snum missing", async () => {
    const { deps, logs } = makeDeps();
    await handleDexpressWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({ status_key: 10, name_status: "تم التسليم" }),
      deps,
    });
    expect(logs[0]).toMatchObject({ outcome: "error", outcome_reason: "malformed_payload" });
  });

  it("returns 200 and logs malformed_payload when status_key missing", async () => {
    const { deps, logs } = makeDeps();
    await handleDexpressWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({ order_snum: 1032, name_status: "تم التسليم" }),
      deps,
    });
    expect(logs[0]).toMatchObject({ outcome: "error", outcome_reason: "malformed_payload" });
  });

  it("returns 200 and logs unknown_status_key for unmapped status keys", async () => {
    const { deps, logs, applyFulfillment } = makeDeps();
    await handleDexpressWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({ order_snum: 1032, status_key: 99, name_status: "مجهول" }),
      deps,
    });
    expect(logs[0]).toMatchObject({
      outcome: "ignored",
      outcome_reason: "unknown_status_key:99",
      tracking_number: "1032",
    });
    expect(applyFulfillment).not.toHaveBeenCalled();
  });

  it("returns 200 and logs order_not_found when neither lookup matches", async () => {
    const { deps, logs } = makeDeps();
    await handleDexpressWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({
        order_snum: 1032,
        status_key: 10,
        name_status: "تم التسليم",
        order_reference: "EO-99",
      }),
      deps,
    });
    expect(logs[0]).toMatchObject({
      outcome: "ignored",
      outcome_reason: "order_not_found",
    });
    expect(deps.findOrderByTracking).toHaveBeenCalledWith("1032");
    expect(deps.findOrderByExternalId).toHaveBeenCalledWith("EO-99");
  });

  it("falls back to external_id lookup when tracking not found", async () => {
    const { deps, applyFulfillment } = makeDeps({
      findOrderByTracking: vi.fn().mockResolvedValue(null),
      findOrderByExternalId: vi.fn().mockResolvedValue({ id: "ord-1", status: "in_transit" }),
    });
    await handleDexpressWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({
        order_snum: 1032,
        status_key: 10,
        name_status: "تم التسليم",
        order_reference: "EO-99",
      }),
      deps,
    });
    expect(applyFulfillment).toHaveBeenCalledWith({
      orderId: "ord-1",
      newStatus: "delivered",
      isDamaged: false,
      note: "Dexpress: تم التسليم",
    });
  });

  it("returns 200 and logs invalid_transition when already delivered", async () => {
    const { deps, logs, applyFulfillment } = makeDeps({
      findOrderByTracking: vi.fn().mockResolvedValue({ id: "ord-1", status: "delivered" }),
    });
    await handleDexpressWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({ order_snum: 1032, status_key: 10, name_status: "تم التسليم" }),
      deps,
    });
    expect(logs[0]).toMatchObject({
      outcome: "ignored",
      outcome_reason: "invalid_transition:delivered_to_delivered",
      order_id: "ord-1",
    });
    expect(applyFulfillment).not.toHaveBeenCalled();
  });

  it("happy path: status_key 10 transitions in_transit→delivered", async () => {
    const { deps, logs, applyFulfillment } = makeDeps({
      findOrderByTracking: vi.fn().mockResolvedValue({ id: "ord-1", status: "in_transit" }),
    });
    const result = await handleDexpressWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({ order_snum: 1032, status_key: 10, name_status: "تم التسليم" }),
      deps,
    });
    expect(result.status).toBe(200);
    expect(applyFulfillment).toHaveBeenCalledWith({
      orderId: "ord-1",
      newStatus: "delivered",
      isDamaged: false,
      note: "Dexpress: تم التسليم",
    });
    expect(logs[0]).toMatchObject({
      outcome: "processed",
      outcome_reason: null,
      order_id: "ord-1",
      carrier_status_raw: "10",
      tracking_number: "1032",
    });
  });

  it("happy path: status_key 1 transitions deposit→in_transit", async () => {
    const { deps, applyFulfillment } = makeDeps({
      findOrderByTracking: vi.fn().mockResolvedValue({ id: "ord-1", status: "deposit" }),
    });
    await handleDexpressWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({ order_snum: 1032, status_key: 1, name_status: "عند العميل" }),
      deps,
    });
    expect(applyFulfillment).toHaveBeenCalledWith({
      orderId: "ord-1",
      newStatus: "in_transit",
      isDamaged: false,
      note: "Dexpress: عند العميل",
    });
  });

  it("logs processing_error and does not leak err.message when RPC throws", async () => {
    const { deps, logs } = makeDeps({
      findOrderByTracking: vi.fn().mockResolvedValue({ id: "ord-1", status: "in_transit" }),
      applyFulfillment: vi.fn().mockRejectedValue(new Error("DB boom")),
    });
    const result = await handleDexpressWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({ order_snum: 1032, status_key: 10, name_status: "تم التسليم" }),
      deps,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
    expect(logs[0]).toMatchObject({
      outcome: "error",
      outcome_reason: "processing_error",
      order_id: "ord-1",
    });
    expect(JSON.stringify(result.body)).not.toContain("DB boom");
  });

  it("returns 200 even when writeLog throws", async () => {
    const { deps } = makeDeps({
      writeLog: vi.fn().mockRejectedValue(new Error("log insert failed")),
    });
    const result = await handleDexpressWebhook({
      token: "wrong",
      rawBody: JSON.stringify({ order_snum: 1032, status_key: 10, name_status: "تم التسليم" }),
      deps,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
  });
});
