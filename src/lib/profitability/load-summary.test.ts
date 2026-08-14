import { describe, it, expect, vi } from "vitest";
import { loadProfitabilitySummary } from "./load-summary";

// Builds a supabase stub whose:
//  - .rpc("get_profitability_summary", ...).maybeSingle() resolves to `aggData`
//  - .from("orders")...(head count) resolves to { count: leadsCount }
//  - .from("ad_spend")...select("amount") resolves to { data: adSpendRows }
function makeSupabase(opts: {
  aggData: Record<string, number | string> | null;
  aggError?: { message: string } | null;
  leadsCount: number;
  adSpendRows: { amount: number | string }[];
}) {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];

  const rpc = vi.fn((fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    return {
      maybeSingle: vi.fn(async () => ({
        data: opts.aggData,
        error: opts.aggError ?? null,
      })),
    };
  });

  const from = vi.fn((table: string) => {
    if (table === "orders") {
      // chainable, terminal is awaited directly -> { count }
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = vi.fn(chain);
      builder.eq = vi.fn(chain);
      builder.gte = vi.fn(chain);
      builder.lte = vi.fn(chain);
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({ count: opts.leadsCount, error: null });
      return builder;
    }
    if (table === "ad_spend") {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = vi.fn(chain);
      builder.eq = vi.fn(chain);
      builder.is = vi.fn(chain);
      builder.gte = vi.fn(chain);
      builder.lte = vi.fn(chain);
      // The read carries a total order (period columns are tie-heavy once spend
      // is daily), so the double has to accept .order() or it stops modelling
      // the query under test.
      builder.order = vi.fn(chain);
      // An un-ranged read is capped at 1000 rows by PostgREST, with no error to
      // mark the truncation — reproduce that, so a >1000-row fixture actually
      // catches an unpaged read instead of quietly passing.
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: opts.adSpendRows.slice(0, 1000), error: null });
      // fetchAllRows pages with .range(from, to). PostgREST's bounds are
      // inclusive on both ends, so mirror that — otherwise a >1000-row fixture
      // would not exercise the second page the way production does.
      builder.range = vi.fn((from: number, to: number) => ({
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: opts.adSpendRows.slice(from, to + 1), error: null }),
      }));
      return builder;
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { supabase: { rpc, from } as never, rpcCalls };
}

describe("loadProfitabilitySummary", () => {
  it("maps RPC cents (as strings) to decimal money and computes net profit + margin", async () => {
    // LY 30-day known-good numbers, cents as strings (how PostgREST serializes BIGINT).
    const { supabase, rpcCalls } = makeSupabase({
      aggData: {
        revenue_cents: "4988600",
        cogs_cents: "761399",
        delivery_cost_cents: "278000",
        return_cost_cents: "39500",
        packing_cost_cents: "18650",
        delivered_count: 278,
        returned_count: 79,
        confirmed_count: 996,
      },
      leadsCount: 1619,
      adSpendRows: [{ amount: 0 }],
    });

    const out = await loadProfitabilitySummary(
      supabase,
      "00000000-0000-0000-0000-000000000002",
      "2026-06-07",
      "2026-07-06",
    );

    // exact-number parity with the legacy JS path
    expect(out.revenue).toBe(49886);
    expect(out.cogs).toBe(7613.99);
    expect(out.delivery_cost).toBe(2780);
    expect(out.return_cost).toBe(395);
    expect(out.packing_cost).toBe(186.5);
    expect(out.ad_spend).toBe(0);
    // net = 49886 - 7613.99 - 2780 - 395 - 186.5 - 0
    expect(out.net_profit).toBe(38910.51);
    expect(out.margin).toBe(78.0); // round((38910.51/49886)*1000)/10
    expect(out.delivered_count).toBe(278);
    expect(out.returned_count).toBe(79);
    expect(out.confirmed_count).toBe(996);
    expect(out.leads_count).toBe(1619);

    // passes the correct RPC name + dateLte upper bound
    expect(rpcCalls[0].fn).toBe("get_profitability_summary");
    expect(rpcCalls[0].args).toMatchObject({
      p_market_id: "00000000-0000-0000-0000-000000000002",
      p_from_date: "2026-06-07",
      p_to_date: "2026-07-06T23:59:59.999Z",
    });
  });

  it("sums ad_spend rows and folds it into net profit", async () => {
    const { supabase } = makeSupabase({
      aggData: {
        revenue_cents: "100000", // 1000
        cogs_cents: "0",
        delivery_cost_cents: "0",
        return_cost_cents: "0",
        packing_cost_cents: "0",
        delivered_count: 10,
        returned_count: 0,
        confirmed_count: 10,
      },
      leadsCount: 20,
      adSpendRows: [{ amount: 100 }, { amount: "150.5" }],
    });

    const out = await loadProfitabilitySummary(supabase, "m", "2026-01-01", "2026-01-31");
    expect(out.revenue).toBe(1000);
    expect(out.ad_spend).toBe(250.5);
    expect(out.net_profit).toBe(749.5);
  });

  // Daily campaign rows put ad_spend past PostgREST's 1000-row cap within
  // months. Before this was paged, the sum below stopped at 1000 — understating
  // spend and so overstating net profit, with no error to reveal it.
  it("sums every ad_spend row past the 1000-row PostgREST cap", async () => {
    const { supabase } = makeSupabase({
      aggData: {
        revenue_cents: "1000000", // 10000
        cogs_cents: "0",
        delivery_cost_cents: "0",
        return_cost_cents: "0",
        packing_cost_cents: "0",
        delivered_count: 0,
        returned_count: 0,
        confirmed_count: 0,
      },
      leadsCount: 0,
      adSpendRows: Array.from({ length: 1500 }, () => ({ amount: 1 })),
    });

    const out = await loadProfitabilitySummary(supabase, "m", "2026-01-01", "2026-06-30");
    expect(out.ad_spend).toBe(1500);
    expect(out.net_profit).toBe(8500);
  });

  it("returns all-zeros when the RPC yields no row (guard blocked / empty window)", async () => {
    const { supabase } = makeSupabase({
      aggData: null,
      leadsCount: 0,
      adSpendRows: [],
    });

    const out = await loadProfitabilitySummary(supabase, "m", "2026-01-01", "2026-01-31");
    expect(out).toEqual({
      revenue: 0,
      cogs: 0,
      delivery_cost: 0,
      return_cost: 0,
      packing_cost: 0,
      ad_spend: 0,
      net_profit: 0,
      margin: 0,
      delivered_count: 0,
      returned_count: 0,
      confirmed_count: 0,
      leads_count: 0,
    });
  });

  it("throws when the RPC returns an error", async () => {
    const { supabase } = makeSupabase({
      aggData: null,
      aggError: { message: "boom" },
      leadsCount: 0,
      adSpendRows: [],
    });
    await expect(
      loadProfitabilitySummary(supabase, "m", "2026-01-01", "2026-01-31"),
    ).rejects.toThrow("boom");
  });
});
