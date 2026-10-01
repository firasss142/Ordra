import { describe, it, expect } from "vitest";
import {
  campaignVersion,
  adsetResolution,
  needsAttribution,
  campaignGroup,
  groupCampaigns,
  firstToAttribute,
  ownAdsets,
  attributionStatus,
  evenShares,
  wholeShares,
  manualSum,
  draftProblems,
  draftFor,
  isUnchanged,
  toDraftBody,
  type EditorDraft,
} from "../mapping-view";
import type { CampaignNodeDTO, MappingVersionDTO, AdsetNodeDTO, MappingTreeDTO } from "../mapping-types";

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

const spend = {
  spend_window: 0,
  spend_life: 0,
  spend_unattributed: 0,
  results_window: 0,
  first_day: null,
  last_day: null,
  daily: [],
};

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
  spend_by_product: {},
  versions: [],
  current_id: null,
  adsets: [],
  ...over,
});

const mapped = (over: Partial<CampaignNodeDTO> = {}) =>
  campaign({ versions: [version({ id: "cv" })], current_id: "cv", ...over });

describe("what a node sells today", () => {
  const camp = mapped({ adsets: [adset({})] });

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

  it("names the ad sets attributed on their own", () => {
    const own = adset({ id: "S2", versions: [version({ id: "own", external_adset_id: "S2" })], own_current_id: "own" });
    const back = adset({ id: "S3", versions: [version({ id: "back", kind: "inherit", lines: [] })], own_current_id: "back" });
    expect(ownAdsets(mapped({ adsets: [adset({}), own, back] })).map((s) => s.id)).toEqual(["S2"]);
  });
});

describe("needsAttribution — one count, the page's and the drawer's", () => {
  it("money waiting for a product needs attribution, paused or not", () => {
    expect(needsAttribution(campaign({ status: "PAUSED", spend_life: 519, spend_unattributed: 519 }))).toBe(true);
  });

  it("a campaign that never spent and is not running does not — v1 counted it", () => {
    expect(needsAttribution(campaign({ status: "PAUSED", spend_life: 0 }))).toBe(false);
  });

  it("a campaign running with no product does, before its first dinar", () => {
    expect(needsAttribution(campaign({ status: "ACTIVE", spend_life: 0 }))).toBe(true);
  });

  it("a mapped campaign whose spend is all attributed does not", () => {
    expect(needsAttribution(mapped({ spend_life: 18540 }))).toBe(false);
  });

  it("a mapped campaign with days left before its first version still does", () => {
    expect(needsAttribution(mapped({ spend_life: 18540, spend_unattributed: 120 }))).toBe(true);
  });

  it("a running campaign whose every ad set is attributed on its own does not", () => {
    const own = adset({ versions: [version({ id: "own", external_adset_id: "S1" })], own_current_id: "own" });
    expect(needsAttribution(campaign({ status: "ACTIVE", adsets: [own] }))).toBe(false);
  });
});

