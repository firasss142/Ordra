import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

const mockGetPage = vi.fn();
vi.mock("@/lib/warehouse/history-fetch", () => ({
  getWarehouseHistoryPage: (...args: unknown[]) => mockGetPage(...args),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import { resetTestActor, setTestActor } from "@/test/helpers/actorMock";

function row(id: string) {
  return {
    kind: "scan",
    id,
    order_id: "o-" + id,
    order_number: "N-" + id,
    product_id: null,
    product_name: "Produit",
    qty_change: -1,
    balance_after: 9,
    at: "2026-10-01T10:00:00Z",
    detail: "",
    is_damaged: false,
    is_reprint: false,
    note: null,
    actor: { id: "w-1", full_name: "Entrepôt", role: "warehouse_agent" },
    anomalies: [],
  };
}

function req() {
  return new NextRequest(new URL("http://localhost/api/warehouse/history/export.csv?kind=all"), { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  mockRpc.mockResolvedValue({ data: "e-1", error: null });
  mockGetPage.mockResolvedValue({ rows: [row("1"), row("2"), row("3")], nextCursor: null });
});

describe("GET /api/warehouse/history/export.csv — the export is journaled (export.history)", () => {
  test("records the number of rows, the format and the market, as the signed-in user", async () => {
    setTestActor({ id: "mgr-1", role: "market_manager", market_id: "m-ly" });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("journal_record", expect.objectContaining({
      p_action: "export.history",
      p_entity_type: "warehouse_history",
      p_market_id: "m-ly",
      p_context: { rows: 3, format: "csv" },
    }));
  });

  test("a super_admin export is recorded with no market", async () => {
    setTestActor({ id: "sa-1", role: "super_admin", market_id: null });
    await GET(req());
    expect(mockRpc).toHaveBeenCalledWith("journal_record", expect.objectContaining({ p_market_id: null }));
  });

  test("a journal that fails changes nothing: the CSV is still served", async () => {
    mockRpc.mockRejectedValue(new Error("journal down"));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.text()).split("\n")).toHaveLength(4);
  });

  test("a refused export records nothing", async () => {
    setTestActor({ role: "agent" });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
