import { describe, test, expect, vi } from "vitest";
import { recordIntegrationCall, type IntegrationCallInput } from "../record-call";

/** A service-role client double that records what reached `integration_calls`. */
function fakeAdmin(insertResult: unknown = Promise.resolve({ error: null })) {
  const insert = vi.fn(() => insertResult);
  const from = vi.fn(() => ({ insert }));
  return { admin: { from } as unknown as Parameters<typeof recordIntegrationCall>[0], from, insert };
}

const BASE: IntegrationCallInput = {
  system: "navex",
  connectionId: "c-1",
  operation: "upload",
  status: "refused",
  errorCode: "NAVEX_VALIDATION",
  message: "bad city",
  durationMs: 812,
  orderId: "o-1",
  marketId: "m-tn",
  actorId: "u-1",
};

describe("recordIntegrationCall", () => {
  test("writes one row to integration_calls, columns in the table's names", async () => {
    const { admin, from, insert } = fakeAdmin();
    await recordIntegrationCall(admin, BASE);
    expect(from).toHaveBeenCalledWith("integration_calls");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      system: "navex",
      connection_id: "c-1",
      operation: "upload",
      status: "refused",
      http_status: null,
      error_code: "NAVEX_VALIDATION",
      message: "bad city",
      duration_ms: 812,
      attempt: 1,
      order_id: "o-1",
      market_id: "m-tn",
      actor_id: "u-1",
      request_excerpt: null,
      response_excerpt: null,
    });
  });

  test("the message is cut to 300 characters", async () => {
    const { admin, insert } = fakeAdmin();
    await recordIntegrationCall(admin, { ...BASE, message: "ville refusée ".repeat(80) });
    const row = (insert.mock.calls[0] as unknown[])[0] as { message: string };
    expect(row.message.length).toBe(300);
  });

  test("a phone number or an e-mail in the carrier's message never reaches the journal", async () => {
    const { admin, insert } = fakeAdmin();
    await recordIntegrationCall(admin, {
      ...BASE,
      message: "Téléphone 0912345678 invalide pour client@example.com",
    });
    const row = (insert.mock.calls[0] as unknown[])[0] as { message: string };
    expect(row.message).not.toMatch(/0912345678/);
    expect(row.message).not.toMatch(/client@example\.com/);
  });

  test("a fractional duration is rounded (duration_ms is an INT column)", async () => {
    const { admin, insert } = fakeAdmin();
    await recordIntegrationCall(admin, { ...BASE, durationMs: 812.6 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ duration_ms: 813 }));
  });

  test("an ok call carries no message or code", async () => {
    const { admin, insert } = fakeAdmin();
    await recordIntegrationCall(admin, {
      system: "darb_assabil",
      connectionId: "c-2",
      operation: "upload",
      status: "ok",
      durationMs: 120,
      orderId: "o-2",
      marketId: "m-ly",
      actorId: null,
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ok", error_code: null, message: null, actor_id: null }),
    );
  });

  test("an insert that answers an error is swallowed", async () => {
    const { admin } = fakeAdmin(Promise.resolve({ error: { message: "permission denied" } }));
    await expect(recordIntegrationCall(admin, BASE)).resolves.toBeUndefined();
  });

  test("an insert that rejects is swallowed", async () => {
    const { admin } = fakeAdmin(Promise.reject(new Error("network down")));
    await expect(recordIntegrationCall(admin, BASE)).resolves.toBeUndefined();
  });

  test("a client that throws synchronously is swallowed", async () => {
    const admin = {
      from: () => {
        throw new TypeError("from is not a function");
      },
    } as unknown as Parameters<typeof recordIntegrationCall>[0];
    await expect(recordIntegrationCall(admin, BASE)).resolves.toBeUndefined();
  });
});
