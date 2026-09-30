import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

let user: FakeSupabase;
let admin: FakeSupabase;
const mockLoadConfig = vi.fn();
const mockSync = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => admin.client,
  createClient: async () => user.client,
}));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});
vi.mock("@/lib/whatsapp/config", () => ({ loadConfigForMarket: (...a: unknown[]) => mockLoadConfig(...a) }));
vi.mock("@/lib/whatsapp/client", () => ({ createWhatsAppClient: () => ({}) }));
vi.mock("@/lib/whatsapp/templates", () => ({ syncTemplatesFromMeta: (...a: unknown[]) => mockSync(...a) }));

import { POST } from "./route";

/**
 * « Vérifier le statut » — the sheet's pending banner and the card both call
 * this when the approval webhook has not arrived: sync from Meta, then flip
 * the campaign the way the webhook would.
 */
const LY = "00000000-0000-0000-0000-000000000002";
const req = () => new NextRequest(new URL("http://localhost:3000/api/prospects/campaigns/c-1/template-status"), { method: "POST" });
const params = { params: { id: "c-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  setTestActor({ role: "market_manager", market_id: LY, id: "mgr" });
  user = makeFakeSupabase({
    prospect_campaigns: [{ id: "c-1", market_id: LY, wa_template_id: "t-1", wa_launch_status: "pending_template" }],
  });
  admin = makeFakeSupabase({
    prospect_campaigns: [{ id: "c-1", market_id: LY, wa_launch_status: "pending_template" }],
    whatsapp_templates: [{ id: "t-1", name: "ordra_camp_serum_260925", status: "PENDING", rejected_reason: null }],
  });
  mockLoadConfig.mockResolvedValue({ status: "active", decryptFailed: false, market_id: LY });
  mockSync.mockResolvedValue({});
});

describe("POST /api/prospects/campaigns/[id]/template-status", () => {
  test("still pending: says so and changes nothing", async () => {
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ template_status: "PENDING", wa_launch_status: "pending_template" });
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(admin.log.filter((l) => l.table === "prospect_campaigns" && l.op === "update")).toHaveLength(0);
  });

  test("approved at Meta: the campaign becomes ready to launch", async () => {
    admin.tables.whatsapp_templates[0].status = "APPROVED";
    const body = await (await POST(req(), params)).json();
    expect(body).toMatchObject({ template_status: "APPROVED", wa_launch_status: "ready" });
    expect(admin.tables.prospect_campaigns[0].wa_launch_status).toBe("ready");
  });

  test("refused at Meta: the campaign is rejected, with Meta's reason", async () => {
    admin.tables.whatsapp_templates[0].status = "REJECTED";
    admin.tables.whatsapp_templates[0].rejected_reason = "INVALID_FORMAT";
    const body = await (await POST(req(), params)).json();
    expect(body).toMatchObject({ template_status: "REJECTED", rejected_reason: "INVALID_FORMAT", wa_launch_status: "rejected" });
    expect(admin.tables.prospect_campaigns[0].wa_launch_status).toBe("rejected");
  });

  test("a market whose number is not live is a 409, and Meta is not asked", async () => {
    mockLoadConfig.mockResolvedValue(null);
    expect((await POST(req(), params)).status).toBe(409);
    expect(mockSync).not.toHaveBeenCalled();
  });

  test("another market's manager is refused", async () => {
    setTestActor({ role: "market_manager", market_id: "00000000-0000-0000-0000-000000000001", id: "mgr-tn" });
    expect((await POST(req(), params)).status).toBe(403);
  });
});
