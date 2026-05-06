import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: vi.fn(() => ({
    from: (...args: unknown[]) => mockFrom(...args),
  })),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function req(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method: "POST" });
}

function singleChain(data: unknown) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error: null });
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: fetch (HEAD) resolves OK
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
});

describe("POST /api/carriers/[id]/test", () => {
  test("401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req("/api/carriers/c-1/test"), {
      params: Promise.resolve({ id: "c-1" }),
    });
    expect(res.status).toBe(401);
  });

  test("403 when market_manager targets different market carrier", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm" } } });
    let n = 0;
    mockFrom.mockImplementation(() => {
      n++;
      if (n === 1) return singleChain({ role: "market_manager", market_id: "m-ly" });
      return singleChain({
        id: "c-1",
        market_id: "m-tn",
        code: "navex",
        api_endpoint: "https://x",
      });
    });
    const res = await POST(req("/api/carriers/c-1/test"), {
      params: Promise.resolve({ id: "c-1" }),
    });
    expect(res.status).toBe(403);
  });

  test("403 when market_manager not super_admin (canManageCarriers=false)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm" } } });
    mockFrom.mockReturnValue(
      singleChain({ role: "market_manager", market_id: "m-tn" })
    );
    const res = await POST(req("/api/carriers/c-1/test"), {
      params: Promise.resolve({ id: "c-1" }),
    });
    expect(res.status).toBe(403);
  });

  test("reachability mode returns reachable true when HEAD 200", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa" } } });
    let n = 0;
    mockFrom.mockImplementation(() => {
      n++;
      if (n === 1) return singleChain({ role: "super_admin", market_id: null });
      return singleChain({
        id: "c-1",
        market_id: "m-tn",
        code: "navex",
        api_endpoint: "https://app.navex.tn/api",
      });
    });
    const res = await POST(req("/api/carriers/c-1/test"), {
      params: Promise.resolve({ id: "c-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reachable).toBe(true);
    expect(body.status).toBe(200);
    expect(body.adapter).toMatchObject({ code: "navex", known: true });
  });

  test("dry_run mode returns payload preview for known adapter", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa" } } });
    let n = 0;
    mockFrom.mockImplementation(() => {
      n++;
      if (n === 1) return singleChain({ role: "super_admin", market_id: null });
      return singleChain({
        id: "c-1",
        market_id: "m-tn",
        code: "navex",
        api_endpoint: "https://app.navex.tn/api",
      });
    });
    const res = await POST(
      req("/api/carriers/c-1/test?mode=dry_run"),
      { params: Promise.resolve({ id: "c-1" }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reachable).toBe(true);
    expect(body.adapter.known).toBe(true);
    expect(body.adapter.dryRun).toBeDefined();
    expect(typeof body.adapter.dryRun.payloadPreview).toBe("object");
    expect(Object.keys(body.adapter.dryRun.payloadPreview).length).toBeGreaterThan(0);
    // HEAD should NOT be called in dry_run mode
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("dry_run mode returns error for unknown adapter", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa" } } });
    let n = 0;
    mockFrom.mockImplementation(() => {
      n++;
      if (n === 1) return singleChain({ role: "super_admin", market_id: null });
      return singleChain({
        id: "c-1",
        market_id: "m-tn",
        code: "mystery",
        api_endpoint: "https://x",
      });
    });
    const res = await POST(
      req("/api/carriers/c-1/test?mode=dry_run"),
      { params: Promise.resolve({ id: "c-1" }) }
    );
    const body = await res.json();
    expect(body.adapter.known).toBe(false);
    expect(body.error).toMatch(/Adapter inconnu/);
  });

  test("reachability mode handles fetch failure gracefully", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa" } } });
    let n = 0;
    mockFrom.mockImplementation(() => {
      n++;
      if (n === 1) return singleChain({ role: "super_admin", market_id: null });
      return singleChain({
        id: "c-1",
        market_id: "m-tn",
        code: "navex",
        api_endpoint: "https://app.navex.tn/api",
      });
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    const res = await POST(req("/api/carriers/c-1/test"), {
      params: Promise.resolve({ id: "c-1" }),
    });
    const body = await res.json();
    expect(body.reachable).toBe(false);
    expect(body.error).toBe("Connection failed");
  });
});
