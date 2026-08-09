import type { CoverageState } from "./coverage";

/**
 * Which carrier the post-confirm sheet should pre-select.
 *
 * Extracted from PostCallActionSheet's auto-select effect so the behaviour
 * change (prefer the cheapest account) is testable outside React, and so the
 * pre-existing "exactly one carrier" rule is pinned rather than quietly replaced.
 */

export interface InitialCarrierInput {
  carriers: Array<{ id: string; code: string }>;
  coverageOf: (code: string) => CoverageState;
  recommendedCarrierId: string | null;
  currentSelection: string | null;
}

export function pickInitialCarrier(input: InitialCarrierInput): string | null {
  // The agent's own choice always wins — a late-arriving recommendation must
  // never move the selection out from under them.
  if (input.currentSelection !== null) return input.currentSelection;

  // "uncovered" is a confident gap (some other carrier recognises the city and
  // this one doesn't). "unknown" is not — the carrier's own picker resolves it.
  const selectable = (c: { code: string }) => input.coverageOf(c.code) !== "uncovered";

  if (input.recommendedCarrierId) {
    const recommended = input.carriers.find((c) => c.id === input.recommendedCarrierId);
    if (recommended && selectable(recommended)) return recommended.id;
    // A recommended-but-uncovered carrier falls through rather than being
    // silently swapped for a different one: cheapest is worthless if it can't
    // reach the customer, and picking a substitute would hide the problem.
    return null;
  }

  // Pre-existing rule, preserved: one carrier and it's usable → select it.
  if (input.carriers.length === 1 && selectable(input.carriers[0])) {
    return input.carriers[0].id;
  }

  return null;
}
