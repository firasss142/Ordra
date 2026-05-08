import { describe, test, expect } from "vitest";
import { DEXPRESS_STATES, resolveDestination } from "./states";

describe("DEXPRESS_STATES", () => {
  test("contains the 128 destinations from the captured JSON", () => {
    expect(DEXPRESS_STATES).toHaveLength(128);
  });

  test("every entry has id, name, routeId", () => {
    for (const s of DEXPRESS_STATES) {
      expect(typeof s.id).toBe("number");
      expect(typeof s.name).toBe("string");
      expect(s.name.length).toBeGreaterThan(0);
      expect(typeof s.routeId).toBe("number");
    }
  });

  test("ids are unique", () => {
    const ids = new Set(DEXPRESS_STATES.map((s) => s.id));
    expect(ids.size).toBe(DEXPRESS_STATES.length);
  });
});

describe("resolveDestination", () => {
  test("returns to_state and route_id for Tripoli (62)", () => {
    expect(resolveDestination(62)).toEqual({ to_state: 62, route_id: 12 });
  });

  test("returns to_state and route_id for Benghazi (10)", () => {
    expect(resolveDestination(10)).toEqual({ to_state: 10, route_id: 15 });
  });

  test("returns to_state and route_id for Misrata (6)", () => {
    expect(resolveDestination(6)).toEqual({ to_state: 6, route_id: 1 });
  });

  test("throws on unknown state id", () => {
    expect(() => resolveDestination(99999)).toThrow(/Unknown Dexpress state_id/);
  });
});
