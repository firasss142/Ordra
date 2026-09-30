import { describe, test, expect, vi, beforeEach } from "vitest";

const mockSignOut = vi.fn();
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      signOut: () => mockSignOut(),
      getUser: () => mockGetUser(),
    },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function createRequest() {
  return new NextRequest(new URL("http://localhost:3000/api/auth/logout"), {
    method: "POST",
  });
}

function updateCapturingChain() {
  const c: Record<string, unknown> = {};
  const updateMock = vi.fn().mockReturnValue(c);
  const eqMock = vi.fn().mockResolvedValue({ error: null });
  c.update = updateMock;
  c.eq = eqMock;
  return { chain: c, updateMock, eqMock };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
  mockFrom.mockImplementation(() => updateCapturingChain().chain);
  mockRpc.mockResolvedValue({ data: { changed: true, released: 0 }, error: null });
});

describe("POST /api/auth/logout", () => {
  test("calls supabase signOut and returns 200", async () => {
    mockSignOut.mockResolvedValue({ error: null });
    const res = await POST(createRequest());
    expect(res.status).toBe(200);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test("returns 500 when signOut errors", async () => {
    mockSignOut.mockResolvedValue({ error: { message: "boom" } });
    const res = await POST(createRequest());
    expect(res.status).toBe(500);
  });

  test("clears last_seen_at for the current user before sign-out", async () => {
    mockSignOut.mockResolvedValue({ error: null });

    const capture = updateCapturingChain();
    mockFrom.mockImplementation((table: string) => {
      expect(table).toBe("users");
      return capture.chain;
    });

    await POST(createRequest());

    expect(capture.updateMock).toHaveBeenCalledWith({ last_seen_at: null });
    expect(capture.eqMock).toHaveBeenCalledWith("id", "user-123");
  });

  test("still signs out when clearing last_seen_at errors (non-blocking)", async () => {
    mockSignOut.mockResolvedValue({ error: null });
    const c: Record<string, unknown> = {};
    c.update = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockResolvedValue({ error: { message: "db down" } });
    mockFrom.mockReturnValue(c);

    const res = await POST(createRequest());
    expect(res.status).toBe(200);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  test("skips presence clear when no user is present in session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockSignOut.mockResolvedValue({ error: null });

    const capture = updateCapturingChain();
    mockFrom.mockImplementation(() => capture.chain);

    const res = await POST(createRequest());
    expect(res.status).toBe(200);
    expect(capture.updateMock).not.toHaveBeenCalled();
  });
});

describe("standing down on the way out", () => {
  test("turns availability off so untouched orders go back to the pool", async () => {
    // Nulling last_seen_at alone makes the agent stale for routing but leaves
    // is_available true and releases nothing, so their untouched orders sit in
    // a queue nobody is watching until the midnight reset.
    mockSignOut.mockResolvedValue({ error: null });

    await POST(createRequest());

    expect(mockRpc).toHaveBeenCalledWith("set_agent_availability", {
      p_agent_id: "user-123",
      p_available: false,
      p_actor_id: "user-123",
      p_reason: "logout",
    });
  });

  test("still signs out when the stand-down fails", async () => {
    // Every manager and super_admin gets NOT_AN_AGENT here. Failing to log out
    // because of it would be absurd.
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "42501", details: '{"code":"NOT_AN_AGENT"}' },
    });
    mockSignOut.mockResolvedValue({ error: null });

    const res = await POST(createRequest());

    expect(res.status).toBe(200);
    expect(mockSignOut).toHaveBeenCalled();
  });
});
