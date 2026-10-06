/**
 * What Réglages › Surveillance edits: the thresholds journal_detect() reads
 * from public.journal_rule_settings (20261006120100). Defaults are the values
 * the detector hard-coded before 2026-10-06; ranges keep a typo from silencing
 * a rule (a server error threshold of 10 000 would) or flooding the page.
 */

export type ThresholdUnit = "times" | "minutes" | "hours" | "days" | "people" | "rows";

export interface ThresholdField {
  key: string;
  unit: ThresholdUnit;
  default: number;
  min: number;
  max: number;
}

const f = (key: string, unit: ThresholdUnit, def: number, min: number, max: number): ThresholdField => ({
  key,
  unit,
  default: def,
  min,
  max,
});

export const RULE_CATALOG = {
  job_failing: [f("failures", "times", 2, 1, 20)],
  job_hanging: [f("count", "times", 2, 1, 20), f("days", "days", 7, 1, 30)],
  connection_silent: [f("minutes", "minutes", 30, 10, 1440)],
  carrier_inactive: [f("stale_days", "days", 7, 1, 60)],
  carrier_stuck: [f("hours", "hours", 24, 1, 168)],
  upload_failing: [f("count", "times", 3, 1, 100), f("minutes", "minutes", 60, 10, 1440)],
  external_failing: [f("count", "times", 3, 1, 100), f("minutes", "minutes", 60, 10, 1440)],
  whatsapp_down: [],
  import_rows: [f("hours", "hours", 24, 1, 168)],
  ads_no_orders: [f("hours", "hours", 12, 1, 72)],
  server_error: [f("count", "times", 3, 1, 100), f("hours", "hours", 24, 1, 168)],
  browser_error: [f("count", "times", 3, 1, 100), f("users", "people", 2, 1, 50), f("hours", "hours", 24, 1, 168)],
  login_failures: [f("count", "times", 5, 2, 100), f("minutes", "minutes", 60, 5, 1440)],
  large_export: [f("rows", "rows", 1000, 100, 1_000_000)],
} satisfies Record<string, ThresholdField[]>;

export type RuleKey = keyof typeof RULE_CATALOG;

/** The order of the screen: by what the owner is watching, not by rule number. */
export const RULE_GROUPS: { id: "jobs" | "carriers" | "shops" | "app" | "security"; rules: RuleKey[] }[] = [
  { id: "carriers", rules: ["connection_silent", "carrier_stuck", "carrier_inactive", "upload_failing", "external_failing", "whatsapp_down"] },
  { id: "shops", rules: ["import_rows", "ads_no_orders"] },
  { id: "jobs", rules: ["job_failing", "job_hanging"] },
  { id: "app", rules: ["server_error", "browser_error"] },
  { id: "security", rules: ["login_failures", "large_export"] },
];

export function isRuleKey(k: string): k is RuleKey {
  return Object.prototype.hasOwnProperty.call(RULE_CATALOG, k);
}

export interface RulePatch {
  enabled?: boolean;
  params?: Record<string, number>;
}

export type RulePatchResult =
  | { ok: true; value: RulePatch }
  | { ok: false; error: "unknown_rule" | "unknown_param" | "missing_param" | "out_of_range" | "empty"; field?: string };

export function validateRulePatch(rule: string, body: { enabled?: unknown; params?: unknown }): RulePatchResult {
  if (!isRuleKey(rule)) return { ok: false, error: "unknown_rule" };
  const value: RulePatch = {};

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return { ok: false, error: "out_of_range", field: "enabled" };
    value.enabled = body.enabled;
  }

  if (body.params !== undefined) {
    if (!body.params || typeof body.params !== "object" || Array.isArray(body.params)) {
      return { ok: false, error: "out_of_range", field: "params" };
    }
    const fields: ThresholdField[] = RULE_CATALOG[rule];
    const given = body.params as Record<string, unknown>;
    for (const k of Object.keys(given)) {
      if (!fields.some((x) => x.key === k)) return { ok: false, error: "unknown_param", field: k };
    }
    const params: Record<string, number> = {};
    for (const fd of fields) {
      const v = given[fd.key];
      if (v === undefined) return { ok: false, error: "missing_param", field: fd.key };
      if (typeof v !== "number" || !Number.isInteger(v) || v < fd.min || v > fd.max) {
        return { ok: false, error: "out_of_range", field: fd.key };
      }
      params[fd.key] = v;
    }
    value.params = params;
  }

  if (value.enabled === undefined && value.params === undefined) return { ok: false, error: "empty" };
  return { ok: true, value };
}
