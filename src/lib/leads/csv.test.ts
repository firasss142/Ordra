import { describe, test, expect } from "vitest";
import { parseLeadCsv } from "./csv";

describe("parseLeadCsv", () => {
  test("parses valid CSV with required + optional columns", () => {
    const csv = `customer_name,customer_phone,source,customer_city,notes
Alice,+216111,manual_call,Tunis,First call
Bob,+216222,facebook_comment,,Follow-up needed`;
    const r = parseLeadCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].customer_name).toBe("Alice");
    expect(r.rows[0].source).toBe("manual_call");
    expect(r.rows[1].customer_city).toBeNull();
    expect(r.rows.every((row) => row.error === null)).toBe(true);
  });

  test("reports error='empty' for empty input", () => {
    expect(parseLeadCsv("").error).toBe("empty");
    expect(parseLeadCsv("   \n   ").error).toBe("empty");
  });

  test("reports error='headers' when required headers missing", () => {
    const r = parseLeadCsv(`name,phone\nAlice,+216111`);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("headers");
  });

  test("flags row errors inline (missing required field)", () => {
    const csv = `customer_name,customer_phone,source
Alice,,manual_call
,+216222,facebook_comment`;
    const r = parseLeadCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.rows[0].error).toMatch(/customer_phone/);
    expect(r.rows[1].error).toMatch(/customer_name/);
  });

  test("flags invalid source", () => {
    const csv = `customer_name,customer_phone,source
Alice,+216111,carrier_pigeon`;
    const r = parseLeadCsv(csv);
    expect(r.rows[0].error).toMatch(/invalid source/);
  });

  test("handles quoted fields with commas and embedded quotes", () => {
    const csv = `customer_name,customer_phone,source,notes
"Doe, Jane","+216111","manual_call","She said ""yes, maybe"""`;
    const r = parseLeadCsv(csv);
    expect(r.rows[0].customer_name).toBe("Doe, Jane");
    expect(r.rows[0].notes).toBe('She said "yes, maybe"');
  });

  test("trims whitespace and is case-insensitive on headers", () => {
    const csv = ` Customer_Name , Customer_Phone , Source
 Alice , +216111 , manual_call `;
    const r = parseLeadCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.rows[0].customer_name).toBe("Alice");
    expect(r.rows[0].source).toBe("manual_call");
  });
});
