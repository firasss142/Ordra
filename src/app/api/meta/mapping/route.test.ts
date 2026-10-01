import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase, type Row } from "@/test/helpers/fakeSupabase";

let fake: FakeSupabase;

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => fake.client,
  createClient: async () => fake.client,
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s }));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET, POST } from "./route";
import { POST as PREVIEW } from "./preview/route";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

/**
 * The mapping decides which product's P&L — and which investor's share —
 * absorbs a slice of spend, so the gate is super_admin, the account must belong
 * to the market the request names, and a save goes through the one RPC that
 * keeps history, then rewrites ad_spend for exactly the range the preview named.
 */

const ACCT = "1401484224203259";
const P1 = "11111111-1111-4111-8111-111111111111";
const LY = "ly";

function seed(): Record<string, Row[]> {
  return {
    meta_ad_accounts: [
      { ad_account_id: ACCT, market_id: LY, account_name: "Totella AdAccount 5", account_currency: "USD", account_timezone: "Africa/Tunis", last_synced_at: null, adset_history_from: "2026-05-23", is_active: true },
    ],
    meta_adset_daily: [
      { ad_account_id: ACCT, market_id: LY, external_campaign_id: "C1", external_adset_id: "S1", campaign_name: "BoxLyLong - relaunch", adset_name: "BoxLyLong relaunch", day: "2026-08-11", amount: 100, spend_original: 11.9, currency_original: "USD", fx_rate: 8.4, impressions: 1, reach: 1, clicks: 1, frequency: 1, platform_results: 1 },
    ],
    ad_spend_mappings: [],
    ad_spend_mapping_lines: [],
    products: [{ id: P1, market_id: LY, name: "Poupée", sku: null, image_url: null, is_active: true }],
  };
}

const draft = (over: Record<string, unknown> = {}) => ({
  market_id: LY,
  ad_account_id: ACCT,
  campaign_id: "C1",
  adset_id: null,
  kind: "products",
  split_mode: null,
  lines: [{ product_id: P1 }],
  effective_from: null,
  ...over,
});

const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  resetTestActor();
  setTestActor({ id: "admin-1", role: "super_admin", market_id: null });
  fake = makeFakeSupabase(seed());
  fake.rpcs.order_counts_by_product_day = () => [];
  fake.rpcs.set_ad_spend_mapping = () => "new-version";
  fake.rpcs.replace_meta_ad_spend = (args) => (args.p_rows as unknown[]).length;
});

