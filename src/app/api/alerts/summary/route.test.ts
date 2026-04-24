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

function createRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/alerts/summary");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET" });
}

/** Chainable Supabase query mock that resolves with the given payload on await. */
function buildChain(resolved: { data?: unknown; error?: unknown; count?: number | null }) {
  const payload = { data: resolved.data ?? null, error: resolved.error ?? null, count: resolved.count ?? null };
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.select = vi.fn().mockImplementation(passthrough);
  chain.eq = vi.fn().mockImplementation(passthrough);
  chain.neq = vi.fn().mockImplementation(passthrough);
  chain.in = vi.fn().mockImplementation(passthrough);
  chain.is = vi.fn().mockImplementation(passthrough);
  chain.lt = vi.fn().mockImplementation(passthrough);
  chain.gt = vi.fn().mockImplementation(passthrough);
  chain.lte = vi.fn().mockImplementation(passthrough);
  chain.gte = vi.fn().mockImplementation(passthrough);
  chain.or = vi.fn().mockImplementation(passthrough);
  chain.order = vi.fn().mockImplementation(passthrough);
  chain.limit = vi.fn().mockImplementation(passthrough);
  chain.single = vi.fn().mockResolvedValue(payload);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(payload).then(resolve, reject);
  chain.catch = (reject: (e: unknown) => unknown) => Promise.resolve(payload).catch(reject);
  return chain;
}

const userSingleChain = (role: string, market_id: string | null) => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id }, error: null });
  return chain;
};

/**
 * Dispatches `supabase.from(table)` calls to an ordered queue keyed by table name.
 * Any table not in the queue gets an empty default chain.
 */
