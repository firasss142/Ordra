import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { makeFakeSupabase, type Row } from "@/test/helpers/fakeSupabase";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => `plain:${s}` }));

import { syncAccount, pickFxRate } from "../sync";

/**
 * One sync, end to end, against an in-memory database and a stubbed Graph API:
 * catalogue → ad-set facts → projection. The Meta figures are the real ones for
 * "BoxLyLong - relaunch" and QuranTadabr batch 1 / batch 2.
 */

const ACCT = "1401484224203259";
const LY = "00000000-0000-0000-0000-000000000002";
const NOW = new Date("2026-08-15T10:00:00Z");

function json(body: unknown, status = 200) {
  return { status, text: async () => JSON.stringify(body), headers: new Headers() } as unknown as Response;
}

const insightRow = (over: Record<string, unknown>) => ({
  campaign_id: "C-RELAUNCH",
  campaign_name: "BoxLyLong - relaunch",
  adset_id: "S-RELAUNCH",
  adset_name: "BoxLyLong relaunch",
  objective: "OUTCOME_SALES",
  spend: "51.66",
  impressions: "5000",
  reach: "4100",
  clicks: "120",
  frequency: "1.22",
  actions: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "36" }],
  account_currency: "USD",
  date_start: "2026-08-11",
  date_stop: "2026-08-11",
  ...over,
});

