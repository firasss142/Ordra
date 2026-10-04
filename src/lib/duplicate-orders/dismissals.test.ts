import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dropDismissedGroups, readDismissed, siblingsAfterDismissal } from "./dismissals";

const g = (...ids: string[]) => ({ key: ids.join("|"), members: ids.map((id) => ({ id })) });

describe("« Pas un doublon »", () => {
  it("a group whose every member was dismissed does not come back", () => {
    expect(dropDismissedGroups([g("a", "b"), g("c", "d")], new Set(["a", "b"]))).toEqual([g("c", "d")]);
  });

  it("a new copy arriving after the dismissal brings the group back", () => {
    expect(dropDismissedGroups([g("a", "b", "e")], new Set(["a", "b"]))).toHaveLength(1);
  });

  it("a dismissed order stops tagging its dismissed siblings, but not a new one", () => {
    const sib = [{ id: "b" }, { id: "e" }];
    expect(siblingsAfterDismissal("a", sib, new Set(["a", "b"]))).toEqual([{ id: "e" }]);
    expect(siblingsAfterDismissal("x", sib, new Set(["a", "b"]))).toEqual(sib);
  });

  it("reads the dismissals of the given orders only, in one query", async () => {
    const inFn = vi.fn().mockResolvedValue({ data: [{ order_id: "a" }], error: null });
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    const set = await readDismissed({ from } as unknown as SupabaseClient, ["a", "b", "a"]);
    expect(from).toHaveBeenCalledWith("duplicate_dismissals");
    expect(inFn).toHaveBeenCalledWith("order_id", ["a", "b"]);
    expect([...set]).toEqual(["a"]);
  });

  it("no ids, no query; a failed read hides nothing", async () => {
    const from = vi.fn(() => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: "x" } }) }) }));
    expect((await readDismissed({ from } as unknown as SupabaseClient, [])).size).toBe(0);
    expect(from).not.toHaveBeenCalled();
    expect((await readDismissed({ from } as unknown as SupabaseClient, ["a"])).size).toBe(0);
  });

  it("a client that throws hides nothing — duplicate tags never break on it", async () => {
    const from = vi.fn(() => { throw new Error("no table"); });
    expect((await readDismissed({ from } as unknown as SupabaseClient, ["a"])).size).toBe(0);
  });
});
