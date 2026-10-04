import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setLastRowForStorefront } from "./sync-state";

function client(rpcResult: { error: unknown }, current: Record<string, unknown> = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: current } }) }) }) }),
    upsert,
  }));
  return { rpc, from, upsert, c: { rpc, from } as unknown as SupabaseClient };
}

describe("setLastRowForStorefront", () => {
  it("writes ONE key atomically in Postgres, never the whole object from a stale copy", async () => {
    const { rpc, upsert, c } = client({ error: null });
    await setLastRowForStorefront(c, "m-ly", "sf-b", 5422);
    expect(rpc).toHaveBeenCalledWith("set_sheet_cursor", { p_market_id: "m-ly", p_storefront_id: "sf-b", p_last_row: 5422 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("falls back to the old write only while the function is not deployed yet", async () => {
    const { upsert, c } = client({ error: { code: "PGRST202", message: "Could not find the function" } }, { "sf-a": { last_row: 7 } });
    await setLastRowForStorefront(c, "m-ly", "sf-b", 9);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ value: { "sf-a": { last_row: 7 }, "sf-b": { last_row: 9 } } }),
      { onConflict: "market_id,key" },
    );
  });

  it("throws on any other failure — a cursor that silently did not move is how the sync stalled for four days", async () => {
    const { c } = client({ error: { code: "57014", message: "statement timeout" } });
    await expect(setLastRowForStorefront(c, "m-ly", "sf-b", 9)).rejects.toThrow(/statement timeout/);
  });
});
