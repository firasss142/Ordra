import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

let user: FakeSupabase;
let admin: FakeSupabase;
const mockLoadConfig = vi.fn();
const mockSubmit = vi.fn();
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
vi.mock("@/lib/whatsapp/campaign-submit", () => ({ uploadHeaderImage: vi.fn().mockResolvedValue("4:h") }));
vi.mock("@/lib/whatsapp/templates", () => ({ submitCampaignTemplate: (...a: unknown[]) => mockSubmit(...a) }));

import { POST } from "./route";

/**
 * « Modifier et resoumettre » — Meta never edits a rejected template, so the
 * corrected text goes out as a NEW template (`_v2`, `_v3`…) and the campaign
 * waits for it. Prototype: whatsapp-manager-v1.html?screen=campagne&tstatus=rejected.
 */
const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const req = (body: unknown) =>
  new NextRequest(new URL("http://localhost:3000/api/prospects/campaigns/c-1/resubmit"), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
const params = { params: { id: "c-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  setTestActor({ role: "market_manager", market_id: LY, id: "mgr" });
  user = makeFakeSupabase({
    prospect_campaigns: [{
      id: "c-1", market_id: LY, name: "Sérum · clients 60–120 j", wa_sender: "api", wa_language: "ar",
      wa_image_url: null, wa_launch_status: "rejected", wa_template_id: "t-1", wa_window: "10-20", wa_rate: 60,
    }],
  });
  admin = makeFakeSupabase({
    prospect_campaigns: [{ id: "c-1", market_id: LY, wa_launch_status: "rejected", wa_window: "10-20", wa_rate: 60 }],
    whatsapp_templates: [{ id: "t-1", campaign_id: "c-1", name: "ordra_camp_serum_clients_60_120_j_260925" }],
  });
  mockLoadConfig.mockResolvedValue({ status: "active", decryptFailed: false, market_id: LY });
  mockSubmit.mockResolvedValue({ templateId: "t-2", metaTemplateId: "m-2", status: "PENDING" });
});

describe("POST /api/prospects/campaigns/[id]/resubmit", () => {
  test("a rejected campaign goes back to Meta as version 2 and waits for it", async () => {
    const res = await POST(req({ wa_message: "مرحباً {nom}، {produit} بخصم اليوم." }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.template_name).toMatch(/^ordra_camp_serum_clients_60_120_j_\d{6}_v2$/);
    expect(body.wa_launch_status).toBe("pending_template");
    expect(mockSubmit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ campaignId: "c-1", language: "ar" }));
    const row = admin.tables.prospect_campaigns[0];
    expect(row).toMatchObject({ wa_template_id: "t-2", wa_launch_status: "pending_template", wa_message: "مرحباً {nom}، {produit} بخصم اليوم." });
  });

  test("the pacing can be corrected in the same gesture, since nothing has been queued yet", async () => {
    const res = await POST(req({ wa_message: "Bonjour {nom}, ok.", wa_window: "14-21", wa_rate: 40 }), params);
    expect(res.status).toBe(200);
    expect(admin.tables.prospect_campaigns[0]).toMatchObject({ wa_window: "14-21", wa_rate: 40 });
  });

  test("a pacing the drain could not honour is refused before Meta hears of it", async () => {
    expect((await POST(req({ wa_message: "Bonjour {nom}, ok.", wa_window: "20-10" }), params)).status).toBe(400);
    expect((await POST(req({ wa_message: "Bonjour {nom}, ok.", wa_rate: 0 }), params)).status).toBe(400);
    expect((await POST(req({ wa_message: "Bonjour {nom}, ok.", wa_rate: 5000 }), params)).status).toBe(400);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  test("leaving the pacing out keeps what the campaign had", async () => {
    await POST(req({ wa_message: "Bonjour {nom}, ok." }), params);
    expect(admin.tables.prospect_campaigns[0]).toMatchObject({ wa_window: "10-20", wa_rate: 60 });
  });

  test("a body Meta would refuse again is refused here, with the reason", async () => {
    const res = await POST(req({ wa_message: "Bonjour, voici {produit}" }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toContain("ends_with_variable");
  });

  test("409 once launched; 403 for another market's manager", async () => {
    user.tables.prospect_campaigns[0].wa_launch_status = "launched";
    expect((await POST(req({ wa_message: "Bonjour {nom}, ok." }), params)).status).toBe(409);
    user.tables.prospect_campaigns[0].wa_launch_status = "rejected";
    setTestActor({ role: "market_manager", market_id: TN, id: "mgr-tn" });
    expect((await POST(req({ wa_message: "Bonjour {nom}, ok." }), params)).status).toBe(403);
  });
});
