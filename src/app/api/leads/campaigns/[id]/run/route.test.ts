import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockAdminRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
  createAdminClient: vi.fn(() => ({
    rpc: (...args: unknown[]) => mockAdminRpc(...args),
  })),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: vi.fn(),
}));

import { POST } from "./route";
import { getActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";

function req() {
  return new NextRequest(
    new URL("/api/leads/campaigns/c1/run", "http://localhost:3000"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { method: "POST", body: JSON.stringify({}) } as any
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
  mockAdminRpc.mockResolvedValue({ data: "e-1", error: null });
});

describe("POST /api/leads/campaigns/[id]/run", () => {
  test("403 for agents", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "a", role: "agent", market_id: TN },
    });

    const res = await POST(req(), params);
    expect(res.status).toBe(403);
  });

  test("404 when campaign not found", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(singleChain(null));

    const res = await POST(req(), params);
    expect(res.status).toBe(404);
  });

  test("403 when manager runs campaign in other market", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(
      singleChain({ id: "c1", market_id: LY, name: "x" })
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(403);
  });

  test("200 calls RPC with correct params and returns counts", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr-1", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(
      singleChain({ id: "c1", market_id: TN, name: "upsell" })
    );
    mockRpc.mockResolvedValue({
      data: { campaign_id: "c1", inserted: 12, skipped: 3 },
      error: null,
    });

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "rpc_run_prospect_campaign",
      expect.objectContaining({
        p_campaign_id: "c1",
        p_actor_id: "mgr-1",
        p_actor_type: "manager",
      })
    );
    const body = await res.json();
    expect(body.data.inserted).toBe(12);
    expect(body.data.skipped).toBe(3);
  });

  test("super_admin actor_type is super_admin", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "sa-1", role: "super_admin", market_id: null },
    });
    mockFrom.mockReturnValue(
      singleChain({ id: "c1", market_id: TN, name: "upsell" })
    );
    mockRpc.mockResolvedValue({
      data: { campaign_id: "c1", inserted: 0, skipped: 0 },
      error: null,
    });

    await POST(req(), params);
    expect(mockRpc).toHaveBeenCalledWith(
      "rpc_run_prospect_campaign",
      expect.objectContaining({ p_actor_type: "super_admin" })
    );
  });

  test("500 propagates RPC error", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr-1", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(
      singleChain({ id: "c1", market_id: TN, name: "x" })
    );
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "No initial prospect status configured for market" },
    });

    const res = await POST(req(), params);
    expect(res.status).toBe(500);
  });
});

describe("POST /api/leads/campaigns/[id]/run — the run is journaled", () => {
  function asManagerRunning(result: { data: unknown; error: unknown }) {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr-1", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(singleChain({ id: "c1", market_id: TN, name: "upsell" }));
    mockRpc.mockResolvedValue(result);
  }

  test("records whatsapp.campaign_sent with the prospects created, in the runner's name", async () => {
    asManagerRunning({ data: { campaign_id: "c1", inserted: 12, skipped: 3 }, error: null });
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(createAdminClient).toHaveBeenCalledWith({ actorId: "mgr-1" });
    expect(mockAdminRpc).toHaveBeenCalledWith("journal_record", expect.objectContaining({
      p_action: "whatsapp.campaign_sent",
      p_entity_type: "campaign",
      p_entity_id: "c1",
      p_entity_label: "upsell",
      p_market_id: TN,
      p_context: { recipients: 12 },
    }));
  });

  test("a journal that fails changes nothing: the run still answers 200", async () => {
    asManagerRunning({ data: { campaign_id: "c1", inserted: 12, skipped: 3 }, error: null });
    mockAdminRpc.mockRejectedValue(new Error("journal down"));
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect((await res.json()).data.inserted).toBe(12);
  });

  test("an admin client that cannot be created changes nothing", async () => {
    asManagerRunning({ data: { campaign_id: "c1", inserted: 12, skipped: 3 }, error: null });
    vi.mocked(createAdminClient).mockImplementationOnce(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
  });

  test("a run that failed records nothing", async () => {
    asManagerRunning({ data: null, error: { message: "No initial prospect status configured for market" } });
    await POST(req(), params);
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });
});
