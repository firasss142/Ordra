import { describe, test, expect, vi, beforeEach } from "vitest";

const calls: [string, unknown[]][] = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };
const builder: Record<string, unknown> = {};
for (const m of ["select", "eq", "in", "is", "or", "order", "range", "limit", "gte", "lt"]) {
  builder[m] = (...a: unknown[]) => { calls.push([m, a]); return builder; };
}
builder.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ from: () => builder, rpc: (...a: unknown[]) => mockRpc(...a) }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { GET } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const L1 = "11111111-1111-4111-8111-111111111111";
const req = (q = "") => new NextRequest(new URL(`http://localhost:3000/api/prospects/desk/export${q}`));
const as = (role: string) => vi.mocked(getActor).mockResolvedValue({ actor: { id: "m", role, market_id: LY } } as never);
const ROW = { id: "l1", status: "attempt_1", source: "rejected_order", customer_name: "أحمد ب.", customer_phone: "0912344218", customer_city: "طرابلس",
  return_reason: "changement_avis", created_at: "2026-10-04T08:00:00Z", agent: { full_name: "tasnim", color: "indigo" } };

beforeEach(() => { vi.clearAllMocks(); calls.length = 0; result = { data: [ROW], error: null }; });

describe("GET /api/prospects/desk/export", () => {
  test("refuses agents", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "a", role: "agent", market_id: LY } } as never);
    expect((await GET(req())).status).toBe(403);
  });

  test("Excel: semicolons, a BOM, French headers, an attachment named after the file", async () => {
    as("market_manager");
    const res = await GET(req("?format=excel&cols=name,phone,agent&lang=fr"));
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="prospects-\d{4}-\d{2}-\d{2}\.csv"/);
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await res.text();
    expect(text.split("\r\n")[0]).toBe("Nom;Téléphone;Agent");
    expect(text.split("\r\n")[1]).toBe("أحمد ب.;0912344218;tasnim");
  });

  test("CSV: commas, no BOM, Arabic headers on request", async () => {
    as("market_manager");
    const res = await GET(req("?format=csv&cols=name,state&lang=ar"));
    expect([...new Uint8Array(await res.clone().arrayBuffer()).slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    const text = await res.text();
    expect(text.split("\r\n")[0]).toBe("الاسم,الحالة");
  });

  test("a selection exports exactly those ids; the whole month ignores the filters", async () => {
    as("market_manager");
    await GET(req(`?scope=ids&ids=${L1},bad&src=rej`));
    expect(calls.filter(([m]) => m === "in")).toContainEqual(["in", ["id", [L1]]]);
    calls.length = 0;
    await GET(req("?scope=month&month=2026-09&src=rej"));
    expect(calls.filter(([m]) => m === "or")).toEqual([]);
    expect(calls.filter(([m]) => m === "gte")).toHaveLength(1);
  });

  test("records the export in the journal", async () => {
    as("market_manager");
    await GET(req("?format=csv"));
    expect(mockRpc).toHaveBeenCalledWith("journal_record", expect.objectContaining({ p_action: "export.prospects", p_market_id: LY }));
  });
});