describe("GET /api/meta/mapping", () => {
  test("403s for anyone but super_admin — a remap moves money between investors", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    const res = await GET(new NextRequest(`http://x/api/meta/mapping?market_id=${LY}`));
    expect(res.status).toBe(403);
  });

  test("400s without a market", async () => {
    const res = await GET(new NextRequest("http://x/api/meta/mapping"));
    expect(res.status).toBe(400);
  });

  test("returns the tree for the market", async () => {
    const res = await GET(new NextRequest(`http://x/api/meta/mapping?market_id=${LY}&from_date=2026-07-08&to_date=2026-09-30`));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.window).toEqual({ from: "2026-07-08", to: "2026-09-30" });
    expect(data.accounts[0].ad_account_id).toBe(ACCT);
  });

  test("without dates, covers the whole history — the drawer's one period", async () => {
    const res = await GET(new NextRequest(`http://x/api/meta/mapping?market_id=${LY}`));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    // No spend recorded yet: the period starts where the ad-set history does.
    expect(data.window.from).toBe("2026-05-23");
  });

  test("400s on a malformed date", async () => {
    const res = await GET(new NextRequest(`http://x/api/meta/mapping?market_id=${LY}&from_date=yesterday`));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/meta/mapping", () => {
  test("403s for a market manager", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    const res = await POST(post("http://x/api/meta/mapping", draft()));
    expect(res.status).toBe(403);
  });

  test("400s on a draft that would misstate money", async () => {
    const res = await POST(post("http://x/api/meta/mapping", draft({ split_mode: "manual", lines: [{ product_id: P1, share_pct: 60 }, { product_id: "22222222-2222-4222-8222-222222222222", share_pct: 30 }] })));
    expect(res.status).toBe(400);
  });

  test("400s on a product id that is not a UUID, instead of a database 500", async () => {
    const res = await POST(post("http://x/api/meta/mapping", draft({ lines: [{ product_id: "P1'; drop" }] })));
    expect(res.status).toBe(400);
  });

  test("404s on an ad set that is not in the named campaign", async () => {
    fake.tables.meta_ad_sets = [{ ad_account_id: ACCT, external_adset_id: "S1", external_campaign_id: "C-OTHER" }];
    const res = await POST(post("http://x/api/meta/mapping", draft({ adset_id: "S1" })));
    expect(res.status).toBe(404);
  });

  test("404s when the ad account is not the named market's", async () => {
    const res = await POST(post("http://x/api/meta/mapping", draft({ market_id: "tn" })));
    expect(res.status).toBe(404);
  });

  test("records the actor, then rewrites exactly the previewed range for that campaign", async () => {
    const calls: { name: string; args: Row }[] = [];
    fake.rpcs.set_ad_spend_mapping = (args) => {
      calls.push({ name: "set", args });
      return "new-version";
    };
    fake.rpcs.replace_meta_ad_spend = (args) => {
      calls.push({ name: "replace", args });
      return 1;
    };

    const res = await POST(post("http://x/api/meta/mapping", draft({ effective_from: "2026-08-01" })));
    expect(res.status).toBe(201);
    const { data } = await res.json();

    expect(calls.map((c) => c.name)).toEqual(["set", "replace"]);
    expect(calls[0].args).toMatchObject({
      p_actor_id: "admin-1",
      p_ad_account_id: ACCT,
      p_campaign_id: "C1",
      p_adset_id: null,
      p_effective_from: "2026-08-01",
      p_kind: "products",
      p_lines: [{ product_id: P1, share_pct: null }],
    });
    expect(calls[1].args).toMatchObject({ p_since: "2026-08-01", p_campaign_ids: ["C1"] });
    expect(data).toMatchObject({ id: "new-version", rows_rewritten: 1, pending_rebuild: false });
    expect(data.preview.range.since).toBe("2026-08-01");
  });

  test("turns the RPC's refusal into a 400 with its reason", async () => {
    fake.rpcs.set_ad_spend_mapping = () => {
      throw Object.assign(new Error("every product must belong to the ad account's market"), { code: "22023" });
    };
    const res = await POST(post("http://x/api/meta/mapping", draft()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/market/);
  });

  test("keeps the saved mapping and says the amounts are pending when the rewrite fails", async () => {
    fake.rpcs.replace_meta_ad_spend = () => {
      throw new Error("statement timeout");
    };
    const res = await POST(post("http://x/api/meta/mapping", draft()));
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ id: "new-version", pending_rebuild: true });
  });
});

describe("POST /api/meta/mapping/preview", () => {
  test("writes nothing", async () => {
    const calls: string[] = [];
    fake.rpcs.set_ad_spend_mapping = () => calls.push("set");
    fake.rpcs.replace_meta_ad_spend = () => calls.push("replace");
    const res = await PREVIEW(post("http://x/api/meta/mapping/preview", draft()));
    expect(res.status).toBe(200);
    expect(calls).toEqual([]);
    const { data } = await res.json();
    // The unmapped 100 leaves market level for the product.
    expect(data.products).toEqual([
      { product_id: P1, bucket: "product", before: 0, after: 100 },
      { product_id: null, bucket: "none", before: 100, after: 0 },
    ]);
  });

  test("403s for an agent", async () => {
    setTestActor({ role: "agent", market_id: LY });
    const res = await PREVIEW(post("http://x/api/meta/mapping/preview", draft()));
    expect(res.status).toBe(403);
  });
});
