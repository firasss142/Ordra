import { toMillimes, fromMillimes } from "./math";

/**
 * Folds the append-only investor_ledger into a balance.
 *
 * The ledger is the source of truth — there is no stored balance column to
 * drift out of sync. Every figure the investor sees is derived by replaying
 * immutable entries, which is what makes the number defensible when they
 * question it.
 *
 * The four buckets exist to answer "why can't I withdraw yet?" without a
 * conversation:
 *   pending   — accrued from delivered orders, not yet settled
 *   reserve   — settled but held back against late-arriving returns
 *   available — settled, released, withdrawable right now
 *   withdrawn — lifetime paid out
 */

export type LedgerEntryType =
  | "accrual"
  | "settlement"
  | "reserve_hold"
  | "reserve_release"
  | "withdrawal"
  | "correction"
  | "principal_return";

export interface LedgerEntry {
  entryType: LedgerEntryType;
  /** Signed for accrual/correction; a positive magnitude for the rest. */
  amount: number;
}

export interface InvestorBalance {
  pending: number;
  reserve: number;
  available: number;
  withdrawn: number;
  lifetimeProfit: number;
  principalReturned: number;
}

export function foldLedger(entries: LedgerEntry[]): InvestorBalance {
  // Accumulate in integer millimes so a long ledger cannot drift.
  let pending = 0;
  let reserve = 0;
  let available = 0;
  let withdrawn = 0;
  let lifetimeProfit = 0;
  let principalReturned = 0;

  for (const entry of entries) {
    const amount = toMillimes(entry.amount);

    switch (entry.entryType) {
      // Profit earned. Signed: a late return arrives as a negative correction
      // against pending, never as a clawback of money already withdrawn.
      case "accrual":
      case "correction":
        pending += amount;
        lifetimeProfit += amount;
        break;

      case "settlement":
        pending -= amount;
        available += amount;
        break;

      case "reserve_hold":
        available -= amount;
        reserve += amount;
        break;

      case "reserve_release":
        reserve -= amount;
        available += amount;
        break;

      case "withdrawal":
        available -= amount;
        withdrawn += amount;
        break;

      case "principal_return":
        available -= amount;
        principalReturned += amount;
        break;
    }
  }

  return {
    pending: fromMillimes(pending),
    reserve: fromMillimes(reserve),
    available: fromMillimes(available),
    withdrawn: fromMillimes(withdrawn),
    lifetimeProfit: fromMillimes(lifetimeProfit),
    principalReturned: fromMillimes(principalReturned),
  };
}
