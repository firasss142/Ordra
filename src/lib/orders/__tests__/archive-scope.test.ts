import { describe, expect, it } from "vitest";
import {
  ARCHIVE_STATUSES,
  DEFAULT_ARCHIVE_AFTER_DAYS,
  resolveArchiveState,
  resolveArchiveStatuses,
} from "../archive-scope";
import { TERMINAL_STATUSES } from "@/types/order-status";

describe("ARCHIVE_STATUSES", () => {
  it("is exactly the terminal status set", () => {
    expect([...ARCHIVE_STATUSES].sort()).toEqual([...TERMINAL_STATUSES].sort());
  });

  // The archive page previously kept its own four-value list that omitted
  // `cancelled`, so cancelled orders counted toward the total but had no tile
  // and were dropped by the realtime filter. One exported constant prevents
  // that drift from happening again.
  it("includes cancelled", () => {
    expect(ARCHIVE_STATUSES).toContain("cancelled");
  });
});

describe("resolveArchiveStatuses", () => {
  it("returns every archive status when nothing is requested", () => {
    expect(resolveArchiveStatuses(null)).toEqual(ARCHIVE_STATUSES);
    expect(resolveArchiveStatuses(undefined)).toEqual(ARCHIVE_STATUSES);
    expect(resolveArchiveStatuses("")).toEqual(ARCHIVE_STATUSES);
  });

  it("narrows to the requested subset", () => {
    expect(resolveArchiveStatuses("delivered,returned")).toEqual(["delivered", "returned"]);
  });

  it("tolerates whitespace and duplicates", () => {
    expect(resolveArchiveStatuses(" delivered , returned , delivered ")).toEqual([
      "delivered",
      "returned",
    ]);
  });

  // A caller must never be able to pull non-terminal orders into the archive by
  // naming them in the status parameter.
  it("drops statuses that are not in the archive", () => {
    expect(resolveArchiveStatuses("delivered,pending,confirmed")).toEqual(["delivered"]);
  });

  it("falls back to the full archive when every requested status is invalid", () => {
    expect(resolveArchiveStatuses("pending")).toEqual(ARCHIVE_STATUSES);
    expect(resolveArchiveStatuses("nonsense,,")).toEqual(ARCHIVE_STATUSES);
  });
});

/**
 * Archiving is a visibility act, separate from finishing. An order is
 * `finished` the moment it reaches a terminal status (terminal_at), and
 * `archived` only once someone — or the auto rule — puts it away
 * (archived_at). The archive page reports on everything finished; the three
 * states split that set by where it currently lives.
 */
describe("resolveArchiveState", () => {
  it("defaults to every finished order", () => {
    expect(resolveArchiveState(null)).toBe("all");
    expect(resolveArchiveState(undefined)).toBe("all");
    expect(resolveArchiveState("")).toBe("all");
  });

  it("recognises the three states", () => {
    expect(resolveArchiveState("eligible")).toBe("eligible");
    expect(resolveArchiveState("archived")).toBe("archived");
    expect(resolveArchiveState("recent")).toBe("recent");
  });

  it("falls back to all for anything else, rather than showing nothing", () => {
    expect(resolveArchiveState("bogus")).toBe("all");
  });
});

describe("DEFAULT_ARCHIVE_AFTER_DAYS", () => {
  it("is one month", () => {
    expect(DEFAULT_ARCHIVE_AFTER_DAYS).toBe(30);
  });
});
