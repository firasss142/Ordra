import { describe, it, expect } from "vitest";
import { statusToneClass } from "./order-status-tone";

describe("statusToneClass", () => {
  it("maps delivered to the success tone", () => {
    expect(statusToneClass("delivered")).toContain("text-status-success");
  });

  it("maps in-flight carrier statuses to the action tone", () => {
    for (const s of ["uploaded", "scanned", "dispatched", "deposit", "in_transit", "confirmed"]) {
      expect(statusToneClass(s)).toContain("text-status-action");
    }
  });

  it("maps dead statuses to the critical tone", () => {
    for (const s of ["rejected", "cancelled", "deleted", "returned"]) {
      expect(statusToneClass(s)).toContain("text-status-critical");
    }
  });

  it("maps in-confirmation statuses to the warning tone", () => {
    for (const s of [
      "pending",
      "assigned",
      "attempt_1",
      "attempt_2",
      "attempt_3",
      "callback_scheduled",
      "unverified",
      "to_be_returned",
    ]) {
      expect(statusToneClass(s)).toContain("text-status-warning");
    }
  });

  it("falls back to the neutral tone for unknown statuses", () => {
    expect(statusToneClass("something_new")).toContain("text-ink-secondary");
  });
});
