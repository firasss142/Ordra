import { describe, it, expect } from "vitest";
import { makeFakeSupabase, type Row } from "@/test/helpers/fakeSupabase";
import {
  rebuildMetaAdSpend,
  loadLiveVersions,
  clampToHistory,
  nextHistoryFrom,
} from "../rebuild";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The rebuild is the one path that rewrites ad_spend's meta rows. It must read
 * only LIVE versions, ask for order counts only when an automatic split needs
 * them (from 7 days before the window, for the fallback), and hand the whole
 * window to replace_meta_ad_spend in one call — the RPC is what makes the
 * rewrite atomic.
 */

const ACCT = "1401484224203259";
const LY = "ly-market";

function fact(over: Row = {}): Row {
  return {
    ad_account_id: ACCT,
    market_id: LY,
    external_campaign_id: "C-RELAUNCH",
    external_adset_id: "S-RELAUNCH",
    campaign_name: "BoxLyLong - relaunch",
    adset_name: "BoxLyLong relaunch",
    day: "2026-08-11",
    amount: 433.944,
    spend_original: 51.66,
    currency_original: "USD",
    fx_rate: 8.4,
    impressions: 5000,
    reach: 4100,
    clicks: 120,
    frequency: 1.22,
    platform_results: 36,
    synced_at: "2026-09-30T21:07:00Z",
    ...over,
  };
}

function setup(extra: Record<string, Row[]> = {}) {
  const fake = makeFakeSupabase({
    meta_adset_daily: [fact(), fact({ day: "2026-08-12", amount: 43.764, spend_original: 5.21 })],
    ad_spend_mappings: [
      // superseded: must be ignored
      { id: "old", ad_account_id: ACCT, external_campaign_id: "C-RELAUNCH", external_adset_id: null, effective_from: null, kind: "products", split_mode: null, superseded_at: "2026-09-30T20:00:00Z" },
      { id: "live", ad_account_id: ACCT, external_campaign_id: "C-RELAUNCH", external_adset_id: null, effective_from: null, kind: "products", split_mode: "auto_orders", superseded_at: null },
    ],
    ad_spend_mapping_lines: [
      { mapping_id: "old", product_id: "L", share_pct: null },
      { mapping_id: "live", product_id: "M", share_pct: null },
      { mapping_id: "live", product_id: "S", share_pct: null },
      { mapping_id: "live", product_id: "L", share_pct: null },
    ],
    ...extra,
  });
  const calls: { name: string; args: Row }[] = [];
  fake.rpcs.order_counts_by_product_day = (args) => {
    calls.push({ name: "order_counts_by_product_day", args });
    return [
      { day: "2026-08-11", product_id: "M", orders: 84 },
      { day: "2026-08-11", product_id: "S", orders: 52 },
      { day: "2026-08-11", product_id: "L", orders: 17 },
      { day: "2026-08-10", product_id: "M", orders: 3 },
    ];
  };
  fake.rpcs.replace_meta_ad_spend = (args) => {
    calls.push({ name: "replace_meta_ad_spend", args });
    return (args.p_rows as unknown[]).length;
  };
  return { fake, calls, admin: fake.client as unknown as SupabaseClient };
}

describe("loadLiveVersions", () => {
  it("reads only versions nobody has superseded, with their lines", async () => {
    const { admin } = setup();
    const versions = await loadLiveVersions(admin, ACCT);
    expect(versions.map((v) => v.id)).toEqual(["live"]);
    expect(versions[0].lines.map((l) => l.product_id).sort()).toEqual(["L", "M", "S"]);
  });
});

