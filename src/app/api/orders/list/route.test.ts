import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import { ARCHIVE_STATUSES } from "@/lib/orders/archive-scope";

function createRequest(query = "") {
  return new NextRequest(new URL(`/api/orders/list${query}`, "http://localhost:3000"), {
    method: "GET",
  });
}

function actorChain(role: string, marketId: string | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id: marketId }, error: null });
  return chain;
}

/**
 * Self-returning PostgREST stub. Every filter method records its call and hands
 * the chain back; the terminal `await` resolves through `then`. Rows are empty
 * so the route's per-page enrichment short-circuits and needs no RPC stubs.
 */
function ordersChain() {
  const chain: Record<string, unknown> = {};
  const result = { data: [], error: null, count: 0 };
  for (const m of ["select", "eq", "neq", "in", "is", "not", "or", "gte", "gt", "lt", "lte", "ilike", "order", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (fn: (v: unknown) => unknown) => Promise.resolve(result).then(fn);
  return chain;
}

function runAs(role = "market_manager", marketId: string | null = "m-1") {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  const orders = ordersChain();
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return actorChain(role, marketId);
    return orders;
  });
  return orders;
}

const callsFor = (fn: unknown, column: string) =>
  (fn as ReturnType<typeof vi.fn>).mock.calls.filter((c: unknown[]) => c[0] === column);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/orders/list — scope=archive", () => {
  /**
   * The archive used to reach the terminal-status view through the
   * "Afficher supprimées" flag, which the route turns into
   * `.eq("status","deleted")`. ANDed with the archive's own status list, the
   * net predicate was `status = 'deleted'` — so the table could only ever
   * render soft-deleted orders while the summary above it counted all five
   * terminal statuses. These tests pin the two axes apart.
   */
  test("asks for every archive status and applies neither soft-delete branch", async () => {
    const orders = runAs();

    const res = await GET(createRequest("?scope=archive"));
    expect(res.status).toBe(200);

    const statusIn = callsFor(orders.in, "status");
    expect(statusIn).toHaveLength(1);
    expect(statusIn[0][1]).toEqual(ARCHIVE_STATUSES);
    expect(orders.eq).not.toHaveBeenCalledWith("status", "deleted");
    expect(orders.neq).not.toHaveBeenCalledWith("status", "deleted");
  });

  test("narrows to the requested outcomes", async () => {
    const orders = runAs();

    await GET(createRequest("?scope=archive&status=delivered,returned"));

    const statusIn = callsFor(orders.in, "status");
    expect(statusIn).toHaveLength(1);
    expect(statusIn[0][1]).toEqual(["delivered", "returned"]);
  });

  test("a non-terminal status cannot narrow or widen the archive", async () => {
    const orders = runAs();

    await GET(createRequest("?scope=archive&status=pending"));

    const statusIn = callsFor(orders.in, "status");
    expect(statusIn).toHaveLength(1);
    expect(statusIn[0][1]).toEqual(ARCHIVE_STATUSES);
    // The generic status multi-select must not run a second time in archive
    // scope: `.eq("status","pending")` here would collapse the view to nothing.
    expect(orders.eq).not.toHaveBeenCalledWith("status", "pending");
  });

  test("a single requested outcome still uses .in, never .eq", async () => {
    const orders = runAs();

    await GET(createRequest("?scope=archive&status=delivered"));

    expect(callsFor(orders.in, "status")[0][1]).toEqual(["delivered"]);
    expect(orders.eq).not.toHaveBeenCalledWith("status", "delivered");
  });
});

/**
 * Archiving is visibility only. `terminal_at` says when an order finished;
 * `archived_at` says when someone put it away. The working list hides what has
 * been put away; the archive reports on everything finished and splits it by
 * where it currently sits.
 */
describe("GET /api/orders/list — archived orders leave the working list", () => {
  test("the default orders list hides orders that were put away", async () => {
    const orders = runAs();

    await GET(createRequest());

    expect(orders.is).toHaveBeenCalledWith("archived_at", null);
  });

  test("the archive does not hide them", async () => {
    const orders = runAs();

    await GET(createRequest("?scope=archive"));

    expect(orders.is).not.toHaveBeenCalledWith("archived_at", null);
    // Membership is "has finished", not "has a terminal status" — the two are
    // the same set, but terminal_at is the indexed, date-comparable one.
    expect(orders.not).toHaveBeenCalledWith("terminal_at", "is", null);
  });

  test("state=archived shows only what was put away", async () => {
    const orders = runAs();

    await GET(createRequest("?scope=archive&state=archived"));

    expect(orders.not).toHaveBeenCalledWith("archived_at", "is", null);
    expect(orders.is).not.toHaveBeenCalledWith("archived_at", null);
  });

  test("state=eligible is finished long enough ago but still in the list", async () => {
    const orders = runAs();

    await GET(createRequest("?scope=archive&state=eligible"));

    expect(orders.is).toHaveBeenCalledWith("archived_at", null);
    const cutoff = callsFor(orders.lt, "terminal_at");
    expect(cutoff).toHaveLength(1);
    expect(Date.parse(String(cutoff[0][1]))).toBeLessThan(Date.now());
  });

  test("state=recent is finished too recently to be put away", async () => {
    const orders = runAs();

    await GET(createRequest("?scope=archive&state=recent"));

    expect(orders.is).toHaveBeenCalledWith("archived_at", null);
    expect(callsFor(orders.gte, "terminal_at")).toHaveLength(1);
  });
});

describe("GET /api/orders/list — the orders list is unchanged", () => {
  test("hides deleted orders by default", async () => {
    const orders = runAs();

    await GET(createRequest());

    expect(orders.neq).toHaveBeenCalledWith("status", "deleted");
    expect(orders.eq).not.toHaveBeenCalledWith("status", "deleted");
  });

  test("include_deleted=1 still shows only soft-deleted orders", async () => {
    const orders = runAs();

    await GET(createRequest("?include_deleted=1"));

    expect(orders.eq).toHaveBeenCalledWith("status", "deleted");
    expect(orders.neq).not.toHaveBeenCalledWith("status", "deleted");
  });

  test("status multi-select still applies outside the archive", async () => {
    const orders = runAs();

    await GET(createRequest("?status=confirmed,uploaded"));

    expect(callsFor(orders.in, "status")[0][1]).toEqual(["confirmed", "uploaded"]);
    expect(orders.neq).toHaveBeenCalledWith("status", "deleted");
  });

  test("agents are refused", async () => {
    runAs("agent");
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });
});
