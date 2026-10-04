import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadListContext, readArchiveAfterDays, readUploadedSince } from "@/lib/orders/list-context";
import { listQuerySchema } from "@/lib/orders/list-filters";

function client(tables: Record<string, unknown>) {
  const calls: unknown[][] = [];
  const from = vi.fn((table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "limit"]) c[m] = (...a: unknown[]) => (calls.push([table, m, ...a]), c);
    c.single = () => Promise.resolve({ data: tables[table] ?? null });
    c.then = (fn: (v: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [] }).then(fn);
    return c;
  });
  return { sb: { from } as unknown as SupabaseClient, calls, from };
}

describe("list context", () => {
  it("reads today's uploads from the history, once per order", async () => {
    const { sb, calls } = client({ order_history: [{ order_id: "a" }, { order_id: "a" }, { order_id: "b" }] });
    expect(await readUploadedSince(sb, "m", "2026-10-03T22:00:00Z")).toEqual(["a", "b"]);
    expect(calls).toContainEqual(["order_history", "eq", "status_to", "uploaded"]);
    expect(calls).toContainEqual(["order_history", "gte", "created_at", "2026-10-03T22:00:00Z"]);
  });

  it("an archive rule that is off still splits the tabs at 30 days", async () => {
    expect(await readArchiveAfterDays(client({ settings: { value: 0 } }).sb, "m")).toBe(30);
    expect(await readArchiveAfterDays(client({ settings: { value: 45 } }).sb, "m")).toBe(45);
  });

  it("touches the database only for what the query needs", async () => {
    const { sb, from } = client({});
    await loadListContext(sb, listQuerySchema.parse({}), "m");
    expect(from).not.toHaveBeenCalled();
  });
});
