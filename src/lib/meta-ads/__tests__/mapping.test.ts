import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeFakeSupabase, type Row } from "@/test/helpers/fakeSupabase";

vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s }));

import { parseDraft, loadMappingTree, previewDraft, todayIn, type AccountRow } from "../mapping";

const ACCT = "1401484224203259";
const LY = "ly";
const NOW = new Date("2026-09-30T20:00:00Z");

const body = (over: Record<string, unknown> = {}) => ({
  market_id: LY,
  ad_account_id: ACCT,
  campaign_id: "C-RELAUNCH",
  adset_id: null,
  kind: "products",
  split_mode: "auto_orders",
  lines: [{ product_id: "M" }, { product_id: "S" }, { product_id: "L" }],
  effective_from: null,
  ...over,
});

describe("parseDraft — product ids", () => {
  it("refuses a product id that is not a UUID when UUIDs are required", () => {
    const r = parseDraft(body({ lines: [{ product_id: "not-a-uuid" }] }), { requireUuids: true });
    expect(r.ok).toBe(false);
  });
  it("accepts real UUIDs", () => {
    const r = parseDraft(
      body({ split_mode: null, lines: [{ product_id: "6f347bea-d5e7-4356-b233-6f47091564a2" }] }),
      { requireUuids: true },
    );
    expect(r.ok).toBe(true);
  });
});

describe("parseDraft — refuse what would misstate money before it reaches the RPC", () => {
  it("accepts an automatic three-way split over all history", () => {
    const r = parseDraft(body());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.draft).toMatchObject({ kind: "products", split_mode: "auto_orders", effective_from: null, adset_id: null });
  });

  it("drops shares on an automatic split — they would be ignored and then misread", () => {
    const r = parseDraft(body({ lines: [{ product_id: "M", share_pct: 90 }, { product_id: "S", share_pct: 10 }] }));
    expect(r.ok && r.draft.lines.every((l) => l.share_pct === null)).toBe(true);
  });

  it.each([
    ["manual shares that do not make 100", { split_mode: "manual", lines: [{ product_id: "M", share_pct: 60 }, { product_id: "S", share_pct: 30 }] }],
    ["a manual share that is not a number", { split_mode: "manual", lines: [{ product_id: "M", share_pct: "x" }, { product_id: "S", share_pct: 100 }] }],
    ["several products and no split mode", { split_mode: null }],
    ["the same product twice", { lines: [{ product_id: "M" }, { product_id: "M" }] }],
    ["products with no product", { lines: [] }],
    ["a market-level mapping carrying products", { kind: "market_level" }],
    ["a campaign that 'inherits'", { kind: "inherit", lines: [] }],
    ["an unknown kind", { kind: "everything" }],
    ["a malformed date", { effective_from: "01/08/2026" }],
    ["no campaign", { campaign_id: "" }],
  ])("refuses %s", (_label, over) => {
    expect(parseDraft(body(over)).ok).toBe(false);
  });

  it("accepts 33.33 / 33.33 / 33.34 — to the cent, not to float noise", () => {
    const r = parseDraft(body({ split_mode: "manual", lines: [{ product_id: "M", share_pct: 33.33 }, { product_id: "S", share_pct: 33.33 }, { product_id: "L", share_pct: 33.34 }] }));
    expect(r.ok).toBe(true);
  });

  it("lets an ad set go back to its campaign", () => {
    expect(parseDraft(body({ adset_id: "S1", kind: "inherit", lines: [], split_mode: null })).ok).toBe(true);
  });
});

describe("todayIn", () => {
  it("is the ad account's date, not UTC's", () => {
    // 23:30 UTC on the 30th is already 1 October in Tunis (UTC+1).
    expect(todayIn("Africa/Tunis", new Date("2026-09-30T23:30:00Z"))).toBe("2026-10-01");
  });
});

/* ─────────────────────────── fixture ─────────────────────────── */

const spend = (over: Row): Row => ({
  market_id: LY,
  source: "meta",
  is_active: true,
  ad_account_id: ACCT,
  external_campaign_id: "C-RELAUNCH",
  external_adset_id: "S-RELAUNCH",
  campaign_name: "BoxLyLong - relaunch",
  adset_name: "BoxLyLong relaunch",
  product_id: "L",
  allocation_basis: "single",
  platform_results: 10,
  ...over,
});

const fact = (over: Row): Row => ({
  ad_account_id: ACCT,
  market_id: LY,
  external_campaign_id: "C-RELAUNCH",
  external_adset_id: "S-RELAUNCH",
  campaign_name: "BoxLyLong - relaunch",
  adset_name: "BoxLyLong relaunch",
  spend_original: 10,
  currency_original: "USD",
  fx_rate: 8.4,
  impressions: 100,
  reach: 90,
  clicks: 5,
  frequency: 1.1,
  platform_results: 3,
  ...over,
});

