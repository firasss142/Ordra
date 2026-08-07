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

function createRequest(url = "http://localhost:3000/api/agent/queue") {
  return new NextRequest(new URL(url));
}

function queryChainSingle(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

function queryChainList(resolveWith: { data: unknown[]; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  // The order_history lookup that stamps last_action_at is bounded by .limit().
  chain.limit = vi.fn().mockReturnValue(chain);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (chain as any).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolve(resolveWith));
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/agent/queue", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  test("returns 403 when user is not an agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } }, error: null });
    mockFrom.mockReturnValue(
      queryChainSingle({ data: { role: "market_manager", market_id: "m-1" }, error: null })
    );
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("returns 200 with empty orders and zero buckets when no orders assigned", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainList({ data: [], error: null });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.orders).toEqual([]);
    expect(json.buckets).toBeDefined();
    expect(json.buckets.nouveau).toBe(0);
    expect(json.buckets.tentative_1).toBe(0);
    expect(json.buckets.tentative_2).toBe(0);
    expect(json.buckets.tentative_3).toBe(0);
    expect(json.buckets.tentative_total).toBe(0);
    expect(json.buckets.rappel_prevu).toBe(0);
    expect(json.buckets.confirme).toBe(0);
    expect(json.buckets.rejete).toBe(0);
    expect(json.buckets.fermees).toBe(0);
  });

  test("returns active orders sorted and excludes future callbacks from orders array", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });

    const pastDate = "2020-01-01T00:00:00Z";
    const futureDate = "2099-01-01T00:00:00Z";

    const rawOrders = [
      {
        id: "o-assigned",
        status: "assigned",
        callback_scheduled_at: null,
        created_at: "2026-04-10T10:00:00Z",
        updated_at: "2026-04-10T10:00:00Z",
      },
      {
        id: "o-attempt1",
        status: "attempt_1",
        callback_scheduled_at: null,
        created_at: "2026-04-09T10:00:00Z",
        updated_at: "2026-04-09T10:00:00Z",
      },
      {
        id: "o-cb-overdue",
        status: "callback_scheduled",
        callback_scheduled_at: pastDate,
        created_at: "2026-04-08T10:00:00Z",
        updated_at: "2026-04-08T10:00:00Z",
      },
      {
        id: "o-cb-future",
        status: "callback_scheduled",
        callback_scheduled_at: futureDate,
        created_at: "2026-04-07T10:00:00Z",
        updated_at: "2026-04-07T10:00:00Z",
      },
      {
        id: "o-confirmed",
        status: "confirmed",
        callback_scheduled_at: null,
        created_at: "2026-04-06T10:00:00Z",
        updated_at: "2026-04-06T10:00:00Z",
      },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainList({ data: rawOrders, error: null });
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();

    // Active queue: overdue callback first, then attempts, then assigned,
    // then confirmed (awaiting upload to carrier).
    expect(json.orders.map((o: { id: string }) => o.id)).toEqual([
      "o-cb-overdue",
      "o-attempt1",
      "o-assigned",
      "o-confirmed",
    ]);

    // Buckets count ALL orders including future callback + confirmed
    expect(json.buckets.nouveau).toBe(1);       // assigned
    expect(json.buckets.tentative_1).toBe(1);   // attempt_1
    expect(json.buckets.rappel_prevu).toBe(1);  // future callback_scheduled
    expect(json.buckets.confirme).toBe(1);      // confirmed
  });

  test("shows callback_scheduled orders with no scheduled time (unscheduled callbacks)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });

    const futureDate = "2099-01-01T00:00:00Z";

    const rawOrders = [
      {
        id: "o-cb-untimed",
        status: "callback_scheduled",
        callback_scheduled_at: null,
        scheduled_dispatch_at: null,
        scheduled_dispatch_auto: null,
        created_at: "2026-04-08T10:00:00Z",
        updated_at: "2026-04-08T10:00:00Z",
      },
      {
        id: "o-cb-future",
        status: "callback_scheduled",
        callback_scheduled_at: futureDate,
        scheduled_dispatch_at: null,
        scheduled_dispatch_auto: null,
        created_at: "2026-04-07T10:00:00Z",
        updated_at: "2026-04-07T10:00:00Z",
      },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainList({ data: rawOrders, error: null });
    });

    const res = await GET(createRequest());
    const json = await res.json();

    // Untimed callback surfaces in the active list; the explicitly-future one
    // is held back until its time arrives.
    expect(json.orders.map((o: { id: string }) => o.id)).toEqual(["o-cb-untimed"]);
    // The chip count mirrors the visible list: only the untimed one counts,
    // the explicitly-future one is excluded from both list and chip.
    expect(json.buckets.rappel_prevu).toBe(1);
  });

  test("shows manual untimed + all auto dispatch_scheduled, hides only future manual", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });

    const futureDate = "2099-01-01T00:00:00Z";

    const rawOrders = [
      {
        id: "o-dsp-manual-untimed",
        status: "dispatch_scheduled",
        callback_scheduled_at: null,
        scheduled_dispatch_at: null,
        scheduled_dispatch_auto: false,
        created_at: "2026-04-08T10:00:00Z",
        updated_at: "2026-04-08T10:00:00Z",
      },
      {
        id: "o-dsp-manual-future",
        status: "dispatch_scheduled",
        callback_scheduled_at: null,
        scheduled_dispatch_at: futureDate,
        scheduled_dispatch_auto: false,
        created_at: "2026-04-07T10:00:00Z",
        updated_at: "2026-04-07T10:00:00Z",
      },
      {
        id: "o-dsp-auto-future",
        status: "dispatch_scheduled",
        callback_scheduled_at: null,
        scheduled_dispatch_at: futureDate,
        scheduled_dispatch_auto: true,
        created_at: "2026-04-06T10:00:00Z",
        updated_at: "2026-04-06T10:00:00Z",
      },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainList({ data: rawOrders, error: null });
    });

    const res = await GET(createRequest());
    const json = await res.json();

    // Auto rows always surface (so the agent can upload them manually ahead of
    // the cron), regardless of their scheduled time. The untimed manual row
    // surfaces too. Only the future MANUAL row is held back until its time.
    expect(json.orders.map((o: { id: string }) => o.id).sort()).toEqual([
      "o-dsp-auto-future",
      "o-dsp-manual-untimed",
    ]);
    // Chip mirrors the visible list: the untimed manual + the future auto count;
    // the future manual one does not.
    expect(json.buckets.livraison_planifiee).toBe(2);
  });

  test("returns 500 when DB query errors", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChainSingle({ data: { role: "agent", market_id: "m-1" }, error: null });
      }
      return queryChainList({ data: [], error: { message: "DB error" } });
    });
    const res = await GET(createRequest());
    expect(res.status).toBe(500);
  });
});
