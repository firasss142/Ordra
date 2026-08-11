import { describe, test, expect } from "vitest";
import { parseAlertKey, VALID_ALERT_TYPES } from "./alert-key";
import { ALERT_TYPES } from "@/lib/alerts/catalogue";

describe("parseAlertKey", () => {
  test("accepts every type the engine can actually emit", () => {
    // This list was maintained by hand and fell behind the engine: six new
    // rules shipped and none of their alerts could be acknowledged or snoozed,
    // because the key was rejected before it reached the table. Deriving it
    // from the catalogue makes that drift impossible.
    for (const type of ALERT_TYPES) {
      expect(parseAlertKey(`${type}:order-1`)).toEqual({ type, entityId: "order-1" });
    }
  });

  test("no longer accepts the retired types", () => {
    for (const type of ["low_stock", "agent_inactive", "return_bottleneck"]) {
      expect(parseAlertKey(`${type}:x`)).toBeNull();
      expect(VALID_ALERT_TYPES.has(type)).toBe(false);
    }
  });

  test("rejects a malformed key rather than guessing", () => {
    expect(parseAlertKey("pending_idle")).toBeNull();
    expect(parseAlertKey(":order-1")).toBeNull();
    expect(parseAlertKey("pending_idle:")).toBeNull();
    expect(parseAlertKey("not_a_type:order-1")).toBeNull();
  });

  test("keeps a UUID entity id intact, colons and all", () => {
    const id = "3f1c9e10-1f2b-4c3d-9a8b-7c6d5e4f3a2b";
    expect(parseAlertKey(`stock_depleted:${id}`)).toEqual({
      type: "stock_depleted",
      entityId: id,
    });
  });
});