describe("the list — groups, not filters", () => {
  const list = [
    mapped({ id: "q", name: "QuranTadabr", status: "ACTIVE", spend_life: 18540 }),
    campaign({ id: "hero", name: "BoxheroLY - LY", status: "PAUSED", spend_life: 519, spend_unattributed: 519 }),
    campaign({ id: "hero2", name: "BoxheroLY", status: "PAUSED", spend_life: 23, spend_unattributed: 23 }),
    mapped({ id: "relaunch", name: "BoxLyLong - relaunch", status: "PAUSED", spend_life: 16696 }),
    campaign({ id: "pets", name: "Pets Glove test", status: "PAUSED", spend_life: 0 }),
    mapped({
      id: "qiyam",
      name: "book qiyam layl",
      status: "PAUSED",
      spend_life: 1167,
      versions: [version({ id: "t", lines: [{ product_id: "T", share_pct: null }] })],
      current_id: "t",
      adsets: [adset({ status: "ACTIVE", name: "QIYAM - Adset 1" })],
    }),
  ];
  const names = { Q: "القرآن تدبر وعمل", T: "مصحف التهجد" };
  const ids = (g: CampaignNodeDTO[]) => g.map((c) => c.id);

  it("puts each campaign in exactly one group", () => {
    expect(list.map(campaignGroup)).toEqual(["live", "todo", "todo", "paused", "never", "live"]);
  });

  it("orders each group by what it spent", () => {
    const g = groupCampaigns(list, { query: "", productNames: names });
    expect(ids(g.todo)).toEqual(["hero", "hero2"]);
    expect(ids(g.live)).toEqual(["q", "qiyam"]);
    expect(ids(g.paused)).toEqual(["relaunch"]);
    expect(ids(g.never)).toEqual(["pets"]);
  });

  it("searches campaign, ad set and product names, case-insensitively", () => {
    const f = (query: string) => {
      const g = groupCampaigns(list, { query, productNames: names });
      return [...g.todo, ...g.live, ...g.paused, ...g.never].map((c) => c.id);
    };
    expect(f("boxhero")).toEqual(["hero", "hero2"]);
    expect(f("qiyam - adset")).toEqual(["qiyam"]);
    expect(f("التهجد")).toEqual(["qiyam"]);
  });

  it("opens on the campaign with the most money waiting", () => {
    expect(firstToAttribute(list)?.id).toBe("hero");
    expect(firstToAttribute([mapped({})])).toBeNull();
  });
});

describe("attributionStatus — the one sentence at the top", () => {
  const tree = (life: MappingTreeDTO["coverage"]["life"], campaigns: CampaignNodeDTO[]) =>
    ({ coverage: { life, window: life, life_from: "2026-05-23" }, campaigns }) as unknown as MappingTreeDTO;

  it("counts the money waiting and the campaigns it belongs to", () => {
    const s = attributionStatus(
      tree({ total: 73147, attributed: 72605, market_level: 0, unmapped: 542 }, [
        campaign({ id: "hero", status: "PAUSED", spend_life: 519, spend_unattributed: 519 }),
        campaign({ id: "hero2", status: "PAUSED", spend_life: 23, spend_unattributed: 23 }),
        campaign({ id: "pets", status: "PAUSED" }),
        mapped({ spend_life: 72605 }),
      ]),
    );
    expect(s).toEqual({ waiting: 542, waitingCampaigns: 2, general: 0, onProductsPct: 99.2, toAttribute: 2 });
  });

  it("never rounds 99.97 % up to a reassuring 100 %", () => {
    expect(attributionStatus(tree({ total: 10000, attributed: 9997, market_level: 0, unmapped: 3 }, [])).onProductsPct).toBe(99.9);
  });

  it("says nothing is on products when nothing was spent", () => {
    expect(attributionStatus(tree({ total: 0, attributed: 0, market_level: 0, unmapped: 0 }, [])).onProductsPct).toBe(0);
  });
});

describe("manual shares", () => {
  it("even shares always add up to exactly 100", () => {
    expect(evenShares(3)).toEqual([33.34, 33.33, 33.33]);
    expect(evenShares(2)).toEqual([50, 50]);
    expect(manualSum(evenShares(7).map((share_pct) => ({ product_id: "x", share_pct })))).toBe(100);
  });

  it("seeds fixed shares from the orders' split in whole percents that still make 100", () => {
    // The relaunch's real split: 63.8 / 19.5 / 16.7 — a field 46 px wide shows "16," for 16.73.
    expect(wholeShares([16.73, 63.78, 19.49])).toEqual([17, 64, 19]);
    expect(wholeShares([33.4, 33.3, 33.3])).toEqual([34, 33, 33]);
    expect(wholeShares([50, 50])).toEqual([50, 50]);
    expect(wholeShares([12.5, 12.5, 75]).reduce((a, x) => a + x, 0)).toBe(100);
  });

  it("sums to the cent, not to float noise", () => {
    expect(manualSum([{ product_id: "a", share_pct: 33.33 }, { product_id: "b", share_pct: 33.33 }, { product_id: "c", share_pct: 33.34 }])).toBe(100);
  });
});

