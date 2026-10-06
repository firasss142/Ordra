import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TOPIC_IDS,
  topicsFor,
  defaultTopic,
  isTopicFor,
  isMarketScoped,
  canEditArea,
  legacyConnectionsTab,
  legacySettingsTab,
  MANAGER_EDITABLE_SETTING_KEYS,
  MENU_GROUPS,
} from "./topics";

/**
 * Réglages — one page, a menu of topics in the order an order travels
 * (plans/reglages-redesign.md, prototypes/reglages-v2.html).
 */
describe("Réglages topics", () => {
  it("lists eleven topics, day-to-day selling first and the system last", () => {
    expect(TOPIC_IDS).toEqual([
      "shops",
      "orders",
      "rejections",
      "prospects",
      "team",
      "warehouses",
      "delivery",
      "whatsapp",
      "ads",
      "markets",
      "monitoring",
    ]);
  });

  it("groups the menu in four short sections that cover every topic once", () => {
    expect(MENU_GROUPS.map((g) => g.id)).toEqual(["sales", "shipping", "growth", "system"]);
    expect(MENU_GROUPS.flatMap((g) => g.topics)).toEqual([...TOPIC_IDS]);
  });

  it("gives the super_admin every topic and a market_manager neither Marchés, Publicité nor Surveillance", () => {
    expect(topicsFor("super_admin")).toEqual(TOPIC_IDS);
    expect(topicsFor("market_manager")).toEqual([
      "shops",
      "orders",
      "rejections",
      "prospects",
      "team",
      "warehouses",
      "delivery",
      "whatsapp",
    ]);
    expect(topicsFor("agent")).toEqual([]);
    expect(topicsFor("warehouse_agent")).toEqual([]);
  });

  it("opens Boutiques for everyone: the daily work comes first", () => {
    expect(defaultTopic("super_admin")).toBe("shops");
    expect(defaultTopic("market_manager")).toBe("shops");
  });

  it("refuses an unknown topic and a topic the role may not see", () => {
    expect(isTopicFor("super_admin", "orders")).toBe(true);
    expect(isTopicFor("super_admin", "nope")).toBe(false);
    expect(isTopicFor("market_manager", "ads")).toBe(false);
    expect(isTopicFor("market_manager", "markets")).toBe(false);
  });

  it("treats every topic but Marchés and Surveillance as belonging to one market", () => {
    expect(isMarketScoped("markets")).toBe(false);
    expect(isMarketScoped("monitoring")).toBe(false);
    for (const t of TOPIC_IDS.filter((x) => x !== "markets" && x !== "monitoring")) {
      expect(isMarketScoped(t)).toBe(true);
    }
  });

  it("lets a manager edit the day-to-day rules only", () => {
    for (const area of ["orders", "rejections", "team", "risk", "board", "matching", "prospects"] as const) {
      expect(canEditArea("market_manager", area)).toBe(true);
      expect(canEditArea("super_admin", area)).toBe(true);
    }
    for (const area of ["markets", "shops", "commissions", "warehouses", "carriers", "whatsapp", "ads", "money", "monitoring"] as const) {
      expect(canEditArea("market_manager", area)).toBe(false);
      expect(canEditArea("super_admin", area)).toBe(true);
    }
    expect(canEditArea("agent", "orders")).toBe(false);
  });

  it("maps the old Connexions tabs onto their new topic", () => {
    expect(legacyConnectionsTab("storefronts", "super_admin")).toBe("shops");
    expect(legacyConnectionsTab("mappings", "super_admin")).toBe("shops");
    expect(legacyConnectionsTab("carriers", "super_admin")).toBe("delivery");
    expect(legacyConnectionsTab("services", "super_admin")).toBe("whatsapp");
    expect(legacyConnectionsTab("overview", "super_admin")).toBe("markets");
    expect(legacyConnectionsTab("overview", "market_manager")).toBe("shops");
    expect(legacyConnectionsTab(null, "market_manager")).toBe("shops");
  });

  it("maps the old Paramètres tabs onto their new topic", () => {
    expect(legacySettingsTab("operations", "super_admin")).toBe("orders");
    expect(legacySettingsTab("livraison", "super_admin")).toBe("delivery");
    expect(legacySettingsTab("alertes", "super_admin")).toBe("delivery");
    expect(legacySettingsTab("team", "super_admin")).toBe("team");
    expect(legacySettingsTab("objectifs", "super_admin")).toBe("team");
    expect(legacySettingsTab("commissions", "super_admin")).toBe("team");
    expect(legacySettingsTab("rejets", "super_admin")).toBe("rejections");
    expect(legacySettingsTab("whatsapp", "super_admin")).toBe("whatsapp");
    expect(legacySettingsTab(null, "super_admin")).toBe("orders");
  });

  it("whitelists exactly the settings a manager may write — never money, stock planning or WhatsApp", () => {
    expect([...MANAGER_EDITABLE_SETTING_KEYS].sort()).toEqual(
      [
        "max_call_attempts",
        "attempt_retry_times",
        "sla_minutes",
        "duplicate_window_hours",
        "duplicate_autoselect_window_hours",
        "merge_window_hours",
        "auto_archive_after_days",
        "assignment_algorithm",
        "goal_daily_treated",
        "goal_min_rate",
        "goal_conf_per_hour",
        "goal_team_weekly_conf",
        "high_value_threshold",
        "risk_min_prior_failures",
        "zone_low_delivery_rate_pct",
        "zone_min_sample",
        "carrier_stall_days",
        "delivery_first_action_hours",
        "delivery_done_window_hours",
        "max_lead_attempts",
        "lead_hot_window_minutes",
      ].sort(),
    );
  });

  it("lets the database accept exactly the same keys from a manager, in each of its three lists", () => {
    // The route's whitelist gives a readable 403; the RLS policy is what holds
    // against a direct PostgREST call. If one list grows without the other, a
    // manager either gets a 500 on a field the page offers, or can write
    // through PostgREST what the page refuses.
    const sql = readFileSync(
      // the latest migration that redefines the two manager policies
      join(__dirname, "../../../supabase/migrations/20261006120200_settings_business_rules.sql"),
      "utf8",
    ).replace(/--.*$/gm, "");
    const lists = [...sql.matchAll(/key = ANY \(ARRAY\[([^\]]*)\]\)/g)].map((m) =>
      [...m[1].matchAll(/'([a-z_]+)'/g)].map((k) => k[1]).sort(),
    );
    expect(lists).toHaveLength(3);
    for (const keys of lists) expect(keys).toEqual([...MANAGER_EDITABLE_SETTING_KEYS].sort());
  });
});
