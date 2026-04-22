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

function makeRequest() {
  return new NextRequest("http://localhost:3000/api/notifications/notif-1/read", {
    method: "POST",
  });
}

function queryChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/notifications/[id]/read", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "notif-1" }) });
    expect(res.status).toBe(401);
  });

  test("returns 404 when notification not found or not owned", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
    mockFrom.mockImplementation(() => queryChain({ data: null, error: { message: "not found" } }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "notif-1" }) });
    expect(res.status).toBe(404);
  });

  test("returns 200 and marks notification read", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });

    const updateChain: Record<string, unknown> = {};
    updateChain.eq = vi.fn().mockReturnValue(updateChain);
    updateChain.single = vi.fn().mockResolvedValue({ data: { id: "notif-1", read_at: new Date().toISOString() }, error: null });

    mockFrom.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.update = vi.fn().mockReturnValue(updateChain);
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({ data: { id: "notif-1", read_at: null, agent_id: "agent-1" }, error: null });
      return chain;
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "notif-1" }) });
    expect(res.status).toBe(200);
  });
});
