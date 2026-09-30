import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

let user: FakeSupabase;
let admin: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => admin.client,
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

beforeEach(() => {
  resetTestActor();
  runs.length = 0;
  setTestActor({ role: "market_manager", market_id: LY, id: "mgr" });
  user = makeFakeSupabase({
    prospect_campaigns: [{ id: "c-1", market_id: LY, wa_sender: "api", wa_template_id: "t-1", wa_launch_status: "ready", whatsapp_templates: { status: "APPROVED" } }],
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
