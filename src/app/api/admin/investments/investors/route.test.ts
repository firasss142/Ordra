import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: (...a: unknown[]) => mockFrom(...a) }),
}));

import { GET, POST } from "./route";
import { NextRequest } from "next/server";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

/** A thenable query chain that resolves to {data,error} after any builder call. */
function chain(result: { data: unknown; error?: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "is", "not", "range", "limit", "single", "maybeSingle"]) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  c.single = vi.fn().mockResolvedValue({ data: result.data, error: result.error ?? null });
  c.maybeSingle = vi.fn().mockResolvedValue({ data: result.data, error: result.error ?? null });
  c.then = (res: (v: unknown) => unknown) =>
    res({ data: result.data, error: result.error ?? null });
  return c;
}

function post(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/admin/investments/investors"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const getReq = () =>
  new NextRequest(new URL("http://localhost/api/admin/investments/investors"));

beforeEach(() => {
  resetTestActor();
  mockFrom.mockReset();
});

describe("GET /api/admin/investments/investors", () => {
  test("returns investor users joined to their profile", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return chain({
          data: [
            { id: "u-1", email: "a@x", full_name: "A", market_id: "m-tn", is_active: true },
            { id: "u-2", email: "b@x", full_name: "B", market_id: "m-tn", is_active: true },
          ],
        });
      }
      if (table === "investors") {
        return chain({ data: [{ id: "u-1", legal_name: "A Ltd" }] });
      }
      return chain({ data: [] });
    });

    const res = await GET(getReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data.find((i: { id: string }) => i.id === "u-1").legal_name).toBe("A Ltd");
  });

  test("flags an investor user with no profile row as incomplete", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? chain({
            data: [{ id: "u-2", email: "b@x", full_name: "B", market_id: "m-tn", is_active: true }],
          })
        : chain({ data: [] })
    );

    const body = await (await GET(getReq())).json();
    expect(body.data[0].configured).toBe(false);
    expect(body.data[0].legal_name).toBeNull();
  });

  test("a market_manager may read", async () => {
    setTestActor({ role: "market_manager", market_id: "m-tn" });
    mockFrom.mockImplementation(() => chain({ data: [] }));
    expect((await GET(getReq())).status).toBe(200);
  });

  test("an agent may not", async () => {
    setTestActor({ role: "agent", market_id: "m-tn" });
    expect((await GET(getReq())).status).toBe(403);
  });
});

describe("POST /api/admin/investments/investors — configure a profile", () => {
  test("creates the profile for an existing investor user", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const insert = vi.fn().mockReturnValue(
      chain({ data: { id: "u-2", legal_name: "B Ltd" } })
    );
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return chain({ data: { id: "u-2", role: "investor" } });
      if (table === "investors") return { insert, ...chain({ data: null }) };
      return chain({ data: null });
    });

    const res = await POST(post({ user_id: "u-2", legal_name: "B Ltd" }));
    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u-2", legal_name: "B Ltd" })
    );
  });

  test("refuses a user who is not an investor", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? chain({ data: { id: "u-9", role: "agent" } }) : chain({ data: null })
    );
    const res = await POST(post({ user_id: "u-9", legal_name: "X" }));
    expect(res.status).toBe(422);
  });

  test("404s for an unknown user", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockFrom.mockImplementation(() => chain({ data: null }));
    expect((await POST(post({ user_id: "nope", legal_name: "X" }))).status).toBe(404);
  });

  test("requires a legal name", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await POST(post({ user_id: "u-2", legal_name: "  " }))).status).toBe(400);
  });

  test("rejects an unknown payout method", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await POST(
      post({ user_id: "u-2", legal_name: "B", payout_method: "crypto" })
    );
    expect(res.status).toBe(400);
  });

  test("a market_manager cannot create a profile", async () => {
    setTestActor({ role: "market_manager", market_id: "m-tn" });
    expect((await POST(post({ user_id: "u-2", legal_name: "B" }))).status).toBe(403);
  });
});
