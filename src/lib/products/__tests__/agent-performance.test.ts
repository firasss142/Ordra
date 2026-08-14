import { describe, test, expect, vi } from "vitest";
import {
  loadProductAgentPerformance,
  AGENT_ACTION_STATUSES,
  CALL_STATUSES,
  ATTRIBUTION_STATUS,
  IN_FLIGHT_STATUSES,
} from "../agent-performance";
import type { ProductAgentRow } from "@/types/product-agents";

/**
 * Chainable Supabase stub, same shape as metrics.test.ts.
 *
 * Every read goes through `fetchAllRows`, which drives the builder with
 * `.range(from, to)` — so the stub resolves there. Unlike metrics.test.ts each
 * table is hit exactly ONCE, so a table-keyed spec is enough; no queue needed.
 *
 * Filters are NOT simulated. A fixture must therefore only contain rows the
 * real query would have returned; the tests that care about the filters assert
 * on the recorded builder calls instead.
 */
function stubClient(spec: { order_history?: unknown[]; orders?: unknown[]; users?: unknown[] }) {
  const builderCalls: { table: string; method: string; args: unknown[] }[] = [];
  const rangeCalls: { table: string; from: number; to: number }[] = [];
  const tables: string[] = [];

  const from = vi.fn((table: string) => {
    tables.push(table);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "in", "eq", "gte", "lte", "order"]) {
      chain[m] = vi.fn((...args: unknown[]) => {
        builderCalls.push({ table, method: m, args });
        return chain;
      });
    }
    chain.range = vi.fn((f: number, t: number) => {
      rangeCalls.push({ table, from: f, to: t });
      const rows =
        f === 0 ? ((spec as Record<string, unknown[] | undefined>)[table] ?? []) : [];
      // fetchAllRows stops as soon as a page comes back short of 1000.
      return Promise.resolve({ data: rows, error: null });
    });
    return chain;
  });

  return { client: { from } as never, builderCalls, rangeCalls, tables };
}

const PERIOD = { productId: "p-wafra", fromDate: "2026-07-10", toDate: "2026-08-08" };

function hist(
  order_id: string,
  actor_id: string | null,
  status_to: string,
  created_at = "2026-07-15T10:00:00.000Z",
) {
  return { order_id, actor_id, status_to, created_at };
}

function order(id: string, status: string, total_price: number | string = 0) {
  return { id, status, total_price };
}