function setupTableQueues(queues: Record<string, ReturnType<typeof buildChain>[]>) {
  const cursors: Record<string, number> = {};
  mockFrom.mockImplementation((table: string) => {
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const queue = queues[table] ?? [];
    return queue[idx] ?? buildChain({ data: [], error: null, count: 0 });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/alerts/summary (redesigned)", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  test("returns 403 for agents", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("agent", "m-1");
      return buildChain({ data: [], error: null, count: 0 });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("returns 403 for warehouse_agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "w-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("warehouse_agent", "m-1");
      return buildChain({ data: [], error: null, count: 0 });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("returns unified `alerts` array with severity ranking for market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    const overdueCallback = {
      id: "o-overdue",
      market_id: "m-1",
      customer_name: "Alice",
      product_name: "Widget",
      callback_scheduled_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    };
    const unassigned = {
      id: "o-unassigned",
      market_id: "m-1",
      customer_name: "Bob",
      product_name: "Gadget",
      created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    };
    const dispatchFailure = {
      id: "o-stuck",
      market_id: "m-1",
      customer_name: "Carol",
      product_name: "Thingamajig",
      status: "confirmed",
      updated_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const lowStockProduct = {
      id: "p-low",
      market_id: "m-1",
      name: "Low Product",
      current_stock: 2,
      low_stock_threshold: 5,
    };

    setupTableQueues({
      users: [userSingleChain("market_manager", "m-1")],
      orders: [
        buildChain({ data: [overdueCallback], error: null }),
        buildChain({ data: [unassigned], error: null }),
        buildChain({ data: [dispatchFailure], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null, count: 0 }),
      ],
      products: [buildChain({ data: [lowStockProduct], error: null })],
      users_inactive: [],
      alert_acknowledgements: [buildChain({ data: [], error: null })],
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json).toHaveProperty("alerts");
    expect(json).toHaveProperty("total");
    expect(json).toHaveProperty("by_severity");
    expect(json).toHaveProperty("by_type");
    expect(Array.isArray(json.alerts)).toBe(true);

    const types = json.alerts.map((a: { type: string }) => a.type);
    expect(types).toContain("dispatch_failure");
    expect(types).toContain("overdue_callback");
    expect(types).toContain("unassigned_overflow");
    expect(types).toContain("low_stock");

    // Severity ordering: dispatch_failure (critical) comes before low_stock (low)
    const dispatchIdx = types.indexOf("dispatch_failure");
    const lowStockIdx = types.indexOf("low_stock");
    expect(dispatchIdx).toBeLessThan(lowStockIdx);

    // Each alert has required shape
    for (const a of json.alerts) {
      expect(a).toHaveProperty("id");
      expect(a).toHaveProperty("type");
      expect(a).toHaveProperty("severity");
      expect(a).toHaveProperty("entity_id");
      expect(a).toHaveProperty("href");
      expect(a).toHaveProperty("primary");
      expect(a).toHaveProperty("created_at");
      expect(a).toHaveProperty("acknowledged_at");
      expect(a).toHaveProperty("snoozed_until");
      expect(["critical", "high", "medium", "low"]).toContain(a.severity);
    }

    // Dispatch failure should be critical
    const dispatchAlert = json.alerts.find((a: { type: string }) => a.type === "dispatch_failure");
    expect(dispatchAlert.severity).toBe("critical");

    // Low stock should be low
    const lowStockAlert = json.alerts.find((a: { type: string }) => a.type === "low_stock");
    expect(lowStockAlert.severity).toBe("low");
  });

  test("excludes acknowledged alerts from active feed", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    const callback = {
      id: "o-1",
      market_id: "m-1",
      customer_name: "X",
      product_name: "Y",
      callback_scheduled_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    };
    const ack = {
      alert_key: "overdue_callback:o-1",
      alert_type: "overdue_callback",
      entity_id: "o-1",
      market_id: "m-1",
      acknowledged_at: new Date().toISOString(),
      snoozed_until: null,
    };

    setupTableQueues({
      users: [userSingleChain("market_manager", "m-1")],
      orders: [
        buildChain({ data: [callback], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
      ],
      products: [buildChain({ data: [], error: null })],
      alert_acknowledgements: [buildChain({ data: [ack], error: null })],
    });

    const res = await GET(createRequest());
    const json = await res.json();
    const callbackAlerts = json.alerts.filter((a: { type: string }) => a.type === "overdue_callback");
    expect(callbackAlerts).toHaveLength(0);
  });

  test("excludes alerts snoozed into the future", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    const callback = {
      id: "o-2",
      market_id: "m-1",
      customer_name: "X",
      product_name: "Y",
      callback_scheduled_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    };
    const snoozed = {
      alert_key: "overdue_callback:o-2",
      alert_type: "overdue_callback",
      entity_id: "o-2",
      market_id: "m-1",
      acknowledged_at: null,
      snoozed_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };

    setupTableQueues({
      users: [userSingleChain("market_manager", "m-1")],
      orders: [
        buildChain({ data: [callback], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
      ],
      products: [buildChain({ data: [], error: null })],
      alert_acknowledgements: [buildChain({ data: [snoozed], error: null })],
    });

    const res = await GET(createRequest());
    const json = await res.json();
    expect(json.alerts.filter((a: { type: string }) => a.type === "overdue_callback")).toHaveLength(0);
  });

  test("includes alerts whose snooze has expired", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    const callback = {
      id: "o-3",
      market_id: "m-1",
      customer_name: "X",
      product_name: "Y",
      callback_scheduled_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    };
    const expiredSnooze = {
      alert_key: "overdue_callback:o-3",
      alert_type: "overdue_callback",
      entity_id: "o-3",
      market_id: "m-1",
      acknowledged_at: null,
      snoozed_until: new Date(Date.now() - 60 * 1000).toISOString(),
    };

    setupTableQueues({
      users: [userSingleChain("market_manager", "m-1")],
      orders: [
        buildChain({ data: [callback], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
      ],
      products: [buildChain({ data: [], error: null })],
      alert_acknowledgements: [buildChain({ data: [expiredSnooze], error: null })],
    });

    const res = await GET(createRequest());
    const json = await res.json();
    expect(json.alerts.filter((a: { type: string }) => a.type === "overdue_callback")).toHaveLength(1);
  });

  test("includes carrier_webhook_stale only for super_admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });

    const staleOrder = {
      id: "o-stale",
      market_id: "m-1",
      customer_name: "S",
      product_name: "P",
      status: "in_transit",
      updated_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    };

    setupTableQueues({
      users: [userSingleChain("super_admin", null)],
      orders: [
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [staleOrder], error: null }),
        buildChain({ data: [], error: null, count: 0 }),
      ],
      products: [buildChain({ data: [], error: null })],
      alert_acknowledgements: [buildChain({ data: [], error: null })],
    });

    const res = await GET(createRequest());
    const json = await res.json();
    const staleAlerts = json.alerts.filter((a: { type: string }) => a.type === "carrier_webhook_stale");
    expect(staleAlerts.length).toBeGreaterThanOrEqual(1);
    expect(staleAlerts[0].severity).toBe("critical");
  });

  test("market_manager does NOT receive carrier_webhook_stale alerts", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    const staleOrder = {
      id: "o-stale",
      market_id: "m-1",
      customer_name: "S",
      product_name: "P",
      status: "in_transit",
      updated_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    };

    setupTableQueues({
      users: [userSingleChain("market_manager", "m-1")],
      orders: [
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [staleOrder], error: null }),
        buildChain({ data: [], error: null, count: 0 }),
      ],
      products: [buildChain({ data: [], error: null })],
      alert_acknowledgements: [buildChain({ data: [], error: null })],
    });

    const res = await GET(createRequest());
    const json = await res.json();
    const staleAlerts = json.alerts.filter((a: { type: string }) => a.type === "carrier_webhook_stale");
    expect(staleAlerts).toHaveLength(0);
  });

  test("returns empty list when no conditions breached", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    setupTableQueues({
      users: [userSingleChain("super_admin", null)],
      alert_acknowledgements: [buildChain({ data: [], error: null })],
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.alerts).toEqual([]);
    expect(json.total).toBe(0);
  });

  test("total equals alerts length and by_severity sums to total", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });

    const callback = {
      id: "o-cb",
      market_id: "m-1",
      customer_name: "X",
      product_name: "Y",
      callback_scheduled_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    };
    const low = { id: "p-l", market_id: "m-1", name: "L", current_stock: 1, low_stock_threshold: 5 };

    setupTableQueues({
      users: [userSingleChain("market_manager", "m-1")],
      orders: [
        buildChain({ data: [callback], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
        buildChain({ data: [], error: null }),
      ],
      products: [buildChain({ data: [low], error: null })],
      alert_acknowledgements: [buildChain({ data: [], error: null })],
    });

    const res = await GET(createRequest());
    const json = await res.json();
    expect(json.total).toBe(json.alerts.length);
    const sum =
      (json.by_severity.critical ?? 0) +
      (json.by_severity.high ?? 0) +
      (json.by_severity.medium ?? 0) +
      (json.by_severity.low ?? 0);
    expect(sum).toBe(json.total);
  });
});
