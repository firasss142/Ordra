import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
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
      fakeTableQuery(table, table === "users" ? db.users : table === "orders" ? db.orders : []),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

const LY = "ly";
const TRIPOLI = "wh-tripoli";
const BENGHAZI = "wh-benghazi";

function order(id: string, warehouse_id: string | null, total_price: number, created_at: string): Row {
  return { id, status: "to_be_returned", market_id: LY, archived_at: null, warehouse_id, total_price, created_at };
}

const req = () => new NextRequest(new URL("http://localhost/api/warehouse/returns/stats"));

/** The market-wide figures the RPC computes. */
const MARKET_STATS = {
  queue_count: 4,
  queue_value: 1000,
  oldest_days: 30,
  done_today: 2,
  rate_28d: 12.5,
  sample_28d: 40,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
  db.orders = [
    order("b-1", BENGHAZI, 400, "2026-09-07T00:00:00Z"),
    order("n-1", null, 300, "2026-09-20T00:00:00Z"),
    order("t-1", TRIPOLI, 200, "2026-09-27T00:00:00Z"),
    order("t-2", TRIPOLI, 100, "2026-10-05T00:00:00Z"),
  ];
  mockRpc.mockResolvedValue({ data: MARKET_STATS, error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/warehouse/returns/stats — the queue figures follow the building", () => {
  // The chip over the list read the whole market's queue while the list (now)
  // shows one building: "4 in the queue" over two rows.
  test("an agent's queue figures count their building only", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "wa-1", role: "warehouse_agent", market_id: LY } });
    db.users = [{ id: "wa-1", warehouse_id: TRIPOLI }];
    const json = await (await GET(req())).json();
    expect(json.queueCount).toBe(2);
    expect(json.queueValue).toBe(300);
    expect(json.oldestDays).toBe(10);
    // The rest is the market's: rates and today's throughput are team figures.
    expect(json.doneToday).toBe(2);
    expect(json.rate28d).toBe(12.5);
  });

  test("an agent with no building gets an empty queue that says why", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "wa-1", role: "warehouse_agent", market_id: LY } });
    db.users = [{ id: "wa-1", warehouse_id: null }];
    const json = await (await GET(req())).json();
    expect(json.queueCount).toBe(0);
    expect(json.queueValue).toBe(0);
    expect(json.oldestDays).toBe(0);
    expect(json.siteUnassigned).toBe(true);
  });

  test("a manager keeps the market's figures", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "mgr-1", role: "market_manager", market_id: LY } });
    db.users = [{ id: "mgr-1", warehouse_id: null }];
    const json = await (await GET(req())).json();
    expect(json.queueCount).toBe(4);
    expect(json.queueValue).toBe(1000);
    expect(json.oldestDays).toBe(30);
  });
});
