import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockAdminFrom = vi.fn();
const mockAdminCreateUser = vi.fn();
const mockAdminDeleteUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        createUser: (...args: unknown[]) => mockAdminCreateUser(...args),
        deleteUser: (...args: unknown[]) => mockAdminDeleteUser(...args),
      },
    },
    from: (...args: unknown[]) => mockAdminFrom(...args),
  })),
}));

vi.mock("@/lib/avatars", () => ({
  uploadAvatarDataUrl: vi.fn().mockResolvedValue({ ok: true, url: "https://cdn.test/avatar.jpg" }),
}));

import { GET, POST } from "./route";
import { NextRequest } from "next/server";

function makeGetRequest(query: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/users");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url, { method: "GET" });
}

function makePostRequest(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost/api/users"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function actorChain(role: string, market_id: string | null = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: { role, market_id }, error: null });
  return c;
}

function listChain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.gte = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  // also resolve directly for when no limit is called
  Object.defineProperty(c, "then", {
    get: () => Promise.resolve({ data: rows, error: null }).then.bind(Promise.resolve({ data: rows, error: null })),
  });
  return c;
}

function insertChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.insert = vi.fn().mockReturnValue(c);
  c.select = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function auditInsertChain() {
  const c: Record<string, unknown> = {};
  c.insert = vi.fn().mockResolvedValue({ data: null, error: null });
  return c;
}

const superAdmin = { role: "super_admin", market_id: null };
const marketManager = { role: "market_manager", market_id: "market-tn" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "actor-1" } }, error: null });
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe("GET /api/users", () => {
  test("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  test("returns 401 when actor not found", async () => {
    const c: Record<string, unknown> = {};
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockReturnValue(c);
    c.single = vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } });
    mockFrom.mockReturnValue(c);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  test("returns 403 for agent", async () => {
    mockFrom.mockReturnValue(actorChain("agent", "market-tn"));
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(403);
  });

  test("returns 403 for warehouse_agent", async () => {
    mockFrom.mockReturnValue(actorChain("warehouse_agent", "market-tn"));
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(403);
  });

  test("returns 200 for super_admin", async () => {
    mockFrom.mockReturnValue(actorChain("super_admin"));
    const rows = [{ id: "u1", role: "agent" }];
    const adminChain: Record<string, unknown> = {};
    adminChain.select = vi.fn().mockReturnValue(adminChain);
    adminChain.is = vi.fn().mockReturnValue(adminChain);
    adminChain.order = vi.fn().mockResolvedValue({ data: rows, error: null });
    mockAdminFrom.mockReturnValue(adminChain);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });

  test("returns 200 for market_manager, filtered to own market", async () => {
    mockFrom.mockReturnValue(actorChain("market_manager", "market-tn"));
    const rows = [{ id: "u2", role: "agent", market_id: "market-tn" }];
    const adminChain: Record<string, unknown> = {};
    adminChain.select = vi.fn().mockReturnValue(adminChain);
    adminChain.is = vi.fn().mockReturnValue(adminChain);
    adminChain.order = vi.fn().mockReturnValue(adminChain);
    adminChain.eq = vi.fn().mockReturnValue(adminChain);
    adminChain.in = vi.fn().mockResolvedValue({ data: rows, error: null });
    mockAdminFrom.mockReturnValue(adminChain);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });
});

// ─── POST action=create ──────────────────────────────────────────────────────

