import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { resetTestActor, setTestActor } from "@/test/helpers/actorMock";

let db: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => db.client,
  createAdminClient: () => db.client,
}));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});
vi.mock("@/lib/crypto", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ""),
  maskCredential: () => "••••••••",
}));
vi.mock("@/lib/markets/list", () => ({
  getAllActiveMarkets: async () => [
    { id: LY, code: "ly" },
    { id: TN, code: "tn" },
  ],
}));

import { GET, POST } from "./route";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest(new URL("http://localhost/api/carriers"), { method: "POST", body: JSON.stringify(body) }));

/**
 * Réglages › Livraison and › Entrepôts show which site each carrier ships
 * from (Libya: one Darb Assabil account per building), and « Ajouter un
 * transporteur » attaches the new account to its site.
 */
beforeEach(() => {
  resetTestActor();
  db = makeFakeSupabase({
    carriers: [
      { id: "c1", market_id: LY, name: "Darb Assabil - Tripoli", code: "darb_assabil", api_endpoint: "x", api_credentials: "enc:{}", delivery_fee: 10, return_fee: 5, is_active: true, warehouse_id: "w-tripoli" },
    ],
    warehouses: [
      { id: "w-tripoli", market_id: LY, is_active: true },
      { id: "w-benghazi", market_id: LY, is_active: true },
      { id: "w-tunis", market_id: TN, is_active: true },
    ],
  });
});

describe("GET /api/carriers", () => {
  test("returns the site each carrier ships from", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await GET(new NextRequest(new URL(`http://localhost/api/carriers?market_id=${LY}`)));
    expect(res.status).toBe(200);
    expect((await res.json()).data[0].warehouse_id).toBe("w-tripoli");
  });
});

describe("POST /api/carriers — site", () => {
  const base = { market_id: LY, name: "Darb Assabil - Misrata", code: "darb_assabil", api_endpoint: "https://v2.sabil.ly", credentials: { api_key: "k" } };

  test("attaches the new carrier to a site of its market", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await post({ ...base, warehouse_id: "w-benghazi" });
    expect(res.status).toBe(201);
    const created = db.tables.carriers.find((c) => c.name === "Darb Assabil - Misrata");
    expect(created?.warehouse_id).toBe("w-benghazi");
  });

  test("refuses a site from another market", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await post({ ...base, warehouse_id: "w-tunis" });
    expect(res.status).toBe(400);
    expect(db.tables.carriers).toHaveLength(1);
  });
});
