import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
/** `get_stock_position` — defaults to an empty catalogue so the existing
 *  order-shaped cases stay unaffected by the stock rule. */
type StockRpcResult = {
  data: { products: Record<string, unknown>[] } | null;
  error: { message: string } | null;
};
const mockRpc = vi.fn(
  async (): Promise<StockRpcResult> => ({ data: { products: [] }, error: null }),
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...(args as [])),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function createRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/alerts/summary");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET" });
}

/** Chainable Supabase query mock that resolves with the given payload on await. */
function buildChain(resolved: { data?: unknown; error?: unknown; count?: number | null }) {
  const payload = {
    data: resolved.data ?? null,
    error: resolved.error ?? null,
    count: resolved.count ?? null,
  };
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  for (const method of [
    "select", "eq", "neq", "in", "is", "not", "lt", "gt", "lte", "gte", "or", "like", "ilike", "order", "limit",
  ]) {
    chain[method] = vi.fn().mockImplementation(passthrough);
  }
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
 * The `orders` table is queried once per order-shaped rule, and the mock can
 * only tell them apart by call order — so the sequence is named here rather
 * than left as an unlabelled array of five `buildChain({data: []})`.
 */
const ORDER_RULES = [
  "overdue_callback",
  "unassigned_overflow",
  "dispatch_failure",
  "carrier_webhook_stale",
  "pending_idle",
  "attempts_stalled",
  "dispatch_schedule_missed",
  "upload_stalled",
] as const;
type OrderRule = (typeof ORDER_RULES)[number];

function setup(opts: {
  role?: string;
  marketId?: string | null;
  orders?: Partial<Record<OrderRule, unknown[]>>;
  products?: unknown[];
  history?: unknown[];
  acks?: unknown[];
}) {
  const {
    role = "market_manager",
    marketId = "m-1",
    orders = {},
    products = [],
    history = [],
    acks = [],
  } = opts;

  const queues: Record<string, ReturnType<typeof buildChain>[]> = {
    users: [userSingleChain(role, marketId) as ReturnType<typeof buildChain>],
    orders: ORDER_RULES.map((rule) => buildChain({ data: orders[rule] ?? [], error: null })),
    products: [buildChain({ data: products, error: null })],
    order_history: [buildChain({ data: history, error: null })],
    alert_acknowledgements: [buildChain({ data: acks, error: null })],
  };

  const cursors: Record<string, number> = {};
  mockFrom.mockImplementation((table: string) => {
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    return (queues[table] ?? [])[idx] ?? buildChain({ data: [], error: null, count: 0 });
  });
}

async function getAlerts(params: Record<string, string> = {}) {
  const res = await GET(createRequest(params));
  const json = await res.json();
  return { res, json, types: (json.alerts ?? []).map((a: { type: string }) => a.type) };
}

const order = (over: Record<string, unknown>) => ({
  market_id: "m-1",
  customer_name: "Client",
  product_name: "Produit",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
});

describe("GET /api/alerts/summary — access", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    setup({});
    expect((await GET(createRequest())).status).toBe(401);
  });

  test("returns 403 for agents", async () => {
    setup({ role: "agent" });
    expect((await GET(createRequest())).status).toBe(403);
  });

  test("returns 403 for warehouse_agent", async () => {
    setup({ role: "warehouse_agent" });
    expect((await GET(createRequest())).status).toBe(403);
  });
});

describe("severity climbs with age instead of being fixed per type", () => {
  test("a dispatch blocked four days is high, not critical", async () => {
    // The old engine made every dispatch_failure critical on minute one, so a
    // quarter of the list was red and none of it located the problem.
    setup({
      orders: { dispatch_failure: [order({ id: "o-1", status: "confirmed", updated_at: ago(4 * DAY) })] },
    });
    const { json } = await getAlerts();
    expect(json.alerts[0].type).toBe("dispatch_failure");
    expect(json.alerts[0].severity).toBe("high");
  });

  test("the same alert is critical once it has been ignored a week", async () => {
    setup({
      orders: { dispatch_failure: [order({ id: "o-1", status: "confirmed", updated_at: ago(8 * DAY) })] },
    });
    const { json } = await getAlerts();
    expect(json.alerts[0].severity).toBe("critical");
  });

  test("an unassigned order climbs two rungs as the day passes", async () => {
    setup({
      orders: {
        unassigned_overflow: [
          order({ id: "fresh", created_at: ago(3 * HOUR) }),
          order({ id: "old", created_at: ago(30 * HOUR) }),
        ],
      },
    });
    const { json } = await getAlerts();
    const bySeverity = Object.fromEntries(
      json.alerts.map((a: { entity_id: string; severity: string }) => [a.entity_id, a.severity]),
    );
    expect(bySeverity.fresh).toBe("medium");
    expect(bySeverity.old).toBe("critical");
  });
});

