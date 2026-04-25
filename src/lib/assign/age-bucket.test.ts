import { describe, it, expect } from "vitest";
import { getAgeBucket, getBucketAccent, type AgeBucket } from "./age-bucket";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe("getAgeBucket", () => {
  const now = new Date("2026-04-24T12:00:00Z");

  it("returns 'fresh' for orders under 30 minutes old", () => {
    expect(getAgeBucket(new Date(now.getTime() - 0).toISOString(), now)).toBe("fresh");
    expect(getAgeBucket(new Date(now.getTime() - 29 * MIN).toISOString(), now)).toBe("fresh");
  });

  it("returns 'warning' between 30 minutes and 2 hours", () => {
    expect(getAgeBucket(new Date(now.getTime() - 30 * MIN).toISOString(), now)).toBe("warning");
    expect(getAgeBucket(new Date(now.getTime() - (2 * HOUR - 1)).toISOString(), now)).toBe("warning");
  });

  it("returns 'urgent' between 2 and 4 hours", () => {
    expect(getAgeBucket(new Date(now.getTime() - 2 * HOUR).toISOString(), now)).toBe("urgent");
    expect(getAgeBucket(new Date(now.getTime() - (4 * HOUR - 1)).toISOString(), now)).toBe("urgent");
  });

  it("returns 'critical' at 4 hours and beyond", () => {
    expect(getAgeBucket(new Date(now.getTime() - 4 * HOUR).toISOString(), now)).toBe("critical");
    expect(getAgeBucket(new Date(now.getTime() - 48 * HOUR).toISOString(), now)).toBe("critical");
  });

  it("treats future timestamps as fresh (clock skew safeguard)", () => {
    expect(getAgeBucket(new Date(now.getTime() + 5 * MIN).toISOString(), now)).toBe("fresh");
  });
});

describe("getBucketAccent", () => {
  it("maps each bucket to its functional accent token", () => {
    const pairs: Array<[AgeBucket, string]> = [
      ["fresh", "neutral"],
      ["warning", "action"],
      ["urgent", "warning"],
      ["critical", "critical"],
    ];
    for (const [bucket, accent] of pairs) {
      expect(getBucketAccent(bucket)).toBe(accent);
    }
  });
});
