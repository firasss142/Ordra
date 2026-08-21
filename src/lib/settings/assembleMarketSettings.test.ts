import { describe, it, expect } from "vitest";
import { assembleMarketSettings, unwrapSettingValue } from "./assembleMarketSettings";
import { DEFAULT_MARKET_SETTINGS } from "@/types/settings";

describe("unwrapSettingValue", () => {
  it("unwraps the { value: X } scalar wrapping the PATCH route writes", () => {
    expect(unwrapSettingValue({ value: 120 })).toBe(120);
    expect(unwrapSettingValue({ value: "16:30" })).toBe("16:30");
    expect(unwrapSettingValue({ value: true })).toBe(true);
  });

  it("returns objects stored raw (shift_config) unchanged", () => {
    const shift = { start: "08:00", end: "18:00", days: [1, 2], timezone: "Africa/Tunis" };
    expect(unwrapSettingValue(shift)).toEqual(shift);
  });

  it("returns arrays unchanged", () => {
    expect(unwrapSettingValue(["11:00", "14:00"])).toEqual(["11:00", "14:00"]);
  });

  it("passes bare scalars through", () => {
    expect(unwrapSettingValue(5)).toBe(5);
  });
});

describe("assembleMarketSettings", () => {
  it("returns the full defaults when there are no rows", () => {
    const result = assembleMarketSettings([]);
    expect(result).toEqual(DEFAULT_MARKET_SETTINGS);
  });

  it("overrides a single key from a wrapped scalar row", () => {
    const result = assembleMarketSettings([
      { key: "sla_minutes", value: { value: 90 } },
    ]);
    expect(result.sla_minutes).toBe(90);
    // Untouched keys keep their default.
    expect(result.max_call_attempts).toBe(DEFAULT_MARKET_SETTINGS.max_call_attempts);
  });

  it("applies a new redesign key (dispatch_cutoff_time) from a wrapped row", () => {
    const result = assembleMarketSettings([
      { key: "dispatch_cutoff_time", value: { value: "16:30" } },
    ]);
    expect(result.dispatch_cutoff_time).toBe("16:30");
  });

  it("applies an object key (shift_config) stored raw", () => {
    const shift = { start: "09:00", end: "17:00", days: [1, 2, 3], timezone: "Africa/Tripoli" };
    const result = assembleMarketSettings([{ key: "shift_config", value: shift }]);
    expect(result.shift_config).toEqual(shift);
  });

  it("ignores an unknown key rather than injecting it", () => {
    const result = assembleMarketSettings([
      { key: "totally_unknown", value: { value: 1 } },
    ]);
    expect(result).not.toHaveProperty("totally_unknown");
    expect(result).toEqual(DEFAULT_MARKET_SETTINGS);
  });

  it("falls back to the default when a stored value is the wrong type", () => {
    const result = assembleMarketSettings([
      { key: "max_call_attempts", value: { value: "not a number" } },
    ]);
    expect(result.max_call_attempts).toBe(DEFAULT_MARKET_SETTINGS.max_call_attempts);
  });

  it("falls back to the default when a stored value is out of range", () => {
    // 99 is beyond the 1..10 bound; assembly must not surface an invalid value
    // that would then fail the PATCH validator on the next save.
    const result = assembleMarketSettings([
      { key: "max_call_attempts", value: { value: 99 } },
    ]);
    expect(result.max_call_attempts).toBe(DEFAULT_MARKET_SETTINGS.max_call_attempts);
  });

  it("assembles several keys together, mixing wrapped scalars and raw objects", () => {
    const result = assembleMarketSettings([
      { key: "max_call_attempts", value: { value: 3 } },
      { key: "after_max_attempts_action", value: { value: "reject" } },
      { key: "carrier_error_rate_threshold", value: { value: 8 } },
      { key: "attempt_retry_times", value: ["11:00", "14:00"] },
    ]);
    expect(result.max_call_attempts).toBe(3);
    expect(result.after_max_attempts_action).toBe("reject");
    expect(result.carrier_error_rate_threshold).toBe(8);
    expect(result.attempt_retry_times).toEqual(["11:00", "14:00"]);
  });

  it("always returns an object that passes isValidMarketSettings", async () => {
    const { isValidMarketSettings } = await import("@/types/settings");
    const result = assembleMarketSettings([
      { key: "sla_minutes", value: { value: 90 } },
      { key: "order_amount_min", value: { value: 10 } },
      { key: "order_amount_max", value: { value: 2000 } },
    ]);
    expect(isValidMarketSettings(result)).toBe(true);
  });
});
