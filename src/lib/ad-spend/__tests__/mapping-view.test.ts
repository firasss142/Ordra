import { describe, it, expect } from "vitest";
import {
  campaignVersion,
  adsetResolution,
  isUnmapped,
  filterCampaigns,
  evenShares,
  manualSum,
  draftProblems,
  draftFromVersion,
  toDraftBody,
} from "../mapping-view";
import type { CampaignNodeDTO, MappingVersionDTO, AdsetNodeDTO } from "../mapping-types";

const version = (over: Partial<MappingVersionDTO>): MappingVersionDTO => ({
  id: "v",
  external_adset_id: null,
  effective_from: null,
  kind: "products",
  split_mode: null,
  lines: [{ product_id: "Q", share_pct: null }],
  created_by_name: "Super Admin",
  created_at: "2026-08-15T10:00:00Z",
  superseded_at: null,
  ...over,
});

const spend = { spend_window: 0, spend_life: 0, results_window: 0, first_day: null, last_day: null, daily: [] };

const adset = (over: Partial<AdsetNodeDTO>): AdsetNodeDTO => ({
  id: "S1",
  name: "batch 1",
  status: "ACTIVE",
  created_time: null,
  ...spend,
  versions: [],
  own_current_id: null,
  ...over,
});

const campaign = (over: Partial<CampaignNodeDTO>): CampaignNodeDTO => ({
  id: "C1",
  ad_account_id: "act",
  name: "QuranTadabr",
  objective: "OUTCOME_SALES",
  status: "ACTIVE",
  created_time: null,
  ...spend,
  versions: [],
  current_id: null,
  adsets: [],
  ...over,
});

describe("what a node sells today", () => {
  const camp = campaign({ versions: [version({ id: "cv" })], current_id: "cv", adsets: [adset({})] });

  it("a campaign reads its version in force", () => {
    expect(campaignVersion(camp)?.id).toBe("cv");
  });

  it("an ad set with nothing of its own follows its campaign", () => {
    expect(adsetResolution(camp, camp.adsets[0])).toEqual({ version: expect.objectContaining({ id: "cv" }), inherited: true });
  });

  it("an ad set's own version wins", () => {
    const s = adset({ versions: [version({ id: "own", external_adset_id: "S1" })], own_current_id: "own" });
    expect(adsetResolution(camp, s)).toEqual({ version: expect.objectContaining({ id: "own" }), inherited: false });
  });

  it("an ad set that went back to 'inherit' follows its campaign again", () => {
    const s = adset({ versions: [version({ id: "back", kind: "inherit", lines: [] })], own_current_id: "back" });
    expect(adsetResolution(camp, s)).toEqual({ version: expect.objectContaining({ id: "cv" }), inherited: true });
  });

  it("a campaign with only superseded versions is still 'to map'", () => {
    expect(isUnmapped(campaign({ versions: [version({ superseded_at: "2026-09-01T00:00:00Z" })] }))).toBe(true);
    expect(isUnmapped(camp)).toBe(false);
  });
});

