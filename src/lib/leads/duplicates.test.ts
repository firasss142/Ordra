import { describe, it, expect, vi, beforeEach } from "vitest";
import { findPhoneDuplicates } from "./duplicates";
import type { DuplicateResult } from "./duplicates";

function makeSupabase(results: DuplicateResult[] = [], error: unknown = null) {
  const resolved = { data: results, error };
  // Each chainable method returns an object that is also a thenable (Promise-like)
  // so that `await query` works at any point in the chain.
  const builder: Record<string, unknown> = {};
  const thenable = {
    then: (resolve: (v: typeof resolved) => void) => resolve(resolved),
  };
  const select = vi.fn().mockReturnValue(builder);
  const ilike = vi.fn().mockReturnValue(builder);
  const eq = vi.fn().mockReturnValue(builder);
  const neq = vi.fn().mockReturnValue(builder);
  Object.assign(builder, { select, ilike, eq, neq, ...thenable });

  return {
    from: vi.fn().mockReturnValue(builder),
    _mocks: { select, ilike, eq, neq },
  };
}

describe("findPhoneDuplicates", () => {
  it("returns empty array when no matches", async () => {
    const sb = makeSupabase([]);
    const result = await findPhoneDuplicates(sb as never, "+216 22 333 444", "market-1");
    expect(result).toEqual([]);
  });

  it("returns matching leads", async () => {
    const match: DuplicateResult = {
      id: "lead-abc",
      customer_name: "Ali",
      status: "qualified",
      market_id: "market-1",
    };
    const sb = makeSupabase([match]);
    const result = await findPhoneDuplicates(sb as never, "+216 22 333 444", "market-1");
    expect(result).toEqual([match]);
  });

  it("calls ilike with normalised digits", async () => {
    const sb = makeSupabase([]);
    await findPhoneDuplicates(sb as never, "+216 22 333 444", "market-1");
    expect(sb._mocks.ilike).toHaveBeenCalledWith("customer_phone", "%22333444%");
  });

  it("filters by market_id", async () => {
    const sb = makeSupabase([]);
    await findPhoneDuplicates(sb as never, "22333444", "market-99");
    expect(sb._mocks.eq).toHaveBeenCalledWith("market_id", "market-99");
  });

  it("excludes a lead by id when excludeLeadId is provided", async () => {
    const sb = makeSupabase([]);
    await findPhoneDuplicates(sb as never, "22333444", "market-1", "exclude-lead-id");
    expect(sb._mocks.neq).toHaveBeenCalledWith("id", "exclude-lead-id");
  });

  it("returns empty array on DB error", async () => {
    const sb = makeSupabase([], { message: "DB error" });
    const result = await findPhoneDuplicates(sb as never, "22333444", "market-1");
    expect(result).toEqual([]);
  });
});
