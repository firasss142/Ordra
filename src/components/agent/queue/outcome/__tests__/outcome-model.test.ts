import { describe, expect, it } from "vitest";
import {
  agentNotes,
  ageParts,
  callbackSlots,
  deliveryDelay,
  groupIcon,
  slaChip,
  twinOf,
  type AgentNotesInput,
} from "../outcome-model";

const at = (s: string) => new Date(s);

describe("callbackSlots — plan decision 5: +2 h · Ce soir 19:00 · Demain 11:00 / 14:00 / 18:00", () => {
  it("offers the five quick picks in the afternoon", () => {
    const now = new Date(2026, 9, 5, 15, 12);
    const s = callbackSlots(now);
    expect(s.map((x) => x.key)).toEqual(["in2h", "tonight", "tom11", "tom14", "tom18"]);
    expect(s[0].at.getTime()).toBe(now.getTime() + 2 * 3_600_000);
    expect([s[1].at.getDate(), s[1].at.getHours(), s[1].at.getMinutes()]).toEqual([5, 19, 0]);
    expect([s[2].at.getDate(), s[2].at.getHours()]).toEqual([6, 11]);
    expect([s[4].at.getDate(), s[4].at.getHours()]).toEqual([6, 18]);
  });

  it("drops « Ce soir » once 19:00 has passed — a pick in the past would be refused", () => {
    const s = callbackSlots(new Date(2026, 9, 5, 19, 30));
    expect(s.map((x) => x.key)).toEqual(["in2h", "tom11", "tom14", "tom18"]);
  });
});

describe("ageParts — the prototype's ageLong", () => {
  it("reads minutes, hours with padded minutes, days with hours", () => {
    expect(ageParts(42)).toEqual({ kind: "min", n: 42 });
    expect(ageParts(125)).toEqual({ kind: "hours", h: 2, m: "05" });
    expect(ageParts(1440 * 2)).toEqual({ kind: "days", d: 2 });
    expect(ageParts(1440 * 2 + 180)).toEqual({ kind: "daysHours", d: 2, h: 3 });
  });
});

describe("slaChip — plan decision 8", () => {
  const base = { createdAt: "2026-10-05T08:00:00Z", slaMinutes: 120, callbackAt: null };

  it("runs on a calling order, grey within the delay", () => {
    expect(slaChip({ ...base, status: "pending", confirmedAt: null, now: at("2026-10-05T09:00:00Z") })).toEqual({ cls: "run", icon: "clock", minutes: 60, tip: null });
  });

  it("turns amber past the delay, red past a day", () => {
    expect(slaChip({ ...base, status: "attempt_1", confirmedAt: null, now: at("2026-10-05T11:00:00Z") })?.cls).toBe("");
    expect(slaChip({ ...base, status: "attempt_1", confirmedAt: null, now: at("2026-10-06T09:00:00Z") })?.cls).toBe("vlate");
  });

  it("freezes once confirmed: green only when it was in time", () => {
    expect(slaChip({ ...base, status: "confirmed", confirmedAt: "2026-10-05T09:30:00Z", now: at("2026-10-05T15:00:00Z") })).toEqual({ cls: "ok", icon: "check", minutes: 90, tip: "ok" });
    expect(slaChip({ ...base, status: "dispatch_scheduled", confirmedAt: "2026-10-05T11:00:00Z", now: at("2026-10-05T15:00:00Z") })).toEqual({ cls: "run", icon: "check", minutes: 180, tip: "late" });
  });

  it("says nothing on a closed order, or before the market's delay is known", () => {
    expect(slaChip({ ...base, status: "uploaded", confirmedAt: null, now: at("2026-10-05T15:00:00Z") })).toBeNull();
    expect(slaChip({ ...base, slaMinutes: null, status: "pending", confirmedAt: null, now: at("2026-10-05T09:00:00Z") })).toBeNull();
  });
});

