import { describe, test, expect } from "vitest";
import {
  CODED_DEFAULTS,
  ORDER_OPTION_KEYS,
  FULFILMENT_MODE_KEYS,
  resolveOrderPreferences,
  lockedOptionValues,
  resolveFulfilmentModes,
  isFulfilmentModeChangeValid,
  type CarrierOrderPreferenceRow,
} from "./order-preferences";

function row(
  over: Partial<Omit<CarrierOrderPreferenceRow, "option_key">> & { option_key: string },
): CarrierOrderPreferenceRow {
  return {
    carrier_id: "c-tripoli",
    default_value: false,
    can_override: true,
    ...over,
  };
}

describe("resolveOrderPreferences", () => {
  test("with no configured rows, falls back to today's coded defaults", () => {
    const resolved = resolveOrderPreferences([]);

    // Pickup is the one that defaults ON — Darb collecting from our warehouse
    // is the normal case.
    expect(resolved.is_pickup).toEqual({ value: true, canOverride: true });
    expect(resolved.allow_inspection).toEqual({ value: false, canOverride: true });
    expect(resolved.is_replacement).toEqual({ value: false, canOverride: true });
  });

  test("every option key has a coded default, so a gap can never be undefined", () => {
    const resolved = resolveOrderPreferences([]);
    for (const key of ORDER_OPTION_KEYS) {
      expect(resolved[key]).toBeDefined();
      expect(typeof resolved[key].value).toBe("boolean");
      expect(resolved[key].value).toBe(CODED_DEFAULTS[key]);
    }
  });

  test("a configured row overrides the coded default", () => {
    const resolved = resolveOrderPreferences([
      row({ option_key: "allow_inspection", default_value: true }),
    ]);
    expect(resolved.allow_inspection).toEqual({ value: true, canOverride: true });
  });

  test("a locked option keeps its default and reports canOverride false", () => {
    const resolved = resolveOrderPreferences([
      row({ option_key: "allow_testing", default_value: false, can_override: false }),
    ]);
    expect(resolved.allow_testing).toEqual({ value: false, canOverride: false });
  });

  // THE TRAP. Locking an option hides it from the modal, but hidden is not the
  // same as false: a policy that forces inspection ON must still send true.
  test("an option locked ON stays ON — hidden must never mean false", () => {
    const resolved = resolveOrderPreferences([
      row({ option_key: "allow_inspection", default_value: true, can_override: false }),
    ]);
    expect(resolved.allow_inspection).toEqual({ value: true, canOverride: false });
  });

  test("scopes to the carrier's own rows when several carriers are present", () => {
    const rows = [
      row({ carrier_id: "c-tripoli", option_key: "is_fragile", default_value: true }),
      row({ carrier_id: "c-benghazi", option_key: "is_fragile", default_value: false }),
    ];
    expect(resolveOrderPreferences(rows, "c-benghazi").is_fragile.value).toBe(false);
    expect(resolveOrderPreferences(rows, "c-tripoli").is_fragile.value).toBe(true);
  });

  test("ignores an unknown option key rather than throwing", () => {
    const rows = [
      { carrier_id: "c-tripoli", option_key: "not_a_real_option", default_value: true, can_override: false },
    ] as unknown as CarrierOrderPreferenceRow[];
    const resolved = resolveOrderPreferences(rows);
    expect(resolved.is_pickup.value).toBe(true);
    expect(Object.keys(resolved).sort()).toEqual([...ORDER_OPTION_KEYS].sort());
  });
});

describe("resolveFulfilmentModes", () => {
  test("both modes are offered when nothing is configured", () => {
    expect(resolveFulfilmentModes([])).toEqual({ home: true, carrier: true });
  });

  test("a stored row turns a mode off", () => {
    const modes = resolveFulfilmentModes([
      row({ option_key: "mode_carrier_warehouse", default_value: false }),
    ]);
    expect(modes).toEqual({ home: true, carrier: false });
  });

  test("our own warehouse can be turned off too", () => {
    const modes = resolveFulfilmentModes([
      row({ option_key: "mode_home_warehouse", default_value: false }),
    ]);
    expect(modes).toEqual({ home: false, carrier: true });
  });

  test("scopes to the carrier's own rows", () => {
    const rows = [
      row({ carrier_id: "c-tripoli", option_key: "mode_carrier_warehouse", default_value: false }),
      row({ carrier_id: "c-benghazi", option_key: "mode_carrier_warehouse", default_value: true }),
    ];
    expect(resolveFulfilmentModes(rows, "c-tripoli").carrier).toBe(false);
    expect(resolveFulfilmentModes(rows, "c-benghazi").carrier).toBe(true);
  });

  test("the option keys are not mixed into the six order options", () => {
    const resolved = resolveOrderPreferences([
      row({ option_key: "mode_home_warehouse", default_value: false }),
    ]);
    expect(Object.keys(resolved).sort()).toEqual([...ORDER_OPTION_KEYS].sort());
    expect(FULFILMENT_MODE_KEYS).not.toContain("is_pickup");
  });
});

describe("isFulfilmentModeChangeValid", () => {
  test("accepts either mode alone", () => {
    expect(isFulfilmentModeChangeValid({ home: true, carrier: false })).toBe(true);
    expect(isFulfilmentModeChangeValid({ home: false, carrier: true })).toBe(true);
  });

  test("accepts both on", () => {
    expect(isFulfilmentModeChangeValid({ home: true, carrier: true })).toBe(true);
  });

  // Turning both off would leave the carrier undispatchable — there would be
  // nowhere for the parcel to ship from.
  test("refuses both off", () => {
    expect(isFulfilmentModeChangeValid({ home: false, carrier: false })).toBe(false);
  });
});

describe("lockedOptionValues", () => {
  test("returns only the options the agent cannot change", () => {
    const resolved = resolveOrderPreferences([
      row({ option_key: "allow_inspection", default_value: true, can_override: false }),
      row({ option_key: "is_fragile", default_value: true, can_override: true }),
    ]);

    expect(lockedOptionValues(resolved)).toEqual({ allow_inspection: true });
  });

  test("is empty when everything is overridable", () => {
    expect(lockedOptionValues(resolveOrderPreferences([]))).toEqual({});
  });
});