function rowOf(rows: ProductAgentRow[], actorId: string | null) {
  return rows.find((r) => r.actor_id === actorId)!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Production scenario — product sku=box-wafra-shop, Libya, cumulative.
//
// These five lines were validated in SQL against production, so the fixture is
// GENERATED from them rather than hand-transcribed: the assertion is that the
// aggregation reproduces the shape it was measured on, one row per actor, with
// `confirmed === delivered + returned + in_flight + other` on every line.
//
// Deliberately NOT taken from the mock-up: calls / called / treated diverge
// there for two agents, so only the attribution columns are prod-anchored.
// ─────────────────────────────────────────────────────────────────────────────
const PROD = [
  { id: "roqaya", confirmed: 105, delivered: 37, returned: 14, in_flight: 30, other: 24, revenue: 5142 },
  { id: "hend", confirmed: 82, delivered: 27, returned: 5, in_flight: 30, other: 20, revenue: 3483 },
  { id: "mouna", confirmed: 197, delivered: 22, returned: 6, in_flight: 147, other: 22, revenue: 2888 },
  { id: "tasnim", confirmed: 44, delivered: 13, returned: 3, in_flight: 11, other: 17, revenue: 1935 },
  { id: "salima", confirmed: 12, delivered: 1, returned: 0, in_flight: 10, other: 1, revenue: 129 },
];

/** Statuses that must all land in `other`: neither delivered, returned, nor in flight. */
const OTHER_STATUSES = ["cancelled", "rejected", "deleted", "received"];

function buildProdScenario() {
  const history: ReturnType<typeof hist>[] = [];
  const orders: ReturnType<typeof order>[] = [];

  for (const a of PROD) {
    const buckets = [
      ...Array<string>(a.delivered).fill("delivered"),
      ...Array<string>(a.returned).fill("returned"),
      ...Array<string>(a.in_flight).fill(IN_FLIGHT_STATUSES[0]),
      ...Array.from({ length: a.other }, (_, i) => OTHER_STATUSES[i % OTHER_STATUSES.length]),
    ];
    let deliveredSeen = 0;
    buckets.forEach((status, i) => {
      const oid = `${a.id}-${i}`;
      history.push(hist(oid, a.id, "confirmed", `2026-07-${String((i % 27) + 1).padStart(2, "0")}T09:00:00.000Z`));
      let price: number = 0;
      if (status === "delivered") {
        // First delivered order carries the remainder so the sum is EXACT —
        // revenue / delivered is not a whole number for any of these agents.
        price = deliveredSeen === 0 ? a.revenue - (a.delivered - 1) : 1;
        deliveredSeen += 1;
      }
      orders.push(order(oid, status, price));
    });
  }

  return { order_history: history, orders };
}

describe("loadProductAgentPerformance — attribution", () => {
  test("the LAST confirmer owns the order; an earlier confirmer keeps nothing", async () => {
    const { client } = stubClient({
      order_history: [
        hist("o-1", "a", "confirmed", "2026-07-11T08:00:00.000Z"),
        hist("o-1", "b", "confirmed", "2026-07-12T08:00:00.000Z"),
      ],
      orders: [order("o-1", "delivered", 100)],
      users: [
        { id: "a", full_name: "Agent A", role: "agent" },
        { id: "b", full_name: "Agent B", role: "agent" },
      ],
    });

    const rows = await loadProductAgentPerformance({ supabase: client, ...PERIOD });
    expect(rowOf(rows, "b").confirmed).toBe(1);
    expect(rowOf(rows, "b").delivered).toBe(1);
    expect(rowOf(rows, "b").revenue).toBe(100);
    // A still appears — it treated the order — but owns none of the outcome.
    expect(rowOf(rows, "a").confirmed).toBe(0);
    expect(rowOf(rows, "a").delivered).toBe(0);
    expect(rowOf(rows, "a").revenue).toBe(0);
    expect(rowOf(rows, "a").orders_treated).toBe(1);
  });

  test("outcome buckets read the CURRENT orders.status, not the history status", async () => {
    const { client } = stubClient({
      order_history: [
        hist("o-1", "a", "confirmed"),
        hist("o-2", "a", "confirmed"),
        hist("o-3", "a", "confirmed"),
        hist("o-4", "a", "confirmed"),
      ],
      orders: [
        order("o-1", "delivered", 250),
        order("o-2", "returned"),
        order("o-3", "uploaded"),
        order("o-4", "cancelled"),
      ],
    });

    const rows = await loadProductAgentPerformance({ supabase: client, ...PERIOD });
    const a = rowOf(rows, "a");
    expect(a.confirmed).toBe(4);
    expect(a.delivered).toBe(1);
    expect(a.returned).toBe(1);
    expect(a.in_flight).toBe(1);
    expect(a.other).toBe(1);
    expect(a.revenue).toBe(250);
  });

  test("an attributed order missing from `orders` falls into `other`, never nowhere", async () => {
    // Otherwise the closing identity silently breaks by one for that agent.
    const { client } = stubClient({
      order_history: [hist("o-1", "a", "confirmed"), hist("o-ghost", "a", "confirmed")],
      orders: [order("o-1", "delivered", 40)],
    });
    const a = rowOf(await loadProductAgentPerformance({ supabase: client, ...PERIOD }), "a");
    expect(a.confirmed).toBe(2);
    expect(a.other).toBe(1);
    expect(a.confirmed).toBe(a.delivered + a.returned + a.in_flight + a.other);
  });

  test("a confirmation with no actor lands in an explicit unattributed row", async () => {
    // Dropping it would make the product-level totals disagree with the sum of
    // the agent rows, which is exactly what the reading note promises they do.
    const { client } = stubClient({
      order_history: [hist("o-1", null, "confirmed")],
      orders: [order("o-1", "delivered", 60)],
    });
    const rows = await loadProductAgentPerformance({ supabase: client, ...PERIOD });
    const unattributed = rowOf(rows, null);
    expect(unattributed).toBeDefined();
    expect(unattributed.full_name).toBeNull();
    expect(unattributed.confirmed).toBe(1);
    expect(unattributed.revenue).toBe(60);
  });
});

describe("loadProductAgentPerformance — activity columns", () => {
  test("calls counts ROWS while orders_called counts DISTINCT orders", async () => {
    const { client } = stubClient({
      order_history: [
        hist("o-1", "a", "attempt_1", "2026-07-11T08:00:00.000Z"),
        hist("o-1", "a", "attempt_2", "2026-07-12T08:00:00.000Z"),
        hist("o-1", "a", "attempt_3", "2026-07-13T08:00:00.000Z"),
        hist("o-2", "a", "attempt_1", "2026-07-14T08:00:00.000Z"),
      ],
      orders: [order("o-1", "pending"), order("o-2", "pending")],
    });
    const a = rowOf(await loadProductAgentPerformance({ supabase: client, ...PERIOD }), "a");
    expect(a.calls).toBe(4);
    expect(a.orders_called).toBe(2);
  });

  test("orders_treated counts distinct orders across every agent-posted status", async () => {
    const { client } = stubClient({
      order_history: [
        hist("o-1", "a", "attempt_1"),
        hist("o-1", "a", "confirmed"),
        hist("o-2", "a", "callback_scheduled"),
        hist("o-3", "a", "rejected"),
      ],
      orders: [order("o-1", "uploaded"), order("o-2", "pending"), order("o-3", "rejected")],
    });
    const a = rowOf(await loadProductAgentPerformance({ supabase: client, ...PERIOD }), "a");
    expect(a.orders_treated).toBe(3);
    expect(a.calls).toBe(1);
    expect(a.orders_called).toBe(1);
    expect(a.confirmed).toBe(1);
  });

  test("only agent-postable statuses are requested — a bulk-import `pending` never counts", async () => {
    const { client, builderCalls } = stubClient({ order_history: [], orders: [] });
    await loadProductAgentPerformance({ supabase: client, ...PERIOD });
    const inCall = builderCalls.find((c) => c.table === "order_history" && c.method === "in");
    expect(inCall?.args[0]).toBe("status_to");
    expect(inCall?.args[1]).toEqual([...AGENT_ACTION_STATUSES]);
    // `pending` carries an actor_id on mass imports; counting it would report
    // 605 "treated" for an admin account that never picked up a phone.
    expect(AGENT_ACTION_STATUSES as readonly string[]).not.toContain("pending");
    expect(AGENT_ACTION_STATUSES as readonly string[]).not.toContain("uploaded");
    expect([...CALL_STATUSES]).toEqual(["attempt_1", "attempt_2", "attempt_3"]);
    expect(ATTRIBUTION_STATUS).toBe("confirmed");
  });

  test("an agent who only called, never confirmed, still gets a row", async () => {
    const { client } = stubClient({
      order_history: [hist("o-1", "a", "attempt_1"), hist("o-1", "b", "confirmed")],
      orders: [order("o-1", "delivered", 90)],
    });
    const rows = await loadProductAgentPerformance({ supabase: client, ...PERIOD });
    expect(rows.map((r) => r.actor_id).sort()).toEqual(["a", "b"]);
    expect(rowOf(rows, "a").confirmed).toBe(0);
  });
});

describe("loadProductAgentPerformance — identity", () => {
  test("name and role come from users, joined by actor_id", async () => {
    const { client } = stubClient({
      order_history: [hist("o-1", "a", "confirmed")],
      orders: [order("o-1", "delivered", 10)],
      users: [{ id: "a", full_name: "Roqaya", role: "agent" }],
    });
    const a = rowOf(await loadProductAgentPerformance({ supabase: client, ...PERIOD }), "a");
    expect(a.full_name).toBe("Roqaya");
    expect(a.role).toBe("agent");
  });

  test("an actor RLS hides keeps its row with a null name — never disappears", async () => {
    // users_select scopes a market_manager to its own market and super_admins
    // carry market_id NULL, so a Libyan manager cannot read the admin rows.
    // Filtering them out would break the closing identity for that manager only.
    const { client } = stubClient({
      order_history: [hist("o-1", "sa-hidden", "confirmed")],
      orders: [order("o-1", "delivered", 77)],
      users: [],
    });
    const rows = await loadProductAgentPerformance({ supabase: client, ...PERIOD });
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe("sa-hidden");
    expect(rows[0].full_name).toBeNull();
    expect(rows[0].role).toBeNull();
    expect(rows[0].revenue).toBe(77);
  });

  test("the users lookup is skipped entirely when nobody acted", async () => {
    const { client, tables } = stubClient({ order_history: [], orders: [] });
    const rows = await loadProductAgentPerformance({ supabase: client, ...PERIOD });
    expect(rows).toEqual([]);
    expect(tables).not.toContain("users");
  });
});

describe("loadProductAgentPerformance — windowing and paging", () => {
  test("order_history is windowed on created_at, end-of-day inclusive", async () => {
    const { client, builderCalls } = stubClient({ order_history: [], orders: [] });
    await loadProductAgentPerformance({ supabase: client, ...PERIOD });
    const hCalls = builderCalls.filter((c) => c.table === "order_history");
    expect(hCalls.find((c) => c.method === "gte")?.args).toEqual(["created_at", "2026-07-10"]);
    expect(hCalls.find((c) => c.method === "lte")?.args).toEqual([
      "created_at",
      "2026-08-08T23:59:59.999Z",
    ]);
  });

  test("orders is NOT windowed — the bucket is the CURRENT status", async () => {
    // An order confirmed inside the window is delivered days later. Windowing
    // this read would move it to `other` and make the funnel lie.
    const { client, builderCalls } = stubClient({ order_history: [], orders: [] });
    await loadProductAgentPerformance({ supabase: client, ...PERIOD });
    const oCalls = builderCalls.filter((c) => c.table === "orders");
    expect(oCalls.some((c) => c.method === "gte" || c.method === "lte")).toBe(false);
    expect(oCalls.find((c) => c.method === "eq")?.args).toEqual(["product_id", "p-wafra"]);
  });

  test("every read pages through fetchAllRows under a deterministic order", async () => {
    const { client, rangeCalls, builderCalls } = stubClient({
      order_history: [hist("o-1", "a", "confirmed")],
      orders: [order("o-1", "delivered", 10)],
      users: [{ id: "a", full_name: "A", role: "agent" }],
    });
    await loadProductAgentPerformance({ supabase: client, ...PERIOD });
    // PostgREST caps .select() at 1000 rows; .range() paging is the only way out.
    expect(rangeCalls.length).toBeGreaterThanOrEqual(3);
    expect(rangeCalls.every((c) => c.to - c.from === 999)).toBe(true);
    // Paging without ORDER BY lets Postgres repeat or skip rows across pages,
    // which for the attribution scan is a wrong owner, not just a wrong count.
    for (const table of ["order_history", "orders", "users"]) {
      expect(builderCalls.some((c) => c.table === table && c.method === "order")).toBe(true);
    }
  });
});

describe("loadProductAgentPerformance — production shape", () => {
  test("reproduces the five measured agents, column for column", async () => {
    const { client } = stubClient({
      ...buildProdScenario(),
      users: PROD.map((a) => ({ id: a.id, full_name: a.id, role: "agent" })),
    });
    const rows = await loadProductAgentPerformance({ supabase: client, ...PERIOD });
    expect(rows).toHaveLength(PROD.length);

    for (const expected of PROD) {
      const got = rowOf(rows, expected.id);
      expect({
        confirmed: got.confirmed,
        delivered: got.delivered,
        returned: got.returned,
        in_flight: got.in_flight,
        other: got.other,
        revenue: got.revenue,
      }).toEqual({
        confirmed: expected.confirmed,
        delivered: expected.delivered,
        returned: expected.returned,
        in_flight: expected.in_flight,
        other: expected.other,
        revenue: expected.revenue,
      });
    }
  });

  test("INVARIANT: confirmed === delivered + returned + in_flight + other, on every row", async () => {
    const { client } = stubClient({
      ...buildProdScenario(),
      users: PROD.map((a) => ({ id: a.id, full_name: a.id, role: "agent" })),
    });
    const rows = await loadProductAgentPerformance({ supabase: client, ...PERIOD });
    for (const r of rows) {
      expect(r.confirmed).toBe(r.delivered + r.returned + r.in_flight + r.other);
    }
  });

  test("rows come back in a stable, deterministic order", async () => {
    const scenario = buildProdScenario();
    const users = PROD.map((a) => ({ id: a.id, full_name: a.id, role: "agent" }));
    const first = await loadProductAgentPerformance({
      supabase: stubClient({ ...scenario, users }).client,
      ...PERIOD,
    });
    const second = await loadProductAgentPerformance({
      supabase: stubClient({
        order_history: [...scenario.order_history].reverse(),
        orders: [...scenario.orders].reverse(),
        users: [...users].reverse(),
      }).client,
      ...PERIOD,
    });
    expect(second.map((r) => r.actor_id)).toEqual(first.map((r) => r.actor_id));
    // Busiest confirmer first — a default order, not a ranking (that lives in
    // the UI lot, where managers and admins are split out of the classement).
    expect(first[0].actor_id).toBe("mouna");
  });
});
