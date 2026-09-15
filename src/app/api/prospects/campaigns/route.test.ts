import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (...a: unknown[]) => mockFrom(...a),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { POST } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const NEW_CAMPAIGN = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const req = (body: unknown, q = "") =>
  new NextRequest(new URL(`http://localhost:3000/api/prospects/campaigns${q}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const as = (id: string, role: string, market_id: string | null) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id, role, market_id } } as never);

/** A sound campaign: delivered customers in a window, contacted by call. */
const body = (over: Record<string, unknown> = {}) => ({
  name: "Rachat sérum",
  offer: "−15 % sur le 50 ml",
  channel: "call",
  conditions: [
    { kind: "outcome", statuses: ["delivered"] },
    { kind: "period", mode: "preset", days: 180, from: "2026-03-19", to: "2026-09-15" },
  ],
  ...over,
});

let inserted: Record<string, unknown> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  inserted = null;
  mockFrom.mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      inserted = row;
      return chain;
    });
    chain.select = vi.fn(() => chain);
    chain.single = vi.fn(() =>
      Promise.resolve({ data: { id: NEW_CAMPAIGN, ...(inserted ?? {}) }, error: null }),
    );
    return chain;
  });
  mockRpc.mockImplementation((fn: string) => {
    if (fn === "preview_campaign_audience") {
      return Promise.resolve({
        data: {
          matched: 294,
          excluded: { openLead: 290, recentlyOrdered: 0, recentCampaign: 0, lostNotInterested: 0 },
          net: 4,
          sample: [],
        },
        error: null,
      });
    }
    if (fn === "rpc_run_prospect_campaign") {
      return Promise.resolve({ data: { campaign_id: NEW_CAMPAIGN, inserted: 4, skipped: 0 }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

describe("POST /api/prospects/campaigns?preview=1", () => {
  const preview = (b: unknown) => req(b, "?preview=1");

  test("an agent cannot size an audience", async () => {
    as("a1", "agent", LY);
    expect((await POST(preview(body()))).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("a preview creates nothing", async () => {
    as("m", "market_manager", LY);
    const res = await POST(preview(body()));
    expect(res.status).toBe(200);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledWith("preview_campaign_audience", expect.anything());
  });

  test("the exclusions come back named, not just a total", async () => {
    // A manager who sees "4" must be able to read why: on the rebuy template
    // in Libya, 290 of the 294 matched already have an open prospect.
    as("m", "market_manager", LY);
    const json = await (await POST(preview(body()))).json();
    expect(json.matched).toBe(294);
    expect(json.net).toBe(4);
    expect(json.excluded.openLead).toBe(290);
  });

  test("a manager previews their own market, whatever the body asks", async () => {
    as("m", "market_manager", LY);
    await POST(preview(body({ market_id: TN })));
    expect(mockRpc).toHaveBeenCalledWith(
      "preview_campaign_audience",
      expect.objectContaining({ p_market_id: LY }),
    );
  });

  test("the conditions reach the database as filter_json", async () => {
    as("m", "market_manager", LY);
    await POST(preview(body()));
    const args = mockRpc.mock.calls[0][1] as { p_filter: Record<string, unknown> };
    expect(args.p_filter.order_statuses).toEqual(["delivered"]);
    expect(args.p_filter.date_from).toBe("2026-03-19");
  });

  test("a condition set that would empty the audience is refused with its reason", async () => {
    // A rejection reason with no losing outcome returns nobody, and the
    // manager cannot see why unless the server says so.
    as("m", "market_manager", LY);
    const res = await POST(preview(body({
      conditions: [
        { kind: "outcome", statuses: ["delivered"] },
        { kind: "period", mode: "preset", days: 90, from: "2026-06-17", to: "2026-09-15" },
        { kind: "reason", reasons: ["refus_client"] },
      ],
    })));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors).toContainEqual(expect.objectContaining({ kind: "reason" }));
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/prospects/campaigns", () => {
  test("an agent cannot create a campaign", async () => {
    as("a1", "agent", LY);
    expect((await POST(req(body()))).status).toBe(403);
  });

  test("a super admin must name a market", async () => {
    as("sa", "super_admin", null);
    expect((await POST(req(body()))).status).toBe(400);
  });

  test("creating stores the conditions and runs the campaign", async () => {
    as("m", "market_manager", LY);
    const res = await POST(req(body()));
    expect(res.status).toBe(200);
    expect(inserted).toMatchObject({ market_id: LY, name: "Rachat sérum", channel: "call" });
    expect(mockRpc).toHaveBeenCalledWith(
      "rpc_run_prospect_campaign",
      expect.objectContaining({ p_campaign_id: NEW_CAMPAIGN }),
    );
  });

  test("the creator is recorded", async () => {
    as("mgr-3", "market_manager", LY);
    await POST(req(body()));
    expect(inserted).toMatchObject({ created_by: "mgr-3" });
  });

  test("a nameless campaign is refused", async () => {
    as("m", "market_manager", LY);
    expect((await POST(req(body({ name: "   " })))).status).toBe(400);
  });

  test("an unknown channel is refused", async () => {
    as("m", "market_manager", LY);
    expect((await POST(req(body({ channel: "pigeon" })))).status).toBe(400);
  });

  test("a WhatsApp campaign without a message is refused before the database sees it", async () => {
    // The table has a CHECK for this; catching it here gives the composer a
    // field to point at instead of a constraint violation.
    as("m", "market_manager", LY);
    const res = await POST(req(body({ channel: "wa", wa_message: "  " })));
    expect(res.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("a WhatsApp campaign keeps its message and sending rules", async () => {
    as("m", "market_manager", LY);
    await POST(req(body({
      channel: "wa_call",
      wa_message: "Bonjour {name}, …",
      wa_image: true,
      wa_sender: "agent",
      wa_window: "10-20",
      wa_rate: 40,
      wa_follow_up_hours: 24,
    })));
    expect(inserted).toMatchObject({
      channel: "wa_call",
      wa_message: "Bonjour {name}, …",
      wa_image: true,
      wa_sender: "agent",
      wa_rate: 40,
      wa_follow_up_hours: 24,
    });
  });

  test("the call script is stored in both languages", async () => {
    as("m", "market_manager", LY);
    await POST(req(body({ script_fr: "Bonjour…", script_ar: "مرحبا…" })));
    expect(inserted).toMatchObject({ script_fr: "Bonjour…", script_ar: "مرحبا…" });
  });

  test("a duplicate name is reported as a conflict, not a server error", async () => {
    // prospect_campaigns has UNIQUE (market_id, name).
    as("m", "market_manager", LY);
    mockFrom.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.insert = vi.fn(() => chain);
      chain.select = vi.fn(() => chain);
      chain.single = vi.fn(() =>
        Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } }),
      );
      return chain;
    });
    expect((await POST(req(body()))).status).toBe(409);
  });

  test("a campaign that creates no prospects still reports honestly", async () => {
    as("m", "market_manager", LY);
    mockRpc.mockImplementation((fn: string) =>
      fn === "rpc_run_prospect_campaign"
        ? Promise.resolve({ data: { campaign_id: NEW_CAMPAIGN, inserted: 0, skipped: 0 }, error: null })
        : Promise.resolve({ data: null, error: null }),
    );
    const json = await (await POST(req(body()))).json();
    expect(json.inserted).toBe(0);
  });
});
