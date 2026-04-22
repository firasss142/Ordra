import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn().mockReturnValue({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

const VALID_SECRET = "test-secret";

function makeRequest(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers["x-cron-secret"] = secret;
  return new NextRequest("http://localhost:3000/api/cron/notifications-check", {
    method: "POST",
    headers,
  });
}

function listChain(data: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue({ data, error: null });
  return chain;
}

function insertChain(data: unknown) {
  const chain: Record<string, unknown> = {};
  chain.insert = vi.fn().mockResolvedValue({ data, error: null });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = VALID_SECRET;
});

describe("POST /api/cron/notifications-check", () => {
  test("returns 401 when CRON_SECRET is missing", async () => {
    const res = await POST(makeRequest(undefined));
    expect(res.status).toBe(401);
  });

  test("returns 401 when CRON_SECRET is wrong", async () => {
    const res = await POST(makeRequest("wrong-secret"));
    expect(res.status).toBe(401);
  });

  test("returns 200 with zero counts when no due orders exist", async () => {
    mockFrom.mockImplementation(() => listChain([]));

    const res = await POST(makeRequest(VALID_SECRET));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.callback_notifications).toBe(0);
    expect(json.attempt_notifications).toBe(0);
  });

  test("inserts callback_due notification for overdue callback_scheduled order", async () => {
    const callbackOrder = {
      id: "order-1",
      assigned_to: "agent-1",
      callback_scheduled_at: new Date(Date.now() - 60000).toISOString(),
    };

    let insertedRows: unknown[] = [];
    // Track which status filter was used to discriminate the two orders queries
    let lastEqStatus: unknown = null;

    mockFrom.mockImplementation((table: string) => {
      if (table === "orders") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.lte = vi.fn().mockReturnValue(chain);
        chain.in = vi.fn().mockImplementation(() => {
          // called only for attempt query — mark it
          lastEqStatus = "attempt";
          return chain;
        });
        chain.eq = vi.fn().mockImplementation((_col: string, val: unknown) => {
          if (val === "callback_scheduled") lastEqStatus = "callback_scheduled";
          return chain;
        });
        chain.limit = vi.fn().mockImplementation(() => {
          if (lastEqStatus === "callback_scheduled") {
            return Promise.resolve({ data: [callbackOrder], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        });
        return chain;
      }
      if (table === "agent_notifications") {
        const chain: Record<string, unknown> = {};
        chain.insert = vi.fn().mockImplementation((rows: unknown[]) => {
          insertedRows = rows;
          return Promise.resolve({ data: rows, error: null });
        });
        return chain;
      }
      return listChain([]);
    });

    const res = await POST(makeRequest(VALID_SECRET));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.callback_notifications).toBe(1);
    expect(insertedRows.length).toBeGreaterThan(0);
    expect((insertedRows[0] as Record<string, unknown>).kind).toBe("callback_due");
  });

  test("returns 200 with attempt_notifications count for due attempt orders", async () => {
    const attemptOrder = {
      id: "order-2",
      assigned_to: "agent-1",
      callback_scheduled_at: new Date(Date.now() - 60000).toISOString(),
    };

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "orders") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.in = vi.fn().mockReturnValue(chain);
        chain.lte = vi.fn().mockReturnValue(chain);
        chain.is = vi.fn().mockReturnValue(chain);
        chain.limit = vi.fn().mockImplementation(() => {
          callCount++;
          // First query (callback) empty, second (attempt) has data
          if (callCount === 1) return Promise.resolve({ data: [], error: null });
          return Promise.resolve({ data: [attemptOrder], error: null });
        });
        return chain;
      }
      if (table === "agent_notifications") {
        const chain: Record<string, unknown> = {};
        chain.insert = vi.fn().mockResolvedValue({ data: [{}], error: null });
        return chain;
      }
      return listChain([]);
    });

    const res = await POST(makeRequest(VALID_SECRET));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.attempt_notifications).toBe(1);
  });
});
