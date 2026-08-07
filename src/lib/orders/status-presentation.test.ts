import { describe, it, expect } from "vitest";
import { STATUS_LABELS } from "@/lib/status-labels";
import {
  presentStatus,
  CONFIRMATION_STATUSES,
  FULFILLMENT_STATUSES,
  OPEN_GLYPHS,
  FULFILLMENT_HUES,
} from "./status-presentation";

describe("status presentation — coverage", () => {
  it("maps every status the app can label, with nothing falling through", () => {
    // Both call sites used `STATUS_TONE[status] ?? "neutral"`, so a status
    // nobody had thought about rendered as a grey pill rather than failing
    // loudly. Coverage is asserted here instead.
    for (const status of Object.keys(STATUS_LABELS)) {
      const p = presentStatus(status);
      expect(p, `no presentation for "${status}"`).toBeDefined();
      expect(p.glyph, `no glyph for "${status}"`).toBeTruthy();
    }
  });

  it("still renders something for a status the backend invents later", () => {
    const p = presentStatus("teleported_to_mars");
    expect(p.glyph).toBeTruthy();
    expect(p.weight).toBe("quiet");
  });
});

describe("status presentation — shape says open, hue says phase", () => {
  it("gives every status still awaiting a call a round glyph", () => {
    for (const status of CONFIRMATION_STATUSES) {
      expect(OPEN_GLYPHS.has(presentStatus(status).glyph), status).toBe(true);
    }
  });

  it("gives every handed-off status an angular glyph", () => {
    for (const status of FULFILLMENT_STATUSES) {
      expect(OPEN_GLYPHS.has(presentStatus(status).glyph), status).toBe(false);
    }
  });

  it("never paints a confirmation-phase status in a fulfillment hue", () => {
    // Phase is carried by hue, so the two ramps must not overlap: nothing
    // before the carrier upload is allowed to be teal or green.
    for (const status of [...CONFIRMATION_STATUSES, "confirmed", "dispatch_scheduled", "rejected"]) {
      expect(FULFILLMENT_HUES.has(presentStatus(status).hue), status).toBe(false);
    }
  });

  it("separates confirmed from uploaded, which were the same blue", () => {
    // Phase 1 done, still the agent's problem — vs gone to the carrier. The
    // two-phase model is the spine of this system and the row rendered both
    // identically, so they must differ in hue AND shape.
    const confirmed = presentStatus("confirmed");
    const uploaded = presentStatus("uploaded");
    expect(confirmed.hue).not.toBe(uploaded.hue);
    expect(confirmed.glyph).not.toBe(uploaded.glyph);
    expect(FULFILLMENT_HUES.has(confirmed.hue)).toBe(false);
    expect(FULFILLMENT_HUES.has(uploaded.hue)).toBe(true);
  });
});

describe("status presentation — intensity, not just hue", () => {
  it("quiets the states that need nobody", () => {
    // 35% of the list is uploaded and 28% rejected. Both are settled; both
    // were shouting. Red at that density stops being a signal.
    for (const status of ["uploaded", "rejected", "delivered", "cancelled", "deleted"]) {
      expect(presentStatus(status).weight, status).toBe("quiet");
    }
  });

  it("keeps the states that need a human at least medium", () => {
    for (const status of ["pending", "attempt_1", "attempt_2", "callback_scheduled"]) {
      expect(presentStatus(status).weight, status).toBe("medium");
    }
  });

  it("goes loud only when attempts have run out", () => {
    expect(presentStatus("attempt_3", { attemptsCount: 3, maxAttempts: 8 }).weight).toBe("medium");
    expect(presentStatus("attempt_3", { attemptsCount: 8, maxAttempts: 8 }).weight).toBe("loud");
    expect(presentStatus("attempt_3", { attemptsCount: 9, maxAttempts: 8 }).weight).toBe("loud");
  });

  it("does not shout at a settled order however old", () => {
    expect(presentStatus("uploaded", { attemptsCount: 9, maxAttempts: 8 }).weight).toBe("quiet");
  });
});

describe("status presentation — the attempt counter tells the truth", () => {
  it("counts against the market's real ceiling, not the status enum's", () => {
    // Libya's max_call_attempts is 8 while the status enum stops at attempt_3.
    // "3/3" would tell an agent they are out of attempts with five left.
    expect(presentStatus("attempt_3", { attemptsCount: 3, maxAttempts: 8 }).counter).toBe("3/8");
  });

  it("shows the bare count when the ceiling has not loaded", () => {
    expect(presentStatus("attempt_2", { attemptsCount: 2 }).counter).toBe("2");
  });

  it("trusts attempts_count over the status label past three", () => {
    // status caps at attempt_3 while attempts_count keeps climbing, so an
    // order called seven times used to read "Tentative 3".
    expect(presentStatus("attempt_3", { attemptsCount: 7, maxAttempts: 8 }).counter).toBe("7/8");
  });

  it("has no counter on statuses that are not attempts", () => {
    expect(presentStatus("uploaded", { attemptsCount: 3, maxAttempts: 8 }).counter).toBeNull();
    expect(presentStatus("pending", { attemptsCount: 0, maxAttempts: 8 }).counter).toBeNull();
  });
});

describe("presentStatus — a zero attempt count on an attempt status", () => {
  // Every attempt_* order in the database carries attempts_count = 0, so the
  // pill rendered "Tentative 0/9". An order cannot be in attempt_2 having made
  // zero calls: the zero is a data artifact, and the status is then the best
  // available truth. The cap-not-a-count rule is unaffected — a real count
  // above the enum's ceiling still wins.
  it("falls back to the status digit rather than showing 0", () => {
    expect(presentStatus("attempt_2", { attemptsCount: 0, maxAttempts: 9 }).counter).toBe("2/9");
  });

  it("still prefers a real count over the status digit", () => {
    expect(presentStatus("attempt_3", { attemptsCount: 7, maxAttempts: 9 }).counter).toBe("7/9");
  });

  it("does not go loud off a fabricated count", () => {
    expect(presentStatus("attempt_3", { attemptsCount: 0, maxAttempts: 9 }).weight).toBe("medium");
  });
});
