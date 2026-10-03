import { describe, test, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

const mockGetUser = vi.fn();
const mockSessionRpc = vi.fn();
const mockAdminRpc = vi.fn();
const mockCount = vi.fn();
const countFilters: Array<[string, unknown]> = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    rpc: (...args: unknown[]) => mockSessionRpc(...args),
  }),
  createAdminClient: vi.fn(() => ({
    rpc: (...args: unknown[]) => mockAdminRpc(...args),
    from: (table: string) => {
      countFilters.push(["from", table]);
      const c: Record<string, unknown> = {};
      c.select = (_cols: string, opts: unknown) => {
        countFilters.push(["select", opts]);
        return c;
      };
      c.eq = (col: string, v: unknown) => {
        countFilters.push([`eq:${col}`, v]);
        return c;
      };
      c.gte = (col: string, v: unknown) => {
        countFilters.push([`gte:${col}`, v]);
        return mockCount();
      };
      return c;
    },
  })),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

function req(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(new URL("http://localhost/api/auth/login-event"), {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
  });
}

const sha12 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

beforeEach(() => {
  vi.clearAllMocks();
  countFilters.length = 0;
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-1", email: "admin@oms.local" } } });
  mockSessionRpc.mockResolvedValue({ data: "e-1", error: null });
  mockAdminRpc.mockResolvedValue({ data: "e-2", error: null });
  mockCount.mockResolvedValue({ count: 0, error: null });
});

describe("POST /api/auth/login-event — a successful sign-in", () => {
  test("is recorded as auth.login through the signed-in session, email masked", async () => {
    const res = await POST(req({ email: "admin@oms.local", ok: true }));
    expect(res.status).toBe(204);
    expect(mockSessionRpc).toHaveBeenCalledWith("journal_record", {
      p_action: "auth.login",
      p_entity_type: "auth",
      p_entity_id: "u-1",
      p_entity_label: "ad•••@oms.local",
      p_context: {},
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  test("is labelled with the SESSION's e-mail, never the one the body claims", async () => {
    await POST(req({ email: "someone.else@oms.local", ok: true }));
    expect(mockSessionRpc).toHaveBeenCalledWith(
      "journal_record",
      expect.objectContaining({ p_entity_label: "ad•••@oms.local" }),
    );
  });

  test("records nothing when there is no session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req({ email: "admin@oms.local", ok: true }));
    expect(res.status).toBe(204);
    expect(mockSessionRpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login-event — a failed sign-in", () => {
  test("is recorded as auth.login_failed by the service role, with a hashed ip", async () => {
    const res = await POST(
      req({ email: "  Manager.TN@oms.local ", ok: false }, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
    );
    expect(res.status).toBe(204);
    expect(mockAdminRpc).toHaveBeenCalledWith("journal_record", {
      p_action: "auth.login_failed",
      p_entity_type: "auth",
      p_entity_id: sha12("manager.tn@oms.local"),
      p_entity_label: "ma•••@oms.local",
      p_context: { ip_hash: sha12("203.0.113.7") },
    });
    expect(mockSessionRpc).not.toHaveBeenCalled();
  });

  test("counts the ACCOUNT's failures (hash of the full address) of the last 15 minutes before writing", async () => {
    const before = Date.now();
    await POST(req({ email: "admin@oms.local", ok: false }));
    expect(countFilters).toContainEqual(["from", "audit_events"]);
    expect(countFilters).toContainEqual(["select", { count: "exact", head: true }]);
    expect(countFilters).toContainEqual(["eq:action", "auth.login_failed"]);
    expect(countFilters).toContainEqual(["eq:entity_id", sha12("admin@oms.local")]);
    const since = countFilters.find(([k]) => k === "gte:occurred_at")?.[1] as string;
    const ageMin = (before - new Date(since).getTime()) / 60000;
    expect(ageMin).toBeGreaterThan(14.9);
    expect(ageMin).toBeLessThan(15.1);
  });

  test("two accounts that share their first letters are counted apart (agent1 ≠ agent2)", async () => {
    await POST(req({ email: "agent1.tn@oms.local", ok: false }));
    await POST(req({ email: "agent2.tn@oms.local", ok: false }));
    const ids = mockAdminRpc.mock.calls.map((c) => (c[1] as { p_entity_id: string }).p_entity_id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test("stops writing after 30 failures for one account in 15 minutes (no flooding)", async () => {
    mockCount.mockResolvedValue({ count: 30, error: null });
    const res = await POST(req({ email: "admin@oms.local", ok: false }));
    expect(res.status).toBe(204);
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });

  test("writes nothing when the failures cannot be counted", async () => {
    mockCount.mockResolvedValue({ count: null, error: { message: "denied" } });
    await POST(req({ email: "admin@oms.local", ok: false }));
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });

  test("no forwarded ip → ip_hash null", async () => {
    await POST(req({ email: "admin@oms.local", ok: false }));
    expect(mockAdminRpc).toHaveBeenCalledWith(
      "journal_record",
      expect.objectContaining({ p_context: { ip_hash: null } }),
    );
  });
});

describe("POST /api/auth/login-event — says nothing, ever", () => {
  test.each([
    ["not JSON", "{oops"],
    ["no ok flag", { email: "admin@oms.local" }],
    ["ok is not a boolean", { email: "admin@oms.local", ok: "yes" }],
    ["email is not a string", { email: 42, ok: false }],
    ["email without @", { email: "admin", ok: false }],
    ["email absurdly long", { email: `${"a".repeat(300)}@oms.local`, ok: false }],
  ])("invalid input (%s) → 204, nothing recorded", async (_label, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(mockSessionRpc).not.toHaveBeenCalled();
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });

  test("a journal that fails still answers 204 with an empty body", async () => {
    mockAdminRpc.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ email: "admin@oms.local", ok: false }));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  test("a session lookup that throws still answers 204", async () => {
    mockGetUser.mockRejectedValue(new Error("auth down"));
    const res = await POST(req({ email: "admin@oms.local", ok: true }));
    expect(res.status).toBe(204);
  });
});
