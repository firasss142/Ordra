import { describe, it, expect } from "vitest";
import { statusToneClass } from "./order-status-tone";

describe("statusToneClass", () => {
  it("maps delivered to the success tone", () => {
    expect(statusToneClass("delivered")).toContain("text-status-success");
  });

  it("maps in-flight carrier statuses to the action tone", () => {
    for (const s of ["uploaded", "scanned", "dispatched", "deposit", "in_transit"]) {
      expect(statusToneClass(s)).toContain("text-status-action");
    }
  });

  it("maps dead statuses to the critical tone", () => {
    for (const s of ["rejected", "cancelled", "deleted"]) {
      expect(statusToneClass(s)).toContain("text-status-critical");
    }
  });

  it("falls back to the neutral tone for everything else", () => {
    expect(statusToneClass("pending")).toContain("text-ink-secondary");
    expect(statusToneClass("confirmed")).toContain("text-ink-secondary");
  });
});