describe("alerts age out of the live list", () => {
  test("drops the 49-day dispatch blocks that made the panel a graveyard", async () => {
    // Straight from the screenshot that prompted this work: `bloquée 1176 h`.
    setup({
      orders: {
        dispatch_failure: [
          order({ id: "ancient", status: "confirmed", updated_at: ago(49 * DAY) }),
          order({ id: "live", status: "confirmed", updated_at: ago(4 * DAY) }),
        ],
      },
    });
    const { json } = await getAlerts();
    expect(json.alerts.map((a: { entity_id: string }) => a.entity_id)).toEqual(["live"]);
  });

  test("keeps a depleted product however long it has been empty", async () => {
    // Not stale information — the current state of the warehouse.
    setup({ products: [{ id: "p-1", market_id: "m-1", name: "Doll", current_stock: 0 }] });
    const { types } = await getAlerts();
    expect(types).toEqual(["stock_depleted"]);
  });
});

describe("stock_unreconciled — the register disagrees with the order flow", () => {
  /** One product straight out of production: 216 on the register, 382 shipped,
   *  30 returned, not one scan. */
  function stockProduct(over: Record<string, unknown> = {}) {
    return {
      id: "p-1",
      name: "دميه ملاكمه حجم صغير",
      market_id: "m-1",
      current_stock: 216,
      ledger_sum_units: 216,
      shipped_units_all_time: 382,
      returned_to_shelf_units_all_time: 30,
      damaged_return_count: 0,
      awaiting_scan_units: 239,
      oldest_awaiting_scan_at: ago(85 * DAY),
      carrier_name: "Darb Assabil - Tripoli",
      ...over,
    };
  }

  test("raises one row per product, carrying the gap in units", async () => {
    setup({});
    mockRpc.mockResolvedValueOnce({ data: { products: [stockProduct()] }, error: null });
    const { json } = await getAlerts();
    const a = json.alerts.find((x: { type: string }) => x.type === "stock_unreconciled");
    expect(a).toBeDefined();
    expect(a.entity_kind).toBe("product");
    expect(a.meta.drift_units).toBe(352); // 216 − (216 − 382 + 30)
    expect(a.meta.awaiting_units).toBe(239);
  });

  test("names the carrier that actually holds the goods", async () => {
    setup({});
    mockRpc.mockResolvedValueOnce({ data: { products: [stockProduct()] }, error: null });
    const { json } = await getAlerts();
    const a = json.alerts.find((x: { type: string }) => x.type === "stock_unreconciled");
    expect(a.secondary).toBe("Darb Assabil - Tripoli");
  });

  test("escalates to critical once the gap is a month old", async () => {
    setup({});
    mockRpc.mockResolvedValueOnce({ data: { products: [stockProduct()] }, error: null });
    const { json } = await getAlerts();
    const a = json.alerts.find((x: { type: string }) => x.type === "stock_unreconciled");
    expect(a.severity).toBe("critical");
  });

  test("stays quiet on a product that reconciles", async () => {
    setup({});
    mockRpc.mockResolvedValueOnce({
      data: {
        products: [
          stockProduct({ shipped_units_all_time: 0, returned_to_shelf_units_all_time: 0, awaiting_scan_units: 0 }),
        ],
      },
      error: null,
    });
    const { types } = await getAlerts();
    expect(types).not.toContain("stock_unreconciled");
  });

  test("carries units but never a money figure — managers see this route", async () => {
    setup({});
    mockRpc.mockResolvedValueOnce({ data: { products: [stockProduct()] }, error: null });
    const { json } = await getAlerts();
    const a = json.alerts.find((x: { type: string }) => x.type === "stock_unreconciled");
    expect(Object.keys(a.meta)).toEqual(["drift_units", "awaiting_units"]);
  });
});