function setup(extra: Record<string, Row[]> = {}) {
  const fake = makeFakeSupabase({
    meta_ad_accounts: [
      { ad_account_id: ACCT, market_id: LY, account_name: "Totella AdAccount 5", account_currency: "USD", account_timezone: "Africa/Tunis", last_synced_at: "2026-09-30T19:07:00Z", adset_history_from: "2026-05-23", is_active: true },
    ],
    settings: [{ market_id: LY, key: "ad_spend_fx_rates", value: { USD: 8.4 } }],
    meta_ad_campaigns: [
      { ad_account_id: ACCT, market_id: LY, external_campaign_id: "C-RELAUNCH", name: "BoxLyLong - relaunch", objective: "OUTCOME_SALES", effective_status: "PAUSED", created_time: "2026-07-06T09:00:00+0100" },
      { ad_account_id: ACCT, market_id: LY, external_campaign_id: "C-PETS", name: "Pets Glove test", objective: "OUTCOME_SALES", effective_status: "PAUSED", created_time: null },
    ],
    meta_ad_sets: [
      { ad_account_id: ACCT, market_id: LY, external_adset_id: "S-RELAUNCH", external_campaign_id: "C-RELAUNCH", name: "BoxLyLong relaunch", effective_status: "CAMPAIGN_PAUSED" },
      { ad_account_id: ACCT, market_id: LY, external_adset_id: "S-PETS", external_campaign_id: "C-PETS", name: "PetsGlove Ad Set", effective_status: "CAMPAIGN_PAUSED" },
    ],
    ad_spend: [
      spend({ period_start: "2026-07-06", amount: 227.472 }),
      spend({ period_start: "2026-08-11", amount: 433.944 }),
      // a legacy campaign-level row, before the ad-set rebuild — still counts
      spend({ external_campaign_id: "C-BOXHERO", external_adset_id: null, campaign_name: "BoxheroLY - LY", period_start: "2026-06-23", amount: 519, product_id: null, allocation_basis: null }),
      { ...spend({ period_start: "2026-08-12", amount: 1 }), source: "manual" },
    ],
    meta_adset_daily: [
      fact({ day: "2026-07-06", amount: 227.472 }),
      fact({ day: "2026-08-11", amount: 433.944 }),
    ],
    ad_spend_mappings: [
      { id: "old", market_id: LY, ad_account_id: ACCT, external_campaign_id: "C-RELAUNCH", external_adset_id: null, effective_from: null, kind: "products", split_mode: null, created_by: "u1", created_at: "2026-08-15T10:00:00Z", superseded_at: "2026-09-01T10:00:00Z" },
      { id: "live", market_id: LY, ad_account_id: ACCT, external_campaign_id: "C-RELAUNCH", external_adset_id: null, effective_from: null, kind: "products", split_mode: null, created_by: "u1", created_at: "2026-09-01T10:00:00Z", superseded_at: null },
    ],
    ad_spend_mapping_lines: [
      { mapping_id: "old", product_id: "M" },
      { mapping_id: "live", product_id: "L" },
    ],
    users: [{ id: "u1", full_name: "Super Admin" }],
    products: [
      { id: "M", market_id: LY, name: "دميه ملاكمه حجم متوسط", sku: null, image_url: null, is_active: true },
      { id: "S", market_id: LY, name: "دميه ملاكمه حجم صغير", sku: "box-wafra-shop", image_url: null, is_active: true },
      { id: "L", market_id: LY, name: "دميه ملاكمه حجم كبير", sku: null, image_url: null, is_active: true },
    ],
    investor_deal_statements: [
      { product_id: "S", sequence_no: 1, period_start: "2026-05-20", period_end: "2026-07-31", settled_at: "2026-08-18T12:59:20Z" },
    ],
    ...extra,
  });
  fake.rpcs.order_counts_by_product_day = () => [
    { day: "2026-07-06", product_id: "S", orders: 20 },
    { day: "2026-08-11", product_id: "M", orders: 84 },
    { day: "2026-08-11", product_id: "S", orders: 52 },
    { day: "2026-08-11", product_id: "L", orders: 17 },
  ];
  return { fake, admin: fake.client as unknown as SupabaseClient };
}

