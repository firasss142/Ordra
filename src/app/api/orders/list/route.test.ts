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
import { LY_MARKET_ID } from "@/lib/markets";
import { marketDayStartUtc, todayInMarket } from "@/lib/dates/market-day";

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
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
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

/**
 * The filters themselves are pinned in lib/orders/__tests__/list-query.test.ts;
 * these check that the route hands the query to them with the right context.
 */
describe("GET /api/orders/list — scope and context", () => {
  test("the working list hides archived and deleted orders", async () => {
    const orders = runAs();
    await GET(createRequest());
    expect(orders.is).toHaveBeenCalledWith("archived_at", null);
    expect(orders.neq).toHaveBeenCalledWith("status", "deleted");
  });

  test("Archivées reads the market's archive delay for its cut-off", async () => {
    const orders = runAs();
    await GET(createRequest("?scope=archive&state=eligible"));
    expect(mockFrom).toHaveBeenCalledWith("settings");
    expect(orders.not).toHaveBeenCalledWith("terminal_at", "is", null);
    expect(callsFor(orders.lt, "terminal_at")).toHaveLength(1);
  });

  test("Supprimées shows every soft-deleted order", async () => {
    const orders = runAs();
    await GET(createRequest("?scope=archive&state=deleted"));
    expect(orders.eq).toHaveBeenCalledWith("status", "deleted");
    expect(orders.is).not.toHaveBeenCalledWith("archived_at", null);
  });

  test("Téléchargées aujourd'hui reads today's uploads from the history", async () => {
    const orders = runAs();
    await GET(createRequest("?preset=uploaded_today"));
    expect(mockFrom).toHaveBeenCalledWith("order_history");
    expect(callsFor(orders.in, "id")).toHaveLength(1);
  });

  test("status multi-select applies outside the archive", async () => {
    const orders = runAs();
    await GET(createRequest("?status=confirmed,uploaded"));
    expect(callsFor(orders.in, "status")[0][1]).toEqual(["confirmed", "uploaded"]);
  });

  test("agents are refused", async () => {
    runAs("agent");
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });
});

/**
 * Dates arrive as market-local calendar days and orders.created_at is UTC.
 * Libya is UTC+2: "2026-09-04" must open at 2026-09-03T22:00Z, not at UTC
 * midnight — otherwise every order placed between 22:00 and midnight in
 * Tripoli is counted on the next day. Reconciling against the Converty export
 * for 4–5 September, that boundary alone moved two orders across days.
 */
describe("GET /api/orders/list — date window in the market's local day", () => {
  test("date_from/date_to bound created_at at the Libyan day edges, in UTC", async () => {
    const orders = runAs("market_manager", LY_MARKET_ID);

    await GET(createRequest("?date_from=2026-09-04&date_to=2026-09-05"));

    expect(callsFor(orders.gte, "created_at")).toEqual([
      ["created_at", "2026-09-03T22:00:00.000Z"],
    ]);
    expect(callsFor(orders.lte, "created_at")).toEqual([
      ["created_at", "2026-09-05T21:59:59.999Z"],
    ]);
  });

  test("preset=today starts at the Libyan midnight, not the UTC one", async () => {
    const orders = runAs("market_manager", LY_MARKET_ID);

    await GET(createRequest("?preset=today"));

    const expected = marketDayStartUtc(todayInMarket(LY_MARKET_ID), LY_MARKET_ID);
    expect(callsFor(orders.gte, "created_at")).toEqual([["created_at", expected]]);
  });
});
