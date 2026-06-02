import { describe, test, expect } from "vitest";
import {
  DARB_STATUSES,
  normalizeDarbStatus,
  type DarbSlug,
} from "./darb-assabil-statuses";

describe("DARB_STATUSES taxonomy", () => {
  test("covers the 11 documented Darb Assabil statuses", () => {
    const slugs = DARB_STATUSES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(11);
    for (const expected of [
      "pending",
      "booked",
      "processing",
      "on-branch",
      "released",
      "resent",
      "delayed",
      "returning",
      "completed",
      "returned",
      "cancelled",
    ] as DarbSlug[]) {
      expect(slugs).toContain(expected);
    }
  });

  test("every entry carries a bilingual label", () => {
    for (const entry of DARB_STATUSES) {
      expect(entry.labelEn.length).toBeGreaterThan(0);
      expect(entry.labelAr.length).toBeGreaterThan(0);
    }
  });
});

describe("normalizeDarbStatus", () => {
  test("returns the slug verbatim for a known status", () => {
    expect(normalizeDarbStatus("completed")).toBe("completed");
    expect(normalizeDarbStatus("on-branch")).toBe("on-branch");
  });

  test("is case-insensitive and trims surrounding whitespace", () => {
    expect(normalizeDarbStatus("  Completed ")).toBe("completed");
    expect(normalizeDarbStatus("ON-BRANCH")).toBe("on-branch");
  });

  test("returns null for an unknown status (graceful degradation)", () => {
    expect(normalizeDarbStatus("teleported")).toBeNull();
    expect(normalizeDarbStatus("")).toBeNull();
    expect(normalizeDarbStatus(null)).toBeNull();
    expect(normalizeDarbStatus(undefined)).toBeNull();
  });
});
