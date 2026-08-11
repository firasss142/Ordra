import { describe, test, expect } from "vitest";
import {
  ALERT_TYPES,
  familyOf,
  isExpired,
  severityFor,
  type AlertType,
} from "./catalogue";

const HOUR = 60;
const DAY = 24 * HOUR;

describe("severityFor — age is part of the severity, not just the type", () => {
  test("holds the base severity below the first rung", () => {
    // A dispatch blocked three hours is a real problem but not the loudest
    // thing on the board. The old fixed map made it critical on minute one,
    // which is why a quarter of the list was red and none of it meant anything.
    expect(severityFor("dispatch_failure", 3 * HOUR)).toBe("high");
  });

  test("escalates once the alert has been ignored long enough", () => {
    expect(severityFor("dispatch_failure", 8 * DAY)).toBe("critical");
  });

  test("takes the highest rung reached, not the first one matched", () => {
    // unassigned_overflow climbs twice: high at 8h, critical at 24h. At 30h
    // both rungs match and the answer has to be the later one.
    expect(severityFor("unassigned_overflow", 3 * HOUR)).toBe("medium");
    expect(severityFor("unassigned_overflow", 9 * HOUR)).toBe("high");
    expect(severityFor("unassigned_overflow", 30 * HOUR)).toBe("critical");
  });

  test("leaves ageless and event alerts at their base forever", () => {
    // stock_depleted is re-derived on every poll, so its age is always zero and
    // an escalation ladder would never fire. A price edit does not become more
    // suspicious for being a day older either.
    expect(severityFor("stock_depleted", 0)).toBe("high");
    expect(severityFor("stock_depleted", 90 * DAY)).toBe("high");
    expect(severityFor("price_changed", 6 * DAY)).toBe("medium");
    expect(severityFor("order_reopened", 6 * DAY)).toBe("low");
  });

  test("treats a missed automatic dispatch as urgent almost immediately", () => {
    // Nothing else in the system notices the cron did not fire, so this is the
    // one new rule that outranks the others on arrival.
    expect(severityFor("dispatch_schedule_missed", 30)).toBe("high");
    expect(severityFor("dispatch_schedule_missed", 3 * HOUR)).toBe("critical");
  });
});

describe("isExpired — the live list only holds what is still worth doing", () => {
  test("keeps an alert inside its window", () => {
    expect(isExpired("dispatch_failure", 29 * DAY)).toBe(false);
  });

  test("drops the 49-day dispatch blocks that made the panel a graveyard", () => {
    // The screenshot that triggered this redesign: `bloquée 1176 h`.
    expect(isExpired("dispatch_failure", 49 * DAY)).toBe(true);
  });

  test("drops a callback that went 31 days unanswered", () => {
    expect(isExpired("overdue_callback", 31 * DAY)).toBe(true);
  });

  test("never expires a condition that is still true right now", () => {
    // An out-of-stock product is not stale information — it is the current
    // state of the warehouse, and hiding it would be a lie.
    expect(isExpired("stock_depleted", 365 * DAY)).toBe(false);
  });
});

describe("familyOf — what a rule is actually complaining about", () => {
  test("groups every rule that means 'this order is not moving'", () => {
    // These are the ones that can catch the same order twice: a 30-hour-old
    // assigned order with no calls is both idle and under-attempted. Showing
    // it on two rows is the noise the redesign exists to remove.
    const progress: AlertType[] = [
      "dispatch_failure",
      "carrier_webhook_stale",
      "overdue_callback",
      "unassigned_overflow",
      "pending_idle",
      "attempts_stalled",
      "dispatch_schedule_missed",
      "upload_stalled",
    ];
    for (const type of progress) expect(familyOf(type)).toBe("progress");
  });

  test("keeps the audit events in their own family", () => {
    // A price edit on an order that also happens to be stalled is a separate
    // fact about a separate actor. Collapsing it into the stall would silently
    // drop the only record anyone would review.
    expect(familyOf("price_changed")).toBe("oversight");
    expect(familyOf("order_reopened")).toBe("oversight");
  });

  test("keeps stock apart, since it is about a product and not an order", () => {
    expect(familyOf("stock_depleted")).toBe("stock");
  });
});

describe("the catalogue itself", () => {
  test("no longer carries the three types the operator retired", () => {
    const retired = ["agent_inactive", "low_stock", "return_bottleneck"];
    for (const type of retired) {
      expect(ALERT_TYPES).not.toContain(type as AlertType);
    }
  });

  test("carries every new condition the operator asked for", () => {
    const added: AlertType[] = [
      "attempts_stalled",
      "pending_idle",
      "dispatch_schedule_missed",
      "upload_stalled",
      "price_changed",
      "order_reopened",
    ];
    for (const type of added) expect(ALERT_TYPES).toContain(type);
  });

  test("every type resolves to a real severity and a defined expiry", () => {
    // Guards the map against a type being added to the union and forgotten
    // here — the failure mode would be a silent `undefined` severity that
    // sorts to the bottom of the panel and is never seen.
    for (const type of ALERT_TYPES) {
      expect(["critical", "high", "medium", "low"]).toContain(severityFor(type, 0));
      expect(typeof isExpired(type, 0)).toBe("boolean");
    }
  });
});
