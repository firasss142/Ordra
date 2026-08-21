import { describe, it, expect } from "vitest";
import {
  isValidMarketSettings,
  AssignmentAlgorithm,
  MARKET_SETTINGS_KEYS,
  DEFAULT_MARKET_SETTINGS,
} from "../../types/settings";
import type { MarketSettings, CarrierConfig } from "../../types/settings";

describe("MARKET_SETTINGS_KEYS", () => {
  it("includes every key that has a default (so assembly never drops a defaulted key)", () => {
    for (const key of Object.keys(DEFAULT_MARKET_SETTINGS)) {
      expect(MARKET_SETTINGS_KEYS).toContain(key);
    }
  });
  it("has no duplicate entries", () => {
    expect(new Set(MARKET_SETTINGS_KEYS).size).toBe(MARKET_SETTINGS_KEYS.length);
  });
});

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

describe("isValidMarketSettings — supplier_lead_time_days", () => {
  const valid = {
    delivery_fee: 7,
    return_fee: 3,
    packing_cost: 1.5,
    max_call_attempts: 3,
    assignment_algorithm: "round_robin",
  };

  // The stock console derives `reorder_by_date` as stock-out minus this value.
  // Without a branch here the whitelist validator rejects the whole payload, so
  // the setting could be read but never saved.
  it("accepts a whole number of days", () => {
    expect(isValidMarketSettings({ ...valid, supplier_lead_time_days: 14 })).toBe(true);
  });
  it("accepts zero — a domestic supplier with same-day pickup", () => {
    expect(isValidMarketSettings({ ...valid, supplier_lead_time_days: 0 })).toBe(true);
  });
  it("is optional", () => {
    expect(isValidMarketSettings(valid)).toBe(true);
  });
  it("rejects a negative lead time", () => {
    expect(isValidMarketSettings({ ...valid, supplier_lead_time_days: -1 })).toBe(false);
  });
  it("rejects a fractional lead time", () => {
    expect(isValidMarketSettings({ ...valid, supplier_lead_time_days: 3.5 })).toBe(false);
  });
  it("rejects a numeric string", () => {
    expect(isValidMarketSettings({ ...valid, supplier_lead_time_days: "14" })).toBe(false);
  });
  it("rejects a lead time beyond a year", () => {
    expect(isValidMarketSettings({ ...valid, supplier_lead_time_days: 400 })).toBe(false);
  });
});

