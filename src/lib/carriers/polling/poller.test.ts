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
    fetchDexpressBatch: vi.fn(),
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
    expect(deps.fetchDexpressBatch).not.toHaveBeenCalled();
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

  test("batches Dexpress orders into one HTTP call per chunk", async () => {
    const orders: OpenOrderForPoll[] = Array.from({ length: 3 }, (_, i) => ({
      order_id: `o${i}`,
      tracking_number: `DEX-${i}`,
      status: "dispatched",
      carrier_code: "dexpress" as const,
      api_credentials: "enc:creds-dexpress",
      api_endpoint: "https://api.shippingeyes.com",
    }));

    const deps = createDeps({
      fetchOpenOrders: vi.fn().mockResolvedValue(orders),
      fetchDexpressBatch: vi.fn().mockResolvedValue({
        code: 4000,
        data: [
          { order_snum: "DEX-0", status_key: 10, name_status: "تم التسليم" },
          { order_snum: "DEX-1", status_key: 1, name_status: "عند العميل" },
        ],
      }),
    });

    const results = await runPollCycle(deps);

    expect(deps.fetchDexpressBatch).toHaveBeenCalledTimes(1);
    expect(deps.fetchDexpressBatch).toHaveBeenCalledWith(
      ["DEX-0", "DEX-1", "DEX-2"],
      expect.any(Object)
    );
    // DEX-0 → delivered (mapped), but transition from dispatched → delivered
    // will invoke applyFulfillment, which in real life would throw;
    // here we're mocking applyFulfillment to succeed so processed counts go up.
    expect(deps.applyFulfillment).toHaveBeenCalledTimes(2);
    // DEX-2 not in response → logged as ignored (tracking not returned)
    expect(deps.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tracking_number: "DEX-2",
        outcome: "ignored",
        outcome_reason: expect.stringContaining("not_in_response"),
      })
    );
    const dex = results.find((r) => r.carrierCode === "dexpress")!;
    expect(dex.polled).toBe(3);
    expect(dex.processed).toBe(2);
    expect(dex.ignored).toBe(1);
  });

  test("ignores Dexpress entries with unknown status_key", async () => {
    const orders: OpenOrderForPoll[] = [
      {
        order_id: "o1",
        tracking_number: "DEX-1",
        status: "dispatched",
        carrier_code: "dexpress",
        api_credentials: "enc:x",
        api_endpoint: "https://api.shippingeyes.com",
      },
    ];
    const deps = createDeps({
      fetchOpenOrders: vi.fn().mockResolvedValue(orders),
      fetchDexpressBatch: vi.fn().mockResolvedValue({
        code: 4000,
        data: [
          { order_snum: "DEX-1", status_key: 7, name_status: "فى الشركة" },
        ],
      }),
    });

    await runPollCycle(deps);

    expect(deps.applyFulfillment).not.toHaveBeenCalled();
    expect(deps.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "ignored",
        outcome_reason: expect.stringContaining("unknown_dexpress_status_key"),
      })
    );
  });

  test("logs error when entire Dexpress batch throws", async () => {
    const orders: OpenOrderForPoll[] = [
      {
        order_id: "o1",
        tracking_number: "DEX-1",
        status: "dispatched",
        carrier_code: "dexpress",
        api_credentials: "enc:x",
        api_endpoint: "https://api.shippingeyes.com",
      },
    ];
    const deps = createDeps({
      fetchOpenOrders: vi.fn().mockResolvedValue(orders),
      fetchDexpressBatch: vi
        .fn()
        .mockRejectedValue(new Error("502 Bad Gateway")),
    });

    const results = await runPollCycle(deps);

    expect(deps.applyFulfillment).not.toHaveBeenCalled();
    expect(deps.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "error",
        outcome_reason: expect.stringContaining("502"),
      })
    );
    const dex = results.find((r) => r.carrierCode === "dexpress")!;
    expect(dex.errored).toBe(1);
  });

  test("returns separate per-carrier aggregates", async () => {
    const orders: OpenOrderForPoll[] = [
      makeOrder({ order_id: "n1", tracking_number: "N-1", carrier_code: "navex" }),
      {
        order_id: "d1",
        tracking_number: "D-1",
        status: "dispatched",
        carrier_code: "dexpress",
        api_credentials: "enc:x",
        api_endpoint: "https://api.shippingeyes.com",
      },
    ];
    const deps = createDeps({
      fetchOpenOrders: vi.fn().mockResolvedValue(orders),
      fetchNavexStatus: vi.fn().mockResolvedValue({ etat: "En cours" }),
      fetchDexpressBatch: vi.fn().mockResolvedValue({
        code: 4000,
        data: [{ order_snum: "D-1", status_key: 1, name_status: "عند العميل" }],
      }),
    });

    const results = await runPollCycle(deps);
    expect(results).toHaveLength(2);
    const byCode = Object.fromEntries(results.map((r) => [r.carrierCode, r]));
    expect(byCode.navex.polled).toBe(1);
    expect(byCode.dexpress.polled).toBe(1);
  });
});
