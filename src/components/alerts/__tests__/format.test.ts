import { describe, test, expect } from "vitest";
import { createTranslator } from "next-intl";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";
import { formatDuration, formatMeta, typeLabel } from "../format";
import type { Alert } from "@/lib/alerts/types";

// A real translator over the real catalogue — the strings under test are the
// ones that ship, so a missing or malformed key fails here rather than in prod.
const fr = createTranslator({ locale: "fr", messages: frMessages, namespace: "alerts" });
const ar = createTranslator({ locale: "ar", messages: arMessages, namespace: "alerts" });

const HOUR = 60;
const DAY = 24 * HOUR;

describe("formatDuration — precision that coarsens as the number grows", () => {
  test("keeps minutes while minutes are what you would say out loud", () => {
    expect(formatDuration(45, fr)).toBe("45 min");
  });

  test("gives hours and minutes inside the first day", () => {
    // The genuinely live end of the list — "en retard de 1 h 35 min" is a
    // reading someone acts on, and the minutes still matter there.
    expect(formatDuration(95, fr)).toBe("1 h 35 min");
    expect(formatDuration(3 * HOUR, fr)).toBe("3 h");
  });

  test("switches to days once hours stop being countable", () => {
    // This is the bug the redesign started from: the panel printed
    // "bloquée 1176 h" and "en retard de 744 h 5 min". Nobody reads that as
    // seven weeks, and the 5-minute precision on a 31-day-old alert is noise.
    expect(formatDuration(1176 * HOUR, fr)).toBe("49 j");
    expect(formatDuration(744 * HOUR + 5, fr)).toBe("31 j");
  });

  test("keeps a leftover hour while the day count is still small", () => {
    // Two days is close enough to act on that "2 j 6 h" is worth the extra word.
    expect(formatDuration(2 * DAY + 6 * HOUR, fr)).toBe("2 j 6 h");
    expect(formatDuration(2 * DAY, fr)).toBe("2 j");
  });

  test("drops to whole days past a week, where the hour is meaningless", () => {
    expect(formatDuration(9 * DAY + 6 * HOUR, fr)).toBe("9 j");
  });

  test("renders the same ladder in Arabic", () => {
    expect(formatDuration(45, ar)).toBe("45 د");
    expect(formatDuration(49 * DAY, ar)).toBe("49 ي");
  });
});

function alert(over: Partial<Alert>): Alert {
  return {
    id: "x",
    type: "dispatch_failure",
    severity: "high",
    entity_id: "o-1",
    entity_kind: "order",
    href: "/orders/o-1",
    primary: "Ans Sliman",
    secondary: null,
    age_minutes: 0,
    meta: null,
    created_at: "2026-05-01T00:00:00Z",
    market_id: "tn",
    ...over,
  };
}

describe("formatMeta — every time-based alert reads on one scale", () => {
  test("states a blocked dispatch in days, not in 1176 hours", () => {
    const meta = formatMeta(alert({ type: "dispatch_failure", age_minutes: 1176 * HOUR }), fr);
    expect(meta).toBe("bloquée 49 j");
  });

  test("states an overdue callback on that same scale", () => {
    const meta = formatMeta(alert({ type: "overdue_callback", age_minutes: 744 * HOUR + 5 }), fr);
    expect(meta).toBe("en retard de 31 j");
  });

  test("gives each new alert type its own reading", () => {
    expect(formatMeta(alert({ type: "pending_idle", age_minutes: 5 * HOUR }), fr)).toBe(
      "sans action depuis 5 h",
    );
    expect(formatMeta(alert({ type: "upload_stalled", age_minutes: 30 * HOUR }), fr)).toBe(
      "sans suivi depuis 1 j 6 h",
    );
    expect(
      formatMeta(alert({ type: "attempts_stalled", age_minutes: 26 * HOUR, meta: { attempts: 1 } }), fr),
    ).toBe("1 tentative en 1 j 2 h");
    expect(
      formatMeta(alert({ type: "dispatch_schedule_missed", age_minutes: 3 * HOUR }), fr),
    ).toBe("non déclenchée depuis 3 h");
  });

  test("says what changed on the two oversight alerts", () => {
    expect(formatMeta(alert({ type: "price_changed", age_minutes: 30 }), fr)).toBe(
      "prix modifié il y a 30 min",
    );
    expect(formatMeta(alert({ type: "order_reopened", age_minutes: 2 * HOUR }), fr)).toBe(
      "rouverte il y a 2 h",
    );
  });

  test("still reports a depleted product without a duration", () => {
    expect(formatMeta(alert({ type: "stock_depleted", entity_kind: "product" }), fr)).toBe("rupture");
  });
});

describe("typeLabel — the acknowledgement log outlives the rules", () => {
  test("names a live type from the catalogue", () => {
    expect(typeLabel("pending_idle", fr)).toBe("En attente sans action");
  });

  test("falls back to the raw type for a rule that has since been retired", () => {
    // `alert_acknowledgements` is a permanent log, so it still holds
    // `low_stock:…` rows written before that rule was dropped. Their message
    // key is gone, and next-intl renders a missing key as the key path — the
    // history panel would print "alerts.types.low_stock.label" at the user.
    expect(typeLabel("low_stock", fr)).toBe("low_stock");
    expect(typeLabel("agent_inactive", fr)).toBe("agent_inactive");
  });
});