describe("isValidMarketSettings — sla_minutes", () => {
  const valid = {
    delivery_fee: 7,
    return_fee: 3,
    packing_cost: 1.5,
    max_call_attempts: 3,
    assignment_algorithm: "round_robin",
  };

  // The order panel reads this as the confirmation target. Without a branch
  // here the whitelist validator rejects the whole payload, so the target could
  // be read but never saved.
  it("accepts a whole number of minutes", () => {
    expect(isValidMarketSettings({ ...valid, sla_minutes: 120 })).toBe(true);
  });
  it("is optional — a market that has not set one falls back to the default", () => {
    expect(isValidMarketSettings(valid)).toBe(true);
  });
  it("rejects zero, which would mark every order late on arrival", () => {
    expect(isValidMarketSettings({ ...valid, sla_minutes: 0 })).toBe(false);
  });
  it("rejects a fractional target", () => {
    expect(isValidMarketSettings({ ...valid, sla_minutes: 90.5 })).toBe(false);
  });
  it("rejects a numeric string", () => {
    expect(isValidMarketSettings({ ...valid, sla_minutes: "120" })).toBe(false);
  });
  it("rejects a target beyond a week, which is not a service level", () => {
    expect(isValidMarketSettings({ ...valid, sla_minutes: 20_000 })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Redesign (Système › Paramètres): new setting keys. These are UI+storage+
// validation only — enforcement (crons/order-engine acting on them) is a
// separate follow-up. Each key needs a validator branch, or the whitelist
// validator would reject the whole payload the moment the key is present.
// ─────────────────────────────────────────────────────────────────────────
describe("isValidMarketSettings — new operations keys", () => {
  const valid = {
    delivery_fee: 7,
    return_fee: 3,
    packing_cost: 1.5,
    max_call_attempts: 3,
    assignment_algorithm: "round_robin",
  };

  describe("after_max_attempts_action", () => {
    it("accepts reject | flag | none", () => {
      expect(isValidMarketSettings({ ...valid, after_max_attempts_action: "reject" })).toBe(true);
      expect(isValidMarketSettings({ ...valid, after_max_attempts_action: "flag" })).toBe(true);
      expect(isValidMarketSettings({ ...valid, after_max_attempts_action: "none" })).toBe(true);
    });
    it("is optional", () => {
      expect(isValidMarketSettings(valid)).toBe(true);
    });
    it("rejects an unknown action", () => {
      expect(isValidMarketSettings({ ...valid, after_max_attempts_action: "explode" })).toBe(false);
    });
    it("rejects a non-string", () => {
      expect(isValidMarketSettings({ ...valid, after_max_attempts_action: 1 })).toBe(false);
    });
  });

  describe("after_max_attempts_delay_hours", () => {
    it("accepts a whole number of hours", () => {
      expect(isValidMarketSettings({ ...valid, after_max_attempts_delay_hours: 24 })).toBe(true);
    });
    it("accepts zero (act immediately)", () => {
      expect(isValidMarketSettings({ ...valid, after_max_attempts_delay_hours: 0 })).toBe(true);
    });
    it("rejects a fractional value", () => {
      expect(isValidMarketSettings({ ...valid, after_max_attempts_delay_hours: 1.5 })).toBe(false);
    });
    it("rejects a negative value", () => {
      expect(isValidMarketSettings({ ...valid, after_max_attempts_delay_hours: -1 })).toBe(false);
    });
    it("rejects beyond 30 days", () => {
      expect(isValidMarketSettings({ ...valid, after_max_attempts_delay_hours: 721 })).toBe(false);
    });
  });

  describe("callback_max_days", () => {
    it("accepts 1..30", () => {
      expect(isValidMarketSettings({ ...valid, callback_max_days: 3 })).toBe(true);
    });
    it("rejects zero", () => {
      expect(isValidMarketSettings({ ...valid, callback_max_days: 0 })).toBe(false);
    });
    it("rejects beyond a month", () => {
      expect(isValidMarketSettings({ ...valid, callback_max_days: 31 })).toBe(false);
    });
  });

  describe("callback_grace_minutes", () => {
    it("accepts 0..1440", () => {
      expect(isValidMarketSettings({ ...valid, callback_grace_minutes: 15 })).toBe(true);
      expect(isValidMarketSettings({ ...valid, callback_grace_minutes: 0 })).toBe(true);
    });
    it("rejects beyond a day", () => {
      expect(isValidMarketSettings({ ...valid, callback_grace_minutes: 1441 })).toBe(false);
    });
  });

  describe("dispatch_cutoff_time", () => {
    it("accepts a HH:MM string", () => {
      expect(isValidMarketSettings({ ...valid, dispatch_cutoff_time: "16:30" })).toBe(true);
    });
    it("rejects a malformed time", () => {
      expect(isValidMarketSettings({ ...valid, dispatch_cutoff_time: "25:00" })).toBe(false);
      expect(isValidMarketSettings({ ...valid, dispatch_cutoff_time: "1630" })).toBe(false);
    });
  });

  describe("duplicate_window_hours", () => {
    it("accepts 0..168", () => {
      expect(isValidMarketSettings({ ...valid, duplicate_window_hours: 24 })).toBe(true);
      expect(isValidMarketSettings({ ...valid, duplicate_window_hours: 0 })).toBe(true);
    });
    it("rejects beyond a week", () => {
      expect(isValidMarketSettings({ ...valid, duplicate_window_hours: 169 })).toBe(false);
    });
  });

  describe("auto_assign_on_intake / auto_upload_on_confirm / auto_restock_on_return_scan", () => {
    it("accept booleans", () => {
      expect(isValidMarketSettings({ ...valid, auto_assign_on_intake: true })).toBe(true);
      expect(isValidMarketSettings({ ...valid, auto_upload_on_confirm: false })).toBe(true);
      expect(isValidMarketSettings({ ...valid, auto_restock_on_return_scan: true })).toBe(true);
    });
    it("reject non-booleans", () => {
      expect(isValidMarketSettings({ ...valid, auto_assign_on_intake: "yes" })).toBe(false);
      expect(isValidMarketSettings({ ...valid, auto_upload_on_confirm: 1 })).toBe(false);
    });
  });

  describe("order_amount_min / order_amount_max", () => {
    it("accept non-negative numbers", () => {
      expect(isValidMarketSettings({ ...valid, order_amount_min: 10, order_amount_max: 2000 })).toBe(true);
      expect(isValidMarketSettings({ ...valid, order_amount_min: 0 })).toBe(true);
    });
    it("reject negatives", () => {
      expect(isValidMarketSettings({ ...valid, order_amount_min: -1 })).toBe(false);
    });
    it("reject max below min", () => {
      expect(isValidMarketSettings({ ...valid, order_amount_min: 100, order_amount_max: 50 })).toBe(false);
    });
  });

  describe("unknown_city_policy", () => {
    it("accepts queue | fuzzy", () => {
      expect(isValidMarketSettings({ ...valid, unknown_city_policy: "queue" })).toBe(true);
      expect(isValidMarketSettings({ ...valid, unknown_city_policy: "fuzzy" })).toBe(true);
    });
    it("rejects an unknown policy", () => {
      expect(isValidMarketSettings({ ...valid, unknown_city_policy: "guess" })).toBe(false);
    });
  });

  describe("unverified_after_days", () => {
    it("accepts 1..90", () => {
      expect(isValidMarketSettings({ ...valid, unverified_after_days: 5 })).toBe(true);
    });
    it("rejects zero and beyond 90", () => {
      expect(isValidMarketSettings({ ...valid, unverified_after_days: 0 })).toBe(false);
      expect(isValidMarketSettings({ ...valid, unverified_after_days: 91 })).toBe(false);
    });
  });

  describe("auto_archive_after_days", () => {
    it("accepts 1..365", () => {
      expect(isValidMarketSettings({ ...valid, auto_archive_after_days: 30 })).toBe(true);
    });
    it("rejects zero and beyond a year", () => {
      expect(isValidMarketSettings({ ...valid, auto_archive_after_days: 0 })).toBe(false);
      expect(isValidMarketSettings({ ...valid, auto_archive_after_days: 366 })).toBe(false);
    });
  });
});

describe("isValidMarketSettings — team keys", () => {
  const valid = {
    delivery_fee: 7,
    return_fee: 3,
    packing_cost: 1.5,
    max_call_attempts: 3,
    assignment_algorithm: "round_robin",
  };

  describe("max_open_orders_per_agent", () => {
    it("accepts a positive integer", () => {
      expect(isValidMarketSettings({ ...valid, max_open_orders_per_agent: 25 })).toBe(true);
    });
    it("rejects zero and fractional", () => {
      expect(isValidMarketSettings({ ...valid, max_open_orders_per_agent: 0 })).toBe(false);
      expect(isValidMarketSettings({ ...valid, max_open_orders_per_agent: 2.5 })).toBe(false);
    });
  });

  describe("orphan_reassign_after_minutes / orphan_reassign_enabled", () => {
    it("accept a positive integer and a boolean", () => {
      expect(isValidMarketSettings({ ...valid, orphan_reassign_after_minutes: 60 })).toBe(true);
      expect(isValidMarketSettings({ ...valid, orphan_reassign_enabled: false })).toBe(true);
    });
    it("reject a non-positive delay", () => {
      expect(isValidMarketSettings({ ...valid, orphan_reassign_after_minutes: 0 })).toBe(false);
    });
  });

  describe("outside_hours_policy", () => {
    it("accepts hold | assign", () => {
      expect(isValidMarketSettings({ ...valid, outside_hours_policy: "hold" })).toBe(true);
      expect(isValidMarketSettings({ ...valid, outside_hours_policy: "assign" })).toBe(true);
    });
    it("rejects an unknown policy", () => {
      expect(isValidMarketSettings({ ...valid, outside_hours_policy: "sleep" })).toBe(false);
    });
  });
});

describe("isValidMarketSettings — alert threshold keys", () => {
  const valid = {
    delivery_fee: 7,
    return_fee: 3,
    packing_cost: 1.5,
    max_call_attempts: 3,
    assignment_algorithm: "round_robin",
  };

  it("carrier_error_rate_threshold accepts 0..100", () => {
    expect(isValidMarketSettings({ ...valid, carrier_error_rate_threshold: 5 })).toBe(true);
    expect(isValidMarketSettings({ ...valid, carrier_error_rate_threshold: 0 })).toBe(true);
    expect(isValidMarketSettings({ ...valid, carrier_error_rate_threshold: 100 })).toBe(true);
  });
  it("carrier_error_rate_threshold rejects out of range", () => {
    expect(isValidMarketSettings({ ...valid, carrier_error_rate_threshold: -1 })).toBe(false);
    expect(isValidMarketSettings({ ...valid, carrier_error_rate_threshold: 101 })).toBe(false);
  });
  it("webhook_failure_threshold accepts a positive integer", () => {
    expect(isValidMarketSettings({ ...valid, webhook_failure_threshold: 3 })).toBe(true);
    expect(isValidMarketSettings({ ...valid, webhook_failure_threshold: 0 })).toBe(false);
  });
  it("sync_staleness_hours accepts a positive integer", () => {
    expect(isValidMarketSettings({ ...valid, sync_staleness_hours: 2 })).toBe(true);
    expect(isValidMarketSettings({ ...valid, sync_staleness_hours: 0 })).toBe(false);
  });
  it("carrier_stall_days accepts a positive integer", () => {
    expect(isValidMarketSettings({ ...valid, carrier_stall_days: 5 })).toBe(true);
    expect(isValidMarketSettings({ ...valid, carrier_stall_days: 0 })).toBe(false);
  });
  it("stockout_days_of_cover accepts a non-negative integer", () => {
    expect(isValidMarketSettings({ ...valid, stockout_days_of_cover: 7 })).toBe(true);
    expect(isValidMarketSettings({ ...valid, stockout_days_of_cover: 0 })).toBe(true);
    expect(isValidMarketSettings({ ...valid, stockout_days_of_cover: -1 })).toBe(false);
  });
  it("sla_breach_alert accepts a boolean", () => {
    expect(isValidMarketSettings({ ...valid, sla_breach_alert: true })).toBe(true);
    expect(isValidMarketSettings({ ...valid, sla_breach_alert: "on" })).toBe(false);
  });
});

describe("isValidMarketSettings — goal keys", () => {
  const valid = {
    delivery_fee: 7,
    return_fee: 3,
    packing_cost: 1.5,
    max_call_attempts: 3,
    assignment_algorithm: "round_robin",
  };

  it("goal_daily_treated accepts a non-negative integer", () => {
    expect(isValidMarketSettings({ ...valid, goal_daily_treated: 12 })).toBe(true);
    expect(isValidMarketSettings({ ...valid, goal_daily_treated: -1 })).toBe(false);
  });
  it("goal_min_rate accepts 0..100", () => {
    expect(isValidMarketSettings({ ...valid, goal_min_rate: 40 })).toBe(true);
    expect(isValidMarketSettings({ ...valid, goal_min_rate: 101 })).toBe(false);
  });
  it("goal_conf_per_hour accepts a non-negative number", () => {
    expect(isValidMarketSettings({ ...valid, goal_conf_per_hour: 3 })).toBe(true);
    expect(isValidMarketSettings({ ...valid, goal_conf_per_hour: -1 })).toBe(false);
  });
  it("goal_team_weekly_conf accepts a non-negative integer", () => {
    expect(isValidMarketSettings({ ...valid, goal_team_weekly_conf: 150 })).toBe(true);
    expect(isValidMarketSettings({ ...valid, goal_team_weekly_conf: 2.5 })).toBe(false);
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
