import { describe, test, expect, vi, afterEach } from "vitest";
import { recordJournalEvent } from "../record-event";

type Client = Parameters<typeof recordJournalEvent>[0];

afterEach(() => vi.useRealTimers());

describe("recordJournalEvent", () => {
  test("calls journal_record with every parameter named", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "e-1", error: null });
    await recordJournalEvent({ rpc } as unknown as Client, {
      action: "export.orders",
      entityType: "orders",
      marketId: "m-tn",
      context: { rows: 12, format: "csv" },
    });
    expect(rpc).toHaveBeenCalledWith("journal_record", {
      p_action: "export.orders",
      p_entity_type: "orders",
      p_entity_id: null,
      p_entity_label: null,
      p_market_id: "m-tn",
      p_context: { rows: 12, format: "csv" },
      p_order_id: null,
    });
  });

  test("an error answer is swallowed", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "réservée au serveur" } });
    await expect(recordJournalEvent({ rpc } as unknown as Client, { action: "export.orders", entityType: "orders" })).resolves.toBeUndefined();
  });

  test("a rejection is swallowed", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("network"));
    await expect(recordJournalEvent({ rpc } as unknown as Client, { action: "export.orders", entityType: "orders" })).resolves.toBeUndefined();
  });

  test("a client without rpc is swallowed", async () => {
    await expect(recordJournalEvent({} as unknown as Client, { action: "export.orders", entityType: "orders" })).resolves.toBeUndefined();
  });

  test("a journal that never answers holds the caller for at most the timeout", async () => {
    vi.useFakeTimers();
    const rpc = vi.fn(() => new Promise(() => {}));
    let done = false;
    const p = recordJournalEvent({ rpc } as unknown as Client, { action: "export.orders", entityType: "orders" }, 1500).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(done).toBe(true);
  });
});