function stubMeta(insights: unknown[]) {
  const fn = vi.fn(async (url: string) => {
    if (url.includes("/campaigns?"))
      return json({
        data: [
          { id: "C-RELAUNCH", name: "BoxLyLong - relaunch", objective: "OUTCOME_SALES", effective_status: "ACTIVE", created_time: "2026-07-06T09:00:00+0100" },
          { id: "C-PETS", name: "Pets Glove test", objective: "OUTCOME_SALES", effective_status: "PAUSED" },
        ],
      });
    if (url.includes("/adsets?"))
      return json({ data: [{ id: "S-RELAUNCH", name: "BoxLyLong relaunch", campaign_id: "C-RELAUNCH", effective_status: "ACTIVE" }] });
    if (url.includes("/insights?")) return json({ data: insights });
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const account = (over: Row = {}) => ({
  id: "acc-1",
  market_id: LY,
  ad_account_id: ACCT,
  account_currency: "USD",
  account_timezone: "Africa/Tunis",
  graph_version: "v26.0",
  access_token: "cipher",
  last_synced_at: "2026-08-15T09:07:00Z",
  adset_history_from: "2026-08-09",
  ...over,
});

function setup(seed: Record<string, Row[]> = {}) {
  const fake = makeFakeSupabase({
    settings: [{ market_id: LY, key: "ad_spend_fx_rates", value: { USD: 8.4 } }],
    meta_ad_accounts: [account() as Row],
    ad_spend_mappings: [
      { id: "v1", ad_account_id: ACCT, external_campaign_id: "C-RELAUNCH", external_adset_id: null, effective_from: null, kind: "products", split_mode: null, superseded_at: null },
    ],
    ad_spend_mapping_lines: [{ mapping_id: "v1", product_id: "L", share_pct: null }],
    ...seed,
  });
  const replaced: Row[] = [];
  fake.rpcs.order_counts_by_product_day = () => [];
  fake.rpcs.replace_meta_ad_spend = (args) => {
    replaced.push(args);
    return (args.p_rows as unknown[]).length;
  };
  return { fake, replaced, admin: fake.client as unknown as SupabaseClient };
}

beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ["Date"] }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("syncAccount — ad-set grain", () => {
  it("stores the whole catalogue, including a campaign that never spent", async () => {
    stubMeta([insightRow({})]);
    const { fake, admin } = setup();
    await syncAccount(admin, account() as never, { trigger: "cron", now: NOW });

    expect(fake.tables.meta_ad_campaigns.map((c) => c.external_campaign_id).sort()).toEqual(["C-PETS", "C-RELAUNCH"]);
    expect(fake.tables.meta_ad_campaigns[0]).toMatchObject({ ad_account_id: ACCT, market_id: LY });
    expect(fake.tables.meta_ad_sets).toEqual([
      expect.objectContaining({ external_adset_id: "S-RELAUNCH", external_campaign_id: "C-RELAUNCH", effective_status: "ACTIVE" }),
    ]);
  });

  it("writes one fact per ad set-day, converted, with purchases as the result", async () => {
    stubMeta([insightRow({})]);
    const { fake, admin } = setup();
    await syncAccount(admin, account() as never, { trigger: "cron", now: NOW });

    expect(fake.tables.meta_adset_daily).toEqual([
      expect.objectContaining({
        external_adset_id: "S-RELAUNCH",
        external_campaign_id: "C-RELAUNCH",
        day: "2026-08-11",
        spend_original: 51.66,
        fx_rate: 8.4,
        amount: 433.944,
        platform_results: 36,
        market_id: LY,
      }),
    ]);
  });

  it("rewrites ad_spend for the fetched window through the mapping in force", async () => {
    stubMeta([insightRow({})]);
    const { replaced, admin } = setup();
    const result = await syncAccount(admin, account() as never, { trigger: "cron", now: NOW });

    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ p_ad_account_id: ACCT, p_since: "2026-08-09", p_until: "2026-08-15", p_campaign_ids: null });
    expect(replaced[0].p_rows).toEqual([
      expect.objectContaining({ product_id: "L", amount: 433.944, allocation_basis: "single", mapping_id: "v1", external_adset_id: "S-RELAUNCH" }),
    ]);
    expect(result).toMatchObject({ status: "succeeded", rows_fetched: 1, rows_upserted: 1 });
  });

  it("re-projects the whole complete history, so a remap whose rebuild failed heals within the hour", async () => {
    stubMeta([insightRow({})]);
    const { replaced, admin } = setup();
    await syncAccount(admin, account({ adset_history_from: "2026-05-23" }) as never, { trigger: "cron", now: NOW });
    expect(replaced[0]).toMatchObject({ p_since: "2026-05-23", p_until: "2026-08-15" });
  });

  it("forgets a fact Meta no longer reports for a re-fetched day", async () => {
    stubMeta([insightRow({})]);
    const { fake, admin } = setup({
      meta_adset_daily: [
        { ad_account_id: ACCT, external_adset_id: "S-GONE", day: "2026-08-12", external_campaign_id: "C-RELAUNCH", market_id: LY, amount: 10, spend_original: 1.19, currency_original: "USD", fx_rate: 8.4, synced_at: "2026-08-14T09:07:00Z" },
        { ad_account_id: ACCT, external_adset_id: "S-OLD", day: "2026-08-01", external_campaign_id: "C-RELAUNCH", market_id: LY, amount: 10, spend_original: 1.19, currency_original: "USD", fx_rate: 8.0, synced_at: "2026-08-02T09:07:00Z" },
      ],
    });
    await syncAccount(admin, account() as never, { trigger: "cron", now: NOW });
    const ids = fake.tables.meta_adset_daily.map((r) => r.external_adset_id).sort();
    expect(ids).toEqual(["S-OLD", "S-RELAUNCH"]); // the 12 Aug ghost is gone, 1 Aug is outside the window
  });

  it("backfills the whole synced history on the first run under the ad-set grain", async () => {
    stubMeta([insightRow({ date_start: "2026-08-01", date_stop: "2026-08-01" }), insightRow({})]);
    const { fake, replaced, admin } = setup({
      ad_spend: [
        { source: "meta", ad_account_id: ACCT, external_campaign_id: "C-RELAUNCH", period_start: "2026-07-20", fx_rate: 8.0, amount: 1, is_active: true },
      ],
    });
    await syncAccount(admin, account({ adset_history_from: null }) as never, { trigger: "cron", now: NOW });

    expect(replaced[0]).toMatchObject({ p_since: "2026-07-20", p_until: "2026-08-15" });
    expect(fake.tables.meta_ad_accounts[0].adset_history_from).toBe("2026-07-20");
  });

  it("keeps the rate a past day was booked at, and uses today's only inside the rolling window", async () => {
    stubMeta([insightRow({ date_start: "2026-07-20", date_stop: "2026-07-20" }), insightRow({})]);
    const { fake, admin } = setup({
      ad_spend: [
        { source: "meta", ad_account_id: ACCT, external_campaign_id: "C-RELAUNCH", period_start: "2026-07-20", fx_rate: 8.0, amount: 1, is_active: true },
      ],
    });
    await syncAccount(admin, account({ adset_history_from: null }) as never, { trigger: "cron", now: NOW });

    const byDay = Object.fromEntries(fake.tables.meta_adset_daily.map((r) => [r.day, r]));
    expect(byDay["2026-07-20"]).toMatchObject({ fx_rate: 8.0, amount: 413.28 });
    expect(byDay["2026-08-11"]).toMatchObject({ fx_rate: 8.4, amount: 433.944 });
  });

  it("fails the run — and leaves the history alone — when the rewrite is refused", async () => {
    stubMeta([insightRow({})]);
    const { fake, admin } = setup({ meta_ad_accounts: [account({ adset_history_from: null }) as Row] });
    fake.rpcs.replace_meta_ad_spend = () => {
      throw new Error('duplicate key value violates unique constraint "ad_spend_synced_key"');
    };
    const result = await syncAccount(admin, account({ adset_history_from: null }) as never, { trigger: "cron", now: NOW });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/ad_spend_synced_key/);
    expect(fake.tables.meta_ad_accounts[0].adset_history_from).toBeNull();
    expect(fake.tables.meta_ad_accounts[0].last_sync_error).toMatch(/ad_spend_synced_key/);
  });
});

describe("pickFxRate", () => {
  const stamps = {
    adset: new Map([["S1|2026-07-20", 8.0]]),
    campaign: new Map([["C1|2026-07-21", 7.9]]),
  };
  it("uses the current rate inside the rolling window", () => {
    expect(pickFxRate({ day: "2026-08-10", adsetId: "S1", campaignId: "C1" }, "2026-08-09", stamps, 8.4)).toBe(8.4);
  });
  it("keeps the ad set's own stamp for an older day", () => {
    expect(pickFxRate({ day: "2026-07-20", adsetId: "S1", campaignId: "C1" }, "2026-08-09", stamps, 8.4)).toBe(8.0);
  });
  it("falls back to the legacy campaign row's stamp", () => {
    expect(pickFxRate({ day: "2026-07-21", adsetId: "S1", campaignId: "C1" }, "2026-08-09", stamps, 8.4)).toBe(7.9);
  });
  it("uses the current rate for an old day nobody ever booked", () => {
    expect(pickFxRate({ day: "2026-07-01", adsetId: "S1", campaignId: "C1" }, "2026-08-09", stamps, 8.4)).toBe(8.4);
  });
});
