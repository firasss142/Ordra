import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET, PUT } from "./route";
import { NextRequest } from "next/server";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

const AGENTS = [
  { id: "ahmed", full_name: "Ahmed", avatar_url: null },
  { id: "sara", full_name: "Sara", avatar_url: null },
];

/** Chain that resolves through `.order()` and also when awaited directly. */
function chain(rows: unknown) {
  const c: Record<string, unknown> = {};
  ["select", "eq", "is", "not", "delete", "upsert"].forEach((m) => {
    c[m] = vi.fn().mockReturnValue(c);
  });
  c.order = vi.fn().mockResolvedValue({ data: rows, error: null });
  (c as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(resolve({ data: rows, error: null }));
  return c;
}

function getRequest(qs = "") {
  return new NextRequest(`http://localhost:3000/api/settings/agent-shares${qs}`);
}

function putRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/settings/agent-shares", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  resetTestActor();
  mockFrom.mockReset();
});

describe("GET — the editor's rows", () => {
  test("returns every active agent, including those with no share yet", async () => {
    // The uncovered agent has to be visible or the manager cannot see the gap
    // they are being blocked on.
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? chain(AGENTS)
        : chain([{ agent_id: "ahmed", share_pct: 60 }]),
    );

    const json = await (await GET(getRequest())).json();

    expect(json.data).toEqual([
      { agent_id: "ahmed", full_name: "Ahmed", avatar_url: null, share_pct: 60 },
      { agent_id: "sara", full_name: "Sara", avatar_url: null, share_pct: null },
    ]);
  });

  test("numeric shares arriving as strings become numbers", async () => {
    // numeric(5,2) comes back from PostgREST as a string.
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? chain([AGENTS[0]]) : chain([{ agent_id: "ahmed", share_pct: "40.50" }]),
    );
    const json = await (await GET(getRequest())).json();
    expect(json.data[0].share_pct).toBe(40.5);
  });

  test("super_admin must name a market", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await GET(getRequest())).status).toBe(400);
  });

  test("a manager cannot read another market", async () => {
    setTestActor({ role: "market_manager", market_id: "m-1" });
    expect((await GET(getRequest("?market_id=m-2"))).status).toBe(403);
  });
});

describe("PUT — nothing is written until everything validates", () => {
  test("a correct split is stored for every active agent", async () => {
    const upsert = vi.fn().mockReturnValue(chain([]));
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return chain(AGENTS);
      const c = chain([]) as Record<string, unknown>;
      c.upsert = upsert;
      return c;
    });

    const res = await PUT(putRequest({ shares: { ahmed: 60, sara: 40 } }));

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      [
        { market_id: "m-1", agent_id: "ahmed", share_pct: 60, updated_by: "mgr-1" },
        { market_id: "m-1", agent_id: "sara", share_pct: 40, updated_by: "mgr-1" },
      ],
      { onConflict: "market_id,agent_id" },
    );
  });

  test("a column that does not total 100 is refused and nothing is written", async () => {
    const upsert = vi.fn().mockReturnValue(chain([]));
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return chain(AGENTS);
      const c = chain([]) as Record<string, unknown>;
      c.upsert = upsert;
      return c;
    });

    const res = await PUT(putRequest({ shares: { ahmed: 60, sara: 30 } }));

    expect(res.status).toBe(400);
    expect((await res.json()).details).toContainEqual({ code: "TOTAL_NOT_100", total: 90 });
    expect(upsert).not.toHaveBeenCalled();
  });

  test("an uncovered agent is refused and named", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? chain(AGENTS) : chain([]),
    );

    const res = await PUT(putRequest({ shares: { ahmed: 100 } }));

    expect(res.status).toBe(400);
    expect((await res.json()).details).toContainEqual({
      code: "AGENT_UNCOVERED",
      agentId: "sara",
    });
  });

  test("a share for a departed agent is refused", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? chain(AGENTS) : chain([]),
    );
    const res = await PUT(putRequest({ shares: { ahmed: 50, sara: 30, ghost: 20 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).details).toContainEqual({
      code: "AGENT_UNKNOWN",
      agentId: "ghost",
    });
  });

  test("an agent may not write the split", async () => {
    setTestActor({ role: "agent", market_id: "m-1" });
    mockFrom.mockImplementation(() => chain(AGENTS));
    expect((await PUT(putRequest({ shares: { ahmed: 100 } }))).status).toBe(403);
  });

  test("rejects a non-object shares payload", async () => {
    mockFrom.mockImplementation(() => chain(AGENTS));
    expect((await PUT(putRequest({ shares: [50, 50] }))).status).toBe(400);
    expect((await PUT(putRequest({}))).status).toBe(400);
  });
});
