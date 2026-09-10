import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockGetActor = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...a: unknown[]) => mockFrom(...a),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...a: unknown[]) => mockGetActor(...a),
}));

import { POST } from "./route";
import { NextResponse } from "next/server";

function updateChain() {
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn().mockResolvedValue({ error: null });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({
    actor: { id: "agent-1", role: "agent", market_id: "m-1" },
  });
  mockFrom.mockImplementation(() => updateChain());
});

describe("POST /api/presence/heartbeat", () => {
  test("resolves identity from the signed cookie, not from Supabase Auth", async () => {
    // This fires every 60s per open tab. Calling auth.getUser() meant a GoTrue
    // round trip per beat per tab — measured as the dominant remaining source
    // of /auth/v1/user traffic (~250/hour) once middleware stopped calling it.
    await POST();

    expect(mockGetActor).toHaveBeenCalled();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test("stamps last_seen_at for the acting user", async () => {
    const chain = updateChain();
    mockFrom.mockReturnValue(chain);

    const res = await POST();

    expect(mockFrom).toHaveBeenCalledWith("users");
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ last_seen_at: expect.any(String) }),
    );
    expect(chain.eq).toHaveBeenCalledWith("id", "agent-1");
    expect(res.status).toBe(200);
  });

  test("refuses an unauthenticated beat", async () => {
    mockGetActor.mockResolvedValue({
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await POST();

    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("reports a failed write rather than claiming success", async () => {
    const chain: Record<string, unknown> = {};
    chain.update = vi.fn(() => chain);
    chain.eq = vi.fn().mockResolvedValue({ error: { message: "boom" } });
    mockFrom.mockReturnValue(chain);

    const res = await POST();

    expect(res.status).toBe(500);
  });
});
