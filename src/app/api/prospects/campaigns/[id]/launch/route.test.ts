import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

let user: FakeSupabase;
let admin: FakeSupabase;
const adminOptions: unknown[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: (opts?: unknown) => {
    adminOptions.push(opts);
    return admin.client;
  },
  createClient: async () => user.client,
}));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { POST } from "./route";

const LY = "00000000-0000-0000-0000-000000000002";
const req = () => new NextRequest(new URL("http://localhost:3000/api/prospects/campaigns/c-1/launch"), { method: "POST" });
const params = { params: { id: "c-1" } };
const runs: string[] = [];

const journaled: Array<Record<string, unknown>> = [];

beforeEach(() => {
  resetTestActor();
  runs.length = 0;
  journaled.length = 0;
  adminOptions.length = 0;
  setTestActor({ role: "market_manager", market_id: LY, id: "mgr" });
  user = makeFakeSupabase({
    prospect_campaigns: [{ id: "c-1", market_id: LY, name: "Relance octobre", wa_sender: "api", wa_template_id: "t-1", wa_launch_status: "ready", whatsapp_templates: { status: "APPROVED" } }],
  });
  user.rpcs.rpc_run_prospect_campaign = (args) => {
    runs.push(`run:${args.p_campaign_id}:${args.p_actor_type}`);
    return { inserted: 412, skipped: 3 };
  };
  admin = makeFakeSupabase({});
  admin.rpcs.whatsapp_enqueue_campaign = (args) => {
    runs.push(`enqueue:${args.p_campaign_id}`);
    return { inserted: 412, queued: 400, skipped_by_reason: { invalid_phone: 9, opted_out: 3 } };
  };
  admin.rpcs.journal_record = (args) => {
    journaled.push(args);
    return "e-1";
  };
});

describe("POST /api/prospects/campaigns/[id]/launch", () => {
  test("approved: spawns the prospects, then queues the paced sends", async () => {
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(runs).toEqual(["run:c-1:manager", "enqueue:c-1"]);
    expect(await res.json()).toEqual({ id: "c-1", inserted: 412, skipped: 3, queued: 400, skipped_by_reason: { invalid_phone: 9, opted_out: 3 } });
  });

  test("409 while the template is not approved, and nothing is spawned", async () => {
    user.tables.prospect_campaigns[0].whatsapp_templates = { status: "PENDING" };
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("template_not_approved");
    expect(runs).toEqual([]);
  });

  test("409 for an agent-sent campaign; 403 for another market's manager; 404 unknown", async () => {
    user.tables.prospect_campaigns[0].wa_sender = "agent";
    expect((await POST(req(), params)).status).toBe(409);
    user.tables.prospect_campaigns[0].wa_sender = "api";
    setTestActor({ role: "market_manager", market_id: "00000000-0000-0000-0000-000000000001" });
    expect((await POST(req(), params)).status).toBe(403);
    setTestActor({ role: "super_admin", market_id: null });
    expect((await POST(req(), { params: { id: "nope" } })).status).toBe(404);
  });
});

describe("POST /api/prospects/campaigns/[id]/launch — the send is journaled", () => {
  test("records whatsapp.campaign_sent with the recipients queued, in the launcher's name", async () => {
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(adminOptions).toContainEqual({ actorId: "mgr" });
    expect(journaled).toEqual([
      expect.objectContaining({
        p_action: "whatsapp.campaign_sent",
        p_entity_type: "campaign",
        p_entity_id: "c-1",
        p_entity_label: "Relance octobre",
        p_market_id: LY,
        p_context: { recipients: 400 },
      }),
    ]);
  });

  test("a journal that fails changes nothing: the launch still answers 200", async () => {
    admin.rpcs.journal_record = () => {
      throw new Error("journal down");
    };
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect((await res.json()).queued).toBe(400);
  });

  test("a launch that does not happen records nothing", async () => {
    user.tables.prospect_campaigns[0].whatsapp_templates = { status: "PENDING" };
    await POST(req(), params);
    delete admin.rpcs.whatsapp_enqueue_campaign;
    user.tables.prospect_campaigns[0].whatsapp_templates = { status: "APPROVED" };
    expect((await POST(req(), params)).status).toBe(500);
    expect(journaled).toEqual([]);
  });
});
