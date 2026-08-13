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

function createRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/orders/archive/summary");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET" });
}

function actorChain(role: string, marketId: string | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id: marketId }, error: null });
  return chain;
}

/** Shape the RPC returns — one snapshot, so total === sum(outcomes). */
const PAYLOAD = {
  total: 2050,
  shipped: 435,
  outcomes: { delivered: 342, returned: 93, rejected: 1387, cancelled: 228 },
  reasons: { injoignable: 403, refus_client: 427, non_renseigne: 235 },
  winback: { total: 403, never_called: 135, partial: 101, exhausted: 167, second_phone: 0 },
  cities: [{ city: "بنغازي", shipped: 105, returned: 34 }],
  speed: [{ status: "rejected", n: 1387, median_days: 1, p90_days: 6.7, same_day: 704 }],
  cohorts: [{ week: "2026-W25", delivered: 10, returned: 2, rejected: 40, cancelled: 5, total: 57 }],
  placement: { archived: 1734, in_list: 316 },
};

const DATES = { from_date: "2026-05-15", to_date: "2026-08-13" };

function runAs(role: string, marketId: string | null) {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  mockFrom.mockImplementation(() => actorChain(role, marketId));
  mockRpc.mockResolvedValue({ data: PAYLOAD, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/orders/archive/summary", () => {
  test("401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(createRequest(DATES))).status).toBe(401);
  });

  test("403 for agents", async () => {
    runAs("agent", "m-1");
    expect((await GET(createRequest(DATES))).status).toBe(403);
  });

  test("400 when dates are missing", async () => {
    runAs("market_manager", "m-1");
    expect((await GET(createRequest())).status).toBe(400);
  });

  test("400 when a super_admin does not name a market", async () => {
    runAs("super_admin", null);
    expect((await GET(createRequest(DATES))).status).toBe(400);
  });

  test("returns the snapshot and passes the filters through", async () => {
    runAs("market_manager", "m-1");

    const res = await GET(
      createRequest({ ...DATES, status: "rejected,returned", q: "0912", rejection_reason: "injoignable" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual(PAYLOAD);

    const [fn, args] = mockRpc.mock.calls[0];
    expect(fn).toBe("get_archive_summary");
    expect(args).toMatchObject({
      p_market_id: "m-1",
      p_from_date: "2026-05-15",
      p_to_date: "2026-08-13",
      p_statuses: ["rejected", "returned"],
      p_q: "0912",
      p_rejection_reason: "injoignable",
    });
  });

  /**
   * The whole reason the summary moved into one SQL statement: the old route
   * counted `total` over a different set than the outcome tiles, so the
   * percentages could never sum to 100%.
   */
  test("the snapshot it returns is internally consistent", async () => {
    runAs("market_manager", "m-1");

    const body = await (await GET(createRequest(DATES))).json();
    const o = body.data.outcomes;

    expect(o.delivered + o.returned + o.rejected + o.cancelled).toBe(body.data.total);
  });

  test("an unknown status cannot widen the scope beyond the archive", async () => {
    runAs("market_manager", "m-1");

    await GET(createRequest({ ...DATES, status: "pending,delivered" }));

    expect(mockRpc.mock.calls[0][1].p_statuses).toEqual(["delivered"]);
  });

  test("omits the status filter entirely when none is asked for", async () => {
    runAs("market_manager", "m-1");

    await GET(createRequest(DATES));

    expect(mockRpc.mock.calls[0][1].p_statuses).toBeNull();
  });

  test("maps the database's market guard to a 403", async () => {
    runAs("market_manager", "m-1");
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Forbidden" } });

    expect((await GET(createRequest(DATES))).status).toBe(403);
  });
});
