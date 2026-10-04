import { describe, it, expect, vi } from "vitest";
import { applyOrderListFilters, inList, type FilterBuilder, type ListQueryContext } from "@/lib/orders/list-query";
import { listQuerySchema } from "@/lib/orders/list-filters";
import { ARCHIVE_STATUSES } from "@/lib/orders/archive-scope";

/** A self-returning PostgREST stub that records every filter call. */
function chain() {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ["eq", "neq", "in", "is", "not", "or", "gte", "lt", "lte"]) c[m] = vi.fn(() => c);
  return c as unknown as FilterBuilder & Record<string, ReturnType<typeof vi.fn>>;
}
const calls = (c: ReturnType<typeof chain>, m: string) => c[m].mock.calls;
const q = (o: Record<string, string>) => listQuerySchema.parse(o);

const CTX: ListQueryContext = {
  marketId: "m-1",
  now: new Date("2026-10-04T15:00:00Z"),
  todayStartIso: "2026-10-03T22:00:00.000Z",
  uploadedTodayIds: ["o-1", "o-2"],
  archiveAfterDays: 30,
};

describe("applyOrderListFilters — the working list", () => {
  it("hides archived and deleted orders, pinned to the market", () => {
    const c = chain();
    applyOrderListFilters(c, q({}), CTX);
    expect(calls(c, "eq")).toContainEqual(["market_id", "m-1"]);
    expect(calls(c, "is")).toContainEqual(["archived_at", null]);
    expect(calls(c, "neq")).toContainEqual(["status", "deleted"]);
  });

  it("Non assignées = pending AND no agent (the count and the list agree)", () => {
    const c = chain();
    applyOrderListFilters(c, q({ preset: "unassigned" }), CTX);
    expect(calls(c, "eq")).toContainEqual(["status", "pending"]);
    expect(calls(c, "is")).toContainEqual(["assigned_to", null]);
  });

  it("À rappeler = the three attempts and every scheduled callback", () => {
    const c = chain();
    applyOrderListFilters(c, q({ preset: "recall" }), CTX);
    expect(calls(c, "in")).toContainEqual(["status", ["attempt_1", "attempt_2", "attempt_3", "callback_scheduled"]]);
  });

  it("Reçues aujourd'hui opens at the market's midnight", () => {
    const c = chain();
    applyOrderListFilters(c, q({ preset: "today" }), CTX);
    expect(calls(c, "gte")).toContainEqual(["created_at", CTX.todayStartIso]);
  });

  it("Téléchargées aujourd'hui is the set of orders uploaded since midnight", () => {
    const c = chain();
    applyOrderListFilters(c, q({ preset: "uploaded_today" }), CTX);
    expect(calls(c, "in")).toContainEqual(["id", ["o-1", "o-2"]]);
  });

  it("reads multi-value facets, with « none » meaning NULL", () => {
    const c = chain();
    applyOrderListFilters(
      c,
      q({ agent_id: "a1,unassigned", storefront_id: "s1,s2", city: "Tripoli,none", product_id: "p1", carrier_id: "none" }),
      CTX,
    );
    expect(calls(c, "or")).toContainEqual(['assigned_to.is.null,assigned_to.in.("a1")']);
    expect(calls(c, "in")).toContainEqual(["storefront_id", ["s1", "s2"]]);
    expect(calls(c, "or")).toContainEqual(['customer_city.is.null,customer_city.eq."",customer_city.in.("Tripoli")']);
    expect(calls(c, "in")).toContainEqual(["product_id", ["p1"]]);
    expect(calls(c, "is")).toContainEqual(["carrier_id", null]);
  });

  it("a single agent is a plain equality list, an only-unassigned pick is IS NULL", () => {
    const a = chain();
    applyOrderListFilters(a, q({ agent_id: "a1,a2" }), CTX);
    expect(calls(a, "in")).toContainEqual(["assigned_to", ["a1", "a2"]]);
    const b = chain();
    applyOrderListFilters(b, q({ agent_id: "unassigned" }), CTX);
    expect(calls(b, "is")).toContainEqual(["assigned_to", null]);
  });

  it("the status menu narrows with IN", () => {
    const c = chain();
    applyOrderListFilters(c, q({ status: "pending,confirmed" }), CTX);
    expect(calls(c, "in")).toContainEqual(["status", ["pending", "confirmed"]]);
  });
});

describe("applyOrderListFilters — Archivées", () => {
  it("Prêtes à ranger = finished before the cut-off and still in the list", () => {
    const c = chain();
    applyOrderListFilters(c, q({ scope: "archive" }), CTX);
    expect(calls(c, "not")).toContainEqual(["terminal_at", "is", null]);
    expect(calls(c, "is")).toContainEqual(["archived_at", null]);
    expect(calls(c, "lt")).toContainEqual(["terminal_at", "2026-09-04T15:00:00.000Z"]);
    expect(calls(c, "in")).toContainEqual(["status", ARCHIVE_STATUSES.filter((s) => s !== "deleted")]);
  });

  it("Encore récentes = finished after the cut-off", () => {
    const c = chain();
    applyOrderListFilters(c, q({ scope: "archive", state: "recent" }), CTX);
    expect(calls(c, "gte")).toContainEqual(["terminal_at", "2026-09-04T15:00:00.000Z"]);
  });

  it("Déjà rangées = archived_at is set", () => {
    const c = chain();
    applyOrderListFilters(c, q({ scope: "archive", state: "archived" }), CTX);
    expect(calls(c, "not")).toContainEqual(["archived_at", "is", null]);
  });

  it("Supprimées = every soft-deleted order, archived or not", () => {
    const c = chain();
    applyOrderListFilters(c, q({ scope: "archive", state: "deleted" }), CTX);
    expect(calls(c, "eq")).toContainEqual(["status", "deleted"]);
    expect(calls(c, "is")).not.toContainEqual(["archived_at", null]);
    expect(calls(c, "not")).not.toContainEqual(["terminal_at", "is", null]);
  });

  it("the Issue menu narrows the outcomes, never to a live status", () => {
    const c = chain();
    applyOrderListFilters(c, q({ scope: "archive", status: "delivered,pending" }), CTX);
    expect(calls(c, "in")).toContainEqual(["status", ["delivered"]]);
  });

  it("shortcuts do not apply in the archive", () => {
    const c = chain();
    applyOrderListFilters(c, q({ scope: "archive", preset: "unassigned" }), CTX);
    expect(calls(c, "eq")).not.toContainEqual(["status", "pending"]);
  });
});

describe("inList", () => {
  it("quotes values so commas, quotes and parentheses survive", () => {
    expect(inList(['Bir "X", (sud)', "Tripoli"])).toBe('("Bir \\"X\\", (sud)","Tripoli")');
  });
});
