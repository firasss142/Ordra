import { describe, it, expect } from "vitest";
import { isServiceWindowOpen, windowClosesAt, SERVICE_WINDOW_MS } from "../window";

/**
 * Meta's rule, not ours: free-form text is allowed only within 24 h of the
 * customer's last inbound message. Outside it, only templates.
 */
describe("service window", () => {
  const now = new Date("2026-09-25T12:00:00Z");

  it("is closed when the customer never wrote", () => {
    expect(isServiceWindowOpen(null, now)).toBe(false);
    expect(windowClosesAt(null)).toBeNull();
  });

  it("is open for 24 h after the last inbound", () => {
    expect(isServiceWindowOpen("2026-09-24T12:00:01Z", now)).toBe(true);
    expect(isServiceWindowOpen("2026-09-24T12:00:00Z", now)).toBe(false);
    expect(isServiceWindowOpen("2026-09-24T11:59:59Z", now)).toBe(false);
  });

  it("says when it closes", () => {
    expect(windowClosesAt("2026-09-24T12:00:00Z")?.toISOString()).toBe("2026-09-25T12:00:00.000Z");
    expect(SERVICE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});