describe("filterCampaigns", () => {
  const list = [
    campaign({ id: "a", name: "QuranTadabr", status: "ACTIVE", spend_life: 100, versions: [version({})], current_id: "v" }),
    campaign({ id: "b", name: "BoxheroLY", status: "PAUSED", spend_life: 519 }),
    campaign({ id: "c", name: "Pets Glove test", status: "PAUSED", spend_life: 0 }),
    campaign({ id: "d", name: "book qiyam layl", status: "PAUSED", adsets: [adset({ status: "ACTIVE", name: "QIYAM - Adset 1" })], versions: [version({ lines: [{ product_id: "T", share_pct: null }] })], current_id: "v" }),
  ];
  const names = { Q: "القرآن تدبر وعمل", T: "مصحف التهجد" };

  it("'to map' keeps only campaigns nobody has decided", () => {
    expect(filterCampaigns(list, { filter: "unmapped", query: "", hideNeverSpent: false, productNames: names }).map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("'active' counts a campaign whose ad set runs", () => {
    expect(filterCampaigns(list, { filter: "active", query: "", hideNeverSpent: false, productNames: names }).map((c) => c.id)).toEqual(["a", "d"]);
  });

  it("can hide the campaigns that never spent", () => {
    expect(filterCampaigns(list, { filter: "all", query: "", hideNeverSpent: true, productNames: names }).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("searches campaign, ad set and product names, case-insensitively", () => {
    const f = (query: string) => filterCampaigns(list, { filter: "all", query, hideNeverSpent: false, productNames: names }).map((c) => c.id);
    expect(f("boxhero")).toEqual(["b"]);
    expect(f("qiyam - adset")).toEqual(["d"]);
    expect(f("التهجد")).toEqual(["d"]);
  });
});

describe("manual shares", () => {
  it("even shares always add up to exactly 100", () => {
    expect(evenShares(3)).toEqual([33.34, 33.33, 33.33]);
    expect(evenShares(2)).toEqual([50, 50]);
    expect(manualSum(evenShares(7).map((share_pct) => ({ product_id: "x", share_pct })))).toBe(100);
  });

  it("sums to the cent, not to float noise", () => {
    expect(manualSum([{ product_id: "a", share_pct: 33.33 }, { product_id: "b", share_pct: 33.33 }, { product_id: "c", share_pct: 33.34 }])).toBe(100);
  });
});

describe("draftProblems — what keeps Apply disabled", () => {
  const base = { kind: "products" as const, split_mode: "auto_orders" as const, lines: [{ product_id: "M", share_pct: null }], scope: "all" as const, from: "2026-09-30" };

  it("needs at least one product", () => {
    expect(draftProblems({ ...base, lines: [] })).toEqual(["no_products"]);
  });

  it("needs manual shares that make 100", () => {
    expect(draftProblems({ ...base, split_mode: "manual", lines: [{ product_id: "M", share_pct: 60 }, { product_id: "S", share_pct: 30 }] })).toEqual(["manual_sum"]);
    expect(draftProblems({ ...base, split_mode: "manual", lines: [{ product_id: "M", share_pct: 60 }, { product_id: "S", share_pct: 40 }] })).toEqual([]);
  });

  it("needs a date when applying from a date", () => {
    expect(draftProblems({ ...base, scope: "from", from: "" })).toEqual(["no_date"]);
  });

  it("market level and inherit need nothing else", () => {
    expect(draftProblems({ ...base, kind: "market_level", lines: [] })).toEqual([]);
    expect(draftProblems({ ...base, kind: "inherit", lines: [] })).toEqual([]);
  });
});

describe("drafts", () => {
  it("starts from what is in force, applied from today by default", () => {
    const d = draftFromVersion(version({ lines: [{ product_id: "Q", share_pct: null }] }), { today: "2026-09-30", isAdset: false });
    expect(d).toEqual({ kind: "products", split_mode: "auto_orders", lines: [{ product_id: "Q", share_pct: null }], scope: "from", from: "2026-09-30" });
  });

  it("an unmapped campaign starts as 'products', empty, over all history", () => {
    expect(draftFromVersion(null, { today: "2026-09-30", isAdset: false })).toMatchObject({ kind: "products", lines: [], scope: "all" });
  });

  it("an ad set that follows its campaign starts as 'inherit'", () => {
    expect(draftFromVersion(null, { today: "2026-09-30", isAdset: true })).toMatchObject({ kind: "inherit" });
  });

  it("becomes the API body — no shares on an automatic split, null date for all history", () => {
    const body = toDraftBody(
      { kind: "products", split_mode: "auto_orders", lines: [{ product_id: "M", share_pct: 60 }, { product_id: "S", share_pct: 40 }], scope: "all", from: "2026-08-01" },
      { marketId: "ly", adAccountId: "act", campaignId: "C1", adsetId: null },
    );
    expect(body).toEqual({
      market_id: "ly", ad_account_id: "act", campaign_id: "C1", adset_id: null,
      kind: "products", split_mode: "auto_orders",
      lines: [{ product_id: "M", share_pct: null }, { product_id: "S", share_pct: null }],
      effective_from: null,
    });
  });

  it("a single product sends no split mode", () => {
    const body = toDraftBody(
      { kind: "products", split_mode: "manual", lines: [{ product_id: "M", share_pct: 100 }], scope: "from", from: "2026-08-01" },
      { marketId: "ly", adAccountId: "act", campaignId: "C1", adsetId: "S1" },
    );
    expect(body).toMatchObject({ split_mode: null, lines: [{ product_id: "M", share_pct: null }], effective_from: "2026-08-01", adset_id: "S1" });
  });
});
