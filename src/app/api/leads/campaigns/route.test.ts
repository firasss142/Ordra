import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: vi.fn(),
}));

import { GET, POST } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";

function req(method: "GET" | "POST", url: string, body?: unknown) {
  const init: { method: string; body?: string } = { method };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(
    new URL(url, "http://localhost:3000"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    init as any
  );
}

function listChain(rows: unknown[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockResolvedValue({ data: rows, error: null });
  return c;
}

function insertChain(row: unknown, error: unknown = null) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.insert = vi.fn().mockReturnValue(c);
  c.select = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: row, error });
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/leads/campaigns", () => {
  test("403 for agents", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "a", role: "agent", market_id: TN },
    });

    const res = await GET(req("GET", "/api/leads/campaigns"));
    expect(res.status).toBe(403);
  });

  test("manager sees own market", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    const chain = listChain([{ id: "c1", market_id: TN, name: "Q4 upsell" }]);
    mockFrom.mockReturnValue(chain);

    const res = await GET(req("GET", "/api/leads/campaigns"));
    expect(res.status).toBe(200);
    expect(chain.eq).toHaveBeenCalledWith("market_id", TN);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });

  test("400 when super_admin omits market_id", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });

    const res = await GET(req("GET", "/api/leads/campaigns"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/leads/campaigns", () => {
  test("403 for agents", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "a", role: "agent", market_id: TN },
    });

    const res = await POST(
      req("POST", "/api/leads/campaigns", {
        market_id: TN,
        name: "x",
        filter_json: {},
      })
    );
    expect(res.status).toBe(403);
  });

  test("403 when manager targets other market", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });

    const res = await POST(
      req("POST", "/api/leads/campaigns", {
        market_id: LY,
        name: "x",
        filter_json: {},
      })
    );
    expect(res.status).toBe(403);
  });

  test("400 when required fields missing", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });

    const res = await POST(
      req("POST", "/api/leads/campaigns", { market_id: TN })
    );
    expect(res.status).toBe(400);
  });

  test("400 when filter_json is not an object", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });

    const res = await POST(
      req("POST", "/api/leads/campaigns", {
        market_id: TN,
        name: "x",
        filter_json: "bogus",
      })
    );
    expect(res.status).toBe(400);
  });

  test("201 on successful create with created_by snapshot", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr-1", role: "market_manager", market_id: TN },
    });
    const chain = insertChain({
      id: "c1",
      market_id: TN,
      name: "Q4 upsell",
      filter_json: { order_statuses: ["delivered"] },
      created_by: "mgr-1",
    });
    mockFrom.mockReturnValue(chain);

    const res = await POST(
      req("POST", "/api/leads/campaigns", {
        market_id: TN,
        name: "Q4 upsell",
        filter_json: { order_statuses: ["delivered"] },
      })
    );
    expect(res.status).toBe(201);
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        market_id: TN,
        name: "Q4 upsell",
        created_by: "mgr-1",
      })
    );
  });
});
