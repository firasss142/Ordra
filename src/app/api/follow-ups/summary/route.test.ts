import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockGetSummary = vi.fn();
const mockCreateClient = vi.fn().mockResolvedValue({});

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

vi.mock("@/lib/follow-ups/summary", () => ({
  getFollowUpsSummary: (...args: unknown[]) => mockGetSummary(...args),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function req(params?: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/follow-ups/summary");
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

const baseSummary = () => ({
  total: 10,
  open: 4,
  in_progress: 3,
  resolved: 2,
  escalated: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSummary.mockResolvedValue(baseSummary());
});

describe("GET /api/follow-ups/summary", () => {
  test("returns 401 when actor is not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockGetActor.mockResolvedValue({
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  test("returns 403 for warehouse_agent", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "w", role: "warehouse_agent", market_id: "m-tn" },
    });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  test("super_admin with no market_id passes null (all markets)", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mockGetSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ marketId: null, agentId: null, campaignId: null }),
    );
  });

  test("super_admin with market_id param is passed through", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });
    await GET(req({ market_id: "m-ly" }));
    expect(mockGetSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ marketId: "m-ly" }),
    );
  });

  test("super_admin with market_id=all resolves to null", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });
    await GET(req({ market_id: "all" }));
    expect(mockGetSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ marketId: null }),
    );
  });

  test("market_manager market_id param is ignored; pinned to own market", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "mgr-tn", role: "market_manager", market_id: "m-tn" },
    });
    await GET(req({ market_id: "m-ly" }));
    expect(mockGetSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ marketId: "m-tn" }),
    );
  });

  test("agent is hard-scoped to own market + confirming_agent_id", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "a-1", role: "agent", market_id: "m-tn" },
    });
    await GET(req({ agent_id: "a-99" }));
    expect(mockGetSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ marketId: "m-tn", agentId: "a-1" }),
    );
  });

  test("campaign_id is forwarded", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });
    await GET(req({ campaign_id: "c-42" }));
    expect(mockGetSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ campaignId: "c-42" }),
    );
  });

  test("sets Cache-Control header on success", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });
    const res = await GET(req());
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=2");
    const json = await res.json();
    expect(json.data.total).toBe(10);
  });
});
