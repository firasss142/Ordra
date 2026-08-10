import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function createRequest(url: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(new URL(url, "http://localhost:3000"), { method: "GET" } as any);
}

/**
 * A chain that is itself awaitable — mirrors PostgREST, where
 * `.select("*", { count: "exact", head: true }).eq(...)` resolves to
 * `{ count, error }` with no row payload at all.
 */
function countChain(count: number) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "eq", "in", "is", "gte", "lt", "lte", "not"]) {
    chain[m] = vi.fn(self);
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, count, error: null }).then(resolve);
  return chain;
}

function singleChain(row: unknown) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "eq", "in", "is", "gte", "lt", "lte", "not"]) {
    chain[m] = vi.fn(self);
  }
  chain.single = vi.fn().mockResolvedValue({ data: row, error: null });
  return chain;
}

/** Chains handed out for the `orders` table, so assertions can ignore the auth lookup. */
let orderChains: Record<string, unknown>[] = [];

/** Every orders query resolves to the same count — enough to prove aggregation is used. */
function setup(
  role: string,
  marketId: string | null,
  ordersCount: number,
  rate: {
    current_yes: number;
    current_total: number;
    prev_yes: number;
    prev_total: number;
  } = { current_yes: 106, current_total: 216, prev_yes: 60, prev_total: 200 },
) {
  orderChains = [];
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  mockRpc.mockResolvedValue({ data: [rate], error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return singleChain({ role, market_id: marketId });
    const chain = countChain(ordersCount);
    orderChains.push(chain);
    return chain;
  });
}

describe("GET /api/orders/status-counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("reports the true total, not a page of rows", async () => {
    // Libya really has 2578 orders. The previous implementation did
    // `.select("status")` and counted the returned array, which PostgREST
    // silently caps at 1000 — so the UI displayed "1000 au total" forever.
    setup("market_manager", "ly", 2578);

    const res = await GET(createRequest("/api/orders/status-counts"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.total).toBe(2578);
  });

  test("never fetches order rows to derive counts", async () => {
    setup("market_manager", "ly", 2578);

    await GET(createRequest("/api/orders/status-counts"));

    const selectCalls = orderChains.flatMap(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (chain) => (chain.select as any)?.mock?.calls ?? [],
    );

    expect(selectCalls.length).toBeGreaterThan(0);
    for (const call of selectCalls) {
      // Every count query must be head-only; fetching rows is what truncated.
      expect(call[1]).toMatchObject({ count: "exact", head: true });
    }
  });

  test("exposes the funnel tiles the KPI strip renders", async () => {
    setup("market_manager", "ly", 42);

    const res = await GET(createRequest("/api/orders/status-counts"));
    const body = await res.json();

    for (const key of [
      "unassigned",
      "today",
      "waiting",
      "toRecall",
      "confirmed",
      "uploaded",
      "total",
    ]) {
      expect(body.data, `missing ${key}`).toHaveProperty(key);
      expect(typeof body.data[key]).toBe("number");
    }
  });

  test("counts only orders still awaiting an agent as unassigned", async () => {
    // `assigned_to IS NULL` alone counts every order nobody was ever assigned to,
    // including delivered, rejected and cancelled ones. On Libya that reported
    // 188 where only 9 were actually waiting — the other 176 had already shipped
    // or settled. The sidebar badge filtered on `pending` and the tile did not,
    // so the same word meant two things 20x apart.
    setup("market_manager", "ly", 9);

    await GET(createRequest("/api/orders/status-counts"));

    const unassignedChain = orderChains.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (chain) => ((chain.is as any)?.mock?.calls ?? []).some((c: unknown[]) => c[0] === "assigned_to"),
    );

    expect(unassignedChain, "no unassigned query found").toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eqCalls = ((unassignedChain!.eq as any)?.mock?.calls ?? []) as unknown[][];
    expect(
      eqCalls.some((c) => c[0] === "status" && c[1] === "pending"),
      "the unassigned tile must be scoped to pending, like the sidebar badge",
    ).toBe(true);
  });

  test("dates the confirmation rate by the decision, not by the last write", async () => {
    // updated_at is "last touched". An order confirmed in May and delivered
    // yesterday landed in this week's numerator, and any bulk write re-dated
    // every row at once — which left Libya's previous window holding ONE order,
    // a 100% rate, and a confident "▼ 40.8" trend that was pure noise.
    // order_history is append-only, so the transition itself carries the date.
    setup("market_manager", "ly", 10);

    await GET(createRequest("/api/orders/status-counts"));

    expect(mockRpc).toHaveBeenCalledWith(
      "get_confirmation_rate_windows",
      expect.objectContaining({
        p_current_from: expect.any(String),
        p_prev_from: expect.any(String),
      }),
    );
  });

  test("derives both rates from distinct decisions", async () => {
    setup("market_manager", "ly", 10, {
      current_yes: 106,
      current_total: 216,
      prev_yes: 60,
      prev_total: 200,
    });

    const res = await GET(createRequest("/api/orders/status-counts"));
    const body = await res.json();

    expect(body.data.confirmationRate).toBe(49.1); // 106 / 216
    expect(body.data.confirmationRatePrev).toBe(30); // 60 / 200
    // The sample size travels with the rate so a reader can see what it is *of*.
    expect(body.data.confirmationSample).toBe(216);
  });

  test("reports no rate at all rather than a rate derived from nothing", async () => {
    // Libya's previous 7-day window genuinely holds zero decisions. Dividing by
    // it produced 100%, and 100% is indistinguishable from a perfect week.
    setup("market_manager", "ly", 10, {
      current_yes: 0,
      current_total: 0,
      prev_yes: 0,
      prev_total: 0,
    });

    const res = await GET(createRequest("/api/orders/status-counts"));
    const body = await res.json();

    expect(body.data.confirmationRate).toBeNull();
    expect(body.data.confirmationRatePrev).toBeNull();
    expect(body.data.confirmationSample).toBe(0);
  });

  test("rejects roles that cannot view orders", async () => {
    setup("agent", "ly", 10);

    const res = await GET(createRequest("/api/orders/status-counts"));

    expect(res.status).toBe(403);
  });
});
