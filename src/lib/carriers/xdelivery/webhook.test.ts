import { describe, it, expect, vi } from "vitest";
import { handleXDeliveryWebhook, type XDeliveryWebhookDeps } from "./webhook";

function deps(over: Partial<XDeliveryWebhookDeps> = {}): XDeliveryWebhookDeps {
  return {
    loadAccounts: vi.fn(async () => [
      { carrierId: "A", apiKey: "key-A" },
      { carrierId: "B", apiKey: "key-B" },
    ]),
    applyUpdates: vi.fn(async () => ({ processed: 1, ignored: 0, errored: 0, conflicts: [] })),
    ...over,
  };
}

const body = JSON.stringify({ barcode: 611791217729000, status: "DELIVERED", motif: "" });

describe("handleXDeliveryWebhook", () => {
  it("401 without a Bearer that matches one of our accounts", async () => {
    for (const authorization of [null, "Bearer nope", "key-A", "Basic key-A"]) {
      const d = deps();
      const r = await handleXDeliveryWebhook({ authorization, rawBody: body, deps: d });
      expect(r.status).toBe(401);
      expect(d.applyUpdates).not.toHaveBeenCalled();
    }
  });

  it("applies the update scoped to the account whose key signed it", async () => {
    const d = deps();
    const r = await handleXDeliveryWebhook({ authorization: "Bearer key-B", rawBody: body, deps: d });
    expect(r.status).toBe(200);
    expect(d.applyUpdates).toHaveBeenCalledWith(
      [{ barcode: 611791217729000, status: "DELIVERED", motif: "" }],
      "B",
    );
  });

  it("accepts an array of updates", async () => {
    const d = deps();
    await handleXDeliveryWebhook({
      authorization: "Bearer key-A",
      rawBody: JSON.stringify([
        { barcode: "1", status: "DELIVERED" },
        { barcode: "2", status: "PENDING" },
      ]),
      deps: d,
    });
    expect((d.applyUpdates as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(2);
  });

  it("400 on a body that is not JSON or has no barcode/status", async () => {
    for (const rawBody of ["not json", JSON.stringify({ status: "DELIVERED" }), JSON.stringify({ barcode: "1" })]) {
      const d = deps();
      const r = await handleXDeliveryWebhook({ authorization: "Bearer key-A", rawBody, deps: d });
      expect(r.status).toBe(400);
      expect(d.applyUpdates).not.toHaveBeenCalled();
    }
  });

  it("still answers 200 when applying fails, so the carrier does not retry-storm; the log holds the error", async () => {
    const d = deps({ applyUpdates: vi.fn(async () => Promise.reject(new Error("db down"))) });
    const r = await handleXDeliveryWebhook({ authorization: "Bearer key-A", rawBody: body, deps: d });
    expect(r.status).toBe(200);
  });
});
