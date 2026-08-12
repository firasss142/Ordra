import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

const selectSpy = vi.fn();

/**
 * The PostgREST builder is a thenable that returns itself from every filter,
 * so one self-returning object stands in for the whole chain. Resolving with no
 * rows is deliberate: an empty page skips the enrichment RPCs entirely, which
 * keeps this test about the count and nothing else.
 */
function chain(count: number | null) {
  const c: Record<string, unknown> = {};
  for (const m of ["order", "limit", "eq", "neq", "in", "is", "or", "gte", "lte", "ilike"]) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  c.select = vi.fn((...args: unknown[]) => {
    selectSpy(...args);
    return c;
  });
  c.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null, count });
  return c;
}

let currentCount: number | null = 0;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: () => chain(currentCount),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import { encodeCursor } from "@/lib/orders/list-filters";
import { resetTestActor } from "@/test/helpers/actorMock";

function get(query: string) {
  return GET(
    new NextRequest(new URL(`/api/orders/list?${query}`, "http://localhost:3000")),
  );
}

/** The count option the route passes to `.select()`, if any. */
function selectOptions() {
  return selectSpy.mock.calls[0]?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  currentCount = 0;
});

describe("GET /api/orders/list — filtered total", () => {
  test("reports how many orders the filters match, not how many fit on the page", async () => {
    // The summary above the table used to count the loaded rows, so a page size
    // of 10 capped it at "10" however many orders matched.
    currentCount = 123;
    const res = await get("limit=10");
    const body = await res.json();

    expect(selectOptions()).toEqual({ count: "exact" });
    expect(body.total).toBe(123);
    expect(body.rows).toHaveLength(0);
  });

  test("does not recount on a cursor page", async () => {
    // The cursor is part of the WHERE clause, so a count taken with it applied
    // answers "how many are left below this row" — a different question, and
    // one that would make the total shrink as you paged through it.
    currentCount = 47;
    const res = await get(
      `limit=10&cursor=${encodeURIComponent(
        encodeCursor({ createdAt: "2026-05-20T14:32:00Z", id: "order-1" }),
      )}`,
    );
    const body = await res.json();

    expect(selectOptions()).toBeUndefined();
    expect(body.total).toBeNull();
  });
});
