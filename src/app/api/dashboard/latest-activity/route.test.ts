import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockGetLatest = vi.fn();

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));

vi.mock("@/lib/dashboard/latest-activity", () => ({
  getLatestActivityDateCached: (...args: unknown[]) => mockGetLatest(...args),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function req(params?: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/dashboard/latest-activity");
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLatest.mockResolvedValue("2026-04-27");
});

describe("GET /api/dashboard/latest-activity", () => {
  test("403 for agent", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a", role: "agent", market_id: "m1" } });
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  test("403 for warehouse_agent", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "a", role: "warehouse_agent", market_id: "m1" },
    });
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  test("returns early response when getActor rejects auth", async () => {
    const early = new Response("no", { status: 401 });
    mockGetActor.mockResolvedValue({ response: early });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockGetLatest).not.toHaveBeenCalled();
  });

  test("super_admin: uses market_id query param", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "a", role: "super_admin", market_id: null },
    });
    const res = await GET(req({ market_id: "market-tn" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.latest_activity_date).toBe("2026-04-27");
    expect(mockGetLatest).toHaveBeenCalledWith("market-tn");
  });

  test('super_admin without market_id defaults to "all"', async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "a", role: "super_admin", market_id: null },
    });
    await GET(req());
    expect(mockGetLatest).toHaveBeenCalledWith("all");
  });

  test("market_manager is locked to their own market, ignoring the param", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "a", role: "market_manager", market_id: "market-ly" },
    });
    await GET(req({ market_id: "market-tn" }));
    expect(mockGetLatest).toHaveBeenCalledWith("market-ly");
  });

  test("returns null when there is no activity", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "a", role: "super_admin", market_id: null },
    });
    mockGetLatest.mockResolvedValue(null);
    const res = await GET(req({ market_id: "market-empty" }));
    const body = await res.json();
    expect(body.data.latest_activity_date).toBeNull();
  });
});