describe("loadMappingTree", () => {
  it("lists the whole catalogue, including a campaign that never spent", async () => {
    const { admin } = setup();
    const tree = await loadMappingTree(admin, { marketId: LY, from: "2026-07-08", to: "2026-09-30", now: NOW });
    expect(tree.campaigns.map((c) => c.id)).toEqual(["C-RELAUNCH", "C-BOXHERO", "C-PETS"]);
    const pets = tree.campaigns.find((c) => c.id === "C-PETS")!;
    expect(pets).toMatchObject({ spend_life: 0, name: "Pets Glove test", current_id: null });
    expect(pets.adsets.map((a) => a.id)).toEqual(["S-PETS"]);
  });

  it("counts only synced spend, in and out of the window, from the ledger the page reads", async () => {
    const { admin } = setup();
    const tree = await loadMappingTree(admin, { marketId: LY, from: "2026-07-08", to: "2026-09-30", now: NOW });
    const relaunch = tree.campaigns[0];
    expect(relaunch).toMatchObject({ spend_window: 433.944, spend_life: 661.416, results_window: 10, first_day: "2026-07-06", last_day: "2026-08-11" });
    expect(relaunch.daily).toEqual([["2026-08-11", 433.944]]);
    expect(relaunch.adsets[0]).toMatchObject({ id: "S-RELAUNCH", spend_life: 661.416, own_current_id: null });
  });

  it("names the version in force and keeps the superseded one as history, newest first", async () => {
    const { admin } = setup();
    const tree = await loadMappingTree(admin, { marketId: LY, from: "2026-07-08", to: "2026-09-30", now: NOW });
    const relaunch = tree.campaigns[0];
    expect(relaunch.current_id).toBe("live");
    expect(relaunch.versions.map((v) => [v.id, v.superseded_at !== null])).toEqual([["live", false], ["old", true]]);
    expect(relaunch.versions[0]).toMatchObject({ created_by_name: "Super Admin", lines: [{ product_id: "L", share_pct: null }] });
  });

  it("splits coverage into attributed, market-level and still to map", async () => {
    const { admin } = setup();
    const tree = await loadMappingTree(admin, { marketId: LY, from: "2026-07-08", to: "2026-09-30", now: NOW });
    expect(tree.coverage.life).toEqual({ total: 1180.416, attributed: 661.416, market_level: 0, unmapped: 519 });
    expect(tree.coverage.window).toEqual({ total: 433.944, attributed: 433.944, market_level: 0, unmapped: 0 });
    expect(tree.coverage.life_from).toBe("2026-06-23");
  });

  it("says, per campaign, how much is still waiting for a product", async () => {
    const { admin } = setup();
    const tree = await loadMappingTree(admin, { marketId: LY, from: "2026-07-08", to: "2026-09-30", now: NOW });
    const by = Object.fromEntries(tree.campaigns.map((c) => [c.id, c.spend_unattributed]));
    expect(by).toEqual({ "C-RELAUNCH": 0, "C-BOXHERO": 519, "C-PETS": 0 });
  });

  it("does not count deliberate general spend as waiting", async () => {
    const { admin } = setup({
      ad_spend: [
        spend({ external_campaign_id: "C-PETS", external_adset_id: "S-PETS", period_start: "2026-09-01", amount: 40, product_id: null, allocation_basis: "market_level" }),
      ],
    });
    const tree = await loadMappingTree(admin, { marketId: LY, now: NOW });
    expect(tree.campaigns.find((c) => c.id === "C-PETS")).toMatchObject({ spend_life: 40, spend_unattributed: 0 });
  });

  it("says what each product carried of a campaign, over its whole history", async () => {
    const { admin } = setup({
      ad_spend: [
        spend({ period_start: "2026-08-11", amount: 300, product_id: "M", allocation_basis: "auto_orders" }),
        spend({ period_start: "2026-08-11", amount: 100, product_id: "L", allocation_basis: "auto_orders" }),
        spend({ period_start: "2026-06-01", amount: 60, product_id: "L", allocation_basis: "auto_orders" }),
      ],
    });
    const tree = await loadMappingTree(admin, { marketId: LY, from: "2026-07-08", to: "2026-09-30", now: NOW });
    expect(tree.campaigns[0].spend_by_product).toEqual({ M: 300, L: 160 });
  });

  it("without a window, spans the whole history: from where tracking began to today", async () => {
    const { admin } = setup();
    const tree = await loadMappingTree(admin, { marketId: LY, now: NOW });
    // The account's ad-set history starts 23 May; the first spend is 23 June.
    expect(tree.window).toEqual({ from: "2026-05-23", to: "2026-09-30" });
    const relaunch = tree.campaigns[0];
    expect(relaunch).toMatchObject({ spend_window: 661.416, spend_life: 661.416 });
    expect(relaunch.daily).toEqual([["2026-07-06", 227.472], ["2026-08-11", 433.944]]);
  });

  it("without a window, reaches back to spend older than the ad-set history", async () => {
    const { admin } = setup({
      meta_ad_accounts: [
        { ad_account_id: ACCT, market_id: LY, account_name: null, account_currency: "USD", account_timezone: "Africa/Tunis", last_synced_at: null, adset_history_from: "2026-07-01", is_active: true },
      ],
    });
    const tree = await loadMappingTree(admin, { marketId: LY, now: NOW });
    expect(tree.window.from).toBe("2026-06-23");
  });

  it("gives each product its last-30-day orders, and the account its rate and history", async () => {
    const { admin } = setup();
    const tree = await loadMappingTree(admin, { marketId: LY, from: "2026-07-08", to: "2026-09-30", now: NOW });
    expect(tree.products.find((p) => p.id === "M")?.orders_30d).toBe(84);
    expect(tree.accounts).toEqual([
      expect.objectContaining({ ad_account_id: ACCT, fx_rate: 8.4, timezone: "Africa/Tunis", history_from: "2026-05-23" }),
    ]);
  });
});