describe("agentNotes — the lines above the endings", () => {
  const base: AgentNotesInput = {
    status: "attempt_1",
    attempts: 1,
    maxAttempts: 3,
    outOfStock: false,
    twin: null,
    cityMissing: false,
    editBlocked: false,
    callbackAt: null,
    dispatchAt: null,
    now: at("2026-10-05T12:00:00Z"),
  };

  it("is empty when all is well", () => {
    expect(agentNotes(base)).toEqual([]);
  });

  it("puts the blockers in the prototype's order", () => {
    const twin = { id: "o-2", ref: "39508", createdAt: "2026-10-05T09:00:00Z", shipped: false };
    const kinds = agentNotes({ ...base, outOfStock: true, twin, attempts: 3, cityMissing: true }).map((n) => [n.kind, n.hue]);
    expect(kinds).toEqual([["outOfStock", "red"], ["dup", "blue"], ["maxAttempts", "amber"], ["noCity", "amber"]]);
  });

  it("paints a duplicate red when its twin is already with the carrier", () => {
    const twin = { id: "o-2", ref: "39508", createdAt: "2026-10-05T09:00:00Z", shipped: true };
    expect(agentNotes({ ...base, twin })[0]).toMatchObject({ kind: "dup", hue: "red" });
  });

  it("says a due callback in red, a future one in violet", () => {
    expect(agentNotes({ ...base, status: "callback_scheduled", callbackAt: "2026-10-05T11:00:00Z" })[0]).toMatchObject({ kind: "callbackLate", hue: "red" });
    expect(agentNotes({ ...base, status: "callback_scheduled", callbackAt: "2026-10-05T18:00:00Z" })[0]).toMatchObject({ kind: "callback", hue: "violet" });
  });

  it("keeps the calling notes off a confirmed order, but not the missing city", () => {
    const twin = { id: "o-2", ref: "39508", createdAt: "2026-10-05T09:00:00Z", shipped: false };
    expect(agentNotes({ ...base, status: "confirmed", twin, attempts: 3, cityMissing: true, outOfStock: true }).map((n) => n.kind)).toEqual(["noCity"]);
  });

  it("names the scheduled dispatch, and the lock on a closed order", () => {
    expect(agentNotes({ ...base, status: "dispatch_scheduled", dispatchAt: "2026-10-06T10:00:00Z" }).map((n) => n.kind)).toEqual(["dispatch"]);
    expect(agentNotes({ ...base, status: "uploaded", editBlocked: true }).map((n) => n.kind)).toEqual(["locked"]);
  });
});

describe("twinOf", () => {
  it("picks the first sibling that still exists", () => {
    expect(
      twinOf({
        is_potential_duplicate: true,
        has_uploaded_sibling: false,
        duplicate_siblings: [
          { id: "a", external_id: "1", status: "deleted", created_at: "x", already_shipped: false },
          { id: "b", external_id: "2", status: "pending", created_at: "y", already_shipped: false },
        ],
      }),
    ).toEqual({ id: "b", ref: "2", createdAt: "y", shipped: false });
  });

  it("is null for an order with no duplicate", () => {
    expect(twinOf({ is_potential_duplicate: false, duplicate_siblings: [] })).toBeNull();
    expect(twinOf(null)).toBeNull();
  });
});

describe("deliveryDelay + groupIcon", () => {
  it("speaks in days from a day on, hours below", () => {
    expect(deliveryDelay(50)).toEqual({ unit: "days", n: 2 });
    expect(deliveryDelay(9)).toEqual({ unit: "hours", n: 9 });
    expect(deliveryDelay(null)).toBeNull();
  });

  it("gives each rejection group its prototype glyph, « Autre » a question mark", () => {
    expect(groupIcon("refus_client")).toBe("thumbdown");
    expect(groupIcon("injoignable")).toBe("phoneoff");
    expect(groupIcon("livraison_impossible")).toBe("pinoff");
    expect(groupIcon("commande_invalide")).toBe("xcircle");
    expect(groupIcon("autre")).toBe("help");
    expect(groupIcon("sans_suite")).toBe("xcircle");
  });
});