describe("the retired rules are gone", () => {
  test("a product above zero no longer raises low_stock", async () => {
    setup({
      products: [{ id: "p-1", market_id: "m-1", name: "Doll", current_stock: 2, low_stock_threshold: 5 }],
    });
    const { json, types } = await getAlerts();
    expect(types).not.toContain("low_stock");
    expect(json.total).toBe(0);
  });

  test("no rule reports agent_inactive or return_bottleneck any more", async () => {
    setup({});
    const { json } = await getAlerts();
    expect(Object.keys(json.by_type)).not.toContain("agent_inactive");
    expect(Object.keys(json.by_type)).not.toContain("return_bottleneck");
  });
});

describe("the new rules the operator asked for", () => {
  test("flags an assigned order left untouched for four hours", async () => {
    setup({
      orders: {
        pending_idle: [order({ id: "o-1", status: "pending", assigned_to: "ag-1", updated_at: ago(5 * HOUR) })],
      },
    });
    const { json } = await getAlerts();
    expect(json.alerts[0].type).toBe("pending_idle");
    expect(json.alerts[0].age_minutes).toBeGreaterThanOrEqual(299);
  });

  test("flags an order that has had under two attempts in its first day", async () => {
    setup({
      orders: {
        attempts_stalled: [
          order({ id: "slow", status: "attempt_1", attempts_count: 1, created_at: ago(26 * HOUR) }),
          order({ id: "busy", status: "attempt_2", attempts_count: 2, created_at: ago(26 * HOUR) }),
        ],
      },
    });
    const { json } = await getAlerts();
    // Two calls in a day is the bar; only the order below it is an alert.
    expect(json.alerts.map((a: { entity_id: string }) => a.entity_id)).toEqual(["slow"]);
    expect(json.alerts[0].meta.attempts).toBe(1);
  });

  test("flags a scheduled dispatch that never fired", async () => {
    // Nothing else in the system notices the cron missed, which is why this
    // one goes critical within a couple of hours.
    setup({
      orders: {
        dispatch_schedule_missed: [
          order({ id: "o-1", status: "dispatch_scheduled", scheduled_dispatch_at: ago(3 * HOUR) }),
        ],
      },
    });
    const { json } = await getAlerts();
    expect(json.alerts[0].type).toBe("dispatch_schedule_missed");
    expect(json.alerts[0].severity).toBe("critical");
  });

  test("flags an uploaded order whose status has not moved in a day", async () => {
    setup({
      orders: { upload_stalled: [order({ id: "o-1", status: "uploaded", updated_at: ago(30 * HOUR) })] },
    });
    const { types } = await getAlerts();
    expect(types).toEqual(["upload_stalled"]);
  });

  test("flags an agent price change and an agent reopen from the history log", async () => {
    setup({
      history: [
        {
          id: "h-1",
          order_id: "o-price",
          actor_type: "agent",
          note: JSON.stringify({ unit_price: 149 }),
          created_at: ago(30 * MIN),
          orders: { customer_name: "Anas", product_name: "Doll", market_id: "m-1" },
        },
        {
          id: "h-2",
          order_id: "o-reopen",
          actor_type: "agent",
          note: "Reouvert par agent",
          created_at: ago(2 * HOUR),
          orders: { customer_name: "Hani", product_name: "Doll", market_id: "m-1" },
        },
      ],
    });
    const { json, types } = await getAlerts();
    expect(types).toContain("price_changed");
    expect(types).toContain("order_reopened");
    const price = json.alerts.find((a: { type: string }) => a.type === "price_changed");
    expect(price.entity_id).toBe("o-price");
    expect(price.primary).toBe("Anas");
    expect(price.href).toBe("/orders/o-price");
  });

  test("ignores history rows written by the system or a manager", async () => {
    // The rule is about agent behaviour; a manager correcting a price is not
    // the thing being watched, and system rows would fire on every webhook.
    setup({
      history: [
        {
          id: "h-1",
          order_id: "o-1",
          actor_type: "manager",
          note: JSON.stringify({ unit_price: 149 }),
          created_at: ago(30 * MIN),
          orders: { customer_name: "X", product_name: "Y", market_id: "m-1" },
        },
      ],
    });
    const { json } = await getAlerts();
    expect(json.total).toBe(0);
  });
});

