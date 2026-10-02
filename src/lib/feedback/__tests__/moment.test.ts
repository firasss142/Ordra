import { describe, expect, test } from "vitest";
import { momentOf } from "../moment";

// Mirror of public.feedback_moment_of — the capture window shows the moment before saving,
// the RPC decides it. The two must agree on every status.
describe("momentOf", () => {
  test.each([
    ["pending", false, "call"],
    ["attempt_2", false, "call"],
    ["callback_scheduled", false, "call"],
    ["rejected", false, "call"],
    ["cancelled", false, "call"],
    ["confirmed", false, "transit"],
    ["dispatch_scheduled", false, "transit"],
    ["uploaded", true, "transit"],
    ["scanned", true, "transit"],
    ["at_carrier", true, "transit"],
    ["out_for_delivery", true, "transit"],
    ["delivery_delayed", true, "transit"],
    ["returning", true, "door"],
    ["to_be_returned", true, "door"],
    ["returned", true, "door"],
    ["received", true, "door"],
    ["cancelled", true, "door"],
    ["delivered", true, "after"],
  ] as const)("%s (shipped=%s) → %s", (status, shipped, want) => {
    expect(momentOf(status, shipped)).toBe(want);
  });

  test("no order at all is the confirmation call", () => {
    expect(momentOf(null, false)).toBe("call");
  });
});
