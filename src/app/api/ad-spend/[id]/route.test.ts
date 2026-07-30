import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { PATCH, DELETE } from "./route";
import { NextRequest } from "next/server";

const ENTRY = {
  id: "e1",
  market_id: "m-1",
  period_start: "2026-07-01",
  period_end: "2026-07-10",
};

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost:3000/api/ad-spend/e1"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function userChain(role: string, marketId: string | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id: marketId }, error: null });
  return chain;
}

// ad_spend chain: first .single() resolves the entry fetch; update path also
// terminates with .single().
function adSpendChain(entry: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  for (const m of ["select", "eq", "update"]) {
    chain[m] = vi.fn().mockImplementation(passthrough);
  }
  chain.single = vi.fn().mockResolvedValue({ data: entry, error: null });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
});

describe("PATCH /api/ad-spend/[id]", () => {
  test("rejects a single-sided update that would invert the stored period", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("super_admin", null) : adSpendChain(ENTRY),
    );
    // period_end before the STORED period_start — previously accepted
    const res = await PATCH(patchRequest({ period_end: "2026-06-15" }), {
      params: Promise.resolve({ id: "e1" }),
    });
    expect(res.status).toBe(400);
  });

  test("accepts a single-sided period_end after the stored period_start", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("super_admin", null) : adSpendChain(ENTRY),
    );
    const res = await PATCH(patchRequest({ period_end: "2026-07-20" }), {
      params: Promise.resolve({ id: "e1" }),
    });
    expect(res.status).toBe(200);
  });

  test("403 for market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("market_manager", "m-1") : adSpendChain(ENTRY),
    );
    const res = await PATCH(patchRequest({ amount: 10 }), {
      params: Promise.resolve({ id: "e1" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/ad-spend/[id]", () => {
  test("soft-deletes an open-period entry", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("super_admin", null) : adSpendChain(ENTRY),
    );
    const res = await DELETE(
      new NextRequest(new URL("http://localhost:3000/api/ad-spend/e1"), { method: "DELETE" }),
      { params: Promise.resolve({ id: "e1" }) },
    );
    expect(res.status).toBe(200);
  });

  test("403 when a locked-period entry is deleted by non-super_admin path (manager blocked earlier)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("market_manager", "m-1") : adSpendChain(ENTRY),
    );
    const res = await DELETE(
      new NextRequest(new URL("http://localhost:3000/api/ad-spend/e1"), { method: "DELETE" }),
      { params: Promise.resolve({ id: "e1" }) },
    );
    expect(res.status).toBe(403);
  });
});
