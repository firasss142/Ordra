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
 * The Mouvements chips carry a count each (« Tout 225 · Sorties 225 · Retours 0 »).
 *
 * Counted by the server, per family, with the SAME reason lists the ledger
 * query uses (`reasonsForKind`) — a count that used its own list would drift
 * from the rows the chip then shows, which is how « Tout » once hid half the
 * vocabulary.
 *
 * The fake counts each ledger query as 10 × the number of reasons it asked
 * for, so a family that asks for the wrong reasons gets the wrong number.
 */

const LY = "00000000-0000-0000-0000-000000000002";

type Calls = { in: unknown[][]; eq: unknown[][]; select: unknown[][] };
const made: Array<{ table: string; calls: Calls }> = [];

function chain(table: string) {
  const calls: Calls = { in: [], eq: [], select: [] };
  made.push({ table, calls });
  const c: Record<string, unknown> = {};
  for (const m of ["order", "limit", "lte", "gte", "or", "not", "is"]) c[m] = vi.fn().mockReturnValue(c);
  c.select = vi.fn((...a: unknown[]) => { calls.select.push(a); return c; });
  c.in = vi.fn((...a: unknown[]) => { calls.in.push(a); return c; });
  c.eq = vi.fn((...a: unknown[]) => { calls.eq.push(a); return c; });
  c.single = vi.fn().mockResolvedValue({ data: { role: "warehouse_agent", market_id: LY }, error: null });
  c.maybeSingle = c.single;
  c.then = (resolve: (v: unknown) => unknown) => {
    let count = 0;
    if (table === "inventory_log") {
      const reasons = calls.in.find((x) => x[0] === "reason")?.[1] as string[] | undefined;
      count = (reasons?.length ?? 0) * 10;
    } else if (table === "label_prints") count = 3;
    else if (table === "order_history") count = 4;
    return Promise.resolve({ data: null, count, error: null }).then(resolve);
  };
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  made.length = 0;
  mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
  mockFrom.mockImplementation((table: string) => chain(table));
});

const req = (qs = "") => new NextRequest(new URL(`http://localhost/api/warehouse/history/counts${qs}`));

describe("GET /api/warehouse/history/counts", () => {
  test("counts each family with the ledger's own reason lists", async () => {
    const body = await (await GET(req())).json();
    expect(body).toEqual({
      scan: 20, // scanned, scan_reversal
      return: 30, // returned, damaged_writeoff, received_back
      reception: 20, // reception, reception_reversal
      count: 10, // stock_count
      adjust: 40, // manual_adjustment, initial_stock, manual_delete_reversal, deposit
      handover: 4,
      print: 3,
      // « Tout » = the whole ledger (12 reasons) + the two streams that are not stock.
      all: 120 + 4 + 3,
    });
  });

  test("one product: only the ledger can speak, prints and handovers carry no product", async () => {
    const body = await (await GET(req("?product_id=11111111-1111-4111-8111-111111111111"))).json();
    expect(body.print).toBe(0);
    expect(body.handover).toBe(0);
    expect(body.all).toBe(120);
    const ledger = made.filter((m) => m.table === "inventory_log");
    expect(ledger.length).toBeGreaterThan(0);
    for (const m of ledger) {
      expect(m.calls.eq).toContainEqual(["product_id", "11111111-1111-4111-8111-111111111111"]);
    }
    expect(made.some((m) => m.table === "label_prints" || m.table === "order_history")).toBe(false);
  });

  test("stays inside the caller's market", async () => {
    await GET(req());
    for (const m of made.filter((x) => x.table === "inventory_log")) {
      expect(m.calls.eq).toContainEqual(["products.market_id", LY]);
    }
    for (const m of made.filter((x) => x.table === "label_prints" || x.table === "order_history")) {
      expect(m.calls.eq).toContainEqual(["market_id", LY]);
    }
  });

  test("counts heads, never downloads the rows", async () => {
    await GET(req());
    for (const m of made.filter((x) => x.table !== "users")) {
      expect(m.calls.select[0]?.[1]).toMatchObject({ count: "exact", head: true });
    }
  });

  test("rejects a product that is not an id", async () => {
    const res = await GET(req("?product_id=nope"));
    expect(res.status).toBe(400);
  });
});
