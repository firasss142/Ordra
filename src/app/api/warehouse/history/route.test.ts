import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...a: unknown[]) => mockFrom(...a),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

/**
 * Entrepôt › Stock › Mouvements — the ledger the v3 desk shows.
 *
 * Each row names its EVENT (« Sortie scannée », « Stock initial »…), which the
 * family alone cannot say: `adjust` holds four different reasons. And « Qui »
 * reads « adel · Benghazi », so a ledger row carries the building it happened
 * in — `inventory_log.warehouse_id`, written since the September rebuild.
 */

const LY = "00000000-0000-0000-0000-000000000002";

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "lte", "gte", "or", "not", "is"]) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  c.single = vi.fn().mockResolvedValue({ data: { role: "warehouse_agent", market_id: LY }, error: null });
  c.maybeSingle = c.single;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

let ledger: unknown[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
  ledger = [];
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return chain({ data: { role: "warehouse_agent", market_id: LY }, error: null });
    if (table === "inventory_log") return chain({ data: ledger, error: null });
    return chain({ data: [], error: null });
  });
});

const req = (qs: string) => new NextRequest(new URL(`http://localhost/api/warehouse/history?${qs}`));

describe("GET /api/warehouse/history — every family the chips offer", () => {
  test.each(["reception", "count"])("accepts kind=%s", async (kind) => {
    // The chips « Réceptions » and « Inventaires » sent these and got a 400:
    // the query schema had never been told they exist.
    const res = await GET(req(`kind=${kind}`));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/warehouse/history — a ledger row says what happened, and where", () => {
  test("carries the reason and the building, named as the bench reads it", async () => {
    ledger = [
      {
        id: "il-1", order_id: null, reason: "initial_stock", change: 943, balance_after: 943,
        created_at: "2026-09-09T10:00:00Z", is_damaged: false, note: null, actor_id: "u-1",
        product_id: "p-1", products: { name: "Coran", market_id: LY }, orders: null,
        actor: { id: "u-1", full_name: "adel", role: "warehouse_agent", avatar_url: null },
        warehouse: { name_fr: "Benghazi", name_ar: "بنغازي" },
      },
    ];
    const { rows } = await (await GET(req("kind=all"))).json();
    expect(rows[0].reason).toBe("initial_stock");
    expect(rows[0].warehouse_name).toBe("بنغازي");
  });

  test("a row written before buildings existed has no building, not a guessed one", async () => {
    ledger = [
      {
        id: "il-2", order_id: null, reason: "scanned", change: -1, balance_after: 10,
        created_at: "2026-08-01T10:00:00Z", is_damaged: false, note: null, actor_id: null,
        product_id: "p-1", products: { name: "Coran", market_id: LY }, orders: null, actor: null,
        warehouse: null,
      },
    ];
    const { rows } = await (await GET(req("kind=all"))).json();
    expect(rows[0].warehouse_name).toBeNull();
  });

  test("asks the ledger for the building it happened in", async () => {
    await GET(req("kind=scan"));
    const inv = mockFrom.mock.results
      .map((r, i) => ({ table: mockFrom.mock.calls[i][0], c: r.value as { select: { mock: { calls: unknown[][] } } } }))
      .filter((x) => x.table === "inventory_log")
      .map((x) => String(x.c.select.mock.calls[0]?.[0] ?? ""))
      .find((s) => s.includes("balance_after"));
    expect(inv).toContain("warehouse:warehouses");
  });
});
