/**
 * Versioned deal terms.
 *
 * A deal's terms (share %, capital, cadence, maturity) are a list of versions,
 * each effective from a date. "Terms on day D" is the version with the
 * greatest `effectiveFrom <= D`. Amendments never rewrite history: a settled
 * period keeps the terms that were in force on each of its days, and the
 * accrual applies the share % PER DAY, so a change inside an open period is
 * exact by construction.
 */

export type PayoutCadence = "monthly" | "quarterly" | "semiannual" | "annual" | "at_maturity";

export interface TermsVersion {
  id?: string;
  effectiveFrom: string; // YYYY-MM-DD
  sharePct: number; // 0 < pct <= 100
  capitalAmount: number;
  payoutCadence: PayoutCadence;
  maturityDate: string; // YYYY-MM-DD
}

/** Sort ascending by effectiveFrom (stable). */
export function sortTerms(terms: TermsVersion[]): TermsVersion[] {
  return [...terms].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
}

/**
 * The version in force on `day`, or null when no version is effective yet
 * (day precedes the first effectiveFrom). `terms` may be unsorted.
 */
export function termsOn(terms: TermsVersion[], day: string): TermsVersion | null {
  const sorted = sortTerms(terms);
  let lo = 0;
  let hi = sorted.length - 1;
  let found: TermsVersion | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].effectiveFrom <= day) {
      found = sorted[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Share % on `day`; 0 before the first version. */
export function sharePctOn(terms: TermsVersion[], day: string): number {
  return termsOn(terms, day)?.sharePct ?? 0;
}

/** Latest version (the one that governs "today" and the maturity date). */
export function currentTerms(terms: TermsVersion[]): TermsVersion | null {
  const sorted = sortTerms(terms);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

/**
 * Validation for an amendment. Old periods keep old terms, so an amendment
 * must take effect strictly after the last settled period_end and no later
 * than the deal's end_date. Returns null when valid, else a reason code.
 */
export function validateAmendment(params: {
  effectiveFrom: string;
  lastSettledPeriodEnd: string | null;
  dealEndDate: string;
  existing: TermsVersion[];
}): null | "TERMS_BEFORE_SETTLED" | "TERMS_AFTER_END" | "TERMS_DUPLICATE_DATE" {
  const { effectiveFrom, lastSettledPeriodEnd, dealEndDate, existing } = params;
  if (lastSettledPeriodEnd && effectiveFrom <= lastSettledPeriodEnd) return "TERMS_BEFORE_SETTLED";
  if (effectiveFrom > dealEndDate) return "TERMS_AFTER_END";
  if (existing.some((t) => t.effectiveFrom === effectiveFrom)) return "TERMS_DUPLICATE_DATE";
  return null;
}
