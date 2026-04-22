import { describe, it, expect, vi } from "vitest";
import { handleNavexWebhook, type NavexWebhookDeps } from "../navex-webhook-handler";

const VALID_TOKEN = "navex-test-token";

type LoggedEntry = {
  carrier_code: "navex";
  source: "webhook";
  tracking_number: string | null;
  carrier_status_raw: string | null;
  order_id: string | null;
  outcome: "processed" | "ignored" | "error";
  outcome_reason: string | null;
  raw_body: unknown;
};

function makeDeps(overrides: Partial<NavexWebhookDeps> = {}): {
  deps: NavexWebhookDeps;
  logs: LoggedEntry[];
  applyFulfillment: ReturnType<typeof vi.fn>;
} {
  const logs: LoggedEntry[] = [];
  const applyFulfillment = vi.fn().mockResolvedValue(undefined);
  const deps: NavexWebhookDeps = {
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

describe("handleNavexWebhook", () => {
  it("returns 200 and logs invalid_token when token missing", async () => {
    const { deps, logs, applyFulfillment } = makeDeps();
    const result = await handleNavexWebhook({
      token: null,
      rawBody: JSON.stringify({ tracking_number: "T1", event: "package_received" }),
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
    const result = await handleNavexWebhook({
      token: "wrong",
      rawBody: JSON.stringify({ tracking_number: "T1", event: "package_received" }),
      deps,
    });
    expect(result.status).toBe(200);
    expect(logs[0].outcome_reason).toBe("invalid_token");
    expect(applyFulfillment).not.toHaveBeenCalled();
  });

  it("returns 200 and logs invalid_json when body is not JSON", async () => {
    const { deps, logs } = makeDeps();
    const result = await handleNavexWebhook({
      token: VALID_TOKEN,
      rawBody: "{not-json",
      deps,
    });
    expect(result.status).toBe(200);
    expect(logs[0]).toMatchObject({ outcome: "error", outcome_reason: "invalid_json" });
  });

  it("returns 200 and logs malformed_payload when tracking_number missing", async () => {
    const { deps, logs } = makeDeps();
    const result = await handleNavexWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({ event: "package_received" }),
      deps,
    });
    expect(result.status).toBe(200);
    expect(logs[0]).toMatchObject({ outcome: "error", outcome_reason: "malformed_payload" });
  });

  it("returns 200 and logs unknown_event for unmapped event strings", async () => {
    const { deps, logs, applyFulfillment } = makeDeps();
    const result = await handleNavexWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({ tracking_number: "T1", event: "bogus" }),
      deps,
    });
    expect(result.status).toBe(200);
    expect(logs[0]).toMatchObject({
      outcome: "ignored",
      outcome_reason: "unknown_event:bogus",
      tracking_number: "T1",
    });
    expect(applyFulfillment).not.toHaveBeenCalled();
  });

  it("returns 200 and logs order_not_found when neither lookup matches", async () => {
    const { deps, logs } = makeDeps();
    const result = await handleNavexWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({
        tracking_number: "T1",
        event: "package_received",
        order_reference: "EO-99",
      }),
      deps,
    });
    expect(result.status).toBe(200);
    expect(logs[0]).toMatchObject({
      outcome: "ignored",
      outcome_reason: "order_not_found",
    });
    expect(deps.findOrderByTracking).toHaveBeenCalledWith("T1");
    expect(deps.findOrderByExternalId).toHaveBeenCalledWith("EO-99");
  });

  it("falls back to external_id lookup when tracking not found", async () => {
    const { deps, applyFulfillment } = makeDeps({
      findOrderByTracking: vi.fn().mockResolvedValue(null),
      findOrderByExternalId: vi.fn().mockResolvedValue({ id: "ord-1", status: "dispatched" }),
    });
    const result = await handleNavexWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({
        tracking_number: "T1",
        event: "package_received",
        order_reference: "EO-99",
      }),
      deps,
    });
    expect(result.status).toBe(200);
    expect(applyFulfillment).toHaveBeenCalledWith({
      orderId: "ord-1",
      newStatus: "deposit",
      isDamaged: false,
      note: "Navex: package_received",
    });
  });

  it("returns 200 and logs invalid_transition when RPC guard would fail", async () => {
    const { deps, logs, applyFulfillment } = makeDeps({
      findOrderByTracking: vi.fn().mockResolvedValue({ id: "ord-1", status: "delivered" }),
    });
    const result = await handleNavexWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({ tracking_number: "T1", event: "delivered" }),
      deps,
    });
    expect(result.status).toBe(200);
    expect(logs[0]).toMatchObject({
      outcome: "ignored",
      outcome_reason: "invalid_transition:delivered_to_delivered",
      order_id: "ord-1",
    });
    expect(applyFulfillment).not.toHaveBeenCalled();
  });

  it("happy path: package_received transitions dispatched→deposit", async () => {
    const { deps, logs, applyFulfillment } = makeDeps({
      findOrderByTracking: vi.fn().mockResolvedValue({ id: "ord-1", status: "dispatched" }),
    });
    const result = await handleNavexWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({ tracking_number: "T1", event: "package_received" }),
      deps,
    });
    expect(result.status).toBe(200);
    expect(applyFulfillment).toHaveBeenCalledWith({
      orderId: "ord-1",
      newStatus: "deposit",
      isDamaged: false,
      note: "Navex: package_received",
    });
    expect(logs[0]).toMatchObject({
      outcome: "processed",
      outcome_reason: null,
      order_id: "ord-1",
      carrier_status_raw: "package_received",
      tracking_number: "T1",
    });
  });

  it("happy path: damaged_return passes isDamaged=true", async () => {
    const { deps, applyFulfillment } = makeDeps({
      findOrderByTracking: vi.fn().mockResolvedValue({ id: "ord-1", status: "to_be_returned" }),
    });
    const result = await handleNavexWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({ tracking_number: "T1", event: "damaged_return" }),
      deps,
    });
    expect(result.status).toBe(200);
    expect(applyFulfillment).toHaveBeenCalledWith({
      orderId: "ord-1",
      newStatus: "returned",
      isDamaged: true,
      note: "Navex: damaged_return",
    });
  });

  it("logs processing_error and does not leak err.message when RPC throws", async () => {
    const { deps, logs } = makeDeps({
      findOrderByTracking: vi.fn().mockResolvedValue({ id: "ord-1", status: "dispatched" }),
      applyFulfillment: vi.fn().mockRejectedValue(new Error("DB boom")),
    });
    const result = await handleNavexWebhook({
      token: VALID_TOKEN,
      rawBody: JSON.stringify({ tracking_number: "T1", event: "package_received" }),
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
    const result = await handleNavexWebhook({
      token: "wrong",
      rawBody: JSON.stringify({ tracking_number: "T1", event: "package_received" }),
      deps,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
  });
});
