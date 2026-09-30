import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET, POST } from "./route";
import { NextRequest } from "next/server";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

function getRequest() {
  return new NextRequest("http://localhost:3000/api/agent/availability");
}

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/agent/availability", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function userRow(over: Record<string, unknown> = {}) {
  const c: Record<string, unknown> = {};
  ["select", "eq"].forEach((m) => {
    c[m] = vi.fn().mockReturnValue(c);
  });
  c.single = vi.fn().mockResolvedValue({
    data: {
      id: "agent-1",
      is_available: true,
      available_since: "2026-09-19T08:00:00Z",
      last_seen_at: new Date().toISOString(),
      is_active: true,
      deleted_at: null,
      ...over,
    },
    error: null,
  });
  return c;
}

beforeEach(() => {
  resetTestActor();
  mockFrom.mockReset();
  mockRpc.mockReset();
  setTestActor({ id: "agent-1", role: "agent", market_id: "m-1" });
});

describe("GET — what the toggle shows", () => {
  test("reports receiving_orders true when declared and beating", () => {
    mockFrom.mockImplementation(() => userRow());
    return GET(getRequest())
      .then((res) => res.json())
      .then((json) => {
        expect(json.data.is_available).toBe(true);
        expect(json.data.receiving_orders).toBe(true);
      });
  });

  test("declared but stale reports available yet NOT receiving", async () => {
    // The two are shown separately so an agent can tell "I paused myself"
    // apart from "my session went quiet".
    mockFrom.mockImplementation(() =>
      userRow({ last_seen_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
    );
    const json = await (await GET(getRequest())).json();
    expect(json.data.is_available).toBe(true);
    expect(json.data.receiving_orders).toBe(false);
  });

  test("not declared reports not receiving", async () => {
    mockFrom.mockImplementation(() => userRow({ is_available: false }));
    const json = await (await GET(getRequest())).json();
    expect(json.data.receiving_orders).toBe(false);
  });

  test("401 when there is no session", async () => {
    setTestActor(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });
});

describe("POST — the toggle itself", () => {
  test("goes through the RPC, never a direct UPDATE", async () => {
    // The column grant lets `authenticated` write only last_seen_at, so a
    // direct update could not write the log or release orders anyway — this
    // asserts the route does not try.
    mockRpc.mockResolvedValue({ data: { changed: true, released: 3 }, error: null });

    const res = await POST(postRequest({ is_available: false }));

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("set_agent_availability", {
      p_agent_id: "agent-1",
      p_available: false,
      p_actor_id: "agent-1",
      p_reason: null,
    });
    expect(mockFrom).not.toHaveBeenCalledWith("users");
  });

  test("returns how many orders went back to the pool", async () => {
    mockRpc.mockResolvedValue({ data: { changed: true, released: 12 }, error: null });
    const json = await (await POST(postRequest({ is_available: false }))).json();
    expect(json.data.released).toBe(12);
  });

  test("a manager may name another agent", async () => {
    setTestActor({ id: "mgr-1", role: "market_manager", market_id: "m-1" });
    mockRpc.mockResolvedValue({ data: { changed: true, released: 0 }, error: null });

    await POST(postRequest({ is_available: false, agent_id: "agent-9", reason: "shift ended" }));

    expect(mockRpc).toHaveBeenCalledWith("set_agent_availability", {
      p_agent_id: "agent-9",
      p_available: false,
      p_actor_id: "mgr-1",
      p_reason: "shift ended",
    });
  });

  test("rejects a missing or non-boolean flag", async () => {
    expect((await POST(postRequest({}))).status).toBe(400);
    expect((await POST(postRequest({ is_available: "yes" }))).status).toBe(400);
  });

  test("rejects invalid JSON", async () => {
    const req = new NextRequest("http://localhost:3000/api/agent/availability", {
      method: "POST",
      body: "{not json",
      headers: { "content-type": "application/json" },
    });
    expect((await POST(req)).status).toBe(400);
  });
});

describe("POST — the RPC's refusals become HTTP", () => {
  test("FORBIDDEN is 403, not a 500", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "nope", details: '{"code":"FORBIDDEN"}' },
    });
    const res = await POST(postRequest({ is_available: true, agent_id: "someone-else" }));
    expect(res.status).toBe(403);
  });

  test("AGENT_INACTIVE is 409", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "gone", details: '{"code":"AGENT_INACTIVE"}' },
    });
    expect((await POST(postRequest({ is_available: true }))).status).toBe(409);
  });

  test("an unrecognised failure stays an opaque 500", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "boom", details: null },
    });
    const res = await POST(postRequest({ is_available: true }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal server error");
  });
});
