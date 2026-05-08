import { describe, test, expect, vi, beforeEach } from "vitest";
import { runPollCycle } from "./poller";
import type { OpenOrderForPoll, PollerDeps } from "./poller";

function makeOrder(
  overrides: Partial<OpenOrderForPoll> = {}
): OpenOrderForPoll {
  return {
    order_id: "o1",
    tracking_number: "TRACK-1",
    status: "dispatched",
    carrier_code: "navex",
    api_credentials: "enc:creds-navex",
    api_endpoint: "https://app.navex.tn/api",
    ...overrides,
  };
}

function createDeps(overrides: Partial<PollerDeps> = {}): PollerDeps {
  return {
    fetchOpenOrders: vi.fn().mockResolvedValue([]),
    fetchNavexStatus: vi.fn(),
    applyFulfillment: vi.fn().mockResolvedValue(undefined),
    writeLog: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("runPollCycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns empty results when no open orders", async () => {
    const deps = createDeps();
    const results = await runPollCycle(deps);
    expect(results).toEqual([]);
    expect(deps.fetchNavexStatus).not.toHaveBeenCalled();
  });

  test("polls Navex per-order and calls applyFulfillment on mapped status", async () => {
    const order = makeOrder({ tracking_number: "NAV-1", status: "dispatched" });
    const deps = createDeps({
      fetchOpenOrders: vi.fn().mockResolvedValue([order]),
      fetchNavexStatus: vi.fn().mockResolvedValue({
        status: 1,
        etat: "Au magasin",
        status_message: "NAV-1",
      }),
    });

    const results = await runPollCycle(deps);

    expect(deps.fetchNavexStatus).toHaveBeenCalledTimes(1);
    expect(deps.fetchNavexStatus).toHaveBeenCalledWith("NAV-1", expect.objectContaining({
      api_credentials: "enc:creds-navex",
    }));
    expect(deps.applyFulfillment).toHaveBeenCalledTimes(1);
    expect(deps.applyFulfillment).toHaveBeenCalledWith({
      orderId: "o1",
      newStatus: "deposit",
      isDamaged: false,
      note: "Navex: Au magasin",
    });
    expect(deps.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        carrier_code: "navex",
        tracking_number: "NAV-1",
        outcome: "processed",
        order_id: "o1",
      })
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      carrierCode: "navex",
      polled: 1,
      processed: 1,
      ignored: 0,
      errored: 0,
    });
  });

  test("logs ignored + skips applyFulfillment for null-mapped Navex etat", async () => {
    const order = makeOrder({ tracking_number: "NAV-2" });
    const deps = createDeps({
      fetchOpenOrders: vi.fn().mockResolvedValue([order]),
      fetchNavexStatus: vi.fn().mockResolvedValue({ etat: "En attente" }),
    });

    const results = await runPollCycle(deps);

    expect(deps.applyFulfillment).not.toHaveBeenCalled();
    expect(deps.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "ignored" })
    );
    expect(results[0].ignored).toBe(1);
  });

  test("logs ignored for unknown Navex etat", async () => {
    const order = makeOrder({ tracking_number: "NAV-3" });
    const deps = createDeps({
      fetchOpenOrders: vi.fn().mockResolvedValue([order]),
      fetchNavexStatus: vi.fn().mockResolvedValue({ etat: "Totally Bogus" }),
    });

    await runPollCycle(deps);

    expect(deps.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "ignored",
        outcome_reason: expect.stringContaining("unknown_navex_etat"),
      })
    );
  });

  test("logs error when applyFulfillment throws (invalid transition)", async () => {
    const order = makeOrder({ tracking_number: "NAV-4", status: "deposit" });
    const deps = createDeps({
      fetchOpenOrders: vi.fn().mockResolvedValue([order]),
      fetchNavexStatus: vi
        .fn()
        .mockResolvedValue({ etat: "Au magasin" }),
      applyFulfillment: vi
        .fn()
        .mockRejectedValue(new Error("invalid transition from deposit to deposit")),
    });

    const results = await runPollCycle(deps);

    expect(deps.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "error",
        outcome_reason: expect.stringContaining("invalid transition"),
      })
    );
    expect(results[0].errored).toBe(1);
  });

  test("logs error when carrier HTTP call throws", async () => {
    const order = makeOrder({ tracking_number: "NAV-5" });
    const deps = createDeps({
      fetchOpenOrders: vi.fn().mockResolvedValue([order]),
      fetchNavexStatus: vi.fn().mockRejectedValue(new Error("ETIMEDOUT")),
    });

    const results = await runPollCycle(deps);

    expect(deps.applyFulfillment).not.toHaveBeenCalled();
    expect(deps.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "error",
        outcome_reason: expect.stringContaining("ETIMEDOUT"),
      })
    );
    expect(results[0].errored).toBe(1);
  });
});
