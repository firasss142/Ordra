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

import { GET } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";

function req() {
  return new NextRequest(
    new URL("/api/leads/campaigns/c1", "http://localhost:3000"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { method: "GET" } as any
  );
}

function singleChain(row: unknown) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: row, error: null });
  return c;
}

const params = { params: Promise.resolve({ id: "c1" }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/leads/campaigns/[id]", () => {
  test("403 for agents", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "a", role: "agent", market_id: TN },
    });

    const res = await GET(req(), params);
    expect(res.status).toBe(403);
  });

  test("404 when not found", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(singleChain(null));

    const res = await GET(req(), params);
    expect(res.status).toBe(404);
  });

  test("403 when manager targets other market's campaign", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(
      singleChain({ id: "c1", market_id: LY, name: "x", filter_json: {} })
    );

    const res = await GET(req(), params);
    expect(res.status).toBe(403);
  });

  test("200 returns the campaign", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(
      singleChain({ id: "c1", market_id: TN, name: "Q4 upsell", filter_json: {} })
    );

    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe("Q4 upsell");
  });
});