const draft = (over: Partial<EditorDraft> = {}): EditorDraft => ({
  follow: false,
  kind: "products",
  split_mode: "auto_orders",
  lines: [{ product_id: "M", share_pct: null }],
  scope: "all",
  from: "2026-10-01",
  ...over,
});

describe("draftProblems — what keeps Enregistrer disabled", () => {
  it("needs at least one product", () => {
    expect(draftProblems(draft({ lines: [] }))).toEqual(["no_products"]);
  });

  it("needs manual shares that make 100", () => {
    const lines = (a: number, b: number) => [{ product_id: "M", share_pct: a }, { product_id: "S", share_pct: b }];
    expect(draftProblems(draft({ split_mode: "manual", lines: lines(60, 30) }))).toEqual(["manual_sum"]);
    expect(draftProblems(draft({ split_mode: "manual", lines: lines(60, 40) }))).toEqual([]);
  });

  it("needs a date when starting from a date", () => {
    expect(draftProblems(draft({ scope: "from", from: "" }))).toEqual(["no_date"]);
  });

  it("general spend and an ad set following its campaign need no product", () => {
    expect(draftProblems(draft({ kind: "market_level", lines: [] }))).toEqual([]);
    expect(draftProblems(draft({ follow: true, lines: [] }))).toEqual([]);
  });
});

describe("draftFor — where the editor starts", () => {
  it("a campaign starts from what it sells, over all history", () => {
    expect(draftFor({ own: version({}), campaign: null, isAdset: false }, "2026-10-01")).toEqual(
      draft({ lines: [{ product_id: "Q", share_pct: null }] }),
    );
  });

  it("a campaign with no product starts empty", () => {
    expect(draftFor({ own: null, campaign: null, isAdset: false }, "2026-10-01")).toEqual(draft({ lines: [] }));
  });

  it("general spend starts as general spend", () => {
    expect(draftFor({ own: version({ kind: "market_level", lines: [] }), campaign: null, isAdset: false }, "2026-10-01")).toMatchObject({
      kind: "market_level",
      lines: [],
    });
  });

  it("'Attribuer à part' starts from a copy of the campaign's products — the ad set usually sells them AND something else", () => {
    const camp = version({ split_mode: "manual", lines: [{ product_id: "M", share_pct: 60 }, { product_id: "S", share_pct: 40 }] });
    expect(draftFor({ own: null, campaign: camp, isAdset: true }, "2026-10-01")).toEqual(
      draft({ split_mode: "manual", lines: [{ product_id: "M", share_pct: 60 }, { product_id: "S", share_pct: 40 }] }),
    );
  });

  it("an ad set with its own products starts from those", () => {
    const own = version({ id: "own", external_adset_id: "S1", lines: [{ product_id: "T", share_pct: null }] });
    expect(draftFor({ own, campaign: version({}), isAdset: true }, "2026-10-01").lines).toEqual([{ product_id: "T", share_pct: null }]);
  });
});

