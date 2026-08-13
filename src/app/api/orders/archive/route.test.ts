import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function createRequest(body: unknown) {
  return new NextRequest(new URL("/api/orders/archive", "http://localhost:3000"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function actorChain(role: string, marketId: string | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id: marketId }, error: null });
  return chain;
}

type Row = {
  id: string;
  market_id: string;
  terminal_at: string | null;
  archived_at: string | null;
};

/** Records the payload the route writes, so the test can assert on it. */
let written: Record<string, unknown> | null = null;
let writtenIds: string[] = [];

function ordersChain(rows: Row[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    written = payload;
    return chain;
  });
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn((col: string, ids: string[]) => {
    if (col === "id") writtenIds = ids;
    return chain;
  });
  chain.then = (fn: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(fn);
  return chain;
}

function runAs(role: string, marketId: string | null, rows: Row[]) {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return actorChain(role, marketId);
    return ordersChain(rows);
  });
}

const finished: Row = { id: "11111111-1111-4111-8111-111111111111", market_id: "m-1", terminal_at: "2026-01-01T00:00:00Z", archived_at: null };
const live: Row = { id: "22222222-2222-4222-8222-222222222222", market_id: "m-1", terminal_at: null, archived_at: null };
const already: Row = { id: "33333333-3333-4333-8333-333333333333", market_id: "m-1", terminal_at: "2026-01-01T00:00:00Z", archived_at: "2026-02-01T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  written = null;
  writtenIds = [];
});

describe("POST /api/orders/archive", () => {
  test("401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(createRequest({ order_ids: ["11111111-1111-4111-8111-111111111111"], action: "archive" }));
    expect(res.status).toBe(401);
  });

  test("403 for agents", async () => {
    runAs("agent", "m-1", [finished]);
    const res = await POST(createRequest({ order_ids: ["11111111-1111-4111-8111-111111111111"], action: "archive" }));
    expect(res.status).toBe(403);
  });

  test("puts finished orders away and records who did it", async () => {
    runAs("market_manager", "m-1", [finished]);

    const res = await POST(createRequest({ order_ids: ["11111111-1111-4111-8111-111111111111"], action: "archive" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.archived).toBe(1);
    expect(writtenIds).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(written).toMatchObject({ archived_by: "u-1" });
    expect(typeof written?.archived_at).toBe("string");
  });

  /**
   * A live order has no terminal_at, and the database CHECK refuses to archive
   * it. Catching that here turns a 500 into a per-order reason.
   */
  test("refuses to put away an order that has not finished", async () => {
    runAs("market_manager", "m-1", [live]);

    const res = await POST(createRequest({ order_ids: ["22222222-2222-4222-8222-222222222222"], action: "archive" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.archived).toBe(0);
    expect(body.data.skipped).toEqual([{ order_id: "22222222-2222-4222-8222-222222222222", reason: "not_finished" }]);
  });

  test("archiving something already put away is a no-op, not an error", async () => {
    runAs("market_manager", "m-1", [already]);

    const res = await POST(createRequest({ order_ids: ["33333333-3333-4333-8333-333333333333"], action: "archive" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.archived).toBe(0);
    expect(body.data.skipped).toEqual([{ order_id: "33333333-3333-4333-8333-333333333333", reason: "already_archived" }]);
  });

  test("unarchive clears the stamp and brings the order back to the list", async () => {
    runAs("market_manager", "m-1", [already]);

    const res = await POST(createRequest({ order_ids: ["33333333-3333-4333-8333-333333333333"], action: "unarchive" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.archived).toBe(1);
    expect(written).toEqual({ archived_at: null, archived_by: null });
  });

  test("a manager cannot touch another market's orders", async () => {
    runAs("market_manager", "m-2", [finished]);

    const res = await POST(createRequest({ order_ids: ["11111111-1111-4111-8111-111111111111"], action: "archive" }));

    expect(res.status).toBe(403);
  });

  test("rejects a malformed body", async () => {
    runAs("market_manager", "m-1", []);
    const res = await POST(createRequest({ action: "archive" }));
    expect(res.status).toBe(400);
  });
});
