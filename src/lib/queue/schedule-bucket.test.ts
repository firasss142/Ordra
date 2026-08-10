import { describe, expect, it } from "vitest";
import {
  EN_COURS_BUCKETS,
  enCoursBucket,
  isEnCoursStatus,
  type ScheduleInput,
} from "./schedule-bucket";

const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const PAST = "2026-08-10T09:00:00.000Z";
const FUTURE = "2026-08-11T09:00:00.000Z";

function row(over: Partial<ScheduleInput> & { status: string }): ScheduleInput {
  return {
    callback_scheduled_at: null,
    scheduled_dispatch_at: null,
    scheduled_dispatch_auto: false,
    ...over,
  };
}

describe("enCoursBucket", () => {
  it("puts every attempt status in tentative", () => {
    for (const status of ["attempt_1", "attempt_2", "attempt_3"]) {
      expect(enCoursBucket(row({ status }), NOW)).toBe("tentative");
    }
  });

  // A bucket says what KIND of work an order needs. Urgency is the status
  // pill's job — it turns red and reads "en retard" the moment a scheduled time
  // passes — so every callback lands in one place and every dispatch in another,
  // whatever the clock says. Splitting them by time meant two places to look for
  // "my calls".
  it("puts every scheduled call in rappel, due or ahead or untimed", () => {
    for (const at of [PAST, FUTURE, null]) {
      expect(
        enCoursBucket(row({ status: "callback_scheduled", callback_scheduled_at: at }), NOW),
        String(at),
      ).toBe("rappel");
    }
  });

  it("puts every scheduled delivery in livraison, auto or manual", () => {
    for (const at of [PAST, FUTURE, null]) {
      for (const auto of [true, false]) {
        expect(
          enCoursBucket(
            row({
              status: "dispatch_scheduled",
              scheduled_dispatch_at: at,
              scheduled_dispatch_auto: auto,
            }),
            NOW,
          ),
          `${at} / auto=${auto}`,
        ).toBe("livraison");
      }
    }
  });

  it("returns null for statuses that are not in progress", () => {
    for (const status of ["pending", "assigned", "confirmed", "uploaded", "rejected"]) {
      expect(enCoursBucket(row({ status }), NOW)).toBeNull();
    }
  });

  it("is unmoved by an unparseable timestamp", () => {
    expect(
      enCoursBucket(row({ status: "callback_scheduled", callback_scheduled_at: "not-a-date" }), NOW),
    ).toBe("rappel");
  });
});

describe("the partition is total", () => {
  // This is the regression that let a future-scheduled order match no sub-tab at
  // all: the bucket resolver said "en cours" while every sub-filter predicate
  // said no. Any en-cours order must land in exactly one bucket, always.
  const everyShape: ScheduleInput[] = [
    row({ status: "attempt_1" }),
    row({ status: "attempt_2" }),
    row({ status: "attempt_3" }),
    row({ status: "callback_scheduled", callback_scheduled_at: PAST }),
    row({ status: "callback_scheduled", callback_scheduled_at: FUTURE }),
    row({ status: "callback_scheduled", callback_scheduled_at: null }),
    row({ status: "dispatch_scheduled", scheduled_dispatch_at: PAST }),
    row({ status: "dispatch_scheduled", scheduled_dispatch_at: FUTURE }),
    row({ status: "dispatch_scheduled", scheduled_dispatch_at: null }),
    row({ status: "dispatch_scheduled", scheduled_dispatch_at: FUTURE, scheduled_dispatch_auto: true }),
    row({ status: "dispatch_scheduled", scheduled_dispatch_at: PAST, scheduled_dispatch_auto: true }),
  ];

  it("assigns exactly one bucket to every in-progress order shape", () => {
    for (const o of everyShape) {
      const bucket = enCoursBucket(o, NOW);
      expect(bucket, `${o.status} / ${o.scheduled_dispatch_at ?? o.callback_scheduled_at}`).not.toBeNull();
      expect(EN_COURS_BUCKETS).toContain(bucket!);
    }
  });

  it("agrees with isEnCoursStatus — a status is en-cours iff it buckets", () => {
    for (const o of everyShape) {
      expect(isEnCoursStatus(o.status)).toBe(true);
      expect(enCoursBucket(o, NOW)).not.toBeNull();
    }
    for (const status of ["pending", "confirmed", "uploaded", "rejected", "delivered"]) {
      expect(isEnCoursStatus(status)).toBe(false);
      expect(enCoursBucket(row({ status }), NOW)).toBeNull();
    }
  });
});
