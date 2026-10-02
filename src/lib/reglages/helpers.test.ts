import { describe, it, expect } from "vitest";
import {
  plainSettingValue,
  meaningfulHistory,
  shopState,
  parseSendWindow,
  formatSendWindow,
  slaDuration,
} from "./helpers";

describe("plainSettingValue", () => {
  it("unwraps { value }, the legacy { type } and { amount }, and leaves objects alone", () => {
    expect(plainSettingValue({ value: 8 })).toBe(8);
    expect(plainSettingValue({ type: "manual" })).toBe("manual");
    expect(plainSettingValue({ amount: 6 })).toBe(6);
    expect(plainSettingValue({ USD: 8.4 })).toEqual({ USD: 8.4 });
    expect(plainSettingValue(30)).toBe(30);
    expect(plainSettingValue(null)).toBeNull();
  });
});

describe("meaningfulHistory", () => {
  it("drops rows whose value did not change once unwrapped (format migrations)", () => {
    const rows = [
      { id: "1", old_value: { type: "manual" }, new_value: { value: "manual" } },
      { id: "2", old_value: { value: 5 }, new_value: { value: 8 } },
      { id: "3", old_value: null, new_value: { value: 24 } },
      { id: "4", old_value: 30, new_value: { value: 30 } },
    ];
    expect(meaningfulHistory(rows).map((r) => r.id)).toEqual(["2", "3"]);
  });
});

describe("shopState", () => {
  const now = new Date("2026-10-02T14:00:00Z");
  it("calls an inactive shop deactivated, whatever its orders", () => {
    expect(shopState({ is_active: false, last_order_at: "2026-10-01T10:00:00Z" }, now)).toEqual({ kind: "off" });
  });
  it("calls a shop that never sent an order « never »", () => {
    expect(shopState({ is_active: true, last_order_at: null }, now)).toEqual({ kind: "never" });
  });
  it("calls a shop silent after more than 14 days, with the number of days", () => {
    expect(shopState({ is_active: true, last_order_at: "2026-09-07T16:06:00Z" }, now)).toEqual({ kind: "quiet", days: 24 });
    expect(shopState({ is_active: true, last_order_at: "2026-09-18T15:00:00Z" }, now)).toEqual({ kind: "ok" });
  });
});

describe("send window", () => {
  it("reads « 10-20 » as two hours and writes them back", () => {
    expect(parseSendWindow("10-20")).toEqual({ start: 10, end: 20 });
    expect(parseSendWindow("")).toBeNull();
    expect(parseSendWindow(undefined)).toBeNull();
    expect(formatSendWindow(9, 21)).toBe("09-21");
  });
});

describe("slaDuration", () => {
  it("speaks in hours when the minutes are whole hours", () => {
    expect(slaDuration(120)).toEqual({ unit: "h", n: 2 });
    expect(slaDuration(90)).toEqual({ unit: "min", n: 90 });
  });
});