describe("rebuildMetaAdSpend", () => {
  it("projects the window through the live version and replaces it in one call", async () => {
    const { admin, calls } = setup();
    const written = await rebuildMetaAdSpend(admin, {
      adAccountId: ACCT,
      marketId: LY,
      timezone: "Africa/Tunis",
      since: "2026-08-11",
      until: "2026-08-12",
    });

    const replace = calls.find((c) => c.name === "replace_meta_ad_spend")!;
    expect(replace.args).toMatchObject({ p_ad_account_id: ACCT, p_since: "2026-08-11", p_until: "2026-08-12", p_campaign_ids: null });
    const rows = replace.args.p_rows as Row[];
    // 11 Aug: three products by that day's orders; 12 Aug: nobody ordered, so
    // the trailing week decides (only M had orders, on the 10th and 11th).
    expect(rows.filter((r) => r.period_start === "2026-08-11").map((r) => [r.product_id, r.allocation_basis])).toEqual([
      ["L", "auto_orders"],
      ["M", "auto_orders"],
      ["S", "auto_orders"],
    ]);
    expect(rows.filter((r) => r.period_start === "2026-08-12").map((r) => r.allocation_basis)).toEqual([
      "auto_trailing_7d",
      "auto_trailing_7d",
      "auto_trailing_7d",
    ]);
    expect(written).toBe(6);
  });

  it("asks for order counts from 7 days before the window, in the ad account's timezone", async () => {
    const { admin, calls } = setup();
    await rebuildMetaAdSpend(admin, { adAccountId: ACCT, marketId: LY, timezone: "Africa/Tunis", since: "2026-08-11", until: "2026-08-12" });
    const counts = calls.find((c) => c.name === "order_counts_by_product_day")!;
    expect(counts.args).toMatchObject({ p_market_id: LY, p_since: "2026-08-04", p_until: "2026-08-12", p_tz: "Africa/Tunis" });
    expect((counts.args.p_product_ids as string[]).sort()).toEqual(["L", "M", "S"]);
  });

  it("does not query orders at all when no mapping splits automatically", async () => {
    const { admin, calls } = setup({
      ad_spend_mappings: [{ id: "one", ad_account_id: ACCT, external_campaign_id: "C-RELAUNCH", external_adset_id: null, effective_from: null, kind: "products", split_mode: null, superseded_at: null }],
      ad_spend_mapping_lines: [{ mapping_id: "one", product_id: "L", share_pct: null }],
    });
    await rebuildMetaAdSpend(admin, { adAccountId: ACCT, marketId: LY, timezone: "Africa/Tunis", since: "2026-08-11", until: "2026-08-12" });
    expect(calls.some((c) => c.name === "order_counts_by_product_day")).toBe(false);
  });

  it("scopes to the given campaigns, and says so to the RPC", async () => {
    const { admin, calls } = setup({
      meta_adset_daily: [fact(), fact({ external_campaign_id: "C-OTHER", external_adset_id: "S-OTHER" })],
    });
    await rebuildMetaAdSpend(admin, {
      adAccountId: ACCT, marketId: LY, timezone: "Africa/Tunis", since: "2026-08-11", until: "2026-08-11", campaignIds: ["C-RELAUNCH"],
    });
    const replace = calls.find((c) => c.name === "replace_meta_ad_spend")!;
    expect(replace.args.p_campaign_ids).toEqual(["C-RELAUNCH"]);
    expect((replace.args.p_rows as Row[]).every((r) => r.external_campaign_id === "C-RELAUNCH")).toBe(true);
  });

  it("surfaces an RPC refusal instead of reporting a rewrite that did not happen", async () => {
    const { admin, fake } = setup();
    fake.rpcs.replace_meta_ad_spend = () => {
      throw new Error("duplicate key value violates unique constraint \"ad_spend_synced_key\"");
    };
    await expect(
      rebuildMetaAdSpend(admin, { adAccountId: ACCT, marketId: LY, timezone: "Africa/Tunis", since: "2026-08-11", until: "2026-08-12" }),
    ).rejects.toThrow(/ad_spend_synced_key/);
  });
});

describe("clampToHistory — never rewrite a day whose ad-set facts were never fetched", () => {
  it("starts no earlier than the complete ad-set history", () => {
    expect(clampToHistory("2026-05-23", "2026-09-30", "2026-07-01")).toEqual({ since: "2026-07-01", until: "2026-09-30" });
  });
  it("leaves a window inside the history alone", () => {
    expect(clampToHistory("2026-08-01", "2026-08-31", "2026-05-23")).toEqual({ since: "2026-08-01", until: "2026-08-31" });
  });
  it("refuses everything while no complete history exists", () => {
    expect(clampToHistory("2026-08-01", "2026-08-31", null)).toBeNull();
  });
  it("refuses a window that ends before the history starts", () => {
    expect(clampToHistory("2026-05-23", "2026-06-30", "2026-07-01")).toBeNull();
  });
});

describe("nextHistoryFrom — how far back ad-set facts are complete", () => {
  const today = "2026-09-30";
  it("a first clean run through today sets it to the run's start", () => {
    expect(nextHistoryFrom(null, { since: "2026-05-23", until: "2026-09-30" }, today)).toBe("2026-05-23");
  });
  it("a backfill that meets the existing history extends it backwards", () => {
    expect(nextHistoryFrom("2026-09-24", { since: "2026-05-23", until: "2026-09-24" }, today)).toBe("2026-05-23");
  });
  it("a backfill leaving a gap before the history changes nothing", () => {
    expect(nextHistoryFrom("2026-09-24", { since: "2026-05-23", until: "2026-06-30" }, today)).toBe("2026-09-24");
  });
  it("a run that stopped short of today cannot start a history", () => {
    expect(nextHistoryFrom(null, { since: "2026-05-23", until: "2026-06-21" }, today)).toBeNull();
  });
  it("the rolling window never moves an older history forward", () => {
    expect(nextHistoryFrom("2026-05-23", { since: "2026-09-24", until: "2026-09-30" }, today)).toBe("2026-05-23");
  });
});
