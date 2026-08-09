import { describe, test, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mockMarketIdToCode = vi.fn();
vi.mock("@/lib/markets", () => ({
  marketIdToCode: (id: string | null | undefined) => mockMarketIdToCode(id),
}));

import { recommendCarrierForOrder } from "./recommend-carrier-for-order";

const LY = "market-ly";
const TN = "market-tn";
const TRIPOLI = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69";
const BENGHAZI = "43077d36-3d61-40d6-ae35-59ed15cec8f7";

const CARRIERS = [
  {
    id: TRIPOLI,
    name: "Darb Assabil - Tripoli",
    code: "darb_assabil",
    delivery_fee: 10,
    return_fee: 5,
  },
  {
    id: BENGHAZI,
    name: "Darb Assabil — Benghazi",
    code: "darb_assabil",
    delivery_fee: 10,
    return_fee: 5,
  },
];

interface ClientOpts {
  carriers?: unknown[];
  carriersError?: { message: string } | null;
  rates?: unknown[];
  trueCost?: unknown[];
}

/** Minimal Supabase double: `carriers` / `darb_shipping_rates` tables + one RPC. */
function makeClient(opts: ClientOpts = {}) {
  const calls: { table: string; filters: Array<[string, unknown]> }[] = [];

  const rpc = vi.fn().mockResolvedValue({ data: opts.trueCost ?? [], error: null });

  const from = vi.fn((table: string) => {
    const record = { table, filters: [] as Array<[string, unknown]> };
    calls.push(record);
    const rows =
      table === "carriers" ? (opts.carriers ?? CARRIERS) : (opts.rates ?? []);
    const error = table === "carriers" ? (opts.carriersError ?? null) : null;

    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = vi.fn(self);
    chain.eq = vi.fn((col: string, val: unknown) => {
      record.filters.push([col, val]);
      return chain;
    });
    chain.in = vi.fn((col: string, val: unknown) => {
      record.filters.push([col, val]);
      return chain;
    });
    chain.order = vi.fn(() => Promise.resolve({ data: rows, error }));
    chain.then = (cb: (v: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(cb);
    return chain;
  });

  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMarketIdToCode.mockImplementation((id: string) => (id === LY ? "ly" : "tn"));
});

describe("recommendCarrierForOrder", () => {
  test("returns none for a non-Libya market without touching the database", async () => {
    const { client, from, rpc } = makeClient();
    const r = await recommendCarrierForOrder(client, {
      market_id: TN,
      city: "Tunis",
      area: null,
    });
    expect(r).toEqual({ carrier_id: null, reason: "none", ranked: [] });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  test("returns none when the order has no resolved city", async () => {
    const { client, from } = makeClient();
    const r = await recommendCarrierForOrder(client, { market_id: LY, city: null, area: null });
    expect(r.reason).toBe("none");
    expect(from).not.toHaveBeenCalled();
  });

  test("recommends the cheaper quoted account", async () => {
    // Real probed بنغازي figures: Tripoli 30, Benghazi 10.
    const { client } = makeClient({
      rates: [
        rate(TRIPOLI, "بنغازي", "بنغازي", 30),
        rate(BENGHAZI, "بنغازي", "بنغازي", 10),
      ],
    });
    const r = await recommendCarrierForOrder(client, {
      market_id: LY,
      city: "بنغازي",
      area: "بنغازي",
    });
    expect(r.carrier_id).toBe(BENGHAZI);
    expect(r.reason).toBe("quote");
  });

  test("recommends Tripoli in the west", async () => {
    const { client } = makeClient({
      rates: [
        rate(TRIPOLI, "طرابلس", "الرياضية", 15),
        rate(BENGHAZI, "طرابلس", "الرياضية", 20),
      ],
    });
    const r = await recommendCarrierForOrder(client, {
      market_id: LY,
      city: "طرابلس",
      area: "الرياضية",
    });
    expect(r.carrier_id).toBe(TRIPOLI);
  });

  test("scopes the rate query to the order's city", async () => {
    const { client, calls } = makeClient({ rates: [] });
    await recommendCarrierForOrder(client, { market_id: LY, city: "درنة", area: "درنة" });
    const rateCall = calls.find((c) => c.table === "darb_shipping_rates");
    expect(rateCall?.filters).toContainEqual(["city", "درنة"]);
  });

  test("breaks a quote tie on the historical true cost", async () => {
    // سبها quotes 35 from both accounts.
    const { client } = makeClient({
      rates: [rate(TRIPOLI, "سبها", "سبها", 35), rate(BENGHAZI, "سبها", "سبها", 35)],
      trueCost: [
        { carrier_id: TRIPOLI, delivered: 100, returned: 33, delivery_cost: 1000, return_cost: 165 },
        { carrier_id: BENGHAZI, delivered: 500, returned: 73, delivery_cost: 5000, return_cost: 365 },
      ],
    });
    const r = await recommendCarrierForOrder(client, { market_id: LY, city: "سبها", area: "سبها" });
    expect(r.reason).toBe("quote_tie_true_cost");
    expect(r.carrier_id).toBe(BENGHAZI); // 10.73 vs 11.65
  });

  test("abandons the price comparison when only one account has a rate", async () => {
    const { client } = makeClient({
      rates: [rate(TRIPOLI, "درنة", "درنة", 40)],
      trueCost: [
        { carrier_id: TRIPOLI, delivered: 100, returned: 33, delivery_cost: 1000, return_cost: 165 },
        { carrier_id: BENGHAZI, delivered: 500, returned: 73, delivery_cost: 5000, return_cost: 365 },
      ],
    });
    const r = await recommendCarrierForOrder(client, { market_id: LY, city: "درنة", area: "درنة" });
    expect(r.reason).toBe("true_cost");
    expect(r.carrier_id).toBe(BENGHAZI);
  });

  test("ranked carries every candidate with its quoted fee", async () => {
    const { client } = makeClient({
      rates: [
        rate(TRIPOLI, "بنغازي", "بنغازي", 30),
        rate(BENGHAZI, "بنغازي", "بنغازي", 10),
      ],
    });
    const r = await recommendCarrierForOrder(client, {
      market_id: LY,
      city: "بنغازي",
      area: "بنغازي",
    });
    expect(r.ranked).toHaveLength(2);
    expect(r.ranked[0]).toMatchObject({ carrierId: BENGHAZI, quotedFee: 10, isCheapest: true });
  });

  // Intake must never fail because of a rate lookup. An order without a
  // recommendation is fine; an order that does not arrive is a lost sale.
  test("swallows a database error and returns none", async () => {
    const { client } = makeClient({ carriersError: { message: "connection reset" } });
    const r = await recommendCarrierForOrder(client, {
      market_id: LY,
      city: "بنغازي",
      area: "بنغازي",
    });
    expect(r).toEqual({ carrier_id: null, reason: "none", ranked: [] });
  });

  test("swallows a thrown client error and returns none", async () => {
    const client = {
      from: () => {
        throw new Error("boom");
      },
      rpc: vi.fn(),
    } as unknown as SupabaseClient;
    const r = await recommendCarrierForOrder(client, {
      market_id: LY,
      city: "بنغازي",
      area: "بنغازي",
    });
    expect(r.reason).toBe("none");
  });

  test("tolerates the true-cost RPC failing and still ranks on quotes", async () => {
    const { client, rpc } = makeClient({
      rates: [
        rate(TRIPOLI, "بنغازي", "بنغازي", 30),
        rate(BENGHAZI, "بنغازي", "بنغازي", 10),
      ],
    });
    (rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: "no such function" },
    });
    const r = await recommendCarrierForOrder(client, {
      market_id: LY,
      city: "بنغازي",
      area: "بنغازي",
    });
    expect(r.carrier_id).toBe(BENGHAZI);
  });

  test("returns none when the market has no Darb carriers", async () => {
    const { client } = makeClient({ carriers: [] });
    const r = await recommendCarrierForOrder(client, {
      market_id: LY,
      city: "بنغازي",
      area: "بنغازي",
    });
    expect(r.reason).toBe("none");
  });

  test("ignores non-Darb carriers — their prices are not comparable", async () => {
    const { client } = makeClient({
      carriers: [
        ...CARRIERS,
        { id: "c-dexpress", name: "Dexpress", code: "dexpress", delivery_fee: 15, return_fee: 5 },
      ],
      rates: [
        rate(TRIPOLI, "بنغازي", "بنغازي", 30),
        rate(BENGHAZI, "بنغازي", "بنغازي", 10),
      ],
    });
    const r = await recommendCarrierForOrder(client, {
      market_id: LY,
      city: "بنغازي",
      area: "بنغازي",
    });
    expect(r.ranked.map((c) => c.carrierId)).not.toContain("c-dexpress");
  });
});

function rate(carrierId: string, city: string, area: string, amount: number | null) {
  return {
    carrier_id: carrierId,
    city,
    area,
    shipping_amount: amount,
    currency: "lyd",
    last_success_at: amount == null ? null : new Date().toISOString(),
  };
}
