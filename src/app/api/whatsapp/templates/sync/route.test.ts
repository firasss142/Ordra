import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => fake.client,
  createClient: async () => fake.client,
}));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});
vi.mock("@/lib/crypto", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ""),
  maskCredential: () => "••••••••",
}));
const mockSync = vi.fn();
const mockCreate = vi.fn();
vi.mock("@/lib/whatsapp/templates", async () => {
  const actual = await vi.importActual<typeof import("@/lib/whatsapp/templates")>("@/lib/whatsapp/templates");
  return { ...actual, syncTemplatesFromMeta: (...a: unknown[]) => mockSync(...a), createMissingCatalogueTemplates: (...a: unknown[]) => mockCreate(...a) };
});
vi.mock("@/lib/whatsapp/client", () => ({ createWhatsAppClient: () => ({}) }));

import { POST as SYNC } from "./route";
import { POST as CATALOGUE } from "../catalogue/route";

const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";
const CFG = { id: "cfg-tn", market_id: TN, waba_id: "444", phone_number_id: "111", app_id: "777", graph_version: "v26.0", access_token: "enc:EAA", app_secret: "enc:s", verify_token: "enc:v", status: "active", send_rate_per_sec: 3 };
const post = (path: string, body: unknown) =>
  new NextRequest(new URL(`http://localhost:3000/api/whatsapp/templates/${path}`), { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  fake = makeFakeSupabase({ whatsapp_configs: [CFG] });
  mockSync.mockResolvedValue({ total: 3, inserted: 1, updated: 2, deleted: 0 });
  mockCreate.mockResolvedValue({ created: ["a/fr"], skipped: [], failed: [] });
});

describe("POST /api/whatsapp/templates/sync", () => {
  test("manager syncs their own market; the result is returned", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    const res = await SYNC(post("sync", { market_id: TN }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ total: 3, inserted: 1, updated: 2, deleted: 0 });
    expect(mockSync).toHaveBeenCalledOnce();
  });

  test("manager of another market is refused; agent too", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    expect((await SYNC(post("sync", { market_id: TN }))).status).toBe(403);
    setTestActor({ role: "agent", market_id: TN });
    expect((await SYNC(post("sync", { market_id: TN }))).status).toBe(403);
    expect(mockSync).not.toHaveBeenCalled();
  });

  test("409 when the market has no active config", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await SYNC(post("sync", { market_id: LY }))).status).toBe(409);
    fake.tables.whatsapp_configs[0].status = "auth_failed";
    expect((await SYNC(post("sync", { market_id: TN }))).status).toBe(409);
  });

  test("a Graph failure is reported as 502 with the message", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockSync.mockRejectedValue(new Error("(#190) token expired"));
    const res = await SYNC(post("sync", { market_id: TN }));
    expect(res.status).toBe(502);
    expect((await res.json()).message).toMatch(/190/);
  });
});

describe("POST /api/whatsapp/templates/catalogue", () => {
  test("creates the catalogue for the market and returns counts", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await CATALOGUE(post("catalogue", { market_id: TN }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ created: ["a/fr"], skipped: [], failed: [] });
    const opts = mockCreate.mock.calls[0][3] as { readSampleImage: () => Promise<{ bytes: Uint8Array; mime: string; name: string }> };
    const img = await opts.readSampleImage();
    expect(img.mime).toBe("image/jpeg");
    expect(img.bytes.byteLength).toBeGreaterThan(1000);
  });

  test("agents and other-market managers are refused", async () => {
    setTestActor({ role: "agent", market_id: TN });
    expect((await CATALOGUE(post("catalogue", { market_id: TN }))).status).toBe(403);
    setTestActor({ role: "market_manager", market_id: LY });
    expect((await CATALOGUE(post("catalogue", { market_id: TN }))).status).toBe(403);
  });
});
