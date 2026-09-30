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
  decrypt: (s: string) => {
    if (!s.startsWith("enc:")) throw new Error("bad ciphertext");
    return s.slice(4);
  },
  maskCredential: () => "••••••••",
}));

import { GET } from "./route";

/**
 * « Afficher » on the verify token. The operator has to paste it into the
 * Meta app, so it must be readable again — but it is the ONLY secret that
 * may ever come back, only to a super_admin, and alone: never next to the
 * access token or the app secret.
 */
const TN = "00000000-0000-0000-0000-000000000001";
const ROW = {
  id: "cfg-tn",
  market_id: TN,
  waba_id: "444",
  phone_number_id: "111",
  app_id: "777",
  graph_version: "v26.0",
  access_token: "enc:EAAtoken",
  app_secret: "enc:appsecret",
  verify_token: "enc:ordra-tn-2b9e4d1c7a",
  status: "active",
};
const req = () => new NextRequest(new URL(`http://localhost:3000/api/whatsapp/config/${TN}/verify-token`), { method: "GET" });
const params = { params: { marketId: TN } };

beforeEach(() => {
  resetTestActor();
  fake = makeFakeSupabase({ whatsapp_configs: [{ ...ROW }] });
});

describe("GET /api/whatsapp/config/[marketId]/verify-token", () => {
  test("super_admin gets the decrypted verify token and nothing else", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: { verify_token: "ordra-tn-2b9e4d1c7a" } });
    expect(JSON.stringify(body)).not.toMatch(/EAAtoken|appsecret/);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  test("a market_manager is refused, even on their own market; agents too", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    expect((await GET(req(), params)).status).toBe(403);
    setTestActor({ role: "agent", market_id: TN });
    expect((await GET(req(), params)).status).toBe(403);
  });

  test("404 when the market has no config", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await GET(req(), { params: { marketId: "nope" } })).status).toBe(404);
  });

  test("a row the key no longer opens is a 409, not a crash and not ciphertext", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    fake.tables.whatsapp_configs[0].verify_token = "garbage";
    const res = await GET(req(), params);
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toContain("garbage");
  });
});
