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
import { LY_MARKET_ID } from "@/lib/markets";
import { marketDayStartUtc, todayInMarket } from "@/lib/dates/market-day";

function createRequest(url: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(new URL(url, "http://localhost:3000"), { method: "GET" } as any);
}

function singleChain(row: unknown) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "eq", "neq", "in", "is", "gte", "lt", "lte", "not"]) {
    chain[m] = vi.fn(self);
  }
  chain.single = vi.fn().mockResolvedValue({ data: row, error: null });
  return chain;
}

type KpiCounts = {
  total: number;
  unassigned: number;
  to_recall: number;
  uploaded: number;
  rejected: number;
  delivered: number;
  period_total: number;
};

const DEFAULT_COUNTS: KpiCounts = {
  total: 2578,
  unassigned: 9,
  to_recall: 40,
  uploaded: 3,
  rejected: 5,
  delivered: 7,
  period_total: 935,
};

/** The arguments the route passed to get_orders_kpi_counts, for window assertions. */
function kpiArgs(): Record<string, unknown> | undefined {
  const call = mockRpc.mock.calls.find((c) => c[0] === "get_orders_kpi_counts");
  return call?.[1] as Record<string, unknown> | undefined;
}

function setup(
  role: string,
  marketId: string | null,
  counts: Partial<KpiCounts> = {},
  rate: {
    current_yes: number;
    current_total: number;
    prev_yes: number;
    prev_total: number;
  } = { current_yes: 106, current_total: 216, prev_yes: 60, prev_total: 200 },
) {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  // One mock for both RPCs, dispatched by name — the route now calls two.
  mockRpc.mockImplementation((fn: string) => {
    if (fn === "get_orders_kpi_counts") {
      return Promise.resolve({ data: { ...DEFAULT_COUNTS, ...counts }, error: null });
    }
    if (fn === "get_confirmation_rate_windows") {
      return Promise.resolve({ data: [rate], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return singleChain({ role, market_id: marketId });
    return singleChain(null);
  });
}

describe("GET /api/orders/status-counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("reports the true total, not a page of rows", async () => {
    // Libya really has 2578 orders. An early implementation did
    // `.select("status")` and counted the returned array, which PostgREST
    // silently caps at 1000 — so the UI displayed "1000 au total" forever.
    setup("market_manager", "ly", { total: 2578 });

    const res = await GET(createRequest("/api/orders/status-counts"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.total).toBe(2578);
  });

  test("never fetches order rows to derive counts", async () => {
    setup("market_manager", "ly");

    await GET(createRequest("/api/orders/status-counts"));

    // The seven tiles come from ONE aggregate. Selecting rows is what
    // truncated; issuing seven head-counts is what made the strip slow.
    expect(mockFrom).not.toHaveBeenCalledWith("orders");
    expect(
      mockRpc.mock.calls.filter((c) => c[0] === "get_orders_kpi_counts"),
    ).toHaveLength(1);
  });

  test("asks the database once for the whole strip", async () => {
    setup("market_manager", "ly");

    await GET(createRequest("/api/orders/status-counts"));

    // Two round trips total: the counts and the confirmation rate. It was
    // seven head-counts plus the rate.
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  test("exposes the funnel tiles the KPI strip renders", async () => {
    setup("market_manager", "ly");

    const res = await GET(createRequest("/api/orders/status-counts"));
    const body = await res.json();

    for (const key of [
      "unassigned",
      "periodTotal",
      "toRecall",
      "uploaded",
      "rejected",
      "delivered",
      "total",
    ]) {
      expect(body.data, `missing ${key}`).toHaveProperty(key);
      expect(typeof body.data[key]).toBe("number");
    }
  });

  test("maps every count onto the field the strip reads", async () => {
    // A silent mis-mapping here would put the rejected count on the delivered
    // tile, so each value is distinct and checked individually.
    setup("market_manager", "ly", {
      total: 1,
      unassigned: 2,
      to_recall: 3,
      uploaded: 4,
      rejected: 5,
      delivered: 6,
      period_total: 7,
    });

    const body = await (await GET(createRequest("/api/orders/status-counts"))).json();

    expect(body.data).toMatchObject({
      total: 1,
      unassigned: 2,
      toRecall: 3,
      uploaded: 4,
      rejected: 5,
      delivered: 6,
      periodTotal: 7,
    });
  });

  test("the period total is counted over the requested window, not over today", async () => {
    // The tile it feeds used to be a fixed "Aujourd'hui": ask for August and
    // every other tile moved while this number stayed on the current day.
    setup("market_manager", LY_MARKET_ID, { period_total: 935 });

    const res = await GET(
      createRequest("/api/orders/status-counts?date_from=2026-08-01&date_to=2026-08-12"),
    );
    const body = await res.json();

    // The window is the market's local day. Libya is UTC+2, so 1 August opens
    // at 31 July 22:00Z and 12 August closes at 21:59:59.999Z — bounding on
    // UTC midnight counted every late-evening order on the following day.
    expect(kpiArgs()).toMatchObject({
      p_from: "2026-07-31T22:00:00.000Z",
      p_to: "2026-08-12T21:59:59.999Z",
    });
    expect(body.data.periodTotal).toBe(935);
    expect(body.data.window).toEqual({ from: "2026-08-01", to: "2026-08-12" });
  });

  test("with no window given, 'today' is the market's today, not the server's", async () => {
    setup("market_manager", LY_MARKET_ID);

    const res = await GET(createRequest("/api/orders/status-counts"));
    const body = await res.json();

    const today = todayInMarket(LY_MARKET_ID);
    expect(kpiArgs()).toMatchObject({
      p_from: marketDayStartUtc(today, LY_MARKET_ID),
    });
    expect(body.data.window).toEqual({ from: today, to: null });
  });

  test("scopes the counts to the market being asked about", async () => {
    setup("market_manager", LY_MARKET_ID);

    await GET(createRequest("/api/orders/status-counts"));

    expect(kpiArgs()).toMatchObject({ p_market_id: LY_MARKET_ID });
  });

  test("a super_admin with no market selected asks across all of them", async () => {
    setup("super_admin", null);

    await GET(createRequest("/api/orders/status-counts"));

    // NULL means "every market the caller may see" — RLS, not the route,
    // decides what that is.
    expect(kpiArgs()).toMatchObject({ p_market_id: null });
  });

  test("dates the confirmation rate by the decision, not by the last write", async () => {
    // updated_at is "last touched". An order confirmed in May and delivered
    // yesterday landed in this week's numerator, and any bulk write re-dated
    // every row at once — which left Libya's previous window holding ONE order,
    // a 100% rate, and a confident "▼ 40.8" trend that was pure noise.
    // order_history is append-only, so the transition itself carries the date.
    setup("market_manager", "ly");

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
    setup("market_manager", "ly", {}, {
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
    setup("market_manager", "ly", {}, {
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

  test("surfaces a failed count as an error, not as zeroes", async () => {
    // A strip of zeroes reads as "a quiet day", which is a lie the manager
    // would act on.
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockRpc.mockImplementation((fn: string) =>
      fn === "get_orders_kpi_counts"
        ? Promise.resolve({ data: null, error: { message: "boom" } })
        : Promise.resolve({ data: [{ current_yes: 0, current_total: 0, prev_yes: 0, prev_total: 0 }], error: null }),
    );
    mockFrom.mockImplementation(() => singleChain({ role: "market_manager", market_id: "ly" }));

    const res = await GET(createRequest("/api/orders/status-counts"));

    expect(res.status).toBe(500);
  });

  test("rejects roles that cannot view orders", async () => {
    setup("agent", "ly");

    const res = await GET(createRequest("/api/orders/status-counts"));

    expect(res.status).toBe(403);
  });
});
