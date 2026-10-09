import { describe, test, expect, vi, beforeEach } from "vitest";
import { fakeTableQuery, type Row } from "@/test/helpers/fakeSupabaseTable";

const mockGetActor = vi.fn();
const mockRpc = vi.fn();
const db = vi.hoisted(() => ({
  users: [] as Row[],
  orders: [] as Row[],
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (table: string) =>
      fakeTableQuery(
        table,
        table === "users" ? db.users : table === "orders" ? db.orders : [],
      ),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

const LY = "ly";
const TRIPOLI = "wh-tripoli";
const BENGHAZI = "wh-benghazi";

function order(id: string, status: string, warehouse_id: string | null, created_at: string): Row {
  return {
    id,
    status,
    warehouse_id,
    market_id: LY,
    archived_at: null,
    created_at,
    customer_name: id,
    product_id: null,
    product_name: "Sac",
    quantity: 1,
    total_price: 100,
  };
}

function req(query = "") {
  return new NextRequest(new URL(`http://localhost/api/warehouse/returns${query}`));
}

function asAgent(site: string | null) {
  mockGetActor.mockResolvedValue({ actor: { id: "wa-1", role: "warehouse_agent", market_id: LY } });
  db.users = [{ id: "wa-1", warehouse_id: site }];
}

function asManager() {
  mockGetActor.mockResolvedValue({ actor: { id: "mgr-1", role: "market_manager", market_id: LY } });
  db.users = [{ id: "mgr-1", warehouse_id: null }];
}

async function ids(res: Response): Promise<string[]> {
  const json = await res.json();
  return (json.orders as Array<{ id: string }>).map((o) => o.id).sort();
}

beforeEach(() => {
  vi.clearAllMocks();
  db.orders = [
    // Three of Benghazi's are older than Tripoli's only one: a page cut BEFORE
    // the building filter would hand a Tripoli agent nothing at all.
    order("b-1", "to_be_returned", BENGHAZI, "2026-09-01T00:00:00Z"),
    order("b-2", "to_be_returned", BENGHAZI, "2026-09-02T00:00:00Z"),
    order("n-1", "to_be_returned", null, "2026-09-03T00:00:00Z"),
    order("t-1", "to_be_returned", TRIPOLI, "2026-09-04T00:00:00Z"),
    order("b-way", "returning", BENGHAZI, "2026-09-01T00:00:00Z"),
    order("t-way", "returning", TRIPOLI, "2026-09-02T00:00:00Z"),
  ];
  // The market-wide RPC: every to_be_returned of the market, oldest first.
  mockRpc.mockImplementation((fn: string, args: { p_limit: number }) =>
    fn === "get_to_be_returned_orders"
      ? Promise.resolve({
          data: db.orders
            .filter((o) => o.status === "to_be_returned")
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
            .slice(0, args.p_limit),
          error: null,
        })
      : Promise.resolve({ data: null, error: null }),
  );
});

describe("GET /api/warehouse/returns — a warehouse agent sees their own building", () => {
  test("an agent with no building gets an empty queue that says why", async () => {
    asAgent(null);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.orders).toEqual([]);
    expect(json.siteUnassigned).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("the receivable queue holds only the agent's building — not the other, not Darb's own", async () => {
    asAgent(TRIPOLI);
    expect(await ids(await GET(req()))).toEqual(["t-1"]);
  });

  test("the building is filtered before the page is cut", async () => {
    asAgent(TRIPOLI);
    expect(await ids(await GET(req("?limit=2")))).toEqual(["t-1"]);
  });

  test("the on-the-way list too", async () => {
    asAgent(TRIPOLI);
    expect(await ids(await GET(req("?state=way")))).toEqual(["t-way"]);
  });

  test("an agent cannot widen to the other building from the URL", async () => {
    asAgent(TRIPOLI);
    expect(await ids(await GET(req(`?warehouse_id=${BENGHAZI}`)))).toEqual(["t-1"]);
    expect(await ids(await GET(req("?warehouse_id=all")))).toEqual(["t-1"]);
  });
});

describe("GET /api/warehouse/returns — a manager keeps the market view", () => {
  test("no building chosen: every return of the market", async () => {
    asManager();
    const res = await GET(req());
    expect(await ids(res)).toEqual(["b-1", "b-2", "n-1", "t-1"]);
  });

  test("a building chosen: that building only", async () => {
    asManager();
    expect(await ids(await GET(req(`?warehouse_id=${BENGHAZI}`)))).toEqual(["b-1", "b-2"]);
  });
});
