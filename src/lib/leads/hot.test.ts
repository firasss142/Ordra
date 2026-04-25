import { describe, it, expect } from "vitest";
import { isHotLead } from "./hot";

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

describe("isHotLead", () => {
  it("returns true for qualified lead updated 10h ago", () => {
    expect(isHotLead({ status: "qualified", updated_at: hoursAgo(10) })).toBe(true);
  });

  it("returns true for callback_scheduled lead updated 30h ago", () => {
    expect(isHotLead({ status: "callback_scheduled", updated_at: hoursAgo(30) })).toBe(true);
  });

  it("returns false for qualified lead updated 72h ago", () => {
    expect(isHotLead({ status: "qualified", updated_at: hoursAgo(72) })).toBe(false);
  });

  it("returns false for new lead updated 1h ago", () => {
    expect(isHotLead({ status: "new", updated_at: hoursAgo(1) })).toBe(false);
  });

  it("returns false for attempt_1 lead updated 5h ago", () => {
    expect(isHotLead({ status: "attempt_1", updated_at: hoursAgo(5) })).toBe(false);
  });

  it("returns false for won lead updated 1h ago", () => {
    expect(isHotLead({ status: "won", updated_at: hoursAgo(1) })).toBe(false);
  });

  it("returns false at exactly 48h boundary (strict)", () => {
    // Exactly 48h ago should NOT be hot
    const exactly48h = new Date(Date.now() - 48 * 60 * 60 * 1000 - 1).toISOString();
    expect(isHotLead({ status: "qualified", updated_at: exactly48h })).toBe(false);
  });

  it("returns true just under 48h ago", () => {
    const justUnder = new Date(Date.now() - 47 * 60 * 60 * 1000).toISOString();
    expect(isHotLead({ status: "callback_scheduled", updated_at: justUnder })).toBe(true);
  });
});
