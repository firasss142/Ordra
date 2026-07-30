import { describe, test, expect } from "vitest";
import { foldLedger, type LedgerEntry } from "../investor-balance";

const e = (
  entryType: LedgerEntry["entryType"],
  amount: number
): LedgerEntry => ({ entryType, amount });

describe("foldLedger", () => {
  test("an empty ledger is all zeroes", () => {
    const b = foldLedger([]);
    expect(b).toEqual({
      pending: 0,
      reserve: 0,
      available: 0,
      withdrawn: 0,
      lifetimeProfit: 0,
      principalReturned: 0,
    });
  });

  test("accruals build the pending balance and lifetime profit", () => {
    const b = foldLedger([e("accrual", 1200), e("accrual", 940)]);
    expect(b.pending).toBe(2140);
    expect(b.lifetimeProfit).toBe(2140);
    expect(b.available).toBe(0);
  });

  test("pending is not withdrawable until settled", () => {
    const b = foldLedger([e("accrual", 5000)]);
    expect(b.available).toBe(0);
  });

  test("settlement moves money from pending to available", () => {
    const b = foldLedger([e("accrual", 5000), e("settlement", 5000)]);
    expect(b.pending).toBe(0);
    expect(b.available).toBe(5000);
    expect(b.lifetimeProfit).toBe(5000);
  });

  test("a reserve hold takes money out of available without losing it", () => {
    const b = foldLedger([
      e("accrual", 5000),
      e("settlement", 5000),
      e("reserve_hold", 500),
    ]);
    expect(b.available).toBe(4500);
    expect(b.reserve).toBe(500);
  });

  test("releasing a reserve returns it to available", () => {
    const b = foldLedger([
      e("accrual", 5000),
      e("settlement", 5000),
      e("reserve_hold", 500),
      e("reserve_release", 500),
    ]);
    expect(b.reserve).toBe(0);
    expect(b.available).toBe(5000);
  });

  test("a withdrawal reduces available and accumulates withdrawn", () => {
    const b = foldLedger([
      e("accrual", 5000),
      e("settlement", 5000),
      e("withdrawal", 3000),
    ]);
    expect(b.available).toBe(2000);
    expect(b.withdrawn).toBe(3000);
  });

  test("a withdrawal does not change lifetime profit", () => {
    const b = foldLedger([
      e("accrual", 5000),
      e("settlement", 5000),
      e("withdrawal", 5000),
    ]);
    expect(b.lifetimeProfit).toBe(5000);
    expect(b.available).toBe(0);
  });

  test("a negative correction for a late return reduces pending, not paid money", () => {
    // A return landing after payout must never claw back cash already sent.
    const b = foldLedger([
      e("accrual", 5000),
      e("settlement", 5000),
      e("withdrawal", 5000),
      e("accrual", 2000),
      e("correction", -800),
    ]);

    expect(b.withdrawn).toBe(5000);
    expect(b.pending).toBe(1200);
    expect(b.lifetimeProfit).toBe(6200);
  });

  test("principal return reduces available and is tracked separately", () => {
    const b = foldLedger([
      e("accrual", 3000),
      e("settlement", 3000),
      e("principal_return", 1000),
    ]);
    expect(b.available).toBe(2000);
    expect(b.principalReturned).toBe(1000);
    expect(b.withdrawn).toBe(0);
  });

  test("sums exactly in millimes across a long ledger", () => {
    const entries = Array.from({ length: 500 }, () => e("accrual", 2.375));
    const b = foldLedger(entries);
    expect(b.pending).toBe(1187.5);
    expect(b.lifetimeProfit).toBe(1187.5);
  });

  test("a full lifecycle reconciles", () => {
    const b = foldLedger([
      e("accrual", 10000),
      e("settlement", 10000),
      e("reserve_hold", 1000),
      e("withdrawal", 6000),
      e("reserve_release", 1000),
      e("accrual", 2500),
      e("correction", -300),
    ]);

    expect(b.pending).toBe(2200); // 2500 - 300
    expect(b.reserve).toBe(0);
    expect(b.available).toBe(4000); // 10000 - 1000 - 6000 + 1000
    expect(b.withdrawn).toBe(6000);
    expect(b.lifetimeProfit).toBe(12200);
  });
});
