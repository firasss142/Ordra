import { describe, it, expect } from "vitest";
import {
  isValidMarketSettings,
  AssignmentAlgorithm,
} from "../../types/settings";
import type { MarketSettings, CarrierConfig } from "../../types/settings";

describe("AssignmentAlgorithm", () => {
  it("has exactly 5 values", () => {
    const values = Object.values(AssignmentAlgorithm);
    expect(values).toHaveLength(5);
  });

  it("contains manual", () => {
    expect(AssignmentAlgorithm.manual).toBe("manual");
  });

  it("contains round_robin", () => {
    expect(AssignmentAlgorithm.round_robin).toBe("round_robin");
  });

  it("contains workload", () => {
    expect(AssignmentAlgorithm.workload).toBe("workload");
  });

  it("contains product_based", () => {
    expect(AssignmentAlgorithm.product_based).toBe("product_based");
  });

  it("contains region_based", () => {
    expect(AssignmentAlgorithm.region_based).toBe("region_based");
  });
});

describe("MarketSettings type", () => {
  it("accepts a valid MarketSettings object", () => {
    const settings: MarketSettings = {
      delivery_fee: 7,
      return_fee: 3,
      packing_cost: 1.5,
      max_call_attempts: 3,
      assignment_algorithm: "round_robin",
      active_agents_only: false,
    };
    expect(isValidMarketSettings(settings)).toBe(true);
  });
});

describe("isValidMarketSettings", () => {
  const valid = {
    delivery_fee: 7,
    return_fee: 3,
    packing_cost: 1.5,
    max_call_attempts: 3,
    assignment_algorithm: "round_robin",
    active_agents_only: false,
  };

  it("returns true for valid settings", () => {
    expect(isValidMarketSettings(valid)).toBe(true);
  });

  it("returns false when delivery_fee is missing", () => {
    const { delivery_fee, ...rest } = valid;
    expect(isValidMarketSettings(rest)).toBe(false);
  });

  it("returns false when return_fee is missing", () => {
    const { return_fee, ...rest } = valid;
    expect(isValidMarketSettings(rest)).toBe(false);
  });

  it("returns false when packing_cost is missing", () => {
    const { packing_cost, ...rest } = valid;
    expect(isValidMarketSettings(rest)).toBe(false);
  });

  it("returns false when max_call_attempts is missing", () => {
    const { max_call_attempts, ...rest } = valid;
    expect(isValidMarketSettings(rest)).toBe(false);
  });

  it("returns false when assignment_algorithm is missing", () => {
    const { assignment_algorithm, ...rest } = valid;
    expect(isValidMarketSettings(rest)).toBe(false);
  });

  it("returns false when delivery_fee is negative", () => {
    expect(isValidMarketSettings({ ...valid, delivery_fee: -1 })).toBe(false);
  });

  it("returns false when return_fee is negative", () => {
    expect(isValidMarketSettings({ ...valid, return_fee: -0.01 })).toBe(false);
  });

  it("returns false when packing_cost is negative", () => {
    expect(isValidMarketSettings({ ...valid, packing_cost: -5 })).toBe(false);
  });

  it("returns false when max_call_attempts is 0", () => {
    expect(isValidMarketSettings({ ...valid, max_call_attempts: 0 })).toBe(
      false
    );
  });

  it("returns false when max_call_attempts is 11", () => {
    expect(isValidMarketSettings({ ...valid, max_call_attempts: 11 })).toBe(
      false
    );
  });

  it("returns true when max_call_attempts is 1", () => {
    expect(isValidMarketSettings({ ...valid, max_call_attempts: 1 })).toBe(
      true
    );
  });

  it("returns true when max_call_attempts is 10", () => {
    expect(isValidMarketSettings({ ...valid, max_call_attempts: 10 })).toBe(
      true
    );
  });

  it("returns false when assignment_algorithm is an unknown value", () => {
    expect(
      isValidMarketSettings({ ...valid, assignment_algorithm: "unknown_value" })
    ).toBe(false);
  });

  it("returns false for null input", () => {
    expect(isValidMarketSettings(null)).toBe(false);
  });

  it("returns false for empty object", () => {
    expect(isValidMarketSettings({})).toBe(false);
  });

  it("accepts attempt_retry_times with valid sorted HH:MM strings", () => {
    expect(
      isValidMarketSettings({ ...valid, attempt_retry_times: ["11:00", "14:00", "18:00"] })
    ).toBe(true);
  });

  it("accepts empty attempt_retry_times array", () => {
    expect(isValidMarketSettings({ ...valid, attempt_retry_times: [] })).toBe(true);
  });

  it("rejects attempt_retry_times with malformed entry", () => {
    expect(
      isValidMarketSettings({ ...valid, attempt_retry_times: ["11:00", "25:00"] })
    ).toBe(false);
  });

  it("rejects attempt_retry_times when not strictly increasing", () => {
    expect(
      isValidMarketSettings({ ...valid, attempt_retry_times: ["14:00", "11:00"] })
    ).toBe(false);
    expect(
      isValidMarketSettings({ ...valid, attempt_retry_times: ["11:00", "11:00"] })
    ).toBe(false);
  });

  it("rejects attempt_retry_times longer than 3 entries", () => {
    expect(
      isValidMarketSettings({
        ...valid,
        attempt_retry_times: ["08:00", "11:00", "14:00", "18:00"],
      })
    ).toBe(false);
  });
});

describe("CarrierConfig type", () => {
  it("accepts a valid CarrierConfig object", () => {
    const config: CarrierConfig = {
      id: "carrier-1",
      market_id: "market-tn",
      name: "Aramex TN",
      api_endpoint: "https://api.aramex.com/v1",
      api_key_encrypted: "enc:abc123",
      delivery_fee: 7,
      return_fee: 3,
      active: true,
    };
    // Type check only — object is valid if it compiles
    expect(typeof config.id).toBe("string");
    expect(typeof config.api_key_encrypted).toBe("string");
    expect(typeof config.delivery_fee).toBe("number");
    expect(config.delivery_fee).toBeGreaterThan(0);
    expect(config.return_fee).toBeGreaterThan(0);
    expect(typeof config.active).toBe("boolean");
  });
});
