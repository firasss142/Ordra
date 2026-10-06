import { describe, test, expect } from "vitest";
import { RULE_CATALOG, RULE_GROUPS, validateRulePatch } from "../rule-settings";

describe("the Surveillance catalogue", () => {
  test("every rule the detector knows is listed exactly once, in a group", () => {
    const listed = RULE_GROUPS.flatMap((g) => g.rules);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(Object.keys(RULE_CATALOG).sort());
    expect(listed).toHaveLength(14);
  });

  test("defaults equal the values the detector hard-coded before 2026-10-06", () => {
    const d = (rule: keyof typeof RULE_CATALOG) => Object.fromEntries(RULE_CATALOG[rule].map((f) => [f.key, f.default]));
    expect(d("connection_silent")).toEqual({ minutes: 30 });
    expect(d("upload_failing")).toEqual({ count: 3, minutes: 60 });
    expect(d("server_error")).toEqual({ count: 3, hours: 24 });
    expect(d("login_failures")).toEqual({ count: 5, minutes: 60 });
    expect(d("large_export")).toEqual({ rows: 1000 });
    expect(d("whatsapp_down")).toEqual({});
  });
});

describe("validateRulePatch", () => {
  test("accepts a switch, and thresholds inside their range", () => {
    expect(validateRulePatch("server_error", { enabled: false })).toEqual({ ok: true, value: { enabled: false } });
    expect(validateRulePatch("server_error", { params: { count: 5, hours: 12 } })).toEqual({
      ok: true,
      value: { params: { count: 5, hours: 12 } },
    });
  });

  test("refuses an unknown rule, an unknown key, a value out of range or not whole", () => {
    expect(validateRulePatch("nope", { enabled: true })).toMatchObject({ ok: false, error: "unknown_rule" });
    expect(validateRulePatch("server_error", { params: { count: 3, hours: 24, extra: 1 } })).toMatchObject({ ok: false, error: "unknown_param" });
    expect(validateRulePatch("server_error", { params: { count: 0, hours: 24 } })).toMatchObject({ ok: false, error: "out_of_range" });
    expect(validateRulePatch("server_error", { params: { count: 2.5, hours: 24 } })).toMatchObject({ ok: false, error: "out_of_range" });
    expect(validateRulePatch("server_error", { params: { count: "3", hours: 24 } })).toMatchObject({ ok: false, error: "out_of_range" });
  });

  test("a patch must set every threshold of its rule at once, so no half-saved rule exists", () => {
    expect(validateRulePatch("server_error", { params: { count: 3 } })).toMatchObject({ ok: false, error: "missing_param" });
  });

  test("an empty patch is refused", () => {
    expect(validateRulePatch("server_error", {})).toMatchObject({ ok: false, error: "empty" });
  });
});
