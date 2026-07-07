import { describe, it, expect, vi } from "vitest";
import { getLatestActivityDate, REVENUE_RELEVANT_STATUSES } from "./latest-activity";

// Minimal chainable stub mimicking the PostgREST builder used by the helper:
//   supabase.from(...).select(...).order(...).limit(...).eq(...) → thenable
function makeSupabase(returnedRows: Array<{ created_at: string }>) {
  const calls: {
    table?: string;
    eqArgs: Array<[string, unknown]>;
    inArgs: Array<[string, unknown]>;
  } = { eqArgs: [], inArgs: [] };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.limit = vi.fn(chain);
  builder.in = vi.fn((col: string, val: unknown) => {
    calls.inArgs.push([col, val]);
    return builder;
  });
  builder.eq = vi.fn((col: string, val: unknown) => {
    calls.eqArgs.push([col, val]);
    return builder;
  });
  // Make the builder awaitable (thenable) resolving to { data, error }.
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: returnedRows, error: null });

  const supabase = {
    from: vi.fn((table: string) => {
      calls.table = table;
      return builder;
    }),
  };
  return { supabase, calls };
}

describe("getLatestActivityDate", () => {
  it("returns the date portion of the most recent order_history row for a market", async () => {
    const { supabase, calls } = makeSupabase([
      { created_at: "2026-04-27T16:57:06.893+00:00" },
    ]);
    const date = await getLatestActivityDate(supabase as never, "market-tn");
    expect(date).toBe("2026-04-27");
    expect(calls.table).toBe("order_history");
    // filters by the joined market
    expect(calls.eqArgs).toContainEqual(["orders.market_id", "market-tn"]);
    // filters to revenue-relevant statuses only (not any order_history churn)
    expect(calls.inArgs).toContainEqual(["status_to", REVENUE_RELEVANT_STATUSES]);
  });

  it("returns null when the market has no history", async () => {
    const { supabase } = makeSupabase([]);
    const date = await getLatestActivityDate(supabase as never, "market-empty");
    expect(date).toBeNull();
  });

  it('does NOT filter by market when marketId is "all" (global max)', async () => {
    const { supabase, calls } = makeSupabase([
      { created_at: "2026-07-06T18:55:34.416+00:00" },
    ]);
    const date = await getLatestActivityDate(supabase as never, "all");
    expect(date).toBe("2026-07-06");
    expect(calls.eqArgs.find(([c]) => c === "orders.market_id")).toBeUndefined();
  });

  it("does NOT filter by market when marketId is null", async () => {
    const { supabase, calls } = makeSupabase([{ created_at: "2026-07-06T00:00:00Z" }]);
    await getLatestActivityDate(supabase as never, null);
    expect(calls.eqArgs.find(([c]) => c === "orders.market_id")).toBeUndefined();
  });
});
