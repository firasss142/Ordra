import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/actor", () => ({
  getActor: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      single: vi.fn().mockResolvedValue({ data: null }),
    })),
  })),
}));

vi.mock("@/lib/google-sheets/sources-config", () => ({
  getSheetsSources: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/google-sheets/sync-state", () => ({
  getLastRowForStorefront: vi.fn().mockResolvedValue(0),
  setLastRowForStorefront: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/google-sheets/client", () => ({
  fetchSheetRows: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/orders/create-order-from-data", () => ({
  createOrderFromData: vi.fn().mockResolvedValue({ status: "created", orderId: "x" }),
}));

// Run bookkeeping — the lock, the run record, the stale-run reaper — talks to
// tables this route test does not model. These cases are about who is allowed
// to trigger a sync and with what payload; sync-runs.test covers the rest.
vi.mock("@/lib/google-sheets/sync-runs", () => ({
  startRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  finishRun: vi.fn().mockResolvedValue(undefined),
  failRun: vi.fn().mockResolvedValue(undefined),
  recordSkipped: vi.fn().mockResolvedValue(undefined),
  recordFailedRow: vi.fn().mockResolvedValue(undefined),
  reapStaleRuns: vi.fn().mockResolvedValue(0),
}));

import { getActor } from "@/lib/auth/actor";

const MARKET_ID = "market-uuid";

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/google-sheets/sync", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("POST /api/google-sheets/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getActor).mockResolvedValueOnce({
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);

    const res = await POST(makeRequest({ market_id: MARKET_ID }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when role is 'agent'", async () => {
    vi.mocked(getActor).mockResolvedValueOnce({
      actor: { id: "agent-id", role: "agent", market_id: MARKET_ID },
    } as never);

    const res = await POST(makeRequest({ market_id: MARKET_ID }));
    expect(res.status).toBe(403);
  });

  it("returns 403 when market_manager tries to sync a different market", async () => {
    vi.mocked(getActor).mockResolvedValueOnce({
      actor: { id: "mgr-id", role: "market_manager", market_id: "other-market" },
    } as never);

    const res = await POST(makeRequest({ market_id: MARKET_ID }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when market_id is missing from body", async () => {
    vi.mocked(getActor).mockResolvedValueOnce({
      actor: { id: "sa-id", role: "super_admin", market_id: null },
    } as never);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 200 with results array on success for super_admin", async () => {
    vi.mocked(getActor).mockResolvedValueOnce({
      actor: { id: "sa-id", role: "super_admin", market_id: null },
    } as never);

    const res = await POST(makeRequest({ market_id: MARKET_ID }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("allows market_manager to sync their own market", async () => {
    vi.mocked(getActor).mockResolvedValueOnce({
      actor: { id: "mgr-id", role: "market_manager", market_id: MARKET_ID },
    } as never);

    const res = await POST(makeRequest({ market_id: MARKET_ID }));
    expect(res.status).toBe(200);
  });
});
