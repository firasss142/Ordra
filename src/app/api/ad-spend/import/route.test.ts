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

function importRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest(new URL("http://localhost:3000/api/ad-spend/import"), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
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

const insertMock = vi.fn();
function adSpendChain() {
  const chain: Record<string, unknown> = {};
  chain.insert = vi.fn().mockImplementation((rows: unknown[]) => {
    insertMock(rows);
    return chain;
  });
  chain.select = vi.fn().mockImplementation(() =>
    Promise.resolve({
      data: (insertMock.mock.calls.at(-1)?.[0] as unknown[]) ?? [],
      error: null,
    }),
  );
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

const open = () => {
  const iso = new Date().toISOString().slice(0, 10);
  return { period_start: iso.slice(0, 8) + "01", period_end: iso, amount: 10 };
};
const LOCKED = { period_start: "2025-01-01", period_end: "2025-01-31", amount: 10 };

describe("POST /api/ad-spend/import", () => {
  test("403 for market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("market_manager", "m-1") : adSpendChain(),
    );
    const res = await POST(importRequest({ rows: [open()], market_id: "m-1" }));
    expect(res.status).toBe(403);
  });

  test("rejects locked-period rows (no confirmation header) but inserts open ones", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("super_admin", null) : adSpendChain(),
    );
    const res = await POST(
      importRequest({ rows: [open(), LOCKED], market_id: "m-1" }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.inserted).toBe(1);
    expect(json.data.rejected).toEqual([{ index: 1, reason: "locked_period" }]);
  });

  test("inserts locked rows when super_admin confirms with the header", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("super_admin", null) : adSpendChain(),
    );
    const res = await POST(
      importRequest({ rows: [LOCKED], market_id: "m-1" }, { "x-confirm-locked-period": "true" }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.inserted).toBe(1);
    expect(json.data.rejected).toEqual([]);
  });

  test("400 when every row is invalid or locked", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("super_admin", null) : adSpendChain(),
    );
    const res = await POST(importRequest({ rows: [LOCKED], market_id: "m-1" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.rejected).toEqual([{ index: 0, reason: "locked_period" }]);
  });

  // The CSV parser has always produced campaign_name and the import modal has
  // always sent it, but the route built its insert field-by-field and never
  // listed the column — so campaign identity was silently discarded.
  test("carries campaign_name through to the insert payload", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("super_admin", null) : adSpendChain(),
    );
    const res = await POST(
      importRequest({
        rows: [{ ...open(), campaign_name: "TN | Retarget | Broad", note: "week 3 top-up" }],
        market_id: "m-1",
      }),
    );
    expect(res.status).toBe(201);
    const inserted = insertMock.mock.calls.at(-1)?.[0] as Record<string, unknown>[];
    expect(inserted[0].campaign_name).toBe("TN | Retarget | Broad");
    // The note is a separate field — the campaign name must not overwrite it.
    expect(inserted[0].note).toBe("week 3 top-up");
  });

  test("stamps source = 'csv' so imported rows are distinguishable from manual ones", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("super_admin", null) : adSpendChain(),
    );
    const res = await POST(
      importRequest({ rows: [{ ...open(), campaign_name: "TN | Prospecting" }], market_id: "m-1" }),
    );
    expect(res.status).toBe(201);
    const inserted = insertMock.mock.calls.at(-1)?.[0] as Record<string, unknown>[];
    expect(inserted[0].source).toBe("csv");
  });

  test("a row without a campaign_name still inserts, with a null column", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("super_admin", null) : adSpendChain(),
    );
    const res = await POST(importRequest({ rows: [open()], market_id: "m-1" }));
    expect(res.status).toBe(201);
    const inserted = insertMock.mock.calls.at(-1)?.[0] as Record<string, unknown>[];
    expect(inserted[0].campaign_name).toBeNull();
  });
});
