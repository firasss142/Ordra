import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const ADMIN = "11111111-2222-4333-8444-555555555555";
const update = vi.fn();
const select = vi.fn();
let session: unknown;

vi.mock("@/lib/journal/guard", () => ({
  journalSession: async () => session,
  rpcFailure: (e: { code?: string }) => new Response(JSON.stringify(e), { status: e.code === "42501" ? 403 : 500 }),
}));

import { GET, PATCH } from "./route";

function supabase() {
  return {
    from: (table: string) => {
      expect(table).toBe("journal_rule_settings");
      return {
        select: (cols: string) => {
          select(cols);
          return { order: async () => ({ data: [{ rule_key: "server_error", enabled: true, params: { count: 3, hours: 24 }, updated_at: "t", updated_by: null }], error: null }) };
        },
        update: (row: Record<string, unknown>) => {
          update(row);
          return {
            eq: () => ({
              select: () => ({ maybeSingle: async () => ({ data: { rule_key: "server_error", ...row }, error: null }) }),
            }),
          };
        },
      };
    },
  };
}

function patch(body: unknown) {
  return new NextRequest("http://localhost/api/admin/journal/rules", { method: "PATCH", body: JSON.stringify(body) });
}

beforeEach(() => {
  update.mockClear();
  select.mockClear();
  session = { supabase: supabase(), actorId: ADMIN };
});

describe("GET /api/admin/journal/rules", () => {
  test("lists the rules with their thresholds", async () => {
    const res = await GET(new NextRequest("http://localhost/api/admin/journal/rules"));
    expect(res.status).toBe(200);
    expect((await res.json()).data[0]).toMatchObject({ rule_key: "server_error", enabled: true });
  });

  test("anyone but the super_admin gets the guard's answer", async () => {
    session = { response: new Response(null, { status: 403 }) };
    expect((await GET(new NextRequest("http://localhost/api/admin/journal/rules"))).status).toBe(403);
  });
});

describe("PATCH /api/admin/journal/rules", () => {
  test("saves a valid change with who made it", async () => {
    const res = await PATCH(patch({ rule_key: "server_error", enabled: false, params: { count: 5, hours: 12 } }));
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0]).toMatchObject({ enabled: false, params: { count: 5, hours: 12 }, updated_by: ADMIN });
  });

  test("an invalid change is a 422 that names the field, and nothing is written", async () => {
    const res = await PATCH(patch({ rule_key: "server_error", params: { count: 0, hours: 12 } }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "out_of_range", field: "count" });
    expect(update).not.toHaveBeenCalled();
  });

  test("a body that is not JSON is a 400", async () => {
    const res = await PATCH(new NextRequest("http://localhost/api/admin/journal/rules", { method: "PATCH", body: "x" }));
    expect(res.status).toBe(400);
  });
});