describe("previewDraft — what a save will move, computed by the save's own code", () => {
  const account = (over: Partial<AccountRow> = {}): AccountRow => ({
    ad_account_id: ACCT,
    market_id: LY,
    account_name: null,
    account_currency: "USD",
    account_timezone: "Africa/Tunis",
    last_synced_at: null,
    adset_history_from: "2026-05-23",
    ...over,
  });

  it("moves the relaunch off the large doll alone, by each day's orders", async () => {
    const { admin } = setup();
    const r = parseDraft(body());
    if (!r.ok) throw new Error(r.error);
    const p = await previewDraft(admin, r.draft, account(), NOW);

    expect(p.range).toEqual({ since: "2026-07-06", until: "2026-09-30" });
    // 6 Jul: only the small size took orders → all of it; 11 Aug: 84 / 52 / 17
    const s = p.products.find((x) => x.product_id === "S")!;
    const l = p.products.find((x) => x.product_id === "L")!;
    expect(s.before).toBe(0);
    expect(s.after).toBeGreaterThan(227);
    expect(l.before).toBe(661.416);
    expect(l.after).toBeCloseTo((433.944 * 17) / 153, 2);
    expect(p.moved).toBeCloseTo(661.416 - l.after, 3);
    expect(p.shares.map((x) => [x.product_id, x.orders])).toEqual([["M", 84], ["S", 72], ["L", 17]]);
    expect(p.shares.reduce((a, x) => a + x.pct, 0)).toBeCloseTo(100, 6);
  });

  it("tells deliberate general spend apart from a product's margin", async () => {
    const { admin } = setup();
    const r = parseDraft(body({ kind: "market_level", split_mode: null, lines: [] }));
    if (!r.ok) throw new Error(r.error);
    const p = await previewDraft(admin, r.draft, account(), NOW);
    expect(p.products).toEqual([
      { product_id: null, bucket: "general", before: 0, after: 661.416 },
      { product_id: "L", bucket: "product", before: 661.416, after: 0 },
    ]);
    expect(p.moved).toBe(661.416);
  });

  it("names the settled investor statement whose period the change rewrites", async () => {
    const { admin } = setup();
    const r = parseDraft(body());
    if (!r.ok) throw new Error(r.error);
    const p = await previewDraft(admin, r.draft, account(), NOW);
    expect(p.statements).toEqual([
      { product_id: "S", sequence_no: 1, period_start: "2026-05-20", period_end: "2026-07-31", settled: true, delta: 227.472 },
    ]);
  });

  it("'from 1 August' leaves that statement alone", async () => {
    const { admin } = setup();
    const r = parseDraft(body({ effective_from: "2026-08-01" }));
    if (!r.ok) throw new Error(r.error);
    const p = await previewDraft(admin, r.draft, account(), NOW);
    expect(p.range).toEqual({ since: "2026-08-01", until: "2026-09-30" });
    expect(p.statements).toEqual([]);
  });

  it("never reaches before the complete ad-set history, and says so", async () => {
    const { admin } = setup();
    const r = parseDraft(body());
    if (!r.ok) throw new Error(r.error);
    const p = await previewDraft(admin, r.draft, account({ adset_history_from: "2026-08-01" }), NOW);
    expect(p.range?.since).toBe("2026-08-01");
    expect(p.clamped).toBe(true);
  });

  it("moves nothing recorded while no ad-set history exists", async () => {
    const { admin } = setup();
    const r = parseDraft(body());
    if (!r.ok) throw new Error(r.error);
    const p = await previewDraft(admin, r.draft, account({ adset_history_from: null }), NOW);
    expect(p).toMatchObject({ range: null, moved: 0, products: [] });
  });
});
