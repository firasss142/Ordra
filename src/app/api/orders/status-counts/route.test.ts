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
function setup(role: string, marketId: string | null, ordersCount: number) {
  orderChains = [];
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
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

  test("returns a confirmation rate and a previous-period rate to trend against", async () => {
    setup("market_manager", "ly", 100);

    const res = await GET(createRequest("/api/orders/status-counts"));
    const body = await res.json();

    expect(body.data).toHaveProperty("confirmationRate");
    expect(body.data).toHaveProperty("confirmationRatePrev");
    // 100 confirmed of 100 resolved
    expect(body.data.confirmationRate).toBe(100);
  });

  test("counts orders that moved past confirmation as confirmed", async () => {
    // Confirmation is transient: a confirmed order becomes uploaded → scanned →
    // delivered. Measuring only orders still sitting in `confirmed` counts every
    // shipped order as a failure and reports ~7% where the truth is ~79%.
    setup("market_manager", "ly", 10);

    await GET(createRequest("/api/orders/status-counts"));

    const inArgs = orderChains.flatMap(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (chain) => ((chain.in as any)?.mock?.calls ?? []).map((c: unknown[]) => c[1] as string[]),
    );
    // The tile query and the rate numerator both contain "confirmed"; only the
    // numerator should also span the downstream fulfilment statuses.
    const numerator = inArgs.find(
      (list) => list.includes("confirmed") && !list.includes("rejected") && list.length > 2,
    );

    expect(numerator, "no confirmation-rate numerator query found").toBeDefined();
    for (const downstream of ["uploaded", "scanned", "dispatched", "in_transit", "delivered"]) {
      expect(numerator, `${downstream} must count as confirmed`).toContain(downstream);
    }
  });

  test("rejects roles that cannot view orders", async () => {
    setup("agent", "ly", 10);

    const res = await GET(createRequest("/api/orders/status-counts"));

    expect(res.status).toBe(403);
  });
});
