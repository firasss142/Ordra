import { describe, expect, it } from "vitest";
import { dueDateFor, parseAmount, payOutcome, poTotal, settleDecision, settleMath } from "./settle";

describe("parseAmount — what an office types", () => {
  it("reads spaces, a decimal comma and nothing", () => {
    expect(parseAmount("1 050,5")).toBe(1050.5);
    expect(parseAmount(" 48 ")).toBe(48);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("settleMath — the reconciliation the drawer draws", () => {
  const lines = [
    { received: 180, damaged: 6, price: 41 },
    { received: 20, damaged: 0, price: 10 },
  ];

  it("totals received-in-good-state × price, fees excluded", () => {
    const m = settleMath(lines, 0, "value", 7580);
    expect(m.lineTotals).toEqual([7380, 200]);
    expect(m.goods).toBe(7580);
    expect(m.gap).toBe(0);
  });

  it("explains a gap that is exactly the damaged units at their price", () => {
    const m = settleMath(lines, 0, "value", 7826);
    expect(m.gap).toBe(246);
    expect(m.damagedUnits).toBe(6);
    expect(m.damagedValue).toBe(246);
    expect(m.explained).toBe(true);
  });

  it("does not explain any other gap", () => {
    expect(settleMath(lines, 0, "value", 7600).explained).toBe(false);
  });

  it("has no gap without an invoice", () => {
    expect(settleMath(lines, 0, "value", null).gap).toBeNull();
  });

  it("spreads the fees like the base does (by value, or by unit)", () => {
    expect(settleMath(lines, 200, "units", null).landed).toEqual([42, 11]);
    const byValue = settleMath(lines, 758, "value", null).landed;
    expect(byValue).toEqual([45.1, 11]);
  });

  it("leaves the landed cost unknown on a line without a price", () => {
    expect(settleMath([{ received: 5, damaged: 0, price: null }], 10, "units", null).landed).toEqual([null]);
  });
});

describe("settleDecision — what goes to settle_reception", () => {
  const explained = settleMath([{ received: 180, damaged: 6, price: 41 }], 0, "value", 7626);

  it("claims the gap by default, so only the goods are owed", () => {
    expect(settleDecision(explained, "claim", "", "6 abîmés")).toEqual({ ok: true, invoiceTotal: 7626, claimAmount: 246, reason: "6 abîmés", owed: 7380 });
  });

  it("pays anyway: the whole invoice is owed, nothing is claimed", () => {
    expect(settleDecision(explained, "pay", "", "6 abîmés")).toEqual({ ok: true, invoiceTotal: 7626, claimAmount: null, reason: "6 abîmés", owed: 7626 });
  });

  it("asks for a line of explanation when Ordra cannot find the cause", () => {
    const m = settleMath([{ received: 10, damaged: 0, price: 10 }], 0, "value", 90);
    expect(settleDecision(m, "pay", "  ", "")).toEqual({ ok: false, error: "reason_required" });
    expect(settleDecision(m, "pay", "remise", "")).toMatchObject({ ok: true, reason: "remise", claimAmount: null, owed: 90 });
  });

  it("sends no reason when the invoice falls on the count, and none without an invoice", () => {
    const m = settleMath([{ received: 10, damaged: 0, price: 10 }], 0, "value", 100);
    expect(settleDecision(m, "claim", "", "x")).toEqual({ ok: true, invoiceTotal: 100, claimAmount: null, reason: null, owed: 100 });
    const none = settleMath([{ received: 10, damaged: 0, price: 10 }], 0, "value", null);
    expect(settleDecision(none, "claim", "", "x")).toEqual({ ok: true, invoiceTotal: null, claimAmount: null, reason: null, owed: null });
  });
});

describe("dueDateFor", () => {
  it("is today on delivery, today + 30 on credit, or the date picked", () => {
    expect(dueDateFor("2026-10-04", "cod", "")).toBe("2026-10-04");
    expect(dueDateFor("2026-10-04", "30", "")).toBe("2026-11-03");
    expect(dueDateFor("2026-10-04", "date", "2026-12-01")).toBe("2026-12-01");
    expect(dueDateFor("2026-10-04", "date", "")).toBeNull();
  });
});

describe("payOutcome — the sentence under the amount", () => {
  it("clears the bill, and says what the supplier is still owed", () => {
    expect(payOutcome(4200, 4200, 4200)).toEqual({ billRest: 0, supplierRest: 0, over: false });
    expect(payOutcome(4200, 4200, 6000)).toEqual({ billRest: 0, supplierRest: 1800, over: false });
  });
  it("leaves the rest on a partial payment, and flags paying more than is due", () => {
    expect(payOutcome(4200, 1200, 4200)).toEqual({ billRest: 3000, supplierRest: 3000, over: false });
    expect(payOutcome(4200, 5000, 4200).over).toBe(true);
  });
});

describe("poTotal", () => {
  it("adds qty × price on the lines that have both", () => {
    expect(poTotal([{ qty: 160, price: 95 }, { qty: 10, price: null }, { qty: null, price: 4 }])).toBe(15200);
  });
});