describe("one order, one row", () => {
  test("keeps only the loudest alert when two rules catch the same order", async () => {
    // A 30-hour-old assigned order with no calls trips both pending_idle and
    // attempts_stalled. Two rows for one order is the noise this redesign is
    // meant to remove, so the higher severity wins and the other is dropped.
    const stalled = order({
      id: "o-1",
      status: "pending",
      assigned_to: "ag-1",
      attempts_count: 0,
      created_at: ago(30 * HOUR),
      updated_at: ago(30 * HOUR),
    });
    setup({ orders: { pending_idle: [stalled], attempts_stalled: [stalled] } });

    const { json } = await getAlerts();
    expect(json.alerts).toHaveLength(1);
    expect(json.alerts[0].type).toBe("pending_idle");
    expect(json.alerts[0].severity).toBe("critical");
  });

  test("still reports two different orders caught by two different rules", async () => {
    setup({
      orders: {
        pending_idle: [order({ id: "a", status: "pending", assigned_to: "ag-1", updated_at: ago(5 * HOUR) })],
        upload_stalled: [order({ id: "b", status: "uploaded", updated_at: ago(30 * HOUR) })],
      },
    });
    const { json } = await getAlerts();
    expect(json.alerts).toHaveLength(2);
  });
});

describe("acknowledgement and snooze still suppress a row", () => {
  const callback = () =>
    order({ id: "o-1", callback_scheduled_at: ago(30 * MIN), updated_at: ago(30 * MIN) });

  test("excludes acknowledged alerts", async () => {
    setup({
      orders: { overdue_callback: [callback()] },
      acks: [{ alert_key: "overdue_callback:o-1", acknowledged_at: new Date().toISOString(), snoozed_until: null }],
    });
    const { json } = await getAlerts();
    expect(json.total).toBe(0);
  });

  test("excludes alerts snoozed into the future", async () => {
    setup({
      orders: { overdue_callback: [callback()] },
      acks: [
        {
          alert_key: "overdue_callback:o-1",
          acknowledged_at: null,
          snoozed_until: new Date(Date.now() + HOUR).toISOString(),
        },
      ],
    });
    const { json } = await getAlerts();
    expect(json.total).toBe(0);
  });

  test("includes alerts whose snooze has expired", async () => {
    setup({
      orders: { overdue_callback: [callback()] },
      acks: [
        {
          alert_key: "overdue_callback:o-1",
          acknowledged_at: null,
          snoozed_until: ago(HOUR),
        },
      ],
    });
    const { json } = await getAlerts();
    expect(json.total).toBe(1);
  });
});

describe("market scoping", () => {
  test("includes carrier_webhook_stale only for super_admin", async () => {
    setup({
      role: "super_admin",
      marketId: null,
      orders: { carrier_webhook_stale: [order({ id: "o-1", status: "in_transit", updated_at: ago(9 * DAY) })] },
    });
    const { types } = await getAlerts({ market_id: "m-1" });
    expect(types).toContain("carrier_webhook_stale");
  });

  test("market_manager does not receive carrier_webhook_stale", async () => {
    setup({
      orders: { carrier_webhook_stale: [order({ id: "o-1", status: "in_transit", updated_at: ago(9 * DAY) })] },
    });
    const { types } = await getAlerts();
    expect(types).not.toContain("carrier_webhook_stale");
  });
});

describe("the summary counts agree with the list", () => {
  test("returns an empty, well-formed body when nothing is breached", async () => {
    setup({});
    const { json } = await getAlerts();
    expect(json.total).toBe(0);
    expect(json.alerts).toEqual([]);
    expect(json.by_severity).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });

  test("total equals the list length and by_severity sums to it", async () => {
    setup({
      orders: {
        overdue_callback: [order({ id: "a", callback_scheduled_at: ago(30 * MIN) })],
        unassigned_overflow: [order({ id: "b", created_at: ago(3 * HOUR) })],
        dispatch_failure: [order({ id: "c", status: "confirmed", updated_at: ago(4 * DAY) })],
      },
      products: [{ id: "p", market_id: "m-1", name: "Doll", current_stock: 0 }],
    });
    const { json } = await getAlerts();
    expect(json.total).toBe(json.alerts.length);
    const summed = Object.values(json.by_severity as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(summed).toBe(json.total);
    // Sorted loudest first so the panel's first group is the one that matters.
    const ranks = json.alerts.map((a: { severity: string }) =>
      ["critical", "high", "medium", "low"].indexOf(a.severity),
    );
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
  });
});
