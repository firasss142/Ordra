import { describe, it, expect } from "vitest";
import { mergeSheetSources, parseSpreadsheetId, rotateSources } from "./sources-config";

const MARKET = "m-ly";

function sf(id: string, over: Partial<{ is_active: boolean; platform: string; config: unknown }> = {}) {
  return {
    id,
    market_id: MARKET,
    platform: "google_sheets",
    is_active: true,
    config: { spreadsheet_id: `sheet-${id}`, sheet_name: "Orders", sheet_adapter: "converty" },
    ...over,
  };
}

describe("mergeSheetSources", () => {
  it("makes one source per active google_sheets storefront — two Converty accounts, two sources", () => {
    const out = mergeSheetSources([sf("a"), sf("b")], []);
    expect(out.map((s) => s.storefront_id)).toEqual(["a", "b"]);
    expect(out[0]).toMatchObject({
      spreadsheet_id: "sheet-a",
      sheet_name: "Orders",
      platform: "converty",
      is_active: true,
      market_id: MARKET,
    });
  });

  it("stops importing an archived storefront", () => {
    expect(mergeSheetSources([sf("a", { is_active: false })], [])).toEqual([]);
  });

  it("ignores storefronts that are not google_sheets", () => {
    expect(mergeSheetSources([sf("a", { platform: "shopify" })], [])).toEqual([]);
  });

  it("defaults the row adapter to converty when the config does not name one", () => {
    const out = mergeSheetSources([sf("a", { config: { spreadsheet_id: "x", sheet_name: "T" } })], []);
    expect(out[0].platform).toBe("converty");
  });

  it("lets a legacy settings entry override the sheet of an existing storefront", () => {
    const out = mergeSheetSources(
      [sf("a")],
      [{ storefront_id: "a", spreadsheet_id: "legacy", sheet_name: "converty-orders-bachir", platform: "converty", is_active: true }],
    );
    expect(out[0]).toMatchObject({ spreadsheet_id: "legacy", sheet_name: "converty-orders-bachir" });
  });

  it("honours a legacy entry switched off", () => {
    const out = mergeSheetSources(
      [sf("a")],
      [{ storefront_id: "a", spreadsheet_id: "x", sheet_name: "T", platform: "converty", is_active: false }],
    );
    expect(out).toEqual([]);
  });

  it("drops a legacy entry with no storefront behind it — every row would fail the FK", () => {
    const out = mergeSheetSources(
      [],
      [{ storefront_id: "ghost", spreadsheet_id: "x", sheet_name: "T", platform: "converty", is_active: true }],
    );
    expect(out).toEqual([]);
  });

  it("drops a storefront whose sheet is not configured", () => {
    expect(mergeSheetSources([sf("a", { config: {} })], [])).toEqual([]);
    expect(mergeSheetSources([sf("a", { config: null })], [])).toEqual([]);
  });

  it("keeps one source per storefront even if legacy lists it twice — they would share a cursor", () => {
    const entry = { storefront_id: "a", spreadsheet_id: "x", sheet_name: "T", platform: "converty", is_active: true };
    expect(mergeSheetSources([sf("a")], [entry, { ...entry, sheet_name: "Other" }])).toHaveLength(1);
  });
});

describe("rotateSources", () => {
  const list = ["a", "b", "c"];
  it("starts with a different source on each turn so none is starved", () => {
    expect(rotateSources(list, 0)).toEqual(["a", "b", "c"]);
    expect(rotateSources(list, 1)).toEqual(["b", "c", "a"]);
    expect(rotateSources(list, 5)).toEqual(["c", "a", "b"]);
  });
  it("handles an empty list", () => {
    expect(rotateSources([], 3)).toEqual([]);
  });
});

describe("parseSpreadsheetId", () => {
  it("extracts the id from a full Google Sheets URL", () => {
    expect(
      parseSpreadsheetId("https://docs.google.com/spreadsheets/d/1RT7e_Tmmz3krH3quHNQ6Hmv-ZNWX3IETtVksgAFPln8/edit#gid=0"),
    ).toBe("1RT7e_Tmmz3krH3quHNQ6Hmv-ZNWX3IETtVksgAFPln8");
  });
  it("accepts a bare id", () => {
    expect(parseSpreadsheetId("  1RT7e_Tmmz3krH3quHNQ6Hmv-ZNWX3IETtVksgAFPln8 ")).toBe(
      "1RT7e_Tmmz3krH3quHNQ6Hmv-ZNWX3IETtVksgAFPln8",
    );
  });
  it("rejects anything else", () => {
    expect(parseSpreadsheetId("")).toBeNull();
    expect(parseSpreadsheetId("hello world")).toBeNull();
    expect(parseSpreadsheetId("https://example.com/x")).toBeNull();
  });
});
