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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(new URL(url, "http://localhost:3000"), init as any);
}

type Chain = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
};

function selectChain(rows: unknown[]): Chain {
  const c: Partial<Chain> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockResolvedValue({ data: rows, error: null });
  c.insert = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null });
  return c as Chain;
}

function insertChain(data: unknown, error: unknown = null): Chain {
  const c: Partial<Chain> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockResolvedValue({ data: [], error: null });
  c.insert = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c as Chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/settings/statuses", () => {
  test("401 when unauthenticated", async () => {
    vi.mocked(getActor).mockResolvedValue({
      response: new Response("{}", { status: 401 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await GET(req("GET", "/api/settings/statuses"));
    expect(res.status).toBe(401);
  });

  test("400 when super_admin omits market_id", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });

    const res = await GET(req("GET", "/api/settings/statuses"));
    expect(res.status).toBe(400);
  });

  test("returns statuses for own market (manager)", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(
      selectChain([
        { id: "s1", market_id: TN, scope: "prospect", key: "new", sort_order: 1 },
      ])
    );

    const res = await GET(req("GET", "/api/settings/statuses"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].key).toBe("new");
  });

  test("403 when manager requests another market", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });

    const res = await GET(
      req("GET", `/api/settings/statuses?market_id=${LY}`)
    );
    expect(res.status).toBe(403);
  });

  test("filters by scope when provided", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    const chain = selectChain([]);
    mockFrom.mockReturnValue(chain);

    await GET(req("GET", "/api/settings/statuses?scope=prospect"));
    expect(chain.eq).toHaveBeenCalledWith("scope", "prospect");
  });
});

describe("POST /api/settings/statuses", () => {
  test("403 when actor is agent", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "a", role: "agent", market_id: TN },
    });

    const res = await POST(
      req("POST", "/api/settings/statuses", {
        market_id: TN,
        scope: "prospect",
        key: "x",
        label_fr: "X",
        label_ar: "س",
        sort_order: 99,
      })
    );
    expect(res.status).toBe(403);
  });

  test("403 when manager targets other market", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });

    const res = await POST(
      req("POST", "/api/settings/statuses", {
        market_id: LY,
        scope: "prospect",
        key: "x",
        label_fr: "X",
        label_ar: "س",
        sort_order: 99,
      })
    );
    expect(res.status).toBe(403);
  });

  test("400 when key fails regex", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });

    const res = await POST(
      req("POST", "/api/settings/statuses", {
        market_id: TN,
        scope: "prospect",
        key: "Bad Key!",
        label_fr: "X",
        label_ar: "س",
        sort_order: 99,
      })
    );
    expect(res.status).toBe(400);
  });

  test("400 when scope is invalid", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });

    const res = await POST(
      req("POST", "/api/settings/statuses", {
        market_id: TN,
        scope: "bogus",
        key: "x",
        label_fr: "X",
        label_ar: "س",
        sort_order: 99,
      })
    );
    expect(res.status).toBe(400);
  });

  test("201 on successful create", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(
      insertChain({
        id: "new-id",
        market_id: TN,
        scope: "prospect",
        key: "blocked",
        label_fr: "Bloqué",
        label_ar: "محجوب",
        color: "#64748B",
        sort_order: 99,
        is_initial: false,
        is_terminal: false,
        allowed_transitions: [],
      })
    );

    const res = await POST(
      req("POST", "/api/settings/statuses", {
        market_id: TN,
        scope: "prospect",
        key: "blocked",
        label_fr: "Bloqué",
        label_ar: "محجوب",
        sort_order: 99,
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.key).toBe("blocked");
  });
});
