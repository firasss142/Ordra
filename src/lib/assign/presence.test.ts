import { describe, it, expect } from "vitest";
import { derivePresence } from "./presence";

const MIN = 60 * 1000;

describe("derivePresence", () => {
  const now = new Date("2026-04-24T12:00:00Z");

  it("returns 'offline' when last_seen_at is null", () => {
    expect(derivePresence(null, now)).toBe("offline");
  });

  it("returns 'online' when last_seen_at is within 5 minutes", () => {
    expect(derivePresence(new Date(now.getTime() - 0).toISOString(), now)).toBe("online");
    expect(derivePresence(new Date(now.getTime() - 4 * MIN).toISOString(), now)).toBe("online");
  });

  it("returns 'idle' between 5 and 30 minutes", () => {
    expect(derivePresence(new Date(now.getTime() - 5 * MIN).toISOString(), now)).toBe("idle");
    expect(derivePresence(new Date(now.getTime() - 29 * MIN).toISOString(), now)).toBe("idle");
  });

  it("returns 'offline' at 30 minutes and beyond", () => {
    expect(derivePresence(new Date(now.getTime() - 30 * MIN).toISOString(), now)).toBe("offline");
    expect(derivePresence(new Date(now.getTime() - 24 * 60 * MIN).toISOString(), now)).toBe("offline");
  });
});