describe("POST /api/users action=create — RBAC", () => {
  test("returns 403 for agent", async () => {
    mockFrom.mockReturnValue(actorChain("agent", "market-tn"));
    const res = await POST(makePostRequest({ username: "u", password: "pw", role: "agent", market_id: "market-tn" }));
    expect(res.status).toBe(403);
  });

  test("returns 403 for warehouse_agent", async () => {
    mockFrom.mockReturnValue(actorChain("warehouse_agent", "market-tn"));
    const res = await POST(makePostRequest({ username: "u", password: "pw", role: "agent", market_id: "market-tn" }));
    expect(res.status).toBe(403);
  });

  test("market_manager cannot create market_manager", async () => {
    mockFrom.mockReturnValue(actorChain("market_manager", "market-tn"));
    const res = await POST(makePostRequest({ username: "u", password: "pw", role: "market_manager", market_id: "market-tn" }));
    expect(res.status).toBe(403);
  });

  test("super_admin can create market_manager", async () => {
    mockFrom.mockReturnValue(actorChain("super_admin"));
    mockAdminCreateUser.mockResolvedValue({ data: { user: { id: "new-u" } }, error: null });
    let callCount = 0;
    mockAdminFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return insertChain({ id: "new-u", email: "u@oms.local", full_name: "u", role: "market_manager", market_id: "market-tn", is_active: true, avatar_url: null, last_seen_at: null, created_at: "" });
      return auditInsertChain();
    });
    const res = await POST(makePostRequest({ username: "u", password: "pw", role: "market_manager", market_id: "market-tn" }));
    expect(res.status).toBe(201);
  });

  test("market_manager can create agent", async () => {
    mockFrom.mockReturnValue(actorChain("market_manager", "market-tn"));
    mockAdminCreateUser.mockResolvedValue({ data: { user: { id: "new-u" } }, error: null });
    let callCount = 0;
    mockAdminFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return insertChain({ id: "new-u", email: "u@oms.local", full_name: "u", role: "agent", market_id: "market-tn", is_active: true, avatar_url: null, last_seen_at: null, created_at: "" });
      return auditInsertChain();
    });
    const res = await POST(makePostRequest({ username: "u", password: "pw", role: "agent" }));
    expect(res.status).toBe(201);
  });

  test("market_manager can create warehouse_agent", async () => {
    mockFrom.mockReturnValue(actorChain("market_manager", "market-tn"));
    mockAdminCreateUser.mockResolvedValue({ data: { user: { id: "new-u" } }, error: null });
    let callCount = 0;
    mockAdminFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return insertChain({ id: "new-u", email: "u@oms.local", full_name: "u", role: "warehouse_agent", market_id: "market-tn", is_active: true, avatar_url: null, last_seen_at: null, created_at: "" });
      return auditInsertChain();
    });
    const res = await POST(makePostRequest({ username: "u", password: "pw", role: "warehouse_agent" }));
    expect(res.status).toBe(201);
  });

  test("returns 400 when username is missing", async () => {
    mockFrom.mockReturnValue(actorChain("super_admin"));
    const res = await POST(makePostRequest({ password: "pw", role: "agent", market_id: "market-tn" }));
    expect(res.status).toBe(400);
  });

  test("returns 400 when password is missing", async () => {
    mockFrom.mockReturnValue(actorChain("super_admin"));
    const res = await POST(makePostRequest({ username: "u", role: "agent", market_id: "market-tn" }));
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid role", async () => {
    mockFrom.mockReturnValue(actorChain("super_admin"));
    const res = await POST(makePostRequest({ username: "u", password: "pw", role: "god", market_id: "market-tn" }));
    expect(res.status).toBe(400);
  });

  test("inserts audit log row with event_type user_created", async () => {
    mockFrom.mockReturnValue(actorChain("super_admin"));
    mockAdminCreateUser.mockResolvedValue({ data: { user: { id: "new-u" } }, error: null });
    const auditChain = auditInsertChain();
    let callCount = 0;
    mockAdminFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return insertChain({ id: "new-u", email: "u@oms.local", full_name: "u", role: "agent", market_id: "market-tn", is_active: true, avatar_url: null, last_seen_at: null, created_at: "" });
      return auditChain;
    });
    await POST(makePostRequest({ username: "u", password: "pw", role: "agent", market_id: "market-tn" }));
    expect(auditChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "user_created" })
    );
  });
});

