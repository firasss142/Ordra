import { describe, test, expect, vi, beforeEach } from "vitest";

/**
 * darb_timeline_events and darb_conversation are readable by every signed-in
 * user (USING true). The route must therefore prove the order is visible under
 * the caller's own RLS before it reads either, or an agent could read any
 * parcel's courier chatter by guessing an id.
 */
const tables: Record<string, { data: unknown; error: unknown }> = {};
const calls: string[] = [];
function chain(table: string) {
  const result = () => Promise.resolve(tables[table] ?? { data: [], error: null });
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = result;
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => result().then(res, rej);
  return c;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (t: string) => {
      calls.push(t);
      return chain(t);
    },
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { GET } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const ORDER = "94b08126-33e9-45a0-aec7-f98b57cf84f1";
const get = (id = ORDER, q = "") =>
  GET(new NextRequest(new URL(`http://localhost:3000/api/delivery/orders/${id}${q}`)), { params: { id } });

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];
  vi.mocked(getActor).mockResolvedValue({ actor: { id: "me", role: "agent", market_id: LY } } as never);
});

describe("GET /api/delivery/orders/[id]", () => {
  test("an order the caller cannot see is a 404 and no carrier table is read", async () => {
    tables.orders = { data: null, error: null };
    const res = await get();
    expect(res.status).toBe(404);
    expect(calls).toEqual(["orders"]);
  });

  test("warehouse agents are refused", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "w", role: "warehouse_agent", market_id: LY } } as never);
    expect((await get()).status).toBe(403);
    expect(calls).toEqual([]);
  });

  test("a visible order returns the merged timeline", async () => {
    tables.orders = { data: { id: ORDER }, error: null };
    tables.order_history = {
      data: [{ id: "h1", status_from: "confirmed", status_to: "uploaded", note: null, created_at: "2026-09-10T08:00:00Z" }],
      error: null,
    };
    tables.delivery_actions = {
      data: [
        { id: "a1", action_type: "call_customer", outcome: "no_answer", note: null, actor_id: "me", actor_type: "agent", created_at: "2026-09-12T10:00:00Z", actor: { full_name: "Tasnim" } },
      ],
      error: null,
    };
    const res = await get(ORDER, "?lang=ar");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(calls[0]).toBe("orders");
    expect(body.data.timeline.map((e: { id: string }) => e.id)).toEqual(["a1", "h1"]);
    expect(body.data.timeline[0]).toMatchObject({ mine: true, actor: "Tasnim" });
  });

  test("a malformed id is a 400", async () => {
    expect((await get("nope")).status).toBe(400);
  });
});
