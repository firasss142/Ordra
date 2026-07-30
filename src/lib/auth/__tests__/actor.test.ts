import { describe, test, expect, vi, beforeEach } from "vitest";

/**
 * Regression suite for the actor resolver.
 *
 * The critical case is "spoofed x-oms-* headers are ignored": an earlier version
 * of getActor() trusted those headers as an identity source, which let any
 * authenticated caller impersonate super_admin on the ~165 routes that use it.
 */

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockCookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockImplementation(async () => ({
    get: (name: string) => mockCookieGet(name),
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: { getUser: mockGetUser },
    from: (...args: unknown[]) => mockFrom(...args),
  })),
}));

const mockVerifyProfile = vi.fn();

vi.mock("@/lib/auth/profile-cookie", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/profile-cookie")>();
  return { ...actual, verifyProfile: (c: string) => mockVerifyProfile(c) };
});

import { getActor } from "../actor";

function userRowChain(row: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: row, error: null });
  return chain;
}

function reqWithHeaders(headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/anything", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCookieGet.mockReturnValue(undefined);
  mockVerifyProfile.mockResolvedValue(null);
  mockGetUser.mockResolvedValue({ data: { user: null } });
});

describe("getActor — header spoofing", () => {
  test("ignores x-oms-role headers and returns 401 when there is no session", async () => {
    const result = await getActor(
      reqWithHeaders({
        "x-oms-role": "super_admin",
        "x-oms-actor-id": "attacker-1",
        "x-oms-market-id": "market-tn",
      })
    );

    expect("response" in result).toBe(true);
    if ("response" in result) expect(result.response.status).toBe(401);
  });

  test("a session's real role wins over a spoofed super_admin header", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-9" } } });
    mockFrom.mockReturnValue(
      userRowChain({
        role: "agent",
        market_id: "market-tn",
        is_active: true,
        deleted_at: null,
      })
    );

    const result = await getActor(
      reqWithHeaders({
        "x-oms-role": "super_admin",
        "x-oms-actor-id": "someone-else",
        "x-oms-market-id": "market-ly",
      })
    );

    expect("actor" in result).toBe(true);
    if ("actor" in result) {
      expect(result.actor.role).toBe("agent");
      expect(result.actor.id).toBe("agent-9");
      expect(result.actor.market_id).toBe("market-tn");
    }
  });

  test("a valid signed cookie's role wins over a spoofed header", async () => {
    mockCookieGet.mockReturnValue({ value: "signed.cookie" });
    mockVerifyProfile.mockResolvedValue({
      user_id: "mgr-1",
      role: "market_manager",
      market_id: "market-tn",
      exp: Date.now() + 60_000,
    });

    const result = await getActor(
      reqWithHeaders({ "x-oms-role": "super_admin", "x-oms-actor-id": "attacker-1" })
    );

    expect("actor" in result).toBe(true);
    if ("actor" in result) {
      expect(result.actor.role).toBe("market_manager");
      expect(result.actor.id).toBe("mgr-1");
    }
  });
});

describe("getActor — cookie fast path", () => {
  test("resolves from the signed cookie without touching the database", async () => {
    mockCookieGet.mockReturnValue({ value: "signed.cookie" });
    mockVerifyProfile.mockResolvedValue({
      user_id: "admin-1",
      role: "super_admin",
      market_id: null,
      exp: Date.now() + 60_000,
    });

    const result = await getActor(reqWithHeaders());

    expect("actor" in result).toBe(true);
    if ("actor" in result) {
      expect(result.actor).toEqual({
        id: "admin-1",
        role: "super_admin",
        market_id: null,
      });
    }
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("falls back to the session when the cookie fails verification", async () => {
    mockCookieGet.mockReturnValue({ value: "forged.cookie" });
    mockVerifyProfile.mockResolvedValue(null);
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-2" } } });
    mockFrom.mockReturnValue(
      userRowChain({
        role: "market_manager",
        market_id: "market-ly",
        is_active: true,
        deleted_at: null,
      })
    );

    const result = await getActor(reqWithHeaders());

    expect("actor" in result).toBe(true);
    if ("actor" in result) expect(result.actor.id).toBe("mgr-2");
  });

  test("falls back to the session when cookie verification throws", async () => {
    mockCookieGet.mockReturnValue({ value: "signed.cookie" });
    mockVerifyProfile.mockRejectedValue(new Error("ENCRYPTION_KEY is not set"));
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-3" } } });
    mockFrom.mockReturnValue(
      userRowChain({
        role: "market_manager",
        market_id: "market-tn",
        is_active: true,
        deleted_at: null,
      })
    );

    const result = await getActor(reqWithHeaders());

    expect("actor" in result).toBe(true);
    if ("actor" in result) expect(result.actor.id).toBe("mgr-3");
  });
});

describe("getActor — account status", () => {
  test("rejects a deactivated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "gone-1" } } });
    mockFrom.mockReturnValue(
      userRowChain({
        role: "market_manager",
        market_id: "market-tn",
        is_active: false,
        deleted_at: null,
      })
    );

    const result = await getActor(reqWithHeaders());

    expect("response" in result).toBe(true);
    if ("response" in result) expect(result.response.status).toBe(401);
  });

  test("rejects a soft-deleted user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "gone-2" } } });
    mockFrom.mockReturnValue(
      userRowChain({
        role: "agent",
        market_id: "market-tn",
        is_active: true,
        deleted_at: "2026-07-01T00:00:00.000Z",
      })
    );

    const result = await getActor(reqWithHeaders());

    expect("response" in result).toBe(true);
    if ("response" in result) expect(result.response.status).toBe(401);
  });

  test("rejects when the users row is missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "orphan-1" } } });
    mockFrom.mockReturnValue(userRowChain(null));

    const result = await getActor(reqWithHeaders());

    expect("response" in result).toBe(true);
    if ("response" in result) expect(result.response.status).toBe(401);
  });
});
