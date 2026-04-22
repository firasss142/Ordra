import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockAdminCreateUser = vi.fn();
const mockAdminDeleteUser = vi.fn();

const insertMock = vi.fn();
function insertCapturingChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.insert = vi.fn((payload: unknown) => {
    insertMock(payload);
    return c;
  });
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.insert = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        createUser: (...args: unknown[]) => mockAdminCreateUser(...args),
        deleteUser: (...args: unknown[]) => mockAdminDeleteUser(...args),
      },
    },
    from: (...args: unknown[]) => mockFrom(...args),
  })),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function req(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost/api/agents"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const managerActor = { role: "market_manager", market_id: "m-tn" };

beforeEach(() => {
  vi.clearAllMocks();
  insertMock.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
  mockFrom.mockReturnValue(singleChain(managerActor));
});

describe("POST /api/agents — required fields", () => {
  test("returns 400 when username is missing", async () => {
    const res = await POST(req({ password: "pw" }));
    expect(res.status).toBe(400);
  });

  test("returns 400 when password is missing", async () => {
    const res = await POST(req({ username: "bob" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/agents — creation", () => {
  test("accepts a minimal username + password pair (weak passwords allowed)", async () => {
    mockAdminCreateUser.mockResolvedValue({ data: { user: { id: "new-agent" } }, error: null });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return singleChain(managerActor);
      return insertCapturingChain({
        id: "new-agent",
        email: "bob@oms.local",
        full_name: "bob",
        avatar_url: null,
        role: "agent",
        market_id: "m-tn",
        is_active: true,
        last_seen_at: new Date().toISOString(),
      });
    });

    const res = await POST(req({ username: "bob", password: "x" }));
    expect(res.status).toBe(201);
  });

  test("seeds last_seen_at on the inserted row so new agents show as online", async () => {
    mockAdminCreateUser.mockResolvedValue({ data: { user: { id: "new-agent" } }, error: null });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return singleChain(managerActor);
      return insertCapturingChain({
        id: "new-agent",
        email: "bob@oms.local",
        full_name: "bob",
        avatar_url: null,
        role: "agent",
        market_id: "m-tn",
        is_active: true,
        last_seen_at: new Date().toISOString(),
      });
    });

    const before = Date.now();
    const res = await POST(req({ username: "bob", password: "x" }));
    const after = Date.now();

    expect(res.status).toBe(201);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = insertMock.mock.calls[0][0] as { last_seen_at?: string };
    expect(payload.last_seen_at).toBeTruthy();
    const seededMs = new Date(payload.last_seen_at!).getTime();
    expect(seededMs).toBeGreaterThanOrEqual(before);
    expect(seededMs).toBeLessThanOrEqual(after);
  });
});
