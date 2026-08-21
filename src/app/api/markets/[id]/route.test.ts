import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const revalidateTag = vi.fn();

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { PATCH } from "./route";

function req(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost/api/markets/m-tn"), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function usersChain(role: string, market_id: string | null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: { role, market_id }, error: null });
  return c;
}

/** markets update chain: .update(...).eq(...).select(...).single() */
function updateChain(returnRow: unknown) {
  const c: Record<string, unknown> = {};
  c.update = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.select = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: returnRow, error: null });
  return c;
}

const MARKET = { id: "m-tn", code: "tn", name: "Tunisie", language: "fr", currency: "TND", direction: "ltr", is_active: true };

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/markets/[id]", () => {
  test("401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await PATCH(req({ name: "X" }), { params: Promise.resolve({ id: "m-tn" }) });
    expect(res.status).toBe(401);
  });

  test("403 for market_manager (super_admin only)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm" } } });
    mockFrom.mockImplementation(() => usersChain("market_manager", "m-tn"));
    const res = await PATCH(req({ name: "X" }), { params: Promise.resolve({ id: "m-tn" }) });
    expect(res.status).toBe(403);
  });

  test("super_admin updates name, language and is_active", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa" } } });
    let call = 0;
    let upd: Record<string, unknown> | null = null;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) return usersChain("super_admin", null);
      upd = updateChain({ ...MARKET, name: "Tunisie 2", language: "ar", is_active: false });
      return upd;
    });
    const res = await PATCH(
      req({ name: "Tunisie 2", language: "ar", is_active: false }),
      { params: Promise.resolve({ id: "m-tn" }) },
    );
    expect(res.status).toBe(200);
    const patch = (upd as unknown as { update: ReturnType<typeof vi.fn> }).update.mock.calls[0][0];
    expect(patch).toMatchObject({ name: "Tunisie 2", language: "ar", is_active: false });
    // currency/code must never be written
    expect(patch).not.toHaveProperty("currency");
    expect(patch).not.toHaveProperty("code");
    expect(revalidateTag).toHaveBeenCalledWith("markets");
  });

  test("ignores attempts to change currency or code", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa" } } });
    let call = 0;
    let upd: Record<string, unknown> | null = null;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) return usersChain("super_admin", null);
      upd = updateChain(MARKET);
      return upd;
    });
    const res = await PATCH(
      req({ currency: "USD", code: "xx", name: "Keep" }),
      { params: Promise.resolve({ id: "m-tn" }) },
    );
    expect(res.status).toBe(200);
    const patch = (upd as unknown as { update: ReturnType<typeof vi.fn> }).update.mock.calls[0][0];
    expect(patch).toEqual({ name: "Keep" });
  });

  test("400 on an invalid language", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa" } } });
    mockFrom.mockImplementation(() => usersChain("super_admin", null));
    const res = await PATCH(req({ language: "de" }), { params: Promise.resolve({ id: "m-tn" }) });
    expect(res.status).toBe(400);
  });

  test("400 when there is nothing valid to update", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa" } } });
    mockFrom.mockImplementation(() => usersChain("super_admin", null));
    const res = await PATCH(req({ currency: "USD" }), { params: Promise.resolve({ id: "m-tn" }) });
    expect(res.status).toBe(400);
  });
});
