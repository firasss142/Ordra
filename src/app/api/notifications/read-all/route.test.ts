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
  return new NextRequest("http://localhost:3000/api/notifications/read-all", {
    method: "POST",
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/notifications/read-all", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  test("returns 200 and marks all unread notifications read", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });

    const updateChain: Record<string, unknown> = {};
    updateChain.eq = vi.fn().mockReturnValue(updateChain);
    updateChain.is = vi.fn().mockResolvedValue({ data: null, error: null });

    mockFrom.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.update = vi.fn().mockReturnValue(updateChain);
      return chain;
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
  });

  test("returns 500 when DB update fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });

    const updateChain: Record<string, unknown> = {};
    updateChain.eq = vi.fn().mockReturnValue(updateChain);
    updateChain.is = vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } });

    mockFrom.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.update = vi.fn().mockReturnValue(updateChain);
      return chain;
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
  });
});
