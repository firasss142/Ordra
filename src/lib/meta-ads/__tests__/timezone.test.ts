import { describe, test, expect } from "vitest";
import { checkTimezone, expectedTimezone, offsetMinutes } from "../timezone";

/**
 * A fixed instant, so these assertions mean the same thing in every CI region.
 * Mid-August: Tunis and Tripoli are both on their year-round offsets (+1 and
 * +2 respectively — neither observes DST), while Los Angeles is on PDT.
 */
const AT = new Date("2026-08-15T12:00:00Z");

describe("offsetMinutes", () => {
  test("reads the zone's real offset at an instant", () => {
    expect(offsetMinutes("UTC", AT)).toBe(0);
    expect(offsetMinutes("Africa/Tunis", AT)).toBe(60);
    expect(offsetMinutes("Africa/Tripoli", AT)).toBe(120);
  });

  test("returns null for a zone the platform does not know", () => {
    expect(offsetMinutes("Mars/Olympus_Mons", AT)).toBeNull();
  });
});

describe("expectedTimezone", () => {
  test("maps market codes case-insensitively", () => {
    expect(expectedTimezone("LY")).toBe("Africa/Tripoli");
    expect(expectedTimezone("tn")).toBe("Africa/Tunis");
  });

  test("returns null for a market it has no rule for", () => {
    expect(expectedTimezone("XX")).toBeNull();
  });
});

describe("checkTimezone", () => {
  test("passes when the account cuts its day where the market does", () => {
    const r = checkTimezone("Africa/Tripoli", "LY", AT);
    expect(r.status).toBe("ok");
    expect(r.offsetHours).toBe(0);
  });

  test("flags the Tunis-account-on-a-Libya-market case", () => {
    // One hour apart. Small, but it silently moves every order created between
    // 23:00 and 00:00 Tripoli time into the wrong day's cost bucket.
    const r = checkTimezone("Africa/Tunis", "LY", AT);
    expect(r.status).toBe("mismatch");
    expect(r.offsetHours).toBe(-1);
  });

  test("flags the default-US-account case loudly", () => {
    const r = checkTimezone("America/Los_Angeles", "LY", AT);
    expect(r.status).toBe("mismatch");
    expect(r.offsetHours).toBe(-9);
  });

  test("passes an equivalent zone under a different name", () => {
    // Johannesburg is UTC+2 with no DST, same wall clock as Tripoli, different
    // label. Comparing names would raise a false alarm here, which is how
    // operators learn to ignore the warning.
    //
    // Africa/Cairo was the obvious pick and is the wrong one: Egypt brought DST
    // back in 2023, so Cairo is +3 in August and genuinely does cut the day
    // elsewhere. Offsets are read from the platform's tz database for exactly
    // this reason — a hand-written table would still say +2.
    const r = checkTimezone("Africa/Johannesburg", "LY", AT);
    expect(r.status).toBe("ok");
    expect(r.offsetHours).toBe(0);
  });

  test("says unknown rather than ok when it cannot tell", () => {
    expect(checkTimezone(null, "LY", AT).status).toBe("unknown");
    expect(checkTimezone("Africa/Tripoli", "XX", AT).status).toBe("unknown");
    expect(checkTimezone("Mars/Olympus_Mons", "LY", AT).status).toBe("unknown");
  });
});
