import { describe, it, expect } from "vitest";
import { parseAdSpendCsv, detectSource } from "../csv-parse";

const metaCsv = `"Campaign name","Reporting starts","Reporting ends","Amount spent (TND)"
"Black Hair Oil - TN","2026-03-01","2026-03-07","128.50"
"Face Serum Retargeting","2026-03-01","2026-03-07","92.00"`;

const tiktokCsv = `Campaign name,Start date,End date,Cost
"Libya Launch",2026-03-15,2026-03-22,412.75
"TikTok Hair Oil",2026-03-15,2026-03-22,58.20`;

describe("CSV parse — Meta + TikTok export formats", () => {
  it("detects Meta via 'Amount spent' column", () => {
    expect(detectSource(metaCsv)).toBe("meta");
  });

  it("detects TikTok via 'Cost' + 'Start date' columns", () => {
    expect(detectSource(tiktokCsv)).toBe("tiktok");
  });

  it("parses Meta rows into normalized shape", () => {
    const { rows, source } = parseAdSpendCsv(metaCsv);
    expect(source).toBe("meta");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      campaign_name: "Black Hair Oil - TN",
      period_start: "2026-03-01",
      period_end: "2026-03-07",
      amount: 128.5,
    });
    expect(rows[1].amount).toBe(92);
  });

  it("parses TikTok rows into normalized shape", () => {
    const { rows } = parseAdSpendCsv(tiktokCsv);
    expect(rows).toHaveLength(2);
    expect(rows[0].campaign_name).toBe("Libya Launch");
    expect(rows[0].amount).toBe(412.75);
    expect(rows[1].period_start).toBe("2026-03-15");
  });

  it("skips rows with missing required fields but keeps valid ones", () => {
    const messy = `"Campaign name","Reporting starts","Reporting ends","Amount spent (TND)"
"Valid","2026-03-01","2026-03-07","50"
"Bad row","","2026-03-07","50"
"Another","2026-03-08","2026-03-14","75"`;
    const { rows } = parseAdSpendCsv(messy);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.campaign_name)).toEqual(["Valid", "Another"]);
  });

  it("rejects negative or zero amounts", () => {
    const bad = `"Campaign name","Reporting starts","Reporting ends","Amount spent (TND)"
"Zero","2026-03-01","2026-03-07","0"
"Neg","2026-03-01","2026-03-07","-5"
"Good","2026-03-01","2026-03-07","25"`;
    const { rows } = parseAdSpendCsv(bad);
    expect(rows).toHaveLength(1);
    expect(rows[0].campaign_name).toBe("Good");
  });

  it("returns empty rows on unknown format", () => {
    const weird = `foo,bar,baz\n1,2,3`;
    const { rows, source } = parseAdSpendCsv(weird);
    expect(source).toBe("unknown");
    expect(rows).toHaveLength(0);
  });
});
