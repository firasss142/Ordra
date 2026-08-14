import { describe, expect, it } from "vitest";
import { resolveSlaChip } from "../sla";

const CREATED = "2026-08-14T09:00:00.000Z";
const now = (iso: string) => new Date(iso);

describe("resolveSlaChip — when there is nothing to say", () => {
  it("stays out until the market's target has loaded", () => {
    expect(
      resolveSlaChip({
        createdAt: CREATED,
        confirmedAt: null,
        status: "pending",
        slaMinutes: null,
        now: now("2026-08-14T10:00:00.000Z"),
      }),
    ).toBeNull();
  });

  it("disappears once the order is with the carrier — there is nothing left to be late for", () => {
    for (const status of ["uploaded", "scanned", "dispatched", "delivered", "returned"]) {
      expect(
        resolveSlaChip({
          createdAt: CREATED,
          confirmedAt: "2026-08-14T09:30:00.000Z",
          status,
          slaMinutes: 120,
          now: now("2026-08-14T14:00:00.000Z"),
        }),
      ).toBeNull();
    }
  });

  it("disappears on a terminal outcome, including a rejection", () => {
    for (const status of ["rejected", "cancelled", "deleted"]) {
      expect(
        resolveSlaChip({
          createdAt: CREATED,
          confirmedAt: null,
          status,
          slaMinutes: 120,
          now: now("2026-08-14T14:00:00.000Z"),
        }),
      ).toBeNull();
    }
  });
});

describe("resolveSlaChip — while the clock is still running", () => {
  it("counts up from intake and stays neutral inside the target", () => {
    expect(
      resolveSlaChip({
        createdAt: CREATED,
        confirmedAt: null,
        status: "pending",
        slaMinutes: 120,
        now: now("2026-08-14T10:13:00.000Z"),
      }),
    ).toEqual({ minutes: 73, targetMinutes: 120, state: "running" });
  });

  it("turns to a breach the moment the target is passed", () => {
    expect(
      resolveSlaChip({
        createdAt: CREATED,
        confirmedAt: null,
        status: "attempt_2",
        slaMinutes: 120,
        now: now("2026-08-14T11:01:00.000Z"),
      }),
    ).toEqual({ minutes: 121, targetMinutes: 120, state: "breached" });
  });

  it("is still running at exactly the target, not yet late", () => {
    const chip = resolveSlaChip({
      createdAt: CREATED,
      confirmedAt: null,
      status: "callback_scheduled",
      slaMinutes: 120,
      now: now("2026-08-14T11:00:00.000Z"),
    });

    expect(chip?.state).toBe("running");
  });

  it("never reads negative if a clock skew puts intake in the future", () => {
    const chip = resolveSlaChip({
      createdAt: "2026-08-14T10:00:00.000Z",
      confirmedAt: null,
      status: "pending",
      slaMinutes: 120,
      now: now("2026-08-14T09:00:00.000Z"),
    });

    expect(chip?.minutes).toBe(0);
  });
});

describe("resolveSlaChip — once the call has landed", () => {
  it("freezes at the time it actually took, not at the time since", () => {
    expect(
      resolveSlaChip({
        createdAt: CREATED,
        confirmedAt: "2026-08-14T10:47:00.000Z",
        status: "confirmed",
        slaMinutes: 120,
        now: now("2026-08-14T18:00:00.000Z"),
      }),
    ).toEqual({ minutes: 107, targetMinutes: 120, state: "met" });
  });

  it("records a miss as a miss, even after the fact", () => {
    const chip = resolveSlaChip({
      createdAt: CREATED,
      confirmedAt: "2026-08-14T14:00:00.000Z",
      status: "dispatch_scheduled",
      slaMinutes: 120,
      now: now("2026-08-14T18:00:00.000Z"),
    });

    expect(chip).toEqual({ minutes: 300, targetMinutes: 120, state: "breached" });
  });

  it("keeps counting when the order reached confirmed with no recorded confirmation", () => {
    // Older rows predate the history entry; a running clock is a safer reading
    // than a frozen "met" nobody can substantiate.
    const chip = resolveSlaChip({
      createdAt: CREATED,
      confirmedAt: null,
      status: "confirmed",
      slaMinutes: 120,
      now: now("2026-08-14T10:00:00.000Z"),
    });

    expect(chip).toEqual({ minutes: 60, targetMinutes: 120, state: "running" });
  });
});
