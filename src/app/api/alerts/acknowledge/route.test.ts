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
  return new NextRequest("http://localhost:3000/api/alerts/acknowledge", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const userSingleChain = (role: string, market_id: string | null) => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id }, error: null });
  return chain;
};

function upsertChain(resolved: { data?: unknown; error?: unknown }) {
  const payload = { data: resolved.data ?? null, error: resolved.error ?? null };
  const chain: Record<string, unknown> = {};
  chain.upsert = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(payload).then(resolve, reject);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/alerts/acknowledge", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(createRequest({ alert_keys: ["overdue_callback:o-1"] }));
    expect(res.status).toBe(401);
  });

  test("returns 403 for agents", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("agent", "m-1");
      return upsertChain({ data: [], error: null });
    });
    const res = await POST(createRequest({ alert_keys: ["overdue_callback:o-1"] }));
    expect(res.status).toBe(403);
  });

  test("returns 400 when alert_keys is missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      return upsertChain({ data: [], error: null });
    });
    const res = await POST(createRequest({}));
    expect(res.status).toBe(400);
  });

  test("returns 400 when alert_keys is empty array", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      return upsertChain({ data: [], error: null });
    });
    const res = await POST(createRequest({ alert_keys: [] }));
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid alert_key format", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      return upsertChain({ data: [], error: null });
    });
    const res = await POST(createRequest({ alert_keys: ["not-valid"] }));
    expect(res.status).toBe(400);
  });

  test("market_manager acknowledges alerts in own market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    const upsert = upsertChain({ data: [{ id: "ack-1" }], error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("market_manager", "m-1");
      if (table === "alert_acknowledgements") return upsert;
      return upsertChain({ data: [], error: null });
    });
    const res = await POST(
      createRequest({ alert_keys: ["overdue_callback:o-1", "stock_depleted:p-1"] }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.acknowledged).toBe(2);
    expect(upsert.upsert).toHaveBeenCalled();
  });

  test("super_admin acknowledges without market_id requirement", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    const upsert = upsertChain({ data: [{ id: "ack-1" }], error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return userSingleChain("super_admin", null);
      if (table === "alert_acknowledgements") return upsert;
      return upsertChain({ data: [], error: null });
    });
    const res = await POST(
      createRequest({
        alert_keys: ["dispatch_failure:o-stuck"],
        market_id: "m-1",
      }),
    );
    expect(res.status).toBe(200);
  });
});
