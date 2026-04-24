import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function req(body: unknown) {
  return new NextRequest(
    new URL("http://localhost/api/warehouse/scan-return/batch"),
    { method: "POST", body: JSON.stringify(body) },
  );
}

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function authedWarehouse() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
  mockFrom.mockReturnValue(
    singleChain({ role: "warehouse_agent", market_id: "m-1" }),
  );
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/warehouse/scan-return/batch — role guard", () => {
  test("returns 403 for agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "agent", market_id: "m-1" }));
    const res = await POST(req({ items: [] }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/warehouse/scan-return/batch — input", () => {
  test("returns 400 on missing items", async () => {
    authedWarehouse();
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  test("returns 400 on empty items", async () => {
    authedWarehouse();
    const res = await POST(req({ items: [] }));
    expect(res.status).toBe(400);
  });

  test("rejects batch larger than 50 items", async () => {
    authedWarehouse();
    const items = Array.from({ length: 51 }, (_, i) => ({
      order_id: `o-${i}`,
      is_damaged: false,
    }));
    const res = await POST(req({ items }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/warehouse/scan-return/batch — per-item outcome", () => {
  test("returns success for each valid item", async () => {
    authedWarehouse();
    mockRpc
      .mockResolvedValueOnce({ data: { balance_after: 11 }, error: null })
      .mockResolvedValueOnce({ data: { balance_after: 12 }, error: null });
    const res = await POST(
      req({
        items: [
          { order_id: "o-1", is_damaged: false },
          { order_id: "o-2", is_damaged: false },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toHaveLength(2);
    expect(json.results[0]).toEqual(
      expect.objectContaining({ order_id: "o-1", ok: true }),
    );
    expect(json.results[1]).toEqual(
      expect.objectContaining({ order_id: "o-2", ok: true }),
    );
    expect(json.summary).toEqual({ total: 2, succeeded: 2, failed: 0 });
  });

  test("continues processing after a single failure", async () => {
    authedWarehouse();
    mockRpc
      .mockResolvedValueOnce({ data: { balance_after: 11 }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "invalid status" },
      })
      .mockResolvedValueOnce({ data: { balance_after: 13 }, error: null });
    const res = await POST(
      req({
        items: [
          { order_id: "o-1", is_damaged: false },
          { order_id: "o-2", is_damaged: false },
          { order_id: "o-3", is_damaged: false },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.map((r: { ok: boolean }) => r.ok)).toEqual([
      true,
      false,
      true,
    ]);
    expect(json.results[1].error).toMatch(/invalid/);
    expect(json.summary).toEqual({ total: 3, succeeded: 2, failed: 1 });
  });

  test("validation errors are reported per-item without calling RPC", async () => {
    authedWarehouse();
    mockRpc.mockResolvedValue({ data: { balance_after: 5 }, error: null });
    const res = await POST(
      req({
        items: [
          { order_id: "o-1", is_damaged: false },
          // damaged without reason → invalid
          { order_id: "o-2", is_damaged: true },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results[0].ok).toBe(true);
    expect(json.results[1].ok).toBe(false);
    expect(json.results[1].error).toMatch(/reason/i);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