describe("isUnchanged — Enregistrer stays grey while nothing differs", () => {
  const only = (v: Partial<MappingVersionDTO>) => [version(v)];

  it("the version in force, untouched, is unchanged", () => {
    expect(isUnchanged(draft({ lines: [{ product_id: "Q", share_pct: null }] }), only({}))).toBe(true);
  });

  it("the same products in another order are unchanged", () => {
    const v = only({ split_mode: "auto_orders", lines: [{ product_id: "M", share_pct: null }, { product_id: "S", share_pct: null }] });
    expect(isUnchanged(draft({ lines: [{ product_id: "S", share_pct: null }, { product_id: "M", share_pct: null }] }), v)).toBe(true);
  });

  it("another product, another split or other shares are changes", () => {
    const two = [{ product_id: "M", share_pct: 60 }, { product_id: "S", share_pct: 40 }];
    expect(isUnchanged(draft({ lines: [{ product_id: "M", share_pct: null }] }), only({}))).toBe(false);
    expect(isUnchanged(draft({ split_mode: "manual", lines: two }), only({ split_mode: "auto_orders", lines: two }))).toBe(false);
    expect(isUnchanged(draft({ split_mode: "manual", lines: two }), only({ split_mode: "manual", lines: [{ product_id: "M", share_pct: 50 }, { product_id: "S", share_pct: 50 }] }))).toBe(false);
    expect(isUnchanged(draft({ split_mode: "manual", lines: two }), only({ split_mode: "manual", lines: two }))).toBe(true);
  });

  it("all history over a version that starts at a date rewrites the days before it", () => {
    expect(isUnchanged(draft({ lines: [{ product_id: "Q", share_pct: null }] }), only({ effective_from: "2026-08-01" }))).toBe(false);
  });

  it("all history over two live versions collapses them — a change", () => {
    const v = [version({ id: "a" }), version({ id: "b", effective_from: "2026-08-01" })];
    expect(isUnchanged(draft({ lines: [{ product_id: "Q", share_pct: null }] }), v)).toBe(false);
  });

  it("superseded versions are history, not the present", () => {
    const v = [version({ id: "now" }), version({ id: "old", lines: [{ product_id: "L", share_pct: null }], superseded_at: "2026-09-01T00:00:00Z" })];
    expect(isUnchanged(draft({ lines: [{ product_id: "Q", share_pct: null }] }), v)).toBe(true);
  });

  it("a first decision is always a change", () => {
    expect(isUnchanged(draft({}), [])).toBe(false);
  });

  it("general spend over general spend is unchanged", () => {
    expect(isUnchanged(draft({ kind: "market_level", lines: [] }), only({ kind: "market_level", lines: [] }))).toBe(true);
  });

  it("starting from a date is always a decision", () => {
    expect(isUnchanged(draft({ scope: "from", lines: [{ product_id: "Q", share_pct: null }] }), only({}))).toBe(false);
  });

  it("an ad set that already follows its campaign, set to follow, is unchanged", () => {
    expect(isUnchanged(draft({ follow: true }), [])).toBe(true);
    expect(isUnchanged(draft({ follow: true }), only({ kind: "inherit", lines: [] }))).toBe(true);
    expect(isUnchanged(draft({ follow: true }), only({ external_adset_id: "S1" }))).toBe(false);
  });
});

describe("toDraftBody — what is sent", () => {
  const target = { marketId: "ly", adAccountId: "act", campaignId: "C1", adsetId: null };

  it("no shares on an automatic split, null date for all history", () => {
    const body = toDraftBody(
      draft({ lines: [{ product_id: "M", share_pct: 60 }, { product_id: "S", share_pct: 40 }], from: "2026-08-01" }),
      target,
    );
    expect(body).toEqual({
      market_id: "ly", ad_account_id: "act", campaign_id: "C1", adset_id: null,
      kind: "products", split_mode: "auto_orders",
      lines: [{ product_id: "M", share_pct: null }, { product_id: "S", share_pct: null }],
      effective_from: null,
    });
  });

  it("a single product sends no split mode", () => {
    const body = toDraftBody(draft({ split_mode: "manual", lines: [{ product_id: "M", share_pct: 100 }], scope: "from", from: "2026-08-01" }), {
      ...target,
      adsetId: "S1",
    });
    expect(body).toMatchObject({ split_mode: null, lines: [{ product_id: "M", share_pct: null }], effective_from: "2026-08-01", adset_id: "S1" });
  });

  it("an ad set following its campaign sends 'inherit', without the products it had", () => {
    expect(toDraftBody(draft({ follow: true }), { ...target, adsetId: "S1" })).toMatchObject({ kind: "inherit", lines: [], split_mode: null });
  });

  it("general spend sends no products", () => {
    expect(toDraftBody(draft({ kind: "market_level" }), target)).toMatchObject({ kind: "market_level", lines: [], split_mode: null });
  });
});
