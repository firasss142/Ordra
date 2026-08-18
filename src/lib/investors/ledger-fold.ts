import { fromMillimes, toMillimes } from "@/lib/calculations/math";

/**
 * Investor v2 ledger fold. Balance is NEVER stored — it is always this fold.
 *
 *  capital_in (±)     → capital_invested
 *  principal_return   → capital_returned
 *  settlement (+)     → settled_lifetime
 *  correction (±)     → corrections
 *  withdrawal (+)     → withdrawn
 *
 *  available          = settled_lifetime + corrections − withdrawn
 *  capital_outstanding= capital_invested − capital_returned
 */
export type LedgerEntryType = "capital_in" | "settlement" | "withdrawal" | "correction" | "principal_return";

export interface LedgerEntryLike {
  entry_type: LedgerEntryType;
  amount: number | string;
  currency?: string;
}

export interface LedgerBalance {
  capitalInvested: number;
  capitalReturned: number;
  capitalOutstanding: number;
  settledLifetime: number;
  corrections: number;
  withdrawn: number;
  available: number;
}

export function foldLedger(entries: LedgerEntryLike[]): LedgerBalance {
  let inv = 0,
    ret = 0,
    set = 0,
    cor = 0,
    wd = 0;
  for (const e of entries) {
    const m = toMillimes(Number(e.amount));
    switch (e.entry_type) {
      case "capital_in":
        inv += m;
        break;
      case "principal_return":
        ret += m;
        break;
      case "settlement":
        set += m;
        break;
      case "correction":
        cor += m;
        break;
      case "withdrawal":
        wd += m;
        break;
    }
  }
  return {
    capitalInvested: fromMillimes(inv),
    capitalReturned: fromMillimes(ret),
    capitalOutstanding: fromMillimes(inv - ret),
    settledLifetime: fromMillimes(set),
    corrections: fromMillimes(cor),
    withdrawn: fromMillimes(wd),
    available: fromMillimes(set + cor - wd),
  };
}

/** Fold per currency (a portfolio never sums across currencies). */
export function foldLedgerByCurrency(entries: LedgerEntryLike[]): Map<string, LedgerBalance> {
  const groups = new Map<string, LedgerEntryLike[]>();
  for (const e of entries) {
    const c = e.currency ?? "?";
    (groups.get(c) ?? groups.set(c, []).get(c)!).push(e);
  }
  const out = new Map<string, LedgerBalance>();
  for (const [c, list] of groups) out.set(c, foldLedger(list));
  return out;
}
