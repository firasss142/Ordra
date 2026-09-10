/**
 * @vitest-environment node
 *
 * Middleware runs on the edge runtime, not in a browser. Under jsdom, Next's
 * `NextResponse.next({ request })` rejects the request with "request.headers
 * must be an instance of Headers", because jsdom supplies its own Headers class
 * that fails Next's instanceof check against undici's.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockFrom = vi.fn();
const mockSignOut = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: (...a: unknown[]) => mockGetUser(...a),
      getSession: (...a: unknown[]) => mockGetSession(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
    },
    from: (...a: unknown[]) => mockFrom(...a),
  }),
}));

import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import { PROFILE_COOKIE, signProfile, type ProfilePayload } from "@/lib/auth/profile-cookie";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const LY_MARKET = "00000000-0000-0000-0000-000000000002";

function payload(over: Partial<ProfilePayload> = {}): ProfilePayload {
  return {
    user_id: USER_ID,
    email: "manager@oms.local",
    full_name: "Manager",
    avatar_url: null,
    role: "market_manager",
    market_id: LY_MARKET,
    market_code: "ly",
    exp: Date.now() + 5 * 60 * 1000,
    ...over,
  };
}

/** A session whose access token expires in `seconds`. */
function session(seconds: number) {
  return {
    data: {
      session: {
        user: { id: USER_ID, email: "manager@oms.local" },
        expires_at: Math.floor(Date.now() / 1000) + seconds,
      },
    },
  };
}

async function request(path: string, cookie?: string) {
  // The cookie goes in as a real header: NextResponse.next({ request }) reads
  // request.headers and rejects anything that is not a Headers instance.
  const headers = new Headers();
  if (cookie) headers.set("cookie", `${PROFILE_COOKIE}=${cookie}`);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ENCRYPTION_KEY = "test-encryption-key-for-middleware-specs";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID, email: "manager@oms.local" } } });
  mockGetSession.mockResolvedValue(session(3600));
});

describe("middleware — trusting the signed profile cookie", () => {
  test("a valid cookie and a fresh session skip the GoTrue round trip", async () => {
    // This is the whole point: /auth/v1/user was called on EVERY navigation,
    // ~4,820 times a day with a p95 of 1,452 ms. The cookie is HMAC-signed and
    // self-expiring — the same trust getActor already applies to ~165 API routes.
    const res = await middleware(await request("/ar/orders", await signProfile(payload())));

    expect(mockGetUser).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  test("a session close to expiry still verifies with the auth server", async () => {
    // Inside the refresh window the session may need renewing, and getUser is
    // what drives that. Trusting the cookie here would let a session lapse
    // without ever refreshing.
    mockGetSession.mockResolvedValue(session(120));

    await middleware(await request("/ar/orders", await signProfile(payload())));

    expect(mockGetUser).toHaveBeenCalled();
  });

  test("no cookie means the full check, as before", async () => {
    mockFrom.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.single = vi.fn().mockResolvedValue({
        data: {
          role: "market_manager",
          market_id: LY_MARKET,
          full_name: "M",
          avatar_url: null,
          is_active: true,
          deleted_at: null,
          markets: { code: "ly" },
        },
      });
      return chain;
    });

    await middleware(await request("/ar/orders"));

    expect(mockGetUser).toHaveBeenCalled();
  });

  test("a tampered cookie is not trusted", async () => {
    const signed = await signProfile(payload());
    // Flip the payload but keep the signature: verifyProfile must reject it and
    // the request must fall back to the real check.
    const forged = Buffer.from(
      JSON.stringify(payload({ role: "super_admin" })),
    ).toString("base64url") + "." + signed.slice(signed.lastIndexOf(".") + 1);

    mockFrom.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.single = vi.fn().mockResolvedValue({
        data: {
          role: "market_manager",
          market_id: LY_MARKET,
          full_name: "M",
          avatar_url: null,
          is_active: true,
          deleted_at: null,
          markets: { code: "ly" },
        },
      });
      return chain;
    });

    await middleware(await request("/ar/orders", forged));

    expect(mockGetUser).toHaveBeenCalled();
  });

  test("an expired cookie is not trusted", async () => {
    const stale = await signProfile(payload({ exp: Date.now() - 1000 }));
    mockFrom.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.single = vi.fn().mockResolvedValue({
        data: {
          role: "market_manager",
          market_id: LY_MARKET,
          full_name: "M",
          avatar_url: null,
          is_active: true,
          deleted_at: null,
          markets: { code: "ly" },
        },
      });
      return chain;
    });

    await middleware(await request("/ar/orders", stale));

    expect(mockGetUser).toHaveBeenCalled();
  });

  test("a cookie belonging to another user is not trusted", async () => {
    // The user_id binding that middleware already enforced must survive the
    // fast path, or a stale cookie could outlive a user switch on one browser.
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: "22222222-2222-4222-8222-222222222222" },
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
    });
    mockFrom.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.single = vi.fn().mockResolvedValue({
        data: {
          role: "market_manager",
          market_id: LY_MARKET,
          full_name: "M",
          avatar_url: null,
          is_active: true,
          deleted_at: null,
          markets: { code: "ly" },
        },
      });
      return chain;
    });

    await middleware(await request("/ar/orders", await signProfile(payload())));

    expect(mockGetUser).toHaveBeenCalled();
  });

  test("no session at all still redirects to login", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await middleware(await request("/ar/orders", await signProfile(payload())));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  test("the fast path still enforces the route guard", async () => {
    // An agent must not reach /orders just because their cookie was trusted.
    const res = await middleware(
      await request("/ar/orders", await signProfile(payload({ role: "agent" }))),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/queue");
  });

  test("the fast path still enforces the market's locale", async () => {
    const res = await middleware(await request("/fr/orders", await signProfile(payload())));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/ar/orders");
  });

  test("public paths never touch Supabase", async () => {
    await middleware(await request("/fr/login"));

    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
  });
});
